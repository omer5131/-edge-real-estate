import test from 'node:test';
import assert from 'node:assert/strict';
import {buildValuationFromRows} from '../.server-test/server/valuationContext.js';
import {buildActiveMarketFromRows} from '../.server-test/server/activeMarketContext.js';
import {buildAreaIntelligenceFromRows} from '../.server-test/server/areaContext.js';
import {assetIdentityFromListing} from '../.server-test/server/assetContext.js';
import {buildPlanningContext} from '../.server-test/server/planningContext.js';
import {classifySourceUrl,normalizeConfidence} from '../.server-test/server/contracts/investmentContext.js';

const listing={
  id:'11111111-1111-1111-1111-111111111111',
  source_id:'yad2_sale',
  canonical_address:'דרייפוס 25',
  neighborhood_id:'22222222-2222-2222-2222-222222222222',
  property_id:null,building_id:null,
  area_sqm:100,rooms:4,floor:3,asking_price_ils:1700000,
  last_seen_at:'2026-10-03T12:00:00Z'
};

test('valuation v2 collapses duplicate sale fingerprints and keeps rejected candidates',()=>{
  const rows=[
    {transaction_id:'a',source_id:'tax',neighborhood_id:listing.neighborhood_id,address_text:'דרייפוס 25',deal_date:'2026-01-01',sale_price_nis:1800000,area_sqm:100,rooms:4,floor:3,price_per_sqm:18000},
    {transaction_id:'dup',source_id:'tax',neighborhood_id:listing.neighborhood_id,address_text:'דרייפוס 25',deal_date:'2026-01-01',sale_price_nis:1800000,area_sqm:100,rooms:4,floor:3,price_per_sqm:18000},
    {transaction_id:'b',source_id:'tax',neighborhood_id:listing.neighborhood_id,address_text:'דרייפוס 31',deal_date:'2025-11-01',sale_price_nis:1760000,area_sqm:98,rooms:4,floor:2,price_per_sqm:17959},
    {transaction_id:'c',source_id:'tax',neighborhood_id:listing.neighborhood_id,address_text:'דרך צרפת 2',deal_date:'2025-10-01',sale_price_nis:1900000,area_sqm:102,rooms:4,floor:4,price_per_sqm:18627},
    {transaction_id:'weak',source_id:'tax',neighborhood_id:listing.neighborhood_id,address_text:'רחוב אחר 99',deal_date:'2021-01-01',sale_price_nis:800000,area_sqm:35,rooms:1,floor:10,price_per_sqm:22857}
  ];
  const out=buildValuationFromRows(listing,rows);
  assert.equal(out.comparables.filter(x=>x.transactionId==='a'||x.transactionId==='dup').length,1);
  assert.ok(out.comparables.some(x=>x.selected===false));
  assert.equal(out.comparables.find(x=>x.transactionId==='a')?.relation,'same_building');
  assert.ok(out.valuation.baseNis);
  assert.equal(out.evidence.modelVersion,'valuation-v2');
});

test('valuation stays provisional with sparse comparable evidence',()=>{
  const out=buildValuationFromRows(listing,[{transaction_id:'a',source_id:'tax',neighborhood_id:listing.neighborhood_id,address_text:'דרייפוס 25',deal_date:'2026-01-01',sale_price_nis:1800000,area_sqm:100,rooms:4,floor:3,price_per_sqm:18000}]);
  assert.equal(out.evidence.status,'provisional');
  assert.equal(out.evidence.sampleSize,1);
});

test('active market stays provisional when inventory is sparse',()=>{
  const out=buildActiveMarketFromRows(listing,[{id:'x',source_id:'yad2_sale',canonical_address:'דרייפוס 27',asking_price_nis:1750000,area_sqm:100,rooms:4,floor:2,last_seen_at:'2026-10-03T00:00:00Z'}]);
  assert.equal(out.evidence.status,'provisional');
  assert.equal(out.summary.inventoryCount,1);
});

test('asset identity works without building identity',()=>{
  const out=assetIdentityFromListing({...listing,address:'דרייפוס 25',city_id:'c',city:'חיפה',neighborhood:'קריית שפרינצק'});
  assert.equal(out.buildingId,null);
  assert.equal(out.neighborhoodId,listing.neighborhood_id);
  assert.equal(out.identityEvidence.status,'supported');
  assert.ok(out.identityEvidence.notes.some(x=>x.includes('building')));
});

test('missing neighborhood is explicit insufficient evidence, never zero confidence',()=>{
  const out=buildValuationFromRows({...listing,neighborhood_id:null},[]);
  assert.equal(out.evidence.status,'insufficient_evidence');
  assert.equal(out.evidence.confidence,null);
  assert.equal(out.valuation.baseNis,null);
});

