import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {normalizeListing,yad2Url,validatePage,scrapeJson,recentListing,requestBudget,parseYad2Html,partitionListings,pageRules} from '../.server-test/server/sources/scrapingBee.js';
import {listingWrite,completeScopeWrites,runYad2Dataset} from '../.server-test/server/sources/yad2Dataset.js';
import {collectionPlan,isNewCandidate,eligibleNewListing} from '../.server-test/server/sources/yad2Incremental.js';
const row={url:'https://www.yad2.co.il/realestate/item/abc123',price:1200000,city:'חיפה',rooms:3,area_sqm:80};
test('daily worker skips known price changes, inserts only new ads and recovers cache-only writes without HTTP',async()=>{
 const db=new PGlite();process.env.SCRAPINGBEE_API_KEY='test';
 try {
  for(const f of ['011_yad2_scrapingbee.sql','013_yad2_publication_cache.sql','014_yad2_incremental.sql'])await db.exec(fs.readFileSync('db/'+f,'utf8'));
  await db.exec("UPDATE yad2_crawl_scopes SET enabled=(id='israel-sale'),backfill_started_at=now()-interval '30 days',backfill_completed_at=now()-interval '1 day',last_completed_at=now()-interval '1 day',config='{\"city_names\":[\"חיפה\"],\"published_within_days\":30}'");
  const crawl=(await db.query('INSERT INTO yad2_crawls DEFAULT VALUES RETURNING id')).rows[0].id;
  const published_at=new Date().toISOString().slice(0,10);
  for(const q of listingWrite('sale',{...row,published_at},'israel-sale',crawl))await db.query(q.text,q.params);
  const pending={...row,url:row.url.replace('abc123','pending'),published_at};
  await db.query('INSERT INTO yad2_publication_cache(market,listing_id,data) VALUES($1,$2,$3::jsonb)',['sale','pending',JSON.stringify(pending)]);
  const fresh={...row,url:row.url.replace('abc123','new123'),published_at};const calls=[];
  const report=await runYad2Dataset({
   queryDatabase:async(text,params)=>(await db.query(text,params)).rows,
   databaseTransaction:async queries=>db.transaction(async tx=>{const result=[];for(const q of queries)result.push((await tx.query(q.text,q.params)).rows);return result;}),
   scrapeJson:async(url,rules,_fetch,take)=>{take();calls.push(url);return rules===pageRules?{page_valid:true,listings:[{...row,price:1,published_at:null},{...pending,published_at:null},{...fresh,published_at:null}],next_url:null}:fresh;},
   projectLegacy:async()=>{}
  });
  assert.equal(report.requests,2);assert.equal(report.listings,2);assert.equal(report.known_skipped,2);assert.equal(report.scopes[0].phase,'incremental');
  assert.equal(calls.length,2);assert.ok(calls[1].endsWith('new123'));
  assert.equal(Number((await db.query("SELECT price FROM yad2_dataset WHERE listing_id='abc123'")).rows[0].price),row.price);
  assert.equal((await db.query("SELECT count(*)::int n FROM yad2_listing_changes WHERE listing_id='abc123'")).rows[0].n,1);
  assert.equal((await db.query('SELECT count(*)::int n FROM yad2_dataset')).rows[0].n,3);
 }finally{delete process.env.SCRAPINGBEE_API_KEY;await db.close();}
});
test('one-time backfill keeps its baseline on resume; daily discovery only admits new IDs with overlap',()=>{
 const now=new Date('2026-10-02T10:00:00Z');
 const scope={backfill_started_at:'2026-09-28T10:00:00Z',cycle_started_at:'2026-09-28T10:00:00Z',config:{published_within_days:30,max_pages:10}};
 const backfill=collectionPlan(scope,now);
 assert.equal(backfill.incremental,false);assert.equal(backfill.oldest,'2026-08-29');assert.equal(backfill.maxPages,10);
 assert.equal(eligibleNewListing({...row,published_at:'2026-08-30'},scope.config,backfill,now),true);
 assert.equal(eligibleNewListing({...row,published_at:'2026-08-28'},scope.config,backfill,now),false);
 const daily=collectionPlan({...scope,backfill_completed_at:'2026-09-30T12:00:00Z',last_completed_at:'2026-10-01T12:00:00Z',cycle_started_at:null},now);
 assert.equal(daily.incremental,true);assert.equal(daily.maxPages,3);assert.equal(daily.knownPageStop,2);assert.equal(daily.oldest,'2026-09-30');
 assert.equal(isNewCandidate({...row,published_at:'2026-10-01'},daily,false),true);
 assert.equal(isNewCandidate({...row,published_at:'2026-09-20'},daily,false),false);
 assert.equal(isNewCandidate({...row,published_at:'2026-10-01',price:1},daily,true),false);
 assert.throws(()=>collectionPlan({...scope,config:{daily_max_pages:0},backfill_completed_at:now},now));
});
test('incremental state migration is idempotent and does not treat a sample write as completed backfill',async()=>{
 const db=new PGlite();try {
  await db.exec(fs.readFileSync('db/011_yad2_scrapingbee.sql','utf8'));
  const migration=fs.readFileSync('db/014_yad2_incremental.sql','utf8');await db.exec(migration);await db.exec(migration);
  const scopes=(await db.query('SELECT backfill_completed_at FROM yad2_crawl_scopes')).rows;
  assert.ok(scopes.every(s=>s.backfill_completed_at===null));
 }finally{await db.close();}
});
test('regional listing URLs preserve stable IDs and exclude developer promotions',()=>{
 const url='https://www.yad2.co.il/realestate/item/coastal-north/abc123?spot=platinum';
 assert.equal(normalizeListing({...row,url}).id,'abc123');
 assert.equal(normalizeListing({...row,url}).data.url,url.split('?')[0]);
 const p=partitionListings([row,{url:'/www.yad2.co.il/yad1/project/coastal-north/11236/apartment/100'},{}]);
 assert.equal(p.listings.length,1);assert.equal(p.excluded,1);assert.equal(p.invalid,1);
});
test('native page parser uses source dates, real links and source pagination, not bump dates',()=>{
 const item={token:'abc123',price:5000,address:{city:{text:'חיפה'},street:{text:'Test'},house:{floor:0}},additionalDetails:{roomsCount:3,squareMeter:80},dates:{createdAt:'2026-09-15T10:00:00',rebouncedAt:'2026-10-02T10:00:00'}};
 const link='/realestate/item/coastal-north/abc123';
 const html=props=>`<a href="${link}">Listing</a><script id="__NEXT_DATA__">${JSON.stringify({props:{pageProps:props}})}</script>`;
 const feed=parseYad2Html(html({feed:{private:[item],lookalike:[{...item,token:'other'}],pagination:{total:2,totalPages:2}},initialSearchFormInputs:{page:1}}),'https://www.yad2.co.il/realestate/rent?city=4000',true);
 assert.equal(feed.listings.length,1);assert.equal(feed.listings[0].published_at,'2026-09-15');assert.equal(feed.listings[0].floor,0);assert.ok(feed.next_url.includes('city=4000'));assert.ok(feed.next_url.includes('page=2'));
 const detail=parseYad2Html(html({dehydratedState:{queries:[{queryKey:['item','abc123'],state:{data:item}}]}}),'https://www.yad2.co.il'+link,false);
 assert.equal(detail.published_at,'2026-09-15');
 assert.throws(()=>parseYad2Html('<html>Blocked</html>',row.url,true));
 assert.throws(()=>parseYad2Html(html({dehydratedState:{queries:[]}}),row.url,false));
});
test('identity stays stable after price changes; missing numbers remain null',()=>{
 assert.equal(normalizeListing(row).id,normalizeListing({...row,price:1000000}).id);
 assert.equal(normalizeListing({url:row.url}).data.price,null);
 assert.throws(()=>normalizeListing({...row,url:'https://example.com/realestate/item/abc123'}));
 assert.throws(()=>yad2Url('https://www.yad2.co.il/realestate/rent','sale'));
 assert.throws(()=>normalizeListing({...row,price:'negotiable'}));
});
test('blocked, malformed and ambiguous empty pages cannot complete a crawl',()=>{
 for(const page of [{},{page_valid:false,listings:[]},{page_valid:true,listings:[]}])assert.throws(()=>validatePage(page));
 assert.equal(validatePage({page_valid:true,listings:[],empty_confirmed:true}).listings.length,0);
});
test('nonretryable auth errors are reported without exposing the API key',async()=>{
 process.env.SCRAPINGBEE_API_KEY='test-secret';let requests=0;
 await assert.rejects(()=>scrapeJson(row.url,{},async()=>{requests++;return new Response('',{status:401});}),/HTTP 401/);
 assert.equal(requests,1);delete process.env.SCRAPINGBEE_API_KEY;
});
test('database upserts preserve history, unchanged runs create no events, rent and sale are distinct',async()=>{
 const db=new PGlite();await db.exec(fs.readFileSync('db/011_yad2_scrapingbee.sql','utf8'));
 const crawl=(await db.query('INSERT INTO yad2_crawls DEFAULT VALUES RETURNING id')).rows[0].id;
 async function write(market,record){for(const q of listingWrite(market,record,`israel-${market}`,crawl))await db.query(q.text,q.params);}
 await write('sale',row);await write('sale',row);
 assert.equal((await db.query('SELECT * FROM yad2_listing_changes')).rows.length,1);
 await write('sale',{...row,price:1100000});await write('sale',{...row,price:1150000});
 await write('rent',{...row,price:5000});
 const changes=(await db.query('SELECT event,old_price,new_price FROM yad2_listing_changes ORDER BY id')).rows;
 assert.deepEqual(changes.map(c=>c.event),['created','price_drop','price_increase','created']);
 assert.equal(Number(changes[1].old_price),1200000);assert.equal(Number(changes[1].new_price),1100000);
 assert.equal((await db.query('SELECT * FROM yad2_dataset')).rows.length,2);
 await db.query("UPDATE yad2_dataset SET status='inactive' WHERE market='sale'");
 await write('sale',{...row,price:1150000});
 assert.equal((await db.query('SELECT event FROM yad2_listing_changes ORDER BY id DESC LIMIT 1')).rows[0].event,'active');
 await db.close();
});

