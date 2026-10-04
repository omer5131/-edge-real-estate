import type {VercelRequest,VercelResponse} from '@vercel/node';
import {queryDatabase} from '../db.js';
import {refreshNeighborhoodIntelligence} from '../neighborhoodIntelligence.js';
import {neighborhoodIdentity,refreshNeighborhoodIdentity} from '../neighborhoodIdentity.js';
import {latestNeighborhoodEvaluation,runNeighborhoodEvaluations} from '../evaluation/neighborhoodEvals.js';

function authorized(req:VercelRequest){
 if(process.env.VERCEL_ENV==='preview')return true;
 const secret=process.env.CRON_SECRET;
 return Boolean(secret&&req.headers.authorization===`Bearer ${secret}`);
}

async function summary(neighborhoodId:string){
 const [rows,metrics,datasets]=await Promise.all([
  queryDatabase(`
   SELECT n.id::text neighborhood_id,n.slug,n.name_he,n.name_en,c.name_he city,c.settlement_code,
    m.score_version,m.deal_heat::float8,m.investment_score::float8,m.confidence_score::float8,m.confidence_level,
    m.coverage_pct::float8,m.deal_count,m.transaction_count_12m,m.median_price_sqm_12m::float8,m.price_change_1y::float8,
    m.population_growth_22_24::float8,m.renewal_expansion_ratio::float8,m.estimated_gross_yield::float8,
    m.average_wage::float8,m.net_internal_migration::float8,m.construction_starts::float8,m.updated_at
   FROM neighborhoods n JOIN cities c ON c.id=n.city_id
   LEFT JOIN neighborhood_map_cache m ON m.neighborhood_id=n.id WHERE n.id=$1
  `,[neighborhoodId]),
  queryDatabase(`
   SELECT DISTINCT ON(metric_key) metric_key,numeric_value::float8,text_value,sample_count,confidence::float8,
    evidence_count,source_datasets,source_evidence,as_of_date,calculated_at
   FROM neighborhood_metric_snapshots WHERE neighborhood_id=$1
   ORDER BY metric_key,as_of_date DESC,calculated_at DESC
  `,[neighborhoodId]),
  queryDatabase(`
   SELECT dataset_slug,source_grain,count(*)::int evidence_count,
    round(avg(mapping_confidence)::numeric,3)::float8 avg_mapping_confidence,
    max(COALESCE(observation_date,make_date(observation_year,1,1))) latest_observation
   FROM dataset_neighborhood_evidence WHERE neighborhood_id=$1
   GROUP BY dataset_slug,source_grain ORDER BY dataset_slug
  `,[neighborhoodId])
 ]);
 return {neighborhood:rows[0]||null,metrics,datasets};
}

async function transactions(neighborhoodId:string){
 return queryDatabase(`
  SELECT ct.id::text,ct.deal_date,ct.amount_nis::float8,ct.area_sqm::float8,ct.rooms::float8,
   ct.pp_sqm::float8,ct.normalized_pp_sqm::float8,ct.ownership_fraction::float8,
   ct.is_comparable,ct.exclusion_reason,e.mapping_method,e.mapping_confidence::float8
  FROM dataset_neighborhood_evidence e
  JOIN comparable_transactions ct ON ct.id::text=e.source_record_id
  WHERE e.neighborhood_id=$1 AND e.dataset_slug='transactions'
  ORDER BY ct.deal_date DESC LIMIT 1000
 `,[neighborhoodId]);
}

