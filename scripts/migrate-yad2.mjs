import fs from 'node:fs';
import { neon } from '@neondatabase/serverless';
export function migrationStatements(text) {
 const statements=[];let start=0,inFunction=false;
 for(let i=0;i<text.length;i++) {
  if(text.slice(i,i+2)==='$$'){inFunction=!inFunction;i++;continue;}
  if(text[i]===';'&&!inFunction){const s=text.slice(start,i).trim();if(s)statements.push(s);start=i+1;}
 }
 const last=text.slice(start).trim();if(last)statements.push(last);return statements;
}
if(!process.env.DATABASE_URL)console.log('Yad2 schema migration skipped: DATABASE_URL is not configured.');
else {
 const sql=neon(process.env.DATABASE_URL);
 const text=['011_yad2_scrapingbee.sql','012_yad2_focused_scopes.sql'].map(file=>fs.readFileSync(new URL('../db/'+file,import.meta.url),'utf8')).join('\n');
 await sql.transaction(migrationStatements(text).map(s=>sql.query(s)));
 console.log('Yad2 dataset and change history schema ready.');
}
