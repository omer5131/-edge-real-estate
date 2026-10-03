import fs from 'node:fs';
import {neon} from '@neondatabase/serverless';

if(!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const {refreshNeighborhoodIntelligence}=await import('../.server-build/server/neighborhoodIntelligence.js');
const refresh=await refreshNeighborhoodIntelligence();
const sql=neon(process.env.DATABASE_URL);

const [coverage]=await sql`
  SELECT
    (SELECT count(*)::int FROM neighborhoods) neighborhoods,
    (SELECT count(*)::int FROM neighborhoods WHERE geom IS NOT NULL) neighborhoods_with_geometry,
    (SELECT count(*)::int FROM neighborhood_stat_area_map) stat_area_links,
    (SELECT count(*)::int FROM dataset_neighborhood_evidence) evidence_rows,
    (SELECT count(*)::int FROM neighborhood_map_cache) cached_neighborhoods,
    (SELECT count(*)::int FROM neighborhood_map_cache WHERE deal_heat IS NOT NULL) deal_heat_neighborhoods,
    (SELECT count(*)::int FROM neighborhood_map_cache WHERE investment_score IS NOT NULL) investment_score_neighborhoods,
    (SELECT round(avg(coverage_pct)::numeric,2) FROM neighborhood_map_cache) avg_coverage_pct,
    (SELECT round(avg(confidence_score)::numeric,2) FROM neighborhood_map_cache) avg_confidence_score
`;

const mappingRates=(await sql`
  SELECT
    (SELECT count(*)::int FROM comparable_transactions WHERE deal_date>=current_date-interval '36 months') recent_transactions,
    (SELECT count(*)::int FROM comparable_transactions WHERE deal_date>=current_date-interval '36 months' AND neighborhood_id IS NOT NULL) recent_transactions_with_neighborhood,
    (SELECT count(*)::int FROM listings WHERE status='active') active_listings,
    (SELECT count(*)::int FROM listings WHERE status='active' AND neighborhood_id IS NOT NULL) active_listings_with_neighborhood,
    (SELECT count(*)::int FROM renewal_projects) renewal_projects,
    (SELECT count(*)::int FROM renewal_projects WHERE neighborhood_id IS NOT NULL) renewal_projects_with_neighborhood
`)[0];


const geographyDiagnostics=await sql`
  SELECT
    (SELECT count(*)::int FROM parcels) parcels_total,
    (SELECT count(*)::int FROM parcels WHERE city_id IS NOT NULL) parcels_with_city,
    (SELECT count(*)::int FROM parcels WHERE stat_area_id IS NOT NULL) parcels_with_stat_area,
    (SELECT count(*)::int FROM statistical_areas) stat_areas_total,
    (SELECT count(*)::int FROM statistical_areas WHERE city_id IS NOT NULL) stat_areas_with_city,
    (SELECT count(*)::int FROM comparable_transactions WHERE parcel_id IS NOT NULL) comparable_with_parcel,
    (SELECT count(*)::int FROM buildings WHERE geom IS NOT NULL) buildings_with_geom,
    (SELECT count(*)::int FROM buildings WHERE geom IS NOT NULL AND neighborhood_id IS NOT NULL) neighborhood_buildings_with_geom
`;

const geographySamples=await sql`
  SELECT 'parcel' kind,p.gush::text a,p.helka::text b,c.name_he city,
    ST_X(ST_Centroid(p.geom))::float8 x,ST_Y(ST_Centroid(p.geom))::float8 y
  FROM parcels p LEFT JOIN cities c ON c.id=p.city_id WHERE p.geom IS NOT NULL
  LIMIT 5
`;
const statAreaSamples=await sql`
  SELECT 'stat_area' kind,s.stat_area_code a,s."year"::text b,c.name_he city,
    ST_X(ST_Centroid(s.geom))::float8 x,ST_Y(ST_Centroid(s.geom))::float8 y
  FROM statistical_areas s LEFT JOIN cities c ON c.id=s.city_id WHERE s.geom IS NOT NULL
  LIMIT 5
`;
const targetCityCodes=await sql`
  SELECT c.name_he,c.settlement_code,count(n.id)::int neighborhoods
  FROM cities c LEFT JOIN neighborhoods n ON n.city_id=c.id
  WHERE c.name_he IN ('חיפה','נתניה','פתח תקווה')
  GROUP BY c.id,c.name_he,c.settlement_code ORDER BY c.name_he
`;


const transactionLinkDiagnostics=await sql`
  SELECT
    (SELECT count(*)::int FROM comparable_transactions WHERE neighborhood_id IS NOT NULL) direct_neighborhood,
    (SELECT count(*)::int FROM comparable_transactions WHERE neighborhood_id IS NOT NULL AND parcel_id IS NOT NULL) direct_with_parcel,
    (SELECT count(*)::int FROM comparable_transactions ct JOIN parcels p ON p.id=ct.parcel_id WHERE ct.neighborhood_id IS NOT NULL AND p.stat_area_id IS NOT NULL) direct_with_stat_area,
    (SELECT count(*)::int FROM comparable_transactions WHERE parcel_id IS NOT NULL) all_with_parcel,
    (SELECT count(*)::int FROM comparable_transactions ct JOIN parcels p ON p.id=ct.parcel_id WHERE p.stat_area_id IS NOT NULL) all_with_stat_area
`;

const comparableColumns=await sql`
  SELECT column_name,data_type
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='comparable_transactions'
  ORDER BY ordinal_position
`;

const datasetCoverage=await sql`
  SELECT dataset_slug,source_grain,count(DISTINCT neighborhood_id)::int neighborhoods,count(*)::int evidence_rows,
    round(avg(mapping_confidence)::numeric,3) avg_mapping_confidence,
    max(COALESCE(observation_date,make_date(observation_year,1,1))) latest_observation
  FROM dataset_neighborhood_evidence
  GROUP BY dataset_slug,source_grain
  ORDER BY dataset_slug,source_grain
`;

const metricCoverage=await sql`
  SELECT metric_key,count(DISTINCT neighborhood_id)::int neighborhoods,
    round(avg(confidence)::numeric,3) avg_confidence,
    max(as_of_date) latest_as_of,
    array_agg(DISTINCT unnest_source) source_datasets
  FROM neighborhood_metric_snapshots n
  LEFT JOIN LATERAL unnest(n.source_datasets) unnest_source ON true
  GROUP BY metric_key ORDER BY metric_key
`;

const neighborhoods=await sql`
  SELECT n.slug,n.name_he,c.name_he city,
    round(m.deal_heat::numeric,2) deal_heat,
    round(m.investment_score::numeric,2) investment_score,
    m.confidence_level,round(m.coverage_pct::numeric,2) coverage_pct,
    m.deal_count,m.transaction_count_12m,
    round(m.median_price_sqm_12m::numeric,2) median_price_sqm_12m,
    round(m.price_change_1y::numeric,2) price_change_1y,
    round(m.estimated_gross_yield::numeric,2) estimated_gross_yield
  FROM neighborhoods n JOIN cities c ON c.id=n.city_id
  LEFT JOIN neighborhood_map_cache m ON m.neighborhood_id=n.id
  ORDER BY c.name_he,n.name_he
`;

const report={
 generatedAt:new Date().toISOString(),
 scoreVersion:refresh.scoreVersion,
 aggregationKey:'neighborhood_id',
 refresh,
 coverage,
 mappingRates,
 geographyDiagnostics,
 geographySamples,
 statAreaSamples,
 targetCityCodes,
 transactionLinkDiagnostics,
 comparableColumns,
 datasetCoverage,
 metricCoverage,
 neighborhoods
};
fs.mkdirSync('artifacts',{recursive:true});
fs.writeFileSync('artifacts/neighborhood-validation.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