async function listings(neighborhoodId:string){
 return queryDatabase(`
  WITH snap AS(
   SELECT DISTINCT ON(listing_id) listing_id,asking_price_nis,area_sqm,rooms,floor,observed_at
   FROM listing_snapshots ORDER BY listing_id,observed_at DESC
  ), score AS(
   SELECT DISTINCT ON(entity_id) entity_id,score,model_version,calculated_at
   FROM opportunity_scores WHERE entity_type='listing' ORDER BY entity_id,calculated_at DESC
  )
  SELECT l.id::text,l.canonical_address,l.url,l.status,l.first_seen_at,l.last_seen_at,
   s.asking_price_nis::float8,s.area_sqm::float8,s.rooms::float8,s.floor::float8,
   CASE WHEN s.area_sqm>0 THEN (s.asking_price_nis/s.area_sqm)::float8 END asking_price_sqm,
   sc.score::float8,sc.model_version,sc.calculated_at,
   b.first_seen_at,b.days_on_market,b.first_asking_price_nis::float8,
   b.price_change_since_first_pct::float8,b.snapshot_count,b.executed_percentile::float8,b.relative_value_signal,
   b.historical_sample_count,b.matched_historical_sample_count,
   b.historical_median_price_sqm::float8,b.matched_historical_median_price_sqm::float8,
   b.current_listing_sample_count,b.current_listing_median_price_sqm::float8,
   b.executed_discount_pct::float8,b.matched_executed_discount_pct::float8,
   b.current_asking_discount_pct::float8,b.neighborhood_price_change_1y_pct::float8,
   b.trend_adjusted_executed_price_sqm::float8,b.trend_adjusted_discount_pct::float8,
   b.benchmark_confidence::float8,b.benchmark_method,b.evidence benchmark_evidence
  FROM listings l
  LEFT JOIN snap s ON s.listing_id=l.id
  LEFT JOIN score sc ON sc.entity_id=l.id
  LEFT JOIN listing_market_benchmarks b ON b.listing_id=l.id
  WHERE l.neighborhood_id=$1
  ORDER BY (l.status='active') DESC,b.benchmark_confidence DESC NULLS LAST,sc.score DESC NULLS LAST,l.last_seen_at DESC LIMIT 500
 `,[neighborhoodId]);
}


async function marketTrends(neighborhoodId:string){
 const [history,rolling,cbs]=await Promise.all([
  queryDatabase(`
   SELECT period_start,executed_transaction_count,
    median_executed_price_nis::float8,median_executed_price_sqm::float8,
    p25_executed_price_sqm::float8,p75_executed_price_sqm::float8,
    active_sale_listing_count,median_asking_price_nis::float8,median_asking_price_sqm::float8,
    active_rent_listing_count,median_asking_rent_nis::float8,median_rent_sqm::float8,
    asking_to_executed_premium_pct::float8,transaction_count_3m,months_of_sale_inventory::float8,
    sale_listing_to_transaction_ratio::float8,transaction_confidence::float8,listing_confidence::float8
   FROM neighborhood_market_periods
   WHERE neighborhood_id=$1 AND period_type='month'
   ORDER BY period_start
  `,[neighborhoodId]),
  queryDatabase(`
   SELECT period_start,executed_transaction_count,
    median_executed_price_nis::float8,median_executed_price_sqm::float8,
    p25_executed_price_sqm::float8,p75_executed_price_sqm::float8,
    active_sale_listing_count,median_asking_price_nis::float8,median_asking_price_sqm::float8,
    active_rent_listing_count,median_asking_rent_nis::float8,median_rent_sqm::float8,
    asking_to_executed_premium_pct::float8,transaction_confidence::float8,listing_confidence::float8
   FROM neighborhood_market_periods
   WHERE neighborhood_id=$1 AND period_type='rolling_12m'
   ORDER BY period_start DESC LIMIT 1
  `,[neighborhoodId]),
  queryDatabase(`
   SELECT observation_year,population::float8,population_growth_from_2022_pct::float8,
    employment_pct::float8,academic_certificate_pct::float8,median_annual_employee_wage::float8,
    average_household_size::float8,owner_households_pct::float8,renter_households_pct::float8,
    median_age::float8,statistical_area_count,mapping_confidence::float8,profile_quality,safe_for_score,crosswalk_method,source_evidence,calculated_at
   FROM neighborhood_cbs_profiles
   WHERE neighborhood_id=$1 ORDER BY observation_year
  `,[neighborhoodId])
 ]);
 return {history,rolling:rolling[0]||null,cbsProfile:cbs};
}

