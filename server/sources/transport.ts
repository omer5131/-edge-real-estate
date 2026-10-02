
import { sql } from '../db.js';
import { sha256 } from '../normalize.js';

const TARGETS=[
  {slug:'kiryat-eliezer-haifa',lat:32.82646,lon:34.97872},
  {slug:'kiryat-sprinzak-haifa',lat:32.82023,lon:34.96238},
  {slug:'kiryat-nordau-netanya',lat:32.28286,lon:34.85575},
  {slug:'yoseftal-petah-tikva',lat:32.09283,lon:34.90590},
];

type Dataset={id:string;sourceId:string;category:string;planned:boolean};
const DATASETS:Dataset[]=[
  {id:'bus_stops',sourceId:'mot_bus_stops',category:'public_transport_stop',planned:false},
  {id:'bus_terminal_strat',sourceId:'mot_planned_terminals',category:'planned_terminal',planned:true},
];

async function fetchText(url:string){
  const c=new AbortController(); const t=setTimeout(()=>c.abort(),30000);
  try{const r=await fetch(url,{headers:{'user-agent':'EdgeRealEstate/1.0'},signal:c.signal});if(!r.ok)throw new Error('transport '+r.status);return r.text()}
  finally{clearTimeout(t)}
}
async function fetchJson(url:string){return JSON.parse(await fetchText(url))}

function parseCsv(s:string){
  const rows:string[][]=[];let row:string[]=[],cell='',q=false;
  for(let i=0;i<s.length;i++){
    const ch=s[i];
    if(ch==='"'&&s[i+1]==='"'){cell+='"';i++;continue}
    if(ch==='"'){q=!q;continue}
    if(ch===','&&!q){row.push(cell);cell='';continue}
    if((ch==='\n'||ch==='\r')&&!q){if(ch==='\r'&&s[i+1]==='\n')i++;row.push(cell);cell='';if(row.some(x=>x!==''))rows.push(row);row=[];continue}
    cell+=ch;
  }
  if(cell||row.length){row.push(cell);rows.push(row)}
  const head=(rows.shift()||[]).map(x=>x.trim());
  return rows.map(r=>Object.fromEntries(head.map((h,i)=>[h,(r[i]??'').trim()])));
}
function key(o:any,names:string[]){
  const keys=Object.keys(o);for(const n of names){const k=keys.find(x=>x.toLowerCase()===n.toLowerCase());if(k&&o[k]!==''&&o[k]!=null)return o[k]}
  for(const n of names){const k=keys.find(x=>x.toLowerCase().includes(n.toLowerCase()));if(k&&o[k]!==''&&o[k]!=null)return o[k]}
  return null;
}
function toNum(v:any){if(v==null)return null;const x=Number(String(v).replace(/,/g,''));return Number.isFinite(x)?x:null}
function distanceKm(aLat:number,aLon:number,bLat:number,bLon:number){
  const R=6371,rad=Math.PI/180,dLat=(bLat-aLat)*rad,dLon=(bLon-aLon)*rad;
  const s=Math.sin(dLat/2)**2+Math.cos(aLat*rad)*Math.cos(bLat*rad)*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(s));
}

async function csvUrl(packageId:string){
  const p=await fetchJson('https://data.gov.il/api/3/action/package_show?id='+encodeURIComponent(packageId));
  const resources=p?.result?.resources||[];
  const r=resources.find((x:any)=>String(x.format||'').toLowerCase()==='csv'&&x.url) ||
          resources.find((x:any)=>String(x.url||'').toLowerCase().includes('.csv'));
  return r?.url?String(r.url):null;
}

export async function ingestTransportInfrastructure(runId:string){
  let fetched=0,inserted=0,updated=0,errors=0;
  for(const ds of DATASETS){
    try{
      const url=await csvUrl(ds.id); if(!url)throw new Error('No CSV resource for '+ds.id);
      const text=await fetchText(url);
      const rows=parseCsv(text); fetched+=rows.length;
      for(const row of rows){
        let lat=toNum(key(row,['latitude','lat','wgs84_lat','stop_lat']));
        let lon=toNum(key(row,['longitude','lon','lng','wgs84_lon','stop_lon']));
        if(lat==null||lon==null||lat<29||lat>34||lon<34||lon>36)continue;
        const matches=TARGETS.map(t=>({...t,d:distanceKm(t.lat,t.lon,lat!,lon!)})).filter(t=>t.d<=2.0);
        if(!matches.length)continue;
        const target=matches.sort((a,b)=>a.d-b.d)[0];
        const n=await sql`SELECT id FROM neighborhoods WHERE slug=${target.slug} LIMIT 1`;if(!n.length)continue;
        const name=String(key(row,['stop_name','name','station_name','facility_name','שם תחנה','שם'])||ds.category);
        const ext=String(key(row,['stop_id','id','facility_id','station_id','code'])||sha256({ds:ds.id,name,lat,lon}));
        const h=sha256(row);
        const raw=await sql`
          INSERT INTO raw_records(source_id,external_id,entity_hint,payload_hash,payload,ingestion_run_id)
          VALUES(${ds.sourceId},${ext},'infrastructure',${h},${JSON.stringify(row)}::jsonb,${runId}::uuid)
          ON CONFLICT(source_id,external_id,payload_hash) DO UPDATE SET observed_at=now()
          RETURNING id`;
        const existed=await sql`SELECT 1 FROM infrastructure_projects WHERE source_id=${ds.sourceId} AND source_project_id=${ext}`;
        await sql`
          INSERT INTO infrastructure_projects(source_id,source_project_id,neighborhood_id,name,category,status,description,geom,lat,lon,source_url,raw_record_id,source_updated_at)
          VALUES(${ds.sourceId},${ext},${String(n[0].id)}::uuid,${name},${ds.category},${ds.planned?'planned':'existing'},${null},
            ST_SetSRID(ST_MakePoint(${lon},${lat}),4326),${lat},${lon},${url},${Number(raw[0].id)},now())
          ON CONFLICT(source_id,source_project_id) DO UPDATE SET neighborhood_id=EXCLUDED.neighborhood_id,name=EXCLUDED.name,category=EXCLUDED.category,
            status=EXCLUDED.status,geom=EXCLUDED.geom,lat=EXCLUDED.lat,lon=EXCLUDED.lon,source_url=EXCLUDED.source_url,
            raw_record_id=EXCLUDED.raw_record_id,source_updated_at=now(),observed_at=now()`;
        existed.length?updated++:inserted++;
      }
    }catch(e){errors++;console.error('transport dataset',ds.id,e)}
  }
  return {fetched,inserted,updated,errors};
}
