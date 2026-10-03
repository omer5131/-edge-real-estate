import {inflateRawSync} from 'node:zlib';
import fs from 'node:fs';
import {neon} from '@neondatabase/serverless';

const URL='https://www.cbs.gov.il/he/publications/DocLib/2022/%D7%A7%D7%98%D7%9C%D7%95%D7%92/1.%20%D7%99%D7%99%D7%A9%D7%95%D7%91%D7%99%D7%9D%20%D7%95%D7%97%D7%9C%D7%95%D7%A7%D7%95%D7%AA%20%D7%92%D7%90%D7%95%D7%92%D7%A8%D7%A4%D7%99%D7%95%D7%AA/%D7%A8%D7%97%D7%95%D7%91%D7%95%D7%AA%20%D7%A2%D7%99%D7%A7%D7%A8%D7%99%D7%99%D7%9D%20%D7%95%D7%A9%D7%9B%D7%95%D7%A0%D7%95%D7%AA%20%D7%9C%D7%90%D7%A1%202022.xlsx';
const FALLBACK_URL='https://www.cbs.gov.il/he/mediarelease/doclib/2022/026/%D7%A8%D7%97%D7%95%D7%91%D7%95%D7%AA%20%D7%A2%D7%99%D7%A7%D7%A8%D7%99%D7%99%D7%9D%20%D7%95%D7%A9%D7%9B%D7%95%D7%A0%D7%95%D7%AA%20%D7%9C%D7%90%D7%A1%202022.xlsx';
if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL is required');
const sql=neon(process.env.DATABASE_URL);

