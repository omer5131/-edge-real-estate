import {queryDatabase} from './db.js';
import {classifySourceUrl} from './contracts/investmentContext.js';

export function listingFreshness(listing:any,now=Date.now()){
 const observedAt=listing?.last_seen_at??null,time=observedAt?new Date(observedAt).getTime():NaN;
 return {lastObservedAt:observedAt,ageDays:Number.isFinite(time)?Number((Math.max(0,now-time)/86400000).toFixed(1)):null,
  sourceUrlKind:classifySourceUrl(listing?.url),availability:'not_reverified',
  notes:['Stored active status and a source page do not verify current availability.']};
}
export async function getInventoryEvidence(listing:any,query=queryDatabase){
 const [row]=await query(`WITH life AS (
  SELECT listing_id,count(*) n,extract(epoch FROM(max(observed_at)-min(observed_at)))/86400 span
  FROM listing_snapshots GROUP BY listing_id
 ) SELECT
  (SELECT count(*)::int FROM listings WHERE neighborhood_id=$1::uuid AND status='active') activeSaleRecords,
  (SELECT count(*)::int FROM listings WHERE neighborhood_id=$1::uuid AND status='active' AND url LIKE '%/realestate/item/%') exactItemSources,
  (SELECT count(*)::int FROM listings l JOIN life ON life.listing_id=l.id WHERE neighborhood_id=$1::uuid AND status='active' AND life.n>=2 AND life.span>=1) lifecycleSupported,
  (SELECT count(*)::int FROM rental_listings WHERE neighborhood_id=$1::uuid AND status='active') activeRentRecords,
  (SELECT count(*)::int FROM yad2_crawl_scopes WHERE enabled AND config->'city_names' ? $2::text) enabledCityScopes,
  (SELECT count(*)::int FROM yad2_crawl_scopes WHERE enabled AND config->'city_names' ? $2::text AND backfill_completed_at IS NOT NULL) completedCityBackfills`,[listing.neighborhood_id??null,listing.city??'']);
 return {...listingFreshness(listing),coverage:{activeSaleRecords:row?.activesalerecords??null,exactItemSources:row?.exactitemsources??null,lifecycleSupported:row?.lifecyclesupported??null,activeRentRecords:row?.activerentrecords??null,enabledCityScopes:row?.enabledcityscopes??null,completedCityBackfills:row?.completedcitybackfills??null},notes:['Stored coverage, not the full available market.','An unfinished backfill cannot establish market completeness.','Rental asking records are not executed leases.']};
}
