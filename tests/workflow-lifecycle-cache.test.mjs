import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
test('Derived lifecycle view/cache and future materialization require observed history without repricing',async()=>{
 const db=new PGlite();try{
 await db.exec(`CREATE TABLE neighborhoods(id uuid PRIMARY KEY);
 CREATE TABLE listings(id uuid PRIMARY KEY,neighborhood_id uuid,status text,source_id text,source_listing_id text,first_seen_at timestamptz,last_seen_at timestamptz);
 CREATE TABLE listing_snapshots(listing_id uuid,observed_at timestamptz,asking_price_nis numeric,area_sqm numeric,rooms numeric);
 CREATE TABLE comparable_transactions(neighborhood_id uuid,deal_date date,normalized_pp_sqm numeric,pp_sqm numeric,is_comparable boolean,rooms numeric,area_sqm numeric);
 CREATE TABLE neighborhood_metric_snapshots(neighborhood_id uuid,metric_key text,numeric_value numeric,as_of_date date,calculated_at timestamptz);
 CREATE TABLE semantic_metrics(metric_key text PRIMARY KEY,confidence_rule text,description text,caveats text[]);
 INSERT INTO semantic_metrics(metric_key) VALUES('listing_days_on_market'),('listing_price_change');
 INSERT INTO neighborhoods VALUES('10000000-0000-0000-0000-000000000001');`);
 const ddl=await readFile(new URL('../db/022_neighborhood_market_analytics.sql',import.meta.url),'utf8');
 const base=ddl.match(/CREATE TABLE IF NOT EXISTS listing_market_benchmarks \([\s\S]*?\n\);/);assert(base);await db.exec(base[0]);
 const extension=await readFile(new URL('../db/024_market_liquidity_listing_lifecycle.sql',import.meta.url),'utf8');const extra=extension.match(/ALTER TABLE listing_market_benchmarks[\s\S]*?;/);assert(extra);await db.exec(extra[0]);
 const ids=Array.from({length:4},(_,i)=>'00000000-0000-0000-0000-'+String(i+1).padStart(12,'0'));
 for(const id of ids){await db.query("insert into listings values($1,'10000000-0000-0000-0000-000000000001','active','test','source','2020-01-01','2026-10-05')",[id]);await db.query("insert into listing_market_benchmarks(listing_id,neighborhood_id,asking_price_nis,benchmark_confidence,benchmark_method,days_on_market,first_asking_price_nis,price_change_since_first_pct,snapshot_count) values($1,'10000000-0000-0000-0000-000000000001',1000000,.55,'fixture',99,1000000,0,1)",[id]);}
 for(const [i,observed,price] of [[1,'2026-10-01T00:00:00Z',1000000],[2,'2026-10-01T00:00:00Z',1000000],[2,'2026-10-01T12:00:00Z',900000],[3,'2026-10-01T00:00:00Z',1000000],[3,'2026-10-03T12:00:00Z',900000]])await db.query('insert into listing_snapshots values($1,$2,$3,85,4)',[ids[i],observed,price]);
 const sql=await readFile(new URL('../db/033_observed_listing_lifecycle.sql',import.meta.url),'utf8');await db.exec(sql);await db.exec(sql);
 for(let i=0;i<ids.length;i++){const [signal]=(await db.query('select * from listing_seller_signals where listing_id=$1',[ids[i]])).rows,[cache]=(await db.query('select * from listing_market_benchmarks where listing_id=$1',[ids[i]])).rows;assert.equal(signal.days_on_market,i===3?2:null);assert.equal(cache.days_on_market,i===3?2:null);assert.equal(signal.price_reductions,i===3?1:null);assert.equal(cache.price_change_since_first_pct==null?null:Number(cache.price_change_since_first_pct),i===3?-10:null);assert.equal(cache.asking_price_nis,'1000000');assert.equal(cache.benchmark_confidence,'0.55');assert.equal(signal.lifecycle_evidence,i===3?'supported':'provisional');}
 assert((await db.query('select * from semantic_metrics')).rows.every(x=>x.confidence_rule.includes('NULL otherwise')));
 const source=await readFile(new URL('../server/neighborhoodAnalytics.ts',import.meta.url),'utf8');
 assert(!source.includes('GREATEST(0,current_date-x.first_seen_at::date)'));
 const projection=source.match(/const benchmarks=await queryDatabase\(`([\s\S]*?)`\);/);assert(projection);
 // Only disposable fixture data is cleared to execute the actual refresh INSERT.
 await db.exec('DELETE FROM listing_market_benchmarks');await db.exec(projection[1]);
 const future=(await db.query('select listing_id,days_on_market,price_change_since_first_pct from listing_market_benchmarks')).rows;assert.equal(future.length,3);
 for(const row of future){assert.equal(row.days_on_market,row.listing_id===ids[3]?2:null);if(row.listing_id!==ids[3])assert.equal(row.price_change_since_first_pct,null);}
 }finally{await db.close();}
});
