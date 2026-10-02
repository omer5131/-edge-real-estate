import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {normalizeListing,yad2Url,validatePage,scrapeJson,recentListing,requestBudget} from '../.server-test/server/sources/scrapingBee.js';
import {listingWrite,completeScopeWrites} from '../.server-test/server/sources/yad2Dataset.js';
const row={url:'https://www.yad2.co.il/realestate/item/abc123',price:1200000,city:'חיפה',rooms:3,area_sqm:80};
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
