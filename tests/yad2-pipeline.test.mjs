import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {collectYad2} from '../.server-test/server/sources/yad2Collector.js';
import {processYad2} from '../.server-test/server/sources/yad2Processor.js';
import {unlockYad2,unlockerConfig} from '../.server-test/server/sources/brightData.js';

const env={BRIGHTDATA_API_KEY:'test-secret',BRIGHTDATA_UNLOCKER_ZONE:'test-zone',BRIGHTDATA_FREE_TIER_CONFIRMED:'true',YAD2_SCOPE_ID:'israel-rent'};
const today=new Date().toISOString().slice(0,10);
const item=(token,date=today)=>({token,price:5000,address:{city:{text:'חיפה'},street:{text:'Test'}},additionalDetails:{roomsCount:3,squareMeter:80},...(date?{dates:{createdAt:date+'T10:00:00',rebouncedAt:today+'T12:00:00'}}:{})});
const html=props=>'<script id="__NEXT_DATA__">'+JSON.stringify({props:{pageProps:props}})+'</script>';
const feed=(items,pages=1,page=1)=>items.map(i=>'<a href="/realestate/item/coastal-north/'+i.token+'">ad</a>').join('')+html({feed:{private:items,pagination:{total:items.length,totalPages:pages}},initialSearchFormInputs:{page}});
const detail=i=>html({dehydratedState:{queries:[{queryKey:['item',i.token],state:{data:i}}]}});
async function setup() {
 const db=new PGlite();
 for(const file of ['011_yad2_scrapingbee.sql','013_yad2_publication_cache.sql','014_yad2_incremental.sql','015_yad2_staging.sql'])await db.exec(fs.readFileSync('db/'+file,'utf8'));
 await db.exec("UPDATE yad2_crawl_scopes SET enabled=(id='israel-rent'),config='{\"city_names\":[\"חיפה\"],\"published_within_days\":30,\"max_pages\":1}'");
 return {db,deps:{
  env,queryDatabase:async(text,params)=>(await db.query(text,params)).rows,
  databaseTransaction:async queries=>db.transaction(async tx=>{const results=[];for(const q of queries)results.push((await tx.query(q.text,q.params)).rows);return results;}),
  projectLegacy:async()=>{}
 }};
}
test('Unlocker uses the documented raw API; no retries, no secret in errors, no arbitrary targets',async()=>{
 let calls=0,reservations=0;
 const config=unlockerConfig(env);
 const result=await unlockYad2('https://www.yad2.co.il/realestate/rent',config,async()=>reservations++,async(url,opts)=>{
  calls++;assert.equal(url,'https://api.brightdata.com/request');assert.equal(opts.headers.Authorization,'Bearer test-secret');
  assert.deepEqual(JSON.parse(opts.body),{zone:'test-zone',url:'https://www.yad2.co.il/realestate/rent',format:'raw'});return new Response('html');
 });
 assert.equal(result,'html');assert.equal(calls,1);assert.equal(reservations,1);
 await assert.rejects(unlockYad2('https://example.com/realestate/rent',config,async()=>reservations++),/Yad2/);
 assert.equal(reservations,1);
 await assert.rejects(unlockYad2('https://www.yad2.co.il/realestate/rent',config,async()=>{},async()=>{calls++;throw new Error(env.BRIGHTDATA_API_KEY);}),/not retried/);
 assert.equal(calls,2);
 assert.throws(()=>unlockerConfig({...env,BRIGHTDATA_FREE_TIER_CONFIRMED:'false'}),/Confirm/);
});
test('landing survives budget exhaustion; offline processing and resumed collection require no repeated feed requests',async()=>{
 const {db,deps}=await setup();
 try {
  const calls=[],items=[item('fresh1',null),item('fresh2',null)];
  const fetcher=async(_url,opts)=>{
   const url=JSON.parse(opts.body).url;calls.push(url);
   return new Response(url.includes('/item/')?detail(item(url.split('/').pop())):feed(items));
  };
  const first=await collectYad2({...deps,env:{...env,YAD2_MAX_REQUESTS:'2'},fetch:fetcher});
  assert.equal(first.ok,false);assert.equal(first.requests,2);assert.equal(calls.length,2);
  assert.equal((await db.query('SELECT * FROM yad2_dataset')).rows.length,0);
  assert.equal((await db.query('SELECT * FROM yad2_source_pages')).rows.length,1);
  assert.equal((await db.query("SELECT state FROM yad2_source_records WHERE listing_id='fresh1'")).rows[0].state,'ready');
  assert.equal((await db.query("SELECT backfill_completed_at FROM yad2_crawl_scopes WHERE id='israel-rent'")).rows[0].backfill_completed_at,null);
  // No provider configuration supplied, and any unexpected network use fails the test.
  const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{throw new Error('processor must be offline');};
  try {assert.equal((await processYad2({queryDatabase:deps.queryDatabase,databaseTransaction:deps.databaseTransaction,projectLegacy:deps.projectLegacy})).ok,true);}
  finally{globalThis.fetch=originalFetch;}
  assert.equal((await db.query('SELECT * FROM yad2_dataset')).rows.length,1);
  const resumed=await collectYad2({...deps,env:{...env,YAD2_MAX_REQUESTS:'1'},fetch:fetcher});
  assert.equal(resumed.ok,true);assert.equal(resumed.requests,1);assert.equal(calls.length,3);assert.ok(calls[2].endsWith('/fresh2'));
  assert.equal((await db.query('SELECT * FROM yad2_source_pages')).rows.length,1);
  await processYad2(deps);await processYad2(deps);
  assert.equal((await db.query('SELECT * FROM yad2_dataset')).rows.length,2);
  assert.equal((await db.query('SELECT * FROM yad2_listing_changes')).rows.length,2);
  // A daily scan of known IDs does not download details or update prices.
  const daily=await collectYad2({...deps,fetch:async()=>new Response(feed(items.map(i=>({...i,price:1}))))});
  assert.equal(daily.requests,1);assert.equal(daily.scopes[0].phase,'incremental');
  await processYad2(deps);
  assert.ok((await db.query('SELECT price FROM yad2_dataset')).rows.every(r=>Number(r.price)===5000));
 }finally{await db.close();}
});
test('publication/city rejection happens downstream, and initial page limits do not complete backfill',async()=>{
 const {db,deps}=await setup();
 try {
  const old='2020-01-01',rows=[item('old123',old),{...item('wrongcity'),address:{city:{text:'תל אביב'}}},item('new123')];
  const collected=await collectYad2({...deps,fetch:async()=>new Response(feed(rows,2))});
  assert.equal(collected.ok,true);assert.equal(collected.scopes[0].completed,false);
  assert.equal((await db.query('SELECT * FROM yad2_source_records')).rows.length,3);
  assert.equal((await db.query('SELECT * FROM yad2_dataset')).rows.length,0);
  assert.equal((await db.query("SELECT backfill_completed_at FROM yad2_crawl_scopes WHERE id='israel-rent'")).rows[0].backfill_completed_at,null);
  const processed=await processYad2(deps);assert.equal(processed.filtered,2);assert.equal(processed.processed,1);
  assert.equal((await db.query('SELECT listing_id FROM yad2_dataset')).rows[0].listing_id,'new123');
 }finally{await db.close();}
});
test('request caps persist across runs, auth errors abort immediately, and migration is idempotent',async()=>{
 const {db,deps}=await setup();
 try {
  await db.exec(fs.readFileSync('db/015_yad2_staging.sql','utf8'));
  let calls=0;const options={...deps,env:{...env,YAD2_MONTHLY_REQUEST_CAP:'1'},fetch:async()=>{calls++;return new Response('denied',{status:401});}};
  const first=await collectYad2(options);assert.equal(first.requests,1);assert.match(first.error,/HTTP 401/);assert.equal(calls,1);
  const second=await collectYad2(options);assert.equal(second.requests,0);assert.match(second.error,/Persistent/);assert.equal(calls,1);
  const count=(await db.query("SELECT attempts FROM yad2_request_usage WHERE period LIKE 'month:%'")).rows[0].attempts;assert.equal(count,1);
  assert.equal((await db.query('SELECT * FROM yad2_dataset')).rows.length,0);
 }finally{await db.close();}
});
test('a downstream projection failure leaves durable data available for an offline retry',async()=>{
 const {db,deps}=await setup();
 try {
  await collectYad2({...deps,fetch:async()=>new Response(feed([item('retry1')]))});
  const failed=await processYad2({...deps,projectLegacy:async()=>{throw new Error('downstream unavailable');}});
  assert.equal(failed.ok,false);assert.equal((await db.query('SELECT * FROM yad2_dataset')).rows.length,1);
  let projections=0;const retry=await processYad2({...deps,projectLegacy:async()=>{projections++;}});
  assert.equal(retry.ok,true);assert.equal(projections,2);assert.equal((await db.query('SELECT * FROM yad2_listing_changes')).rows.length,1);
 }finally{await db.close();}
});
