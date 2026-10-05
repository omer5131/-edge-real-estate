import {neon} from '@neondatabase/serverless';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
if(!process.env.DATABASE_URL)throw Error('DATABASE_URL is required for the configured workflow schema check');
const sql=neon(process.env.DATABASE_URL),apply=process.argv.includes('--apply-reviewed-tasks');
const required={deals:['id','listing_id','stage','status','next_action'],due_diligence_items:['id','deal_id','notes','evidence'],deal_scenarios:['id','deal_id','assumptions','outputs','is_primary'],investment_notes:['id','deal_id','content','evidence_url'],deal_events:['id','deal_id','payload']};
const columns=await sql.query("select table_name,column_name from information_schema.columns where table_schema='public' and table_name=any($1::text[])",[Object.keys(required)]);
for(const [table,fields] of Object.entries(required))for(const column of fields)assert(columns.some(x=>x.table_name===table&&x.column_name===column),`Required workflow contract absent: ${table}.${column}`);
if(apply){
 const migration=await readFile(new URL('../db/032_deal_tasks.sql',import.meta.url),'utf8');
 assert(!/\b(drop|truncate|delete|update|alter)\b/i.test(migration),'Only additive task table/index DDL is accepted');
 const statements=migration.split(';').map(s=>s.trim()).filter(Boolean);
 await sql.transaction(statements.map(s=>sql.query(s)));
}
const tasks=await sql.query("select column_name,data_type from information_schema.columns where table_schema='public' and table_name='deal_tasks'");
if(tasks.length||apply)for(const column of ['id','deal_id','dd_item_id','title','assignee','due_date','status','source_url','observed_at','result','updated_at'])assert(tasks.some(x=>x.column_name===column),'Task contract absent: '+column);
console.log(JSON.stringify({existingWorkflowContract:'verified',taskSchemaReady:tasks.length>0,additiveMigrationApplied:apply,productionTestRecordsCreated:0}));
