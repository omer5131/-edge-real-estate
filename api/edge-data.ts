import type { VercelRequest,VercelResponse } from '@vercel/node';
import { sql } from '../server/db.js';

export default async function handler(req:VercelRequest,res:VercelResponse){
 if(req.method!=='GET')return res.status(405).json({error:'method_not_allowed'});
 try{
  const [areas,opportunities,sources,plans,infrastructure]=await Promise.all([
   sql`
    WITH tx AS (
     SELECT neighborhood_id,
       count(*) FILTER(WHERE deal_date>=current_date-interval '12 months')::int transactions_12m,
       percentile_cont(.5) WITHIN GROUP(ORDER BY COALESCE(normalized_pp_sqm,pp_sqm))
         FILTER(WHERE deal_date>=current_date-interval '12 months') AS median_price_sqm,
       percentile_cont(.5) WITHIN GROUP(ORDER BY COALESCE(normalized_pp_sqm,pp_sqm))
         FILTER(WHERE deal_date>=current_date-interval '24 months' AND deal_date<current_date-interval '12 months') p0,
       percentile_cont(.5) WITHIN GROUP(ORDER BY COALESCE(normalized_pp_sqm,pp_sqm))
         FILTER(WHERE deal_date>=current_date-interval '36 months' AND deal_date<current_date-interval '24 months') p3,
       max(deal_date) latest_deal_date
     FROM comparable_transactions
     WHERE neighborhood_id IS NOT NULL
     GROUP BY neighborhood_id
    ), rp AS (
     SELECT neighborhood_id,count(*)::int renewal_projects,
       sum(existing_units)::int existing_units,sum(planned_units)::int planned_units
     FROM renewal_projects WHERE neighborhood_id IS NOT NULL GROUP BY neighborhood_id
    ), rent AS (
     SELECT neighborhood_id,active_supply,median_rent_nis::float8,median_rent_pp_sqm::float8,observed_at
     FROM neighborhood_rent_metrics
    ), status AS (
     SELECT
       EXISTS(SELECT 1 FROM renewal_projects) renewal_ready,
       EXISTS(SELECT 1 FROM rental_listings) rent_ready
    )
    SELECT n.id neighborhood_uuid,n.slug id,n.name_he name,c.name_he city,
      tx.median_price_sqm::float8 avg_price_sqm,
      CASE WHEN tx.p0>0 AND tx.median_price_sqm>0 THEN 100*(tx.median_price_sqm/tx.p0-1) END::float8 change_1y,
      CASE WHEN tx.p3>0 AND tx.median_price_sqm>0 THEN 100*(tx.median_price_sqm/tx.p3-1) END::float8 change_3y,
      coalesce(tx.transactions_12m,0)::int transactions_12m,
      coalesce(mc.confidence,'insufficient') confidence,
      coalesce(mc.sample_12m,0)::int sample_size,
      tx.latest_deal_date,
      CASE WHEN status.renewal_ready THEN coalesce(rp.renewal_projects,0)::int END renewal_projects,
      CASE WHEN status.renewal_ready THEN coalesce(rp.existing_units,0)::int END existing_units,
      CASE WHEN status.renewal_ready THEN coalesce(rp.planned_units,0)::int END planned_units,
      CASE WHEN status.rent_ready THEN rent.median_rent_nis END median_rent_nis,
      CASE WHEN status.rent_ready THEN rent.median_rent_pp_sqm END median_rent_pp_sqm,
      CASE WHEN status.rent_ready THEN rent.active_supply END rent_sample_size,
      CASE WHEN status.rent_ready THEN rent.observed_at END rent_observed_at
    FROM neighborhoods n
    JOIN cities c ON c.id=n.city_id
    CROSS JOIN status
    LEFT JOIN tx ON tx.neighborhood_id=n.id
    LEFT JOIN neighborhood_market_confidence mc ON mc.neighborhood_id=n.id
    LEFT JOIN rp ON rp.neighborhood_id=n.id
    LEFT JOIN rent ON rent.neighborhood_id=n.id
    WHERE n.is_focus=true
    ORDER BY n.slug
   `,
   sql`
    WITH latest_snap AS (
     SELECT DISTINCT ON(listing_id) * FROM listing_snapshots ORDER BY listing_id,observed_at DESC
    ), latest_score AS(
     SELECT DISTINCT ON(entity_id) entity_id,score,model_version,calculated_at
     FROM opportunity_scores
     WHERE entity_type='listing'
     ORDER BY entity_id,calculated_at DESC
    ), comps AS(
     SELECT neighborhood_id,
       percentile_cont(.5) WITHIN GROUP(ORDER BY COALESCE(normalized_pp_sqm,pp_sqm))
         FILTER(WHERE deal_date>=current_date-interval '18 months') comp_pp_sqm,
       count(*) FILTER(WHERE deal_date>=current_date-interval '18 months')::int comp_count,
       max(deal_date) latest_comp_date
     FROM comparable_transactions WHERE neighborhood_id IS NOT NULL GROUP BY neighborhood_id
    )
    SELECT l.id::text id,l.canonical_address address,n.slug neighborhood_id,n.name_he neighborhood,c.name_he city,
     s.asking_price_nis::float8 asking_price,s.area_sqm::float8 sqm,s.rooms::float8 rooms,s.floor::text floor,
     CASE WHEN s.area_sqm>0 THEN (s.asking_price_nis/s.area_sqm)::float8 END price_sqm,
     CASE WHEN s.area_sqm>0 AND comps.comp_pp_sqm>0 THEN (s.area_sqm*comps.comp_pp_sqm)::float8 END adjusted_value,
     CASE WHEN s.area_sqm>0 AND comps.comp_pp_sqm>0 THEN
       (100*(s.area_sqm*comps.comp_pp_sqm-s.asking_price_nis)/(s.area_sqm*comps.comp_pp_sqm))::float8 END discount_pct,
     coalesce(sig.days_on_market,0)::int days_on_market,
     CASE WHEN coalesce(sig.days_on_market,0)>120 OR coalesce(sig.price_reductions,0)>=3 THEN 'גבוה מאוד'
          WHEN coalesce(sig.days_on_market,0)>75 OR coalesce(sig.price_reductions,0)>=2 THEN 'גבוה'
          WHEN coalesce(sig.days_on_market,0)>35 THEN 'בינוני' ELSE 'נמוך' END seller_motivation,
     coalesce(comps.comp_count,0)::int comp_count,comps.latest_comp_date,
     CASE WHEN comps.comp_count>=20 THEN 'high'
          WHEN comps.comp_count>=8 THEN 'medium'
          WHEN comps.comp_count>=3 THEN 'low'
          ELSE 'insufficient' END confidence,
     sc.score::int score,sc.model_version,sc.calculated_at,
     (sc.entity_id IS NOT NULL) system_flag,(sub.id IS NOT NULL) manual_flag,
     coalesce(sig.price_reductions,0)+1 price_points,
     sig.original_asking_price::float8 original_price,
     l.last_seen_at
    FROM listings l
    JOIN latest_snap s ON s.listing_id=l.id
    JOIN neighborhoods n ON n.id=l.neighborhood_id
    JOIN cities c ON c.id=l.city_id
    LEFT JOIN latest_score sc ON sc.entity_id=l.id
    LEFT JOIN asset_subscriptions sub ON sub.entity_type='listing' AND sub.entity_id=l.id
    LEFT JOIN listing_seller_signals sig ON sig.listing_id=l.id
    LEFT JOIN comps ON comps.neighborhood_id=l.neighborhood_id
    WHERE l.status='active' AND (sc.entity_id IS NOT NULL OR sub.id IS NOT NULL)
    ORDER BY (sub.id IS NOT NULL) DESC,sc.score DESC NULLS LAST,l.last_seen_at DESC
    LIMIT 100
   `,
   sql`
    SELECT id,name,kind source_type,
      (SELECT max(finished_at) FROM ingestion_runs r WHERE r.source_id=data_sources.id AND r.status='success') last_success_at,
      (SELECT max(finished_at) FROM ingestion_runs r WHERE r.source_id=data_sources.id AND r.status IN ('failed','partial')) last_error_at,
      (SELECT error_summary FROM ingestion_runs r WHERE r.source_id=data_sources.id AND r.status IN ('failed','partial') ORDER BY started_at DESC LIMIT 1) last_error
    FROM data_sources ORDER BY id
   `,
   sql`
    SELECT n.slug neighborhood_id,p.source_plan_id id,p.plan_number,p.name,p.status,p.authority,p.housing_units,p.source_url,
      CASE WHEN p.geom IS NULL THEN NULL ELSE ST_Y(ST_PointOnSurface(p.geom)) END::float8 lat,
      CASE WHEN p.geom IS NULL THEN NULL ELSE ST_X(ST_PointOnSurface(p.geom)) END::float8 lon,
      p.observed_at
    FROM planning_plans p JOIN neighborhoods n ON n.id=p.neighborhood_id
    WHERE n.is_focus
    ORDER BY p.observed_at DESC
    LIMIT 500
   `,
   sql`
    SELECT n.slug neighborhood_id,i.source_project_id id,i.name,i.category,i.status,i.lat,i.lon,i.source_url,i.observed_at
    FROM infrastructure_projects i JOIN neighborhoods n ON n.id=i.neighborhood_id
    WHERE n.is_focus
    ORDER BY i.observed_at DESC
    LIMIT 1000
   `
  ]);

  const plansBy=new Map<string,any[]>(),infraBy=new Map<string,any[]>();
  for(const p of plans as any[]){const a=plansBy.get(p.neighborhood_id)||[];a.push(p);plansBy.set(p.neighborhood_id,a)}
  for(const i of infrastructure as any[]){const a=infraBy.get(i.neighborhood_id)||[];a.push(i);infraBy.set(i.neighborhood_id,a)}
  const enriched=(areas as any[]).map(a=>({...a,plans:plansBy.get(a.id)||[],infrastructure:infraBy.get(a.id)||[]}));

  res.setHeader('Cache-Control','s-maxage=120, stale-while-revalidate=600');
  res.status(200).json({mode:'live',generatedAt:new Date().toISOString(),areas:enriched,opportunities,sources});
 }catch(e){
  res.status(503).json({mode:'unavailable',error:String(e)});
 }
}
