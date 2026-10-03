import fs from 'node:fs';
import {neon} from '@neondatabase/serverless';

function statements(text){
 const out=[];let start=0;let dollar=false;
 for(let i=0;i<text.length;i++){
  if(text.slice(i,i+2)==='$$'){dollar=!dollar;i++;continue;}
  if(text[i]===';'&&!dollar){const s=text.slice(start,i).trim();if(s)out.push(s);start=i+1;}
 }
 const tail=text.slice(start).trim();if(tail)out.push(tail);return out;
}

if(!process.env.DATABASE_URL)console.log('Area intelligence migration skipped: DATABASE_URL is not configured.');
else{
 const sql=neon(process.env.DATABASE_URL);
 const text=['015_area_intelligence.sql','016_statistical_area_identity.sql','017_neighborhood_intelligence.sql','018_semantic_graph.sql'].map(file=>fs.readFileSync(new URL('../db/'+file,import.meta.url),'utf8')).join('\n');
 await sql.transaction(statements(text).map(s=>sql.query(s)));
 console.log('Area intelligence schema ready.');
}
