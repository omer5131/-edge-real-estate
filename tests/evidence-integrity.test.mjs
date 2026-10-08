import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {numberOrNull,addressRelation} from '../.server-test/server/evidenceValues.js';
import {buildValuationFromRows} from '../.server-test/server/valuationContext.js';
import {buildActiveMarketFromRows} from '../.server-test/server/activeMarketContext.js';
import {assetIdentityFromListing} from '../.server-test/server/assetContext.js';
import {buildAreaIntelligenceFromRows} from '../.server-test/server/areaContext.js';
import {getCurrentAreaMarkets,reconcileAreaMarket} from '../.server-test/server/currentAreaMarket.js';
import {listingFreshness,getInventoryEvidence} from '../.server-test/server/inventoryEvidence.js';

const nid='22222222-2222-2222-2222-222222222222';
const subject={id:'listing',neighborhood_id:nid,canonical_address:'סעדיה גאון',area_sqm:85,rooms:4,floor:0,asking_price_ils:1090000};
const sale=(i,extra={})=>({transaction_id:String(i),source_id:'tax',neighborhood_id:nid,address_text:null,deal_date:'2026-08-'+String(i).padStart(2,'0'),sale_price_nis:1500000+i,area_sqm:85,rooms:4,floor:null,price_per_sqm:18000,...extra});

test('source unknown numbers never become zero and genuine ground-floor zero survives both market services',()=>{
 for(const x of [null,undefined,'',' ',NaN,Infinity,true,{}])assert.equal(numberOrNull(x),null);
 assert.equal(numberOrNull('0'),0);
 const v=buildValuationFromRows(subject,[sale(1,{distance_meters:null}),sale(2,{floor:0,distance_meters:0})]);
 assert.equal(v.comparables.find(x=>x.transactionId==='1').floor,null);
 assert.equal(v.comparables.find(x=>x.transactionId==='1').distanceMeters,null);
 assert.equal(v.comparables.find(x=>x.transactionId==='2').floor,0);
 assert.equal(v.comparables.find(x=>x.transactionId==='2').relation,'same_neighborhood');
 const active=buildActiveMarketFromRows(subject,[{id:'active',neighborhood_id:nid,canonical_address:'סעדיה גאון',asking_price_nis:1500000,area_sqm:85,rooms:4,floor:0,distance_meters:null}]);
 assert.equal(active.listings[0].floor,0);assert.equal(active.listings[0].distanceMeters,null);
});

test('street equality and missing distance cannot establish a building or measured proximity',()=>{
 assert.equal(addressRelation(subject,sale(1,{address_text:'סעדיה גאון'})),'same_street');
 assert.equal(addressRelation(subject,sale(1,{distance_meters:null,distance_verified:true})),'same_neighborhood');
 assert.equal(addressRelation(subject,sale(1,{distance_meters:-1,distance_verified:true})),'same_neighborhood');
 assert.equal(addressRelation(subject,sale(1,{distance_meters:0,distance_verified:true})),'nearby');
 assert.equal(addressRelation({...subject,canonical_address:'סעדיה גאון 8'},sale(1,{address_text:'סעדיה גאון 8'})),'same_street');
 assert.equal(addressRelation({...subject,canonical_address:'סעדיה גאון 8',address_verified:true},sale(1,{address_text:'סעדיה גאון 8',address_verified:true})),'same_building');
 assert.equal(addressRelation({...subject,building_id:'b'},sale(1,{building_id:'b'})),'same_building');
 assert.equal(addressRelation({...subject,canonical_address:'סעדיה גאון 8'},sale(1,{address_text:'סעדיה גאון 9'})),'same_street');
});

test('neighborhood linkage does not attest apartment identity or rights',()=>{
 const identity=assetIdentityFromListing(subject);
 assert.equal(identity.identityEvidence.status,'provisional');assert.equal(identity.identityEvidence.confidence,null);
 assert.equal(identity.neighborhoodEvidence.status,'supported');assert.equal(identity.buildingEvidence.status,'insufficient_evidence');
 assert.equal(assetIdentityFromListing({...subject,property_id:'p',building_id:'b'}).identityEvidence.status,'supported');
});

test('closed-sale policy rejects different size/rooms before pricing and explains rank-limit exclusion',()=>{
 const rows=Array.from({length:14},(_,i)=>sale(i+1));rows.push(sale(20,{area_sqm:170}),sale(21,{rooms:7}),sale(22,{area_sqm:null}),sale(23,{price_per_sqm:null}));
 const v=buildValuationFromRows(subject,rows);
 assert.equal(v.evidence.sampleSize,12);assert.equal(v.evidence.modelVersion,'valuation-v3');
 for(const c of v.comparables.filter(x=>!x.selected))assert(c.rejectionReasons.length>0);
 assert(v.comparables.find(x=>x.transactionId==='20').rejectionReasons.includes('area_outside_25pct_band'));
 assert(v.comparables.find(x=>x.transactionId==='21').rejectionReasons.includes('rooms_outside_1_room_band'));
 assert(v.comparables.some(x=>x.rejectionReasons.includes('rank_outside_top_12')));
 assert.equal(v.valuation.baseNis,1530000);
});

