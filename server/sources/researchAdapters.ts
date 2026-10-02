import {queryDatabase as query,databaseTransaction as transaction} from '../db.js';
import {overJson,payloadHash,datasetTable,identifier,type ArchiveRow} from './overApi.js';
import {type ResearchDataset} from './researchSemantics.js';
export function parseCsv(text:string):Record<string,string>[] {
 const result:string[][]=[];let row:string[]=[],field='',quoted=false;
 for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){field+='"';i++;}else quoted=!quoted;}else if(!quoted&&(c===','||c==='\n')){row.push(field.replace(/\r$/,''));field='';if(c==='\n'){result.push(row);row=[];}}else field+=c;}
 if(quoted)throw new Error('Malformed CSV: unclosed quoted field');
 if(field||row.length){row.push(field.replace(/\r$/,''));result.push(row);}
 const header=result.shift()?.map(s=>s.replace(/^\uFEFF/,''))??[];
 if(!header.length||new Set(header).size!==header.length)throw new Error('Invalid CSV header');
 return result.filter(r=>r.some(Boolean)).map(r=>{if(r.length!==header.length)throw new Error('Malformed CSV row');return Object.fromEntries(header.map((k,i)=>[k,r[i]]));});
}
export function featureRows(features:any[]):ArchiveRow[] {
 return features.map(f=>{if(!f||!f.properties||!f.geometry)throw new Error('Invalid GeoJSON feature');const p={...f.properties,geometry:f.geometry};delete p.geom;const hash=payloadHash(p);return {...p,row_hash:String(p._row_hash??hash),first_seen:p._first_seen??p.first_seen??'1970-01-01T00:00:00Z'};});
}
export function boiRows(csv:string):ArchiveRow[] {
 const rows=parseCsv(csv);
 return rows.map(r=>{if(!r.SERIES_CODE||!/^\d{4}(-[A-Z0-9]+)*$/.test(r.TIME_PERIOD??''))throw new Error('Missing SDMX series or observation period');return {series_code:r.SERIES_CODE,observation_period:r.TIME_PERIOD,value:r.OBS_VALUE,attributes:r,row_hash:r.SERIES_CODE+':'+r.TIME_PERIOD,first_seen:'1970-01-01T00:00:00Z'};}).filter(r=>Number(r.observation_period.slice(0,4))>=2022);
}
async function csvFetch(url:string,deadline:number) {
 const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),Math.min(55000,deadline-Date.now()));
 try {const r=await fetch(url,{signal:controller.signal,headers:{Accept:'text/csv'}});if(!r.ok)throw new Error(`BOI HTTP ${r.status}`);const text=await r.text();if(text.length>40000000)throw new Error('BOI response exceeds bounded import size');if(/^\s*</.test(text))throw new Error('BOI returned HTML/XML instead of CSV');return text;}finally{clearTimeout(timeout);}
}
async function save(d:any,rows:ArchiveRow[],cursor:any,runId:string) {
 const input=rows.map(r=>({hash:payloadHash(r),key:r.row_hash,payload:r}));
 const result=await query(`WITH inserted AS(INSERT INTO ${identifier(datasetTable(d.dataset_id))}(_edge_hash,_edge_source_key,_edge_payload) SELECT value->>'hash',value->>'key',value->'payload' FROM jsonb_array_elements($1::jsonb) ON CONFLICT(_edge_hash) DO NOTHING RETURNING 1), ds AS(UPDATE over_datasets SET cursor=$2::jsonb,status='syncing',row_count=row_count+(SELECT count(*) FROM inserted),last_checked_at=now(),last_error=NULL WHERE dataset_id=$3::uuid RETURNING 1), run AS(UPDATE over_sync_runs SET fetched_count=fetched_count+$4,inserted_count=inserted_count+(SELECT count(*) FROM inserted),checkpoint=$2::jsonb WHERE id=$5::uuid RETURNING 1) SELECT count(*)::int inserted FROM inserted`,[JSON.stringify(input),JSON.stringify(cursor),d.dataset_id,rows.length,runId]);
 return Number(result[0].inserted);
}
export async function ingestResearchAdapter(def:ResearchDataset,d:any,runId:string,deadline:number,maxPages:number) {
 let fetched=0,inserted=0,complete=false;
 let cursor=d.cursor??{phase:!d.watermark?'backfill':'daily',offset:0,year:!d.watermark?2022:new Date().getUTCFullYear()-1};
 for(let page=0;page<maxPages&&Date.now()<deadline-3000;page++){
  let rows:ArchiveRow[]=[];
  if(def.adapter==='features'){
   const response=await overJson(`/api/tables/${encodeURIComponent(def.sourceTable!)}/features?limit=1000&offset=${cursor.offset}`,deadline);
   if(response.type!=='FeatureCollection'||!Array.isArray(response.features))throw new Error('Invalid GeoJSON collection');
   rows=featureRows(response.features);cursor={...cursor,offset:cursor.offset+rows.length};complete=!rows.length;
  }else if(def.adapter==='native'){
   const listing=def.sourceTable==='yad2_dataset';
   const id=listing?'listing_id':'id';
   const params:any[]=[cursor.lastKey??''];
   let filter=`${identifier(id)}::text > $1`;
   if(listing){params.push(def.slug==='sale_listings'?'sale':'rent');filter+=' AND market=$2';}
   const result=await query(`SELECT ${identifier(id)}::text key,to_jsonb(s)-'geom'-'last_seen_at'-'observed_at'-'raw_record_id' payload FROM ${identifier(def.sourceTable!)} s WHERE ${filter} ORDER BY ${identifier(id)}::text LIMIT 1000`,params);
   rows=result.map(r=>({...r.payload,first_seen:r.payload.first_seen_at??'1970-01-01T00:00:00Z',row_hash:r.key}));
   cursor={...cursor,lastKey:result.at(-1)?.key??cursor.lastKey};complete=!rows.length;
  }else if(def.adapter==='boi'){
   const year=cursor.year;
   const url=`https://edge.boi.gov.il/FusionEdgeServer/sdmx/v2/data/dataflow/BOI.STATISTICS/${encodeURIComponent(def.sourceTable!)}/1.0/?`+new URLSearchParams({format:'csv',startPeriod:String(year),endPeriod:String(year)+'-12-31'});
   rows=boiRows(await csvFetch(url,deadline));cursor={...cursor,year:year+1};complete=cursor.year>new Date().getUTCFullYear();
  }else throw new Error(def.blockedReason??'No supported adapter');
  inserted+=await save(d,rows,cursor,runId);fetched+=rows.length;
  if(complete)break;
 }
 if(complete)await transaction([{text:`UPDATE over_datasets SET cursor=NULL,watermark=$2::jsonb,status='healthy',last_checked_at=now(),last_success_at=now(),last_error=NULL WHERE dataset_id=$1::uuid`,params:[d.dataset_id,JSON.stringify({seen:new Date().toISOString(),hash:'snapshot'})]},{text:`UPDATE over_sync_runs SET status='success',finished_at=now() WHERE id=$1::uuid`,params:[runId]}]);
 else await query(`UPDATE over_sync_runs SET status='checkpointed',finished_at=now() WHERE id=$1::uuid`,[runId]);
 return {datasetId:d.dataset_id,phase:cursor.phase,fetched,inserted,complete};
}
