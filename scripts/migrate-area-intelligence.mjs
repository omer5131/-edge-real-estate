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
 const text=fs.readFileSync(new URL('../db/015_area_intelligence.sql',import.meta.url),'utf8');
 await sql.transaction(statements(text).map(s=>sql.query(s)));
 console.log('Area intelligence schema ready.');
}