test('read-through PostgreSQL market changes after isolated ingestion without rewriting an old score',async()=>{
 const db=new PGlite();
 try{
 await db.exec(`CREATE TABLE neighborhoods(id uuid PRIMARY KEY);
 CREATE TABLE properties(id uuid PRIMARY KEY,building_id uuid);
 CREATE TABLE buildings(id uuid PRIMARY KEY,neighborhood_id uuid);
 CREATE TABLE parcels(id uuid PRIMARY KEY,stat_area_id uuid);
 CREATE TABLE neighborhood_stat_area_map(stat_area_id uuid,neighborhood_id uuid);
 CREATE TABLE transactions(id uuid PRIMARY KEY,property_id uuid,parcel_id uuid,neighborhood_id uuid,deal_date date,observed_at timestamptz,normalized_pp_sqm numeric,pp_sqm numeric,is_comparable boolean);
 CREATE VIEW comparable_transactions AS SELECT * FROM transactions WHERE is_comparable;
 INSERT INTO neighborhoods VALUES('${nid}'),('33333333-3333-3333-3333-333333333333');`);
 const query=async(sql,params)=>(await db.query(sql,params)).rows;
 let [current]=await getCurrentAreaMarkets([nid],query);assert.equal(current.transaction_count_12m,0);assert.equal(current.median_price_sqm_12m,null);
 await db.query("INSERT INTO transactions VALUES('44444444-4444-4444-4444-444444444444',NULL,NULL,$1,current_date-2,now(),18000,18000,true)",[nid]);
 [current]=await getCurrentAreaMarkets([nid],query);assert.equal(current.transaction_count_12m,1);assert.equal(current.median_price_sqm_12m,18000);
 const reconciled=reconcileAreaMarket({transaction_count_12m:0,median_price_sqm_12m:null,investment_score:80,deal_heat:90,updated_at:'2026-01-01'},current);
 assert.equal(reconciled.transaction_count_12m,1);assert.equal(reconciled.market_freshness.cacheStatus,'stale');assert.equal(reconciled.investment_score,null);assert.equal(reconciled.deal_heat,null);
 // An ambiguous crosswalk must not count the same parcel transaction in two areas.
 await db.exec(`INSERT INTO parcels VALUES('55555555-5555-5555-5555-555555555555','66666666-6666-6666-6666-666666666666');
 INSERT INTO neighborhood_stat_area_map VALUES('66666666-6666-6666-6666-666666666666','${nid}'),('66666666-6666-6666-6666-666666666666','33333333-3333-3333-3333-333333333333');
 INSERT INTO transactions VALUES('77777777-7777-7777-7777-777777777777',NULL,'55555555-5555-5555-5555-555555555555',NULL,current_date-1,now(),99000,99000,true);`);
 [current]=await getCurrentAreaMarkets([nid],query);assert.equal(current.transaction_count_12m,1);
 }finally{await db.close()}
});

test('current source without an aggregation never falls back silently to cached current prices',()=>{
 const r=reconcileAreaMarket({transaction_count_12m:26,median_price_sqm_12m:18000,investment_score:90},null);
 assert.equal(r.transaction_count_12m,null);assert.equal(r.investment_score,null);assert.equal(r.market_freshness.status,'unavailable');
});

test('empty/all-unknown/partial project totals are distinguished from a genuine zero',()=>{
 for(const [count,known_units,planned_units,status] of [[0,0,null,'insufficient_evidence'],[2,0,null,'insufficient_evidence'],[2,1,100,'provisional'],[1,1,0,'supported']]){
  const a=buildAreaIntelligenceFromRows({identity:{neighborhood_id:nid},renewal:{count,known_units,planned_units}});
  assert.equal(a.renewal[1].value,planned_units);assert.equal(a.renewal[1].evidence.status,status);
 }
});

test('listing freshness does not turn a dated active record or item URL into availability verification',()=>{
 const f=listingFreshness({last_seen_at:'2026-10-02T00:00:00Z',url:'https://www.yad2.co.il/realestate/item/x'},Date.parse('2026-10-08T00:00:00Z'));
 assert.equal(f.ageDays,6);assert.equal(f.sourceUrlKind,'item');assert.equal(f.availability,'not_reverified');
 assert.equal(listingFreshness({}).ageDays,null);
});

test('inventory denominators remain scoped to the neighborhood and enabled city collection',async()=>{
 const db=new PGlite();try{
 await db.exec(`CREATE TABLE listing_snapshots(listing_id uuid,observed_at timestamptz);
 CREATE TABLE listings(id uuid,neighborhood_id uuid,status text,url text);
 CREATE TABLE rental_listings(neighborhood_id uuid,status text);
 CREATE TABLE yad2_crawl_scopes(enabled boolean,config jsonb,backfill_completed_at timestamptz);
 INSERT INTO listings VALUES('44444444-4444-4444-4444-444444444444','${nid}','active','https://www.yad2.co.il/realestate/forsale');
 INSERT INTO listing_snapshots VALUES('44444444-4444-4444-4444-444444444444',now());
 INSERT INTO yad2_crawl_scopes VALUES(true,'{"city_names":["חיפה"]}',NULL),(true,'{"city_names":["נתניה"]}',now());`);
 const r=await getInventoryEvidence({...subject,city:'חיפה'},async(sql,params)=>(await db.query(sql,params)).rows);
 assert.deepEqual(r.coverage,{activeSaleRecords:1,exactItemSources:0,lifecycleSupported:0,activeRentRecords:0,enabledCityScopes:1,completedCityBackfills:0});
 }finally{await db.close()}
});
