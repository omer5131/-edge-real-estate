import assert from 'node:assert/strict';
import {queryDatabase} from '../.server-test/server/db.js';
import {getAssetContext} from '../.server-test/server/assetContext.js';

const rows=await queryDatabase(`
  WITH latest AS(
    SELECT DISTINCT ON(listing_id)* FROM listing_snapshots ORDER BY listing_id,observed_at DESC
  )
  SELECT l.id::text,l.source_id,l.property_id::text,l.building_id::text,l.city_id::text,
    l.canonical_address address,l.neighborhood_id::text,n.name_he neighborhood,c.name_he city,l.url,
    l.first_seen_at,l.last_seen_at,latest.asking_price_nis::float8 asking_price_ils,
    latest.area_sqm::float8,latest.rooms::float8,latest.floor::float8
  FROM listings l
  JOIN latest ON latest.listing_id=l.id
  LEFT JOIN neighborhoods n ON n.id=l.neighborhood_id
  LEFT JOIN cities c ON c.id=l.city_id
  JOIN asset_subscriptions s ON s.entity_type='listing' AND s.entity_id=l.id
  WHERE s.status='watching'
  ORDER BY l.last_seen_at DESC
  LIMIT 2
`);

assert.ok(rows.length>0,'Expected at least one watched listing for Phase 1 smoke validation');

for(const listing of rows){
  const context=await getAssetContext(listing);
  assert.equal(context.asset.listingId,listing.id);
  assert.ok(context.valuation);
  assert.ok(context.activeMarket);
  assert.ok(context.planning);
  assert.ok(context.evidence);
  assert.notEqual(context.evidence.status,'unavailable');
  if(listing.neighborhood_id){
    assert.ok(context.neighborhood,'Neighborhood intelligence must be returned when neighborhood_id exists');
    assert.ok(Array.isArray(context.neighborhood.market));
    assert.ok(Array.isArray(context.planning.plans));
  }
  console.log(JSON.stringify({
    listingId:listing.id,
    address:listing.address,
    valuationStatus:context.valuation.evidence.status,
    valuationSample:context.valuation.evidence.sampleSize,
    activeStatus:context.activeMarket.evidence.status,
    activeSample:context.activeMarket.evidence.sampleSize,
    areaStatus:context.neighborhood?.mapping.evidence.status??'missing',
    planningStatus:context.planning.evidence.status,
    overallStatus:context.evidence.status
  }));
}
