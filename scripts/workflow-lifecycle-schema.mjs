import {neon} from '@neondatabase/serverless';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
if(!process.env.DATABASE_URL)throw Error('Configured DATABASE_URL required');
const sql=neon(process.env.DATABASE_URL),apply=process.argv.includes('--apply-reviewed-lifecycle');
const required={listings:['id','source_id','source_listing_id','first_seen_at','last_seen_at'],listing_snapshots:['listing_id','observed_at','asking_price_nis'],listing_market_benchmarks:['listing_id','days_on_market','first_asking_price_nis','price_change_since_first_pct','snapshot_count','evidence'],semantic_metrics:['metric_key','confidence_rule','description','caveats']};
const columns=await sql.query("select table_name,column_name,ordinal_position from information_schema.columns where table_schema='public' and table_name=any($1::text[])",[[...Object.keys(required),'listing_seller_signals']]);
for(const [table,fields] of Object.entries(required))for(const field of fields)assert(columns.some(x=>x.table_name===table&&x.column_name===field),table+'.'+field+' required');
const view=columns.filter(x=>x.table_name==='listing_seller_signals').sort((a,b)=>a.ordinal_position-b.ordinal_position).map(x=>x.column_name);
assert.deepEqual(view.slice(0,10),['listing_id','source_id','source_listing_id','first_seen_at','last_seen_at','days_on_market','price_reductions','original_asking_price','current_asking_price','total_reduction_pct']);
assert(view.length===10||view.length===13,'Unexpected seller-view contract; stop before DDL');
if(view.length===13)assert.deepEqual(view.slice(10),['snapshot_count','observed_span_days','lifecycle_evidence']);
const fingerprint="select md5(coalesce(string_agg((to_jsonb(b)-array['days_on_market','first_asking_price_nis','price_change_since_first_pct','snapshot_count','evidence'])::text,E'\\n' order by listing_id),'')) fingerprint from listing_market_benchmarks b";
if(apply){
 const text=await readFile(new URL('../db/033_observed_listing_lifecycle.sql',import.meta.url),'utf8');
 const statements=text.replace(/--[^\n]*/g,'').split(';').map(x=>x.trim()).filter(Boolean);
 assert.equal(statements.length,3);assert.match(statements[0],/^CREATE OR REPLACE VIEW listing_seller_signals AS/i);assert.match(statements[1],/^WITH life AS/i);assert.match(statements[2],/^UPDATE semantic_metrics SET/i);
 const results=await sql.transaction([sql.query('LOCK TABLE listing_market_benchmarks IN SHARE ROW EXCLUSIVE MODE'),sql.query(fingerprint),...statements.map(s=>sql.query(s)),sql.query(fingerprint)]);
 assert.equal(results[1][0].fingerprint,results.at(-1)[0].fingerprint,'Benchmark prices/valuation/confidence must remain unchanged');
}
const [subject]=await sql.query("select b.days_on_market benchmark_dom,s.days_on_market seller_dom from listing_market_benchmarks b join listing_seller_signals s on s.listing_id=b.listing_id where b.listing_id=$1::uuid",['6fadc597-6c65-4aef-a088-13261d5fd7cc']);
if(apply){assert.equal(subject.benchmark_dom,null);assert.equal(subject.seller_dom,null);}
console.log(JSON.stringify({derivedLifecycleReconciled:apply,subject,sourceRowsChanged:0,valuationFieldsChanged:0,productionQARecords:0}));
