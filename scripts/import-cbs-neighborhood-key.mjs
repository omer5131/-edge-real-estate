import {spawnSync} from 'node:child_process';
import {neon} from '@neondatabase/serverless';

if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL is required');
const parsed=spawnSync('python3',['scripts/parse-cbs-neighborhood-key.py'],{encoding:'utf8',maxBuffer:50*1024*1024});
if(parsed.status!==0)throw new Error(parsed.stderr||'CBS parser failed');
const doc=JSON.parse(parsed.stdout);
if(!Array.isArray(doc.rows)||!doc.rows.length)throw new Error('CBS key returned no rows');

const sql=neon(process.env.DATABASE_URL);
let imported=0;
for(let i=0;i<doc.rows.length;i+=100){
  const batch=doc.rows.slice(i,i+100);
  const queries=batch.map(r=>sql.query(
    `INSERT INTO cbs_neighborhood_stat_area_key(
      locality_code,locality_name,statistical_area_code,neighborhood_names_raw,main_streets_raw,
      neighborhood_names,main_streets,source_url,source_row,source_version,raw,imported_at
    ) VALUES($1,$2,$3,$4,$5,$6::text[],$7::text[],$8,$9,$10,$11::jsonb,now())
    ON CONFLICT(locality_code,statistical_area_code,source_version) DO UPDATE SET
      locality_name=EXCLUDED.locality_name,neighborhood_names_raw=EXCLUDED.neighborhood_names_raw,
      main_streets_raw=EXCLUDED.main_streets_raw,neighborhood_names=EXCLUDED.neighborhood_names,
      main_streets=EXCLUDED.main_streets,source_url=EXCLUDED.source_url,source_row=EXCLUDED.source_row,
      raw=EXCLUDED.raw,imported_at=now()`,
    [r.locality_code,r.locality_name,r.statistical_area_code,r.neighborhood_names_raw,r.main_streets_raw,
     r.neighborhood_names,r.main_streets,r.source_url,r.source_row,r.source_version,JSON.stringify(r.raw)]
  ));
  await sql.transaction(queries); imported+=batch.length;
}
console.log(JSON.stringify({ok:true,source:doc.source_url,headerRow:doc.header_row,rows:imported},null,2));