async function renewal(neighborhoodId:string){
 return queryDatabase(`
  SELECT id::text,project_name,developer,plan_number,route,status,stage,existing_units,planned_units,additional_units,
   permits_count,in_execution,planning_certainty::float8,source_url,observed_at
  FROM renewal_projects WHERE neighborhood_id=$1 ORDER BY in_execution DESC,planning_certainty DESC NULLS LAST,observed_at DESC
 `,[neighborhoodId]);
}


async function metricSection(neighborhoodId:string,categories:string[]){
 return queryDatabase(`
  SELECT DISTINCT ON(m.metric_key) m.metric_key,d.label,d.category,d.preferred_dataset,d.unit,d.description,
   m.numeric_value::float8,m.text_value,m.sample_count,m.confidence::float8,m.evidence_count,
   m.source_datasets,m.source_evidence,m.as_of_date,m.calculated_at
  FROM neighborhood_metric_snapshots m
  JOIN neighborhood_metric_definitions d ON d.metric_key=m.metric_key
  WHERE m.neighborhood_id=$1 AND d.category=ANY($2::text[])
  ORDER BY m.metric_key,m.as_of_date DESC,m.calculated_at DESC
 `,[neighborhoodId,categories]);
}

async function rentals(neighborhoodId:string){
 const [metrics,inventory]=await Promise.all([
  metricSection(neighborhoodId,['rental']),
  queryDatabase(`
   WITH snap AS(
    SELECT DISTINCT ON(rental_listing_id) rental_listing_id,asking_rent_nis,area_sqm,rooms,floor,observed_at
    FROM rental_listing_snapshots ORDER BY rental_listing_id,observed_at DESC
   )
   SELECT l.id::text,l.canonical_address,l.url,l.status,l.first_seen_at,l.last_seen_at,
    s.asking_rent_nis::float8,s.area_sqm::float8,s.rooms::float8,s.floor,s.observed_at,
    CASE WHEN s.area_sqm>0 THEN (s.asking_rent_nis/s.area_sqm)::float8 END rent_per_sqm
   FROM rental_listings l LEFT JOIN snap s ON s.rental_listing_id=l.id
   WHERE l.neighborhood_id=$1
   ORDER BY (l.status='active') DESC,l.last_seen_at DESC LIMIT 500
  `,[neighborhoodId])
 ]);
 return {metrics,inventory};
}

async function demographics(neighborhoodId:string){
 const [profiles,metrics]=await Promise.all([
  queryDatabase(`
   SELECT observation_year,population::float8,population_growth_from_2022_pct::float8,
    employment_pct::float8,academic_certificate_pct::float8,median_annual_employee_wage::float8,
    average_household_size::float8,owner_households_pct::float8,renter_households_pct::float8,
    median_age::float8,statistical_area_count,mapping_confidence::float8,profile_quality,safe_for_score,
    crosswalk_method,source_evidence,calculated_at
   FROM neighborhood_cbs_profiles
   WHERE neighborhood_id=$1 ORDER BY observation_year
  `,[neighborhoodId]),
  metricSection(neighborhoodId,['demographics','economics'])
 ]);
 return {
  profiles,metrics,
  note:'CBS profile values are neighborhood rollups from mapped statistical areas. Provisional profiles are context-only and do not feed the investment score until the 2022 crosswalk is fully validated.'
 };
}

async function infrastructure(neighborhoodId:string){
 const metrics=await metricSection(neighborhoodId,['infrastructure']);
 const evidenceRows=await queryDatabase(`
  SELECT dataset_slug,source_grain,count(*)::int evidence_count,
   round(avg(mapping_confidence)::numeric,3)::float8 avg_mapping_confidence,
   max(COALESCE(observation_date,make_date(observation_year,1,1))) latest_observation
  FROM dataset_neighborhood_evidence
  WHERE neighborhood_id=$1 AND dataset_slug=ANY(ARRAY[
   'infrastructure_projects','national_transport_plans','brt_routes','light_rail_stations',
   'rail_stations','metronit_routes','metro_stations','metro_routes','haifa_transport_2040'
  ])
  GROUP BY dataset_slug,source_grain ORDER BY dataset_slug
 `,[neighborhoodId]);
 return {metrics,evidence:evidenceRows,available:metrics.length>0||evidenceRows.length>0};
}

