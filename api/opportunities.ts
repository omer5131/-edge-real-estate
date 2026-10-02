import type { VercelRequest,VercelResponse } from '@vercel/node';
import { sql } from '../server/db.js';
export default async function handler(req:VercelRequest,res:VercelResponse){
 if(req.method!=='GET')return res.status(405).json({error:'method_not_allowed'});
 const rows=await sql`
 WITH latest_snap AS (
   SELECT DISTINCT ON(listing_id) * FROM listing_snapshots ORDER BY listing_id,observed_at DESC
 ), latest_score AS (
   SELECT DISTINCT ON(entity_id) entity_id,score,price_gap_score,renewal_score,seller_motivation_score,
     comp_confidence_score,risk_deduction,calculated_at,model_version
   FROM opportunity_scores
   WHERE entity_type='listing' AND model_version='edge-v0.2'
   ORDER BY entity_id,calculated_at DESC
 ), comps AS (
   SELECT neighborhood_id,
     percentile_cont(.5) WITHIN GROUP(ORDER BY COALESCE(normalized_pp_sqm,pp_sqm))
       FILTER(WHERE deal_date>=current_date-interval '18 months') comp_pp_sqm,
     count(*) FILTER(WHERE deal_date>=current_date-interval '18 months')::int comp_count,
     max(deal_date) latest_comp_date
   FROM comparable_transactions WHERE neighborhood_id IS NOT NULL GROUP BY neighborhood_id
 )
 SELECT l.id::text,l.canonical_address address,n.slug neighborhood_id,n.name_he neighborhood,c.name_he city,
   s.asking_price_nis::float8 asking_price,s.area_sqm::float8 sqm,s.rooms::float8 rooms,s.floor::float8 floor,
   CASE WHEN s.area_sqm>0 THEN (s.asking_price_nis/s.area_sqm)::float8 END price_sqm,
   CASE WHEN s.area_sqm>0 AND comps.comp_pp_sqm>0 THEN (s.area_sqm*comps.comp_pp_sqm)::float8 END adjusted_value,
   CASE WHEN s.area_sqm>0 AND comps.comp_pp_sqm>0 THEN
     (100*(s.area_sqm*comps.comp_pp_sqm-s.asking_price_nis)/(s.area_sqm*comps.comp_pp_sqm))::float8 END discount_pct,
   sc.score::float8 score,sc.model_version,sc.calculated_at,
   coalesce(comps.comp_count,0)::int comp_count,comps.latest_comp_date,
   CASE WHEN comps.comp_count>=20 THEN 'high' WHEN comps.comp_count>=8 THEN 'medium'
        WHEN comps.comp_count>=3 THEN 'low' ELSE 'insufficient' END confidence,
   coalesce(sig.days_on_market,0)::int days_on_market,coalesce(sig.price_reductions,0)::int price_reductions,
   sig.original_asking_price::float8 original_price,l.url,l.last_seen_at
 FROM listings l
 JOIN latest_snap s ON s.listing_id=l.id
 JOIN neighborhoods n ON n.id=l.neighborhood_id
 JOIN cities c ON c.id=l.city_id
 LEFT JOIN latest_score sc ON sc.entity_id=l.id
 LEFT JOIN listing_seller_signals sig ON sig.listing_id=l.id
 LEFT JOIN comps ON comps.neighborhood_id=l.neighborhood_id
 WHERE l.status='active'
 ORDER BY sc.score DESC NULLS LAST,l.last_seen_at DESC
 LIMIT 100`;
 res.setHeader('Cache-Control','s-maxage=120, stale-while-revalidate=600');
 res.status(200).json({data:rows,source:'edge-postgres'});
}