test('removal needs three completed missing cycles and respects overlapping scopes',async()=>{
 const db=new PGlite();await db.exec(fs.readFileSync('db/011_yad2_scrapingbee.sql','utf8'));
 await db.query("INSERT INTO yad2_crawl_scopes(id,market,url) VALUES('city-sale','sale','https://www.yad2.co.il/realestate/forsale?city=4000')");
 const initial=(await db.query('INSERT INTO yad2_crawls DEFAULT VALUES RETURNING id')).rows[0].id;
 for(const scope of ['israel-sale','city-sale'])for(const q of listingWrite('sale',row,scope,initial))await db.query(q.text,q.params);
 const next=(await db.query('INSERT INTO yad2_crawls DEFAULT VALUES RETURNING id')).rows[0].id;
 const finish=async scope=>{for(const q of completeScopeWrites(scope,next))await db.query(q.text,q.params);};
 for(let i=0;i<3;i++)await finish('israel-sale');
 assert.equal((await db.query('SELECT status FROM yad2_dataset')).rows[0].status,'active');
 for(let i=0;i<2;i++)await finish('city-sale');
 assert.equal((await db.query('SELECT status FROM yad2_dataset')).rows[0].status,'active');
 await finish('city-sale');assert.equal((await db.query('SELECT status FROM yad2_dataset')).rows[0].status,'inactive');
 await db.close();
});

test('recent city collection rejects unknown, old, future and invalid publication dates',()=>{
 const config={city_names:['חיפה'],published_within_days:30},now=new Date('2026-10-02T10:00:00Z');
 assert.equal(recentListing({...row,published_at:'2026-09-02'},config,now),true);
 for(const published_at of [null,'2026-09-01','2026-10-03','2026-09-31','today'])assert.equal(recentListing({...row,published_at},config,now),false);
 assert.equal(recentListing({...row,city:'תל אביב',published_at:'2026-10-01'},config,now),false);
});
test('request budget prevents an extra network request, including retries',async()=>{
 const budget=requestBudget(1);process.env.SCRAPINGBEE_API_KEY='test';let calls=0;
 await assert.rejects(()=>scrapeJson(row.url,{},async()=>{calls++;throw new Error('network');},()=>budget.take()),/budget reached/);
 assert.equal(calls,1);assert.equal(budget.used,1);delete process.env.SCRAPINGBEE_API_KEY;
});
test('focused scope migration disables nationwide scopes and preserves later configuration',async()=>{
 const db=new PGlite();await db.exec(fs.readFileSync('db/011_yad2_scrapingbee.sql','utf8'));
 const migration=fs.readFileSync('db/012_yad2_focused_scopes.sql','utf8');await db.exec(migration);
 const scopes=(await db.query('SELECT * FROM yad2_crawl_scopes WHERE enabled')).rows;
 assert.equal(scopes.length,6);assert.ok(scopes.every(s=>s.config.details===false&&s.config.published_within_days===30));
 await db.query("UPDATE yad2_crawl_scopes SET enabled=false WHERE id='recent-haifa-sale'");await db.exec(migration);
 assert.equal((await db.query('SELECT * FROM yad2_crawl_scopes WHERE enabled')).rows.length,5);await db.close();
});
