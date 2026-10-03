import fs from 'node:fs';
import { neon } from '@neondatabase/serverless';

export function migrationStatements(text) {
 const statements=[];let start=0,dollar=false,single=false,double=false;
 for(let i=0;i<text.length;i++) {
  const c=text[i],n=text[i+1];
  if(!single&&!double&&text.slice(i,i+2)==='$$'){dollar=!dollar;i++;continue;}
  if(!dollar&&!double&&c==="'" ){
   if(single&&n==="'"){i++;continue;}
   single=!single;continue;
  }
  if(!dollar&&!single&&c==='"'){
   if(double&&n==='"'){i++;continue;}
   double=!double;continue;
  }
  if(c===';'&&!dollar&&!single&&!double){const s=text.slice(start,i).trim();if(s)statements.push(s);start=i+1;}
 }
 const last=text.slice(start).trim();if(last)statements.push(last);
 if(single||double||dollar)throw new Error('Unterminated SQL quote in Yad2 migration');
 return statements;
}
if(!process.env.DATABASE_URL)console.log('Yad2 schema migration skipped: DATABASE_URL is not configured.');
else {
 const direct=new URL(process.env.DATABASE_URL_UNPOOLED??process.env.DATABASE_URL);
 direct.hostname=direct.hostname.replace('-pooler.','.');
 const sql=neon(direct.toString());
 const files=['011_yad2_scrapingbee.sql','012_yad2_focused_scopes.sql','013_yad2_publication_cache.sql','014_yad2_incremental.sql'];
 if(process.env.YAD2_APPLY_STAGING_MIGRATION==='true')files.push('015_yad2_staging.sql');
 const text=files.map(file=>fs.readFileSync(new URL('../db/'+file,import.meta.url),'utf8')).join('\n');
 await sql.transaction(migrationStatements(text).map(s=>sql.query(s)));
 console.log('Yad2 dataset and change history schema ready.');
}