function unzip(buffer){
 const b=Buffer.from(buffer);
 let eocd=-1;
 for(let i=b.length-22;i>=Math.max(0,b.length-65557);i--){
  if(b.readUInt32LE(i)===0x06054b50){eocd=i;break;}
 }
 if(eocd<0)throw new Error('Invalid ZIP: EOCD not found');
 const count=b.readUInt16LE(eocd+10),central=b.readUInt32LE(eocd+16);
 const files=new Map();let p=central;
 for(let i=0;i<count;i++){
  if(b.readUInt32LE(p)!==0x02014b50)throw new Error('Invalid ZIP central directory');
  const method=b.readUInt16LE(p+10),compressed=b.readUInt32LE(p+20),nameLen=b.readUInt16LE(p+28),extraLen=b.readUInt16LE(p+30),commentLen=b.readUInt16LE(p+32),local=b.readUInt32LE(p+42);
  const name=b.subarray(p+46,p+46+nameLen).toString('utf8');
  if(b.readUInt32LE(local)!==0x04034b50)throw new Error('Invalid ZIP local header');
  const ln=b.readUInt16LE(local+26),le=b.readUInt16LE(local+28),start=local+30+ln+le;
  const data=b.subarray(start,start+compressed);
  files.set(name,method===0?data:method===8?inflateRawSync(data):(()=>{throw new Error('Unsupported ZIP compression '+method)})());
  p+=46+nameLen+extraLen+commentLen;
 }
 return files;
}
const xmlDecode=s=>String(s??'').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&').replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n)));
const stripTags=s=>xmlDecode(String(s??'').replace(/<[^>]+>/g,''));
const colIndex=ref=>{
 const m=String(ref||'').match(/^([A-Z]+)/);if(!m)return 0;let n=0;
 for(const c of m[1])n=n*26+c.charCodeAt(0)-64;
 return n-1;
};
const norm=v=>String(v??'').replace(/\s+/g,' ').trim();
const tokens=v=>{
 const out=[];
 for(const part of norm(v).split(/\s*[,;/]\s*/)){const p=norm(part);if(p&&!out.includes(p))out.push(p);}
 return out;
};
function parseXlsx(buffer){
 const files=unzip(buffer);
 const shared=[];
 const sharedXml=files.get('xl/sharedStrings.xml');
 if(sharedXml){
  const xml=sharedXml.toString('utf8');
  for(const m of xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)){
   shared.push([...m[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(x=>xmlDecode(x[1])).join(''));
  }
 }
 const sheetName=[...files.keys()].find(x=>/^xl\/worksheets\/sheet\d+\.xml$/.test(x));
 if(!sheetName)throw new Error('Worksheet not found');
 const xml=files.get(sheetName).toString('utf8');
 const rows=[];
 for(const rm of xml.matchAll(/<row\b[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)){
  const rownum=Number(rm[1]),vals={};
  for(const cm of rm[2].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)){
   const attrs=cm[1],body=cm[2],ref=attrs.match(/\br="([^"]+)"/)?.[1],type=attrs.match(/\bt="([^"]+)"/)?.[1];
   const idx=colIndex(ref);let value='';
   if(type==='inlineStr')value=[...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(x=>xmlDecode(x[1])).join('');
   else {
    const raw=body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/)?.[1]??'';
    value=type==='s'?(shared[Number(raw)]??''):xmlDecode(raw);
   }
   vals[idx]=norm(value);
  }
  rows.push({rownum,vals});
 }
 let header;
 for(const r of rows.slice(0,50)){
  const joined=Object.values(r.vals).join(' | ');
  if(joined.includes('יישוב')&&joined.includes('סטטיסטי')&&(joined.includes('שכונ')||joined.includes('רחוב'))){header=r;break;}
 }
 if(!header)throw new Error('Could not detect CBS header row');
 const find=(...needles)=>Object.entries(header.vals).find(([,h])=>needles.every(n=>String(h).includes(n)))?.[0];
 const cLocality=find('שם','יישוב'),cCode=find('סמל','יישוב'),cStat=find('אזור','סטטיסטי'),cNeigh=find('שכונ'),cStreet=find('רחוב');
 if(cLocality==null||cCode==null||cStat==null)throw new Error('Missing CBS columns: '+JSON.stringify(header.vals));
 const out=[];
 for(const r of rows){
  if(r.rownum<=header.rownum)continue;
  const locality=norm(r.vals[cLocality]),code=norm(r.vals[cCode]).replace(/\.0+$/,''),stat=norm(r.vals[cStat]).replace(/\.0+$/,'');
  if(!locality||!code||!stat)continue;
  const neigh=cNeigh==null?'':norm(r.vals[cNeigh]),street=cStreet==null?'':norm(r.vals[cStreet]);
  out.push({locality_code:code,locality_name:locality,statistical_area_code:stat,neighborhood_names_raw:neigh||null,main_streets_raw:street||null,neighborhood_names:tokens(neigh),main_streets:tokens(street),source_url:URL,source_row:r.rownum,source_version:'cbs-2022',raw:r.vals});
 }
 return {headerRow:header.rownum,headers:header.vals,rows:out};
}

const [freshness]=await sql`
  SELECT count(*)::int rows,max(imported_at) latest_import
  FROM cbs_neighborhood_stat_area_key
`;
const latest=freshness?.latest_import?new Date(freshness.latest_import).getTime():0;
const maxAgeMs=30*86400000;
if(process.env.CBS_FORCE_IMPORT!=='true'&&Number(freshness?.rows??0)>0&&Date.now()-latest<maxAgeMs){
 console.log(JSON.stringify({ok:true,skipped:true,reason:'CBS key is fresh',rows:freshness.rows,latestImport:freshness.latest_import},null,2));
 process.exit(0);
}

let fileBuffer;
if(process.env.CBS_XLSX_PATH){
 fileBuffer=fs.readFileSync(process.env.CBS_XLSX_PATH);
}else{
 let lastError;
 for(const downloadUrl of [URL,FALLBACK_URL]){
  for(let attempt=1;attempt<=4;attempt++){
   try{
    const resp=await fetch(downloadUrl,{headers:{'user-agent':'Mozilla/5.0','accept':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,*/*'}});
    if(!resp.ok)throw new Error('CBS download failed '+resp.status+' from '+downloadUrl);
    const candidate=Buffer.from(await resp.arrayBuffer());
    if(candidate.length<1024||candidate.readUInt16LE(0)!==0x4b50)throw new Error('CBS response is not a valid XLSX/ZIP from '+downloadUrl);
    fileBuffer=candidate;break;
   }catch(error){lastError=error;if(attempt<4)await new Promise(r=>setTimeout(r,attempt*1500));}
  }
  if(fileBuffer)break;
 }
 if(!fileBuffer)throw lastError??new Error('CBS download failed from all configured URLs');
}
const doc=parseXlsx(fileBuffer);
if(!doc.rows.length)throw new Error('CBS key returned no rows');

let imported=0;
for(let i=0;i<doc.rows.length;i+=100){
 const batch=doc.rows.slice(i,i+100);
 await sql.transaction(batch.map(r=>sql.query(
  `INSERT INTO cbs_neighborhood_stat_area_key(
    locality_code,locality_name,statistical_area_code,neighborhood_names_raw,main_streets_raw,
    neighborhood_names,main_streets,source_url,source_row,source_version,raw,imported_at
  ) VALUES($1,$2,$3,$4,$5,$6::text[],$7::text[],$8,$9,$10,$11::jsonb,now())
  ON CONFLICT(locality_code,statistical_area_code,source_version) DO UPDATE SET
    locality_name=EXCLUDED.locality_name,neighborhood_names_raw=EXCLUDED.neighborhood_names_raw,
    main_streets_raw=EXCLUDED.main_streets_raw,neighborhood_names=EXCLUDED.neighborhood_names,
    main_streets=EXCLUDED.main_streets,source_url=EXCLUDED.source_url,source_row=EXCLUDED.source_row,
    raw=EXCLUDED.raw,imported_at=now()`,
  [r.locality_code,r.locality_name,r.statistical_area_code,r.neighborhood_names_raw,r.main_streets_raw,r.neighborhood_names,r.main_streets,r.source_url,r.source_row,r.source_version,JSON.stringify(r.raw)]
 )));
 imported+=batch.length;
}
console.log(JSON.stringify({ok:true,source:URL,headerRow:doc.headerRow,headers:doc.headers,rows:imported},null,2));
