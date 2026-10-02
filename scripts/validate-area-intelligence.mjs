import fs from 'node:fs';
import {neon} from '@neondatabase/serverless';

if(!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const {refreshAreaIntelligence}=await import('../.server-build/server/areaIntelligence.js');
const refresh=await refreshAreaIntelligence();
const sql=neon(process.env.DATABASE_URL);

const [coverage]=await sql`
  SELECT
    (SELECT count(*)::int FROM area_dimensions) areas,
    (SELECT count(*)::int FROM transaction_area_map) mapped_transactions,
    (SELECT count(*)::int FROM listing_area_map) mapped_listings,
    (SELECT count(*)::int FROM renewal_area_map) renewal_links,
    (SELECT count(*)::int FROM infrastructure_area_map) infrastructure_links,
    (SELECT count(*)::int FROM area_map_cache) cached_areas,
    (SELECT count(*)::int FROM area_map_cache WHERE deal_heat IS NOT NULL) deal_heat_areas,
    (SELECT count(*)::int FROM area_map_cache WHERE area_score IS NOT NULL) area_score_areas,
    (SELECT round(avg(coverage_pct)::numeric,2) FROM area_map_cache) avg_coverage_pct,
    (SELECT round(avg(confidence_score)::numeric,2) FROM area_map_cache) avg_confidence_score
`;

const mappingRates=(await sql`
  SELECT
    (SELECT count(*)::int FROM transactions WHERE deal_date>=current_date-interval '36 months') recent_transactions,
    (SELECT count(*)::int FROM transactions t JOIN transaction_area_map m ON m.transaction_id=t.id
      WHERE t.deal_date>=current_date-interval '36 months') recent_transactions_mapped,
    (SELECT count(*)::int FROM listings WHERE status='active') active_listings,
    (SELECT count(*)::int FROM listings l JOIN listing_area_map m ON m.listing_id=l.id
      WHERE l.status='active') active_listings_mapped
`)[0];

const top=await sql`
  SELECT a.locality_name,a.statistical_area_code,
    round(c.deal_heat::numeric,2) deal_heat,
    round(c.area_score::numeric,2) area_score,
    c.confidence_level,
    round(c.coverage_pct::numeric,2) coverage_pct,
    c.deal_count,c.transaction_count_12m
  FROM area_map_cache c JOIN area_dimensions a ON a.id=c.area_id
  WHERE c.deal_heat IS NOT NULL OR c.area_score IS NOT NULL
  ORDER BY c.deal_heat DESC NULLS LAST,c.area_score DESC NULLS LAST
  LIMIT 20
`;

const metricCoverage=await sql`
  SELECT metric_key,count(*)::int areas,
         round(avg(confidence)::numeric,3) avg_confidence,
         max(as_of_date) latest_as_of
  FROM area_metric_snapshots
  GROUP BY metric_key ORDER BY metric_key
`;

const report={
  generatedAt:new Date().toISOString(),
  scoreVersion:refresh.scoreVersion,
  refresh,
  coverage,
  mappingRates,
  metricCoverage,
  top
};
fs.mkdirSync('artifacts',{recursive:true});
fs.writeFileSync('artifacts/area-validation.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