async function supply(neighborhoodId:string){
 return {
  metrics:await metricSection(neighborhoodId,['supply']),
  renewal:await queryDatabase(`
   SELECT count(*)::int projects,COALESCE(sum(existing_units),0)::int existing_units,
    COALESCE(sum(planned_units),0)::int planned_units,COALESCE(sum(additional_units),0)::int additional_units
   FROM renewal_projects WHERE neighborhood_id=$1
  `,[neighborhoodId])
 };
}

async function cityContext(neighborhoodId:string){
 return metricSection(neighborhoodId,['economics','demographics','supply','municipal','education']);
}

async function evidence(neighborhoodId:string,dataset?:string){
 return queryDatabase(`
  SELECT dataset_slug,source_record_id,source_grain,observation_date,observation_year,mapping_method,
   mapping_confidence::float8,payload,linked_at
  FROM dataset_neighborhood_evidence
  WHERE neighborhood_id=$1 AND ($2::text IS NULL OR dataset_slug=$2)
  ORDER BY dataset_slug,COALESCE(observation_date,make_date(observation_year,1,1)) DESC NULLS LAST
  LIMIT 1000
 `,[neighborhoodId,dataset||null]);
}

async function mapData(req:VercelRequest,res:VercelResponse){
 const neighborhoods=await queryDatabase(`
  SELECT n.id::text neighborhood_id,n.slug,n.name_he,c.name_he city,c.settlement_code,
   m.deal_heat::float8,m.investment_score::float8,m.confidence_score::float8,m.confidence_level,
   m.coverage_pct::float8,m.deal_count,m.transaction_count_12m,m.median_price_sqm_12m::float8,
   m.price_change_1y::float8,m.renewal_expansion_ratio::float8,m.estimated_gross_yield::float8,
   m.average_wage::float8,m.net_internal_migration::float8,m.construction_starts::float8,
   CASE WHEN n.geom IS NULL THEN NULL ELSE ST_AsGeoJSON(n.geom)::jsonb END geometry
  FROM neighborhoods n JOIN cities c ON c.id=n.city_id
  LEFT JOIN neighborhood_map_cache m ON m.neighborhood_id=n.id
  ORDER BY c.name_he,n.name_he
 `);
 const scope=String(req.query.scope||'neighborhood');
 if(scope!=='israel'){
  res.setHeader('Cache-Control','public, s-maxage=300, stale-while-revalidate=1800');
  return res.status(200).json({generatedAt:new Date().toISOString(),scope:'neighborhood',neighborhoods});
 }
 const cities=await queryDatabase(`
  WITH parsed AS (
   SELECT settlement_code,
    CASE WHEN deal_date ~ '^\\d{2}/\\d{2}/\\d{4}

export default async function handler(req:VercelRequest,res:VercelResponse){
 try{
  const mode=String(req.query.mode||req.body?.mode||'neighborhood-dashboard');
  if(mode==='neighborhood-identity-refresh'){
   if(!authorized(req))return res.status(401).json({error:'unauthorized'});
   return res.status(200).json({ok:true,...await refreshNeighborhoodIdentity()});
  }
  if(mode==='neighborhood-refresh'){
   if(!authorized(req))return res.status(401).json({error:'unauthorized'});
   return res.status(200).json({ok:true,...await refreshNeighborhoodIntelligence()});
  }
  if(mode==='neighborhood-eval'){
   if(req.method==='GET')return res.status(200).json(await latestNeighborhoodEvaluation());
   if(req.method!=='POST')return res.status(405).json({error:'method_not_allowed'});
   if(!authorized(req))return res.status(401).json({error:'unauthorized'});
   const includeAgent=Boolean(req.body?.includeAgent);
   return res.status(200).json(await runNeighborhoodEvaluations({includeAgent,gitSha:process.env.VERCEL_GIT_COMMIT_SHA}));
  }
  if(req.method!=='GET')return res.status(405).json({error:'method_not_allowed'});
  if(mode==='neighborhood-map')return mapData(req,res);
  if(mode==='neighborhood-identity'){
   const id=String(req.query.neighborhoodId||'');
   if(!/^[0-9a-f-]{36}$/i.test(id))return res.status(400).json({error:'invalid_neighborhood_id'});
   return res.status(200).json({mode:'live',neighborhoodId:id,data:await neighborhoodIdentity(id)});
  }
  const id=String(req.query.neighborhoodId||'');
  if(!/^[0-9a-f-]{36}$/i.test(id))return res.status(400).json({error:'invalid_neighborhood_id'});
  const section=String(req.query.section||'summary');
  const data=section==='summary'?await summary(id):
   section==='transactions'?await transactions(id):
   section==='listings'?await listings(id):
   section==='renewal'?await renewal(id):
   section==='market-trends'?await marketTrends(id):
   section==='demographics'?await demographics(id):
   section==='rentals'?await rentals(id):
   section==='infrastructure'?await infrastructure(id):
   section==='supply'?await supply(id):
   section==='city-context'?await cityContext(id):
   section==='evidence'?await evidence(id,typeof req.query.dataset==='string'?req.query.dataset:undefined):
   null;
  if(data===null)return res.status(400).json({error:'invalid_section',allowed:['summary','transactions','market-trends','listings','renewal','demographics','rentals','infrastructure','supply','city-context','evidence']});
  res.setHeader('Cache-Control',section==='listings'?'s-maxage=60, stale-while-revalidate=300':'s-maxage=300, stale-while-revalidate=1800');
  return res.status(200).json({mode:'live',neighborhoodId:id,section,data});
 }catch(error){return res.status(503).json({mode:'unavailable',error:String(error)});}
}
 THEN to_date(deal_date,'DD/MM/YYYY') END deal_date,
    NULLIF(regexp_replace(deal_amount,'[^0-9.]','','g'),'')::numeric amount_nis,
    NULLIF(regexp_replace(asset_area,'[^0-9.]','','g'),'')::numeric area_sqm
   FROM over_fd06f5ae8a4f4120b2758a514ad23499
  ), valid AS (
   SELECT settlement_code,deal_date,amount_nis,area_sqm,
    CASE WHEN area_sqm BETWEEN 15 AND 1000 AND amount_nis>0 THEN amount_nis/area_sqm END pp_sqm
   FROM parsed WHERE deal_date IS NOT NULL AND amount_nis>0
  ), latest AS (SELECT max(deal_date) d FROM valid),
  tx AS (
   SELECT v.settlement_code,
    count(*) FILTER(WHERE v.deal_date>l.d-interval '12 months')::int transaction_count_12m,
    percentile_cont(.5) within group(order by v.amount_nis) FILTER(WHERE v.deal_date>l.d-interval '12 months')::float8 median_deal_amount_12m,
    percentile_cont(.5) within group(order by v.pp_sqm) FILTER(WHERE v.deal_date>l.d-interval '12 months' AND v.pp_sqm IS NOT NULL)::float8 median_price_sqm_12m,
    percentile_cont(.5) within group(order by v.pp_sqm) FILTER(WHERE v.deal_date>l.d-interval '24 months' AND v.deal_date<=l.d-interval '12 months' AND v.pp_sqm IS NOT NULL)::float8 prior_median_price_sqm,
    l.d latest_transaction_date
   FROM valid v CROSS JOIN latest l GROUP BY v.settlement_code,l.d
  ), shapes AS (
   SELECT c.id::text city_id,c.settlement_code,c.name_he,c.name_en,
    ST_AsGeoJSON(ST_SimplifyPreserveTopology(ST_UnaryUnion(ST_Collect(sa.geom)),0.001))::jsonb geometry
   FROM cities c JOIN statistical_areas sa ON sa.city_id=c.id
   WHERE sa.geom IS NOT NULL
   GROUP BY c.id,c.settlement_code,c.name_he,c.name_en
  )
  SELECT s.city_id,s.settlement_code,s.name_he,s.name_en,s.geometry,
   COALESCE(tx.transaction_count_12m,0)::int transaction_count_12m,
   tx.median_deal_amount_12m,tx.median_price_sqm_12m,
   CASE WHEN tx.median_price_sqm_12m IS NOT NULL AND tx.prior_median_price_sqm>0
    THEN ((tx.median_price_sqm_12m-tx.prior_median_price_sqm)/tx.prior_median_price_sqm*100)::float8 END price_change_1y,
   tx.latest_transaction_date,
   (tx.settlement_code IS NOT NULL) has_transaction_data
  FROM shapes s LEFT JOIN tx ON tx.settlement_code=s.settlement_code
  ORDER BY s.name_he
 `);
 res.setHeader('Cache-Control','public, s-maxage=3600, stale-while-revalidate=86400');
 return res.status(200).json({
  generatedAt:new Date().toISOString(),
  scope:'israel',
  source:{dataset:'over_fd06f5ae8a4f4120b2758a514ad23499',grain:'settlement',coverageNote:'Transaction archive currently contains 10 settlements; all other CBS city shapes remain gray.'},
  cities,neighborhoods
 });
}

