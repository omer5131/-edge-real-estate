import type { VercelRequest,VercelResponse } from '@vercel/node';
import { sql } from '../server/db.js';
export default async function handler(req:VercelRequest,res:VercelResponse){
 if(req.method!=='GET')return res.status(405).json({error:'method_not_allowed'});
 const rows=await sql`
  WITH tx AS (
   SELECT neighborhood_id,count(*) FILTER(WHERE deal_date>=current_date-interval '12 months')::int transaction_count_12m,
     percentile_cont(.5) WITHIN GROUP(ORDER BY COALESCE(normalized_pp_sqm,pp_sqm))
       FILTER(WHERE deal_date>=current_date-interval '12 months') median_pp_sqm,
     max(deal_date) latest_transaction_date
   FROM comparable_transactions WHERE neighborhood_id IS NOT NULL GROUP BY neighborhood_id
  ), renewal AS (
   SELECT neighborhood_id,count(*)::int renewal_projects,sum(existing_units)::int existing_units,sum(planned_units)::int planned_units
   FROM renewal_projects GROUP BY neighborhood_id
  ), demo AS (
   SELECT DISTINCT ON(neighborhood_id) neighborhood_id,period_year,population,avg_household_income_nis,
     academic_pct,socio_economic_cluster,population_growth_pct
   FROM demographic_snapshots WHERE neighborhood_id IS NOT NULL ORDER BY neighborhood_id,period_year DESC
  )
  SELECT n.id,n.slug,n.name_he,n.name_en,c.name_he city,
    coalesce(tx.transaction_count_12m,0) transaction_count_12m,tx.median_pp_sqm,tx.latest_transaction_date,
    coalesce(mc.confidence,'insufficient') confidence,coalesce(mc.sample_12m,0)::int sample_size,
    r.renewal_projects,r.existing_units,r.planned_units,
    d.period_year demographic_year,d.population,d.avg_household_income_nis,d.academic_pct,d.socio_economic_cluster,d.population_growth_pct,
    ST_AsGeoJSON(n.geom)::jsonb geometry
  FROM neighborhoods n
  JOIN cities c ON c.id=n.city_id
  LEFT JOIN tx ON tx.neighborhood_id=n.id
  LEFT JOIN neighborhood_market_confidence mc ON mc.neighborhood_id=n.id
  LEFT JOIN renewal r ON r.neighborhood_id=n.id
  LEFT JOIN demo d ON d.neighborhood_id=n.id
  WHERE n.is_focus=true ORDER BY c.name_he,n.name_he`;
 res.setHeader('Cache-Control','s-maxage=120, stale-while-revalidate=600');
 res.status(200).json({data:rows,source:'edge-postgres'});
}