test('provisional CBS profile remains provisional and not analytics-safe',()=>{
  const out=buildAreaIntelligenceFromRows({
    summary:{neighborhood_id:listing.neighborhood_id,neighborhood_slug:'kiryat-sprinzack',neighborhood_name:'קריית שפרינצק',city_name:'חיפה',transaction_count_12m:20,median_price_sqm_12m:18000,confidence_score:.8,updated_at:'2026-10-03T00:00:00Z'},
    cbs:{observation_year:2024,population:10000,mapping_confidence:.75,statistical_area_count:3,safe_for_score:false,calculated_at:'2026-10-03T00:00:00Z'},
    mappings:[{stat_area_code:'1',boundary_year:2022,overlap_ratio:1,mapping_method:'configured_crosswalk',mapping_confidence:.8,mapping_version:'v1',analytics_safe:false}],
    renewal:{count:1,planned_units:200},planning:{count:2,housing_units:400},infrastructure:{count:1}
  });
  assert.ok(out);
  assert.equal(out.population[0].evidence.status,'provisional');
  assert.equal(out.mapping.statisticalAreas[0].analyticsSafe,false);
  assert.equal(out.mapping.evidence.status,'provisional');
});

test('planning context exposes provenance and evidence state',()=>{
  const out=buildPlanningContext([{source_id:'urban_renewal_gov',observed_at:'2026-10-01T00:00:00Z'}],[{source_id:'xplan',observed_at:'2026-10-02T00:00:00Z'}],[]);
  assert.equal(out.evidence.status,'supported');
  assert.deepEqual(new Set(out.evidence.sourceIds),new Set(['urban_renewal_gov','xplan']));
  assert.equal(out.evidence.sampleSize,2);
});


test('evidence confidence is normalized to a 0-1 scale',()=>{
  assert.equal(normalizeConfidence(43.75),.4375);
  assert.equal(normalizeConfidence(.88),.88);
  assert.equal(normalizeConfidence(140),1);
  const out=buildAreaIntelligenceFromRows({
    summary:{neighborhood_id:listing.neighborhood_id,neighborhood_slug:'x',neighborhood_name:'X',city_name:'Y',transaction_count_12m:10,median_price_sqm_12m:18000,confidence_score:43.75,updated_at:'2026-10-03T00:00:00Z'},
    cbs:null,mappings:[],renewal:{count:0},planning:{count:0},infrastructure:{count:0}
  });
  assert.equal(out.market[0].evidence.confidence,.4375);
});

test('three otherwise similar active listings remain provisional',()=>{
  const rows=[1,2,3].map((i)=>({id:'p'+i,source_id:'yad2_sale',canonical_address:'דרייפוס '+(25+i),asking_price_nis:1700000+i*10000,area_sqm:100,rooms:4,floor:3,snapshot_count:2,observed_span_days:2,last_seen_at:'2026-10-03T00:00:00Z'}));
  const out=buildActiveMarketFromRows(listing,rows);
  assert.equal(out.summary.inventoryCount,3);
  assert.equal(out.evidence.status,'provisional');
});

test('active market rejects materially different size before scoring',()=>{
  const out=buildActiveMarketFromRows({...listing,area_sqm:115},[
    {id:'small',source_id:'yad2_sale',canonical_address:'דרך צרפת',asking_price_nis:980000,area_sqm:52,rooms:2.5,floor:2,last_seen_at:'2026-10-03T00:00:00Z'},
    {id:'fit',source_id:'yad2_sale',canonical_address:'דרייפוס 27',asking_price_nis:1780000,area_sqm:110,rooms:4,floor:2,last_seen_at:'2026-10-03T00:00:00Z'}
  ]);
  assert.equal(out.summary.inventoryCount,1);
  assert.ok(out.rejectedListings.find(x=>x.listingId==='small')?.reasons.includes('area_outside_25pct_band'));
});

test('DOM is unknown until there is an observed lifecycle',()=>{
  const out=buildActiveMarketFromRows(listing,[
    {id:'single',source_id:'yad2_sale',canonical_address:'דרייפוס 27',asking_price_nis:1750000,area_sqm:100,rooms:4,floor:2,snapshot_count:1,observed_span_days:0,days_on_market:0,last_seen_at:'2026-10-03T00:00:00Z'}
  ]);
  assert.equal(out.listings[0].daysOnMarket,null);
  assert.equal(out.listings[0].priceReductions,null);
  assert.equal(out.summary.medianDaysOnMarket,null);
});

test('source URL provenance distinguishes item from search pages',()=>{
  assert.equal(classifySourceUrl('https://www.yad2.co.il/realestate/item/abc'),'item');
  assert.equal(classifySourceUrl('https://www.yad2.co.il/realestate/forsale?city=4000'),'search');
  assert.equal(classifySourceUrl(null),'unknown');
});