export default async function handler(req:VercelRequest,res:VercelResponse){
 try{
  const mode=String(req.query.mode||req.body?.mode||'neighborhood-dashboard');
  if(mode==='neighborhood-identity-refresh'){
   if(!authorized(req))return res.status(401).json({error:'unauthorized'});
   return res.status(200).json({ok:true,...await refreshNeighborhoodIdentity()});
  }
  if(mode==='neighborhood-refresh'){
   if(!authorized(req))return res.status(401).json({error:'unauthorized'});
   return res.status(200).json({ok:true,...await refreshNeighborhoodIntelligence()});
  }
  if(mode==='neighborhood-eval'){
   if(req.method==='GET')return res.status(200).json(await latestNeighborhoodEvaluation());
   if(req.method!=='POST')return res.status(405).json({error:'method_not_allowed'});
   if(!authorized(req))return res.status(401).json({error:'unauthorized'});
   const includeAgent=Boolean(req.body?.includeAgent);
   return res.status(200).json(await runNeighborhoodEvaluations({includeAgent,gitSha:process.env.VERCEL_GIT_COMMIT_SHA}));
  }
  if(req.method!=='GET')return res.status(405).json({error:'method_not_allowed'});
  if(mode==='neighborhood-map')return mapData(req,res);
  if(mode==='neighborhood-identity'){
   const id=String(req.query.neighborhoodId||'');
   if(!/^[0-9a-f-]{36}$/i.test(id))return res.status(400).json({error:'invalid_neighborhood_id'});
   return res.status(200).json({mode:'live',neighborhoodId:id,data:await neighborhoodIdentity(id)});
  }
  const id=String(req.query.neighborhoodId||'');
  if(!/^[0-9a-f-]{36}$/i.test(id))return res.status(400).json({error:'invalid_neighborhood_id'});
  const section=String(req.query.section||'summary');
  const data=section==='summary'?await summary(id):
   section==='transactions'?await transactions(id):
   section==='listings'?await listings(id):
   section==='renewal'?await renewal(id):
   section==='market-trends'?await marketTrends(id):
   section==='demographics'?await demographics(id):
   section==='rentals'?await rentals(id):
   section==='infrastructure'?await infrastructure(id):
   section==='supply'?await supply(id):
   section==='city-context'?await cityContext(id):
   section==='evidence'?await evidence(id,typeof req.query.dataset==='string'?req.query.dataset:undefined):
   null;
  if(data===null)return res.status(400).json({error:'invalid_section',allowed:['summary','transactions','market-trends','listings','renewal','demographics','rentals','infrastructure','supply','city-context','evidence']});
  res.setHeader('Cache-Control',section==='listings'?'s-maxage=60, stale-while-revalidate=300':'s-maxage=300, stale-while-revalidate=1800');
  return res.status(200).json({mode:'live',neighborhoodId:id,section,data});
 }catch(error){return res.status(503).json({mode:'unavailable',error:String(error)});}
}
