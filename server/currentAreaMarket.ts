import {queryDatabase} from './db.js';
import {numberOrNull} from './evidenceValues.js';

// Read-through aggregates; no cache/source mutation. Ambiguous stat-area mappings
// cannot multiply a transaction or grant it multiple neighborhood identities.
export const CURRENT_AREA_MARKET_SQL=`WITH resolved AS (
 SELECT ct.*,COALESCE(ct.neighborhood_id,b.neighborhood_id,m.neighborhood_id) resolved_neighborhood_id
 FROM comparable_transactions ct
 LEFT JOIN properties p ON p.id=ct.property_id LEFT JOIN buildings b ON b.id=p.building_id
 LEFT JOIN parcels par ON par.id=ct.parcel_id
 LEFT JOIN LATERAL (
  SELECT CASE WHEN count(DISTINCT neighborhood_id)=1 THEN min(neighborhood_id::text)::uuid END neighborhood_id
  FROM neighborhood_stat_area_map WHERE stat_area_id=par.stat_area_id
 ) m ON true
 WHERE ct.deal_date>=current_date-interval '24 months'
), market AS (
 SELECT resolved_neighborhood_id neighborhood_id,
  count(*) FILTER(WHERE deal_date>=current_date-interval '12 months')::int transaction_count_12m,
  percentile_cont(.5) WITHIN GROUP(ORDER BY COALESCE(normalized_pp_sqm,pp_sqm))
   FILTER(WHERE deal_date>=current_date-interval '12 months' AND COALESCE(normalized_pp_sqm,pp_sqm)>0)::float8 median_price_sqm_12m,
  percentile_cont(.5) WITHIN GROUP(ORDER BY COALESCE(normalized_pp_sqm,pp_sqm))
   FILTER(WHERE deal_date<current_date-interval '12 months' AND COALESCE(normalized_pp_sqm,pp_sqm)>0)::float8 prior_median_price_sqm,
  max(deal_date) latest_transaction_date,max(observed_at) source_revision_at
 FROM resolved WHERE resolved_neighborhood_id IS NOT NULL GROUP BY resolved_neighborhood_id
)
SELECT n.id::text neighborhood_id,COALESCE(m.transaction_count_12m,0)::int transaction_count_12m,
 m.median_price_sqm_12m,
 CASE WHEN m.prior_median_price_sqm>0 AND m.median_price_sqm_12m IS NOT NULL
 THEN 100*(m.median_price_sqm_12m/m.prior_median_price_sqm-1) END price_change_1y,
 m.latest_transaction_date,m.source_revision_at,now() calculated_at
FROM neighborhoods n LEFT JOIN market m ON m.neighborhood_id=n.id
WHERE ($1::uuid[] IS NULL OR n.id=ANY($1::uuid[]))`;

export async function getCurrentAreaMarkets(ids:string[]|null=null,query=queryDatabase){
 return query(CURRENT_AREA_MARKET_SQL,[ids]);
}
export function reconcileAreaMarket(cached:any,current:any){
 if(!current)return {...cached,market_freshness:{status:'unavailable',cacheStatus:'unverified',calculatedAt:null,notes:['Current source aggregation unavailable.']},transaction_count_12m:null,median_price_sqm_12m:null,price_change_1y:null,investment_score:null,deal_heat:null};
 const revision=current.source_revision_at?new Date(current.source_revision_at).getTime():null;
 const cachedAt=cached?.updated_at?new Date(cached.updated_at).getTime():null;
 const stale=!cachedAt||(new Date(current.calculated_at).getTime()-cachedAt>86400000)||(revision!=null&&revision>cachedAt)||numberOrNull(cached?.transaction_count_12m)!==numberOrNull(current.transaction_count_12m)||numberOrNull(cached?.median_price_sqm_12m)!==numberOrNull(current.median_price_sqm_12m);
 const cacheStatus=stale?'stale':'aligned';
 return {...cached,transaction_count_12m:numberOrNull(current.transaction_count_12m),median_price_sqm_12m:numberOrNull(current.median_price_sqm_12m),price_change_1y:numberOrNull(current.price_change_1y),
  latest_transaction_date:current.latest_transaction_date??null,
  ...(stale?{investment_score:null,deal_heat:null,estimated_gross_yield:null,confidence_level:'stale',confidence_score:null}:{}),
  market_freshness:{status:'current_read',cacheStatus,calculatedAt:current.calculated_at,sourceRevisionAt:current.source_revision_at??null,cacheCalculatedAt:cached?.updated_at??null,modelVersion:'area-market-read-v1',notes:['Current 12-month executed-sale aggregate; stored coverage is not full market coverage.',...(stale?['Cached score/yield has not been recomputed for this source revision; no investment score asserted.']:[])]}
 };
}
