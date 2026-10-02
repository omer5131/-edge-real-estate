import type { VercelRequest,VercelResponse } from '@vercel/node';
import { sql } from '../server/db.js';

const n=(v:any)=>{const x=Number(v);return Number.isFinite(x)?x:null};
const bool=(v:any)=>String(v||'').toLowerCase()==='true';

export default async function handler(req:VercelRequest,res:VercelResponse){
 if(req.method==='POST'){
  const b=req.body||{};
  if(!b.entity_id)return res.status(400).json({error:'entity_id_required'});
  if(b.action==='unsubscribe'){
   await sql`DELETE FROM asset_subscriptions WHERE entity_type=${b.entity_type||'listing'} AND entity_id=${b.entity_id}::uuid`;
   return res.status(200).json({ok:true,subscribed:false});
  }
  const sub=await sql`INSERT INTO asset_subscriptions(entity_type,entity_id,status,enrichment_level,notes)
   VALUES(${b.entity_type||'listing'},${b.entity_id}::uuid,${b.status||'watching'},'full',${b.notes||null})
   ON CONFLICT(entity_type,entity_id) DO UPDATE SET status=EXCLUDED.status,enrichment_level='full',
    notes=coalesce(EXCLUDED.notes,asset_subscriptions.notes),updated_at=now() RETURNING *`;
  return res.status(200).json({ok:true,subscribed:true,subscription:sub[0]});
 }
 if(req.method!=='GET')return res.status(405).json({error:'method_not_allowed'});

 if(String(req.query.mode||'')==='research'){
  const q=String(req.query.q||'').trim(),city=String(req.query.city||'').trim(),area=String(req.query.area||'').trim();
  const minPrice=n(req.query.minPrice),maxPrice=n(req.query.maxPrice),minRooms=n(req.query.minRooms),maxRooms=n(req.query.maxRooms);
  const minSqm=n(req.query.minSqm),maxSqm=n(req.query.maxSqm),minScore=n(req.query.minScore);
  const subscribed=bool(req.query.subscribed),system=bool(req.query.system),followed=bool(req.query.followed);
  const limit=Math.min(500,Math.max(25,n(req.query.limit)||200)),offset=Math.max(0,n(req.query.offset)||0);
  const sortAllowed=new Set(['last_seen_at','asking_price_nis','asking_pp_sqm','score','discount_pct','days_on_market','comp_count']);
  const sort=sortAllowed.has(String(req.query.sort))?String(req.query.sort):'last_seen_at';
  const dir=String(req.query.dir).toLowerCase()==='asc'?'ASC':'DESC';

  const rows=await sql`
   WITH latest AS (
    SELECT DISTINCT ON(listing_id) listing_id,asking_price_nis,area_sqm,rooms,floor,broker_name,observed_at
    FROM listing_snapshots ORDER BY listing_id,observed_at DESC
   ), score AS (
    SELECT DISTINCT ON(entity_id) entity_id,score,calculated_at,model_version
    FROM opportunity_scores WHERE entity_type='listing' ORDER BY entity_id,calculated_at DESC
   ), comps AS (
    SELECT neighborhood_id,
      percentile_cont(.5) WITHIN GROUP(ORDER BY COALESCE(normalized_pp_sqm,pp_sqm))
       FILTER(WHERE deal_date>=current_date-interval '18 months') comp_pp_sqm,
      count(*) FILTER(WHERE deal_date>=current_date-interval '18 months')::int comp_count,
      max(deal_date) latest_comp_date
    FROM comparable_transactions WHERE neighborhood_id IS NOT NULL GROUP BY neighborhood_id
   ), renew AS (
    SELECT neighborhood_id,count(*)::int renewal_projects,
      count(*) FILTER(WHERE in_execution)::int renewal_in_execution
    FROM renewal_projects WHERE neighborhood_id IS NOT NULL GROUP BY neighborhood_id
   ), plans AS (
    SELECT neighborhood_id,count(*)::int planning_plans
    FROM planning_plans WHERE neighborhood_id IS NOT NULL GROUP BY neighborhood_id
   ), base AS (
    SELECT l.id,l.source_id,l.source_listing_id,l.canonical_address,l.url,l.status,l.first_seen_at,l.last_seen_at,
      n.slug neighborhood_id,n.name_he neighborhood,c.name_he city,
      latest.asking_price_nis::float8,latest.area_sqm::float8,latest.rooms::float8,latest.floor::float8,
      latest.broker_name,latest.observed_at,
      CASE WHEN latest.area_sqm>0 THEN (latest.asking_price_nis/latest.area_sqm)::float8 END asking_pp_sqm,
      sc.score::float8,sc.calculated_at score_at,sc.model_version,
      (sc.entity_id IS NOT NULL) system_flag,
      (sub.id IS NOT NULL) manual_flag,sub.id subscription_id,sub.status subscription_status,sub.enrichment_level,sub.subscribed_at,
      (fa.id IS NOT NULL AND fa.is_active) followed_area,
      coalesce(sig.days_on_market,0)::int days_on_market,coalesce(sig.price_reductions,0)::int price_reductions,
      sig.original_asking_price::float8 original_asking_price,sig.total_reduction_pct::float8,
      coalesce(comps.comp_count,0)::int comp_count,comps.comp_pp_sqm::float8 comp_pp_sqm,comps.latest_comp_date,
      CASE WHEN latest.area_sqm>0 AND comps.comp_pp_sqm>0 THEN (latest.area_sqm*comps.comp_pp_sqm)::float8 END estimated_value_nis,
      CASE WHEN latest.area_sqm>0 AND comps.comp_pp_sqm>0 THEN
       (100*(latest.area_sqm*comps.comp_pp_sqm-latest.asking_price_nis)/(latest.area_sqm*comps.comp_pp_sqm))::float8 END discount_pct,
      CASE WHEN comps.comp_count>=20 THEN 'high' WHEN comps.comp_count>=8 THEN 'medium'
       WHEN comps.comp_count>=3 THEN 'low' ELSE 'insufficient' END confidence,
      coalesce(renew.renewal_projects,0)::int renewal_projects,coalesce(renew.renewal_in_execution,0)::int renewal_in_execution,
      coalesce(plans.planning_plans,0)::int planning_plans
    FROM listings l
    LEFT JOIN latest ON latest.listing_id=l.id
    LEFT JOIN neighborhoods n ON n.id=l.neighborhood_id
    LEFT JOIN cities c ON c.id=l.city_id
    LEFT JOIN score sc ON sc.entity_id=l.id
    LEFT JOIN asset_subscriptions sub ON sub.entity_type='listing' AND sub.entity_id=l.id
    LEFT JOIN followed_areas fa ON fa.neighborhood_id=l.neighborhood_id
    LEFT JOIN listing_seller_signals sig ON sig.listing_id=l.id
    LEFT JOIN comps ON comps.neighborhood_id=l.neighborhood_id
    LEFT JOIN renew ON renew.neighborhood_id=l.neighborhood_id
    LEFT JOIN plans ON plans.neighborhood_id=l.neighborhood_id
    WHERE l.status='active'
   )
   SELECT *,count(*) OVER()::int total_count FROM base
   WHERE (${q}='' OR coalesce(canonical_address,'') ILIKE ${'%'+q+'%'} OR coalesce(neighborhood,'') ILIKE ${'%'+q+'%'} OR coalesce(city,'') ILIKE ${'%'+q+'%'})
    AND (${city}='' OR city=${city})
    AND (${area}='' OR neighborhood_id=${area})
    AND (${minPrice}::float8 IS NULL OR asking_price_nis>=${minPrice})
    AND (${maxPrice}::float8 IS NULL OR asking_price_nis<=${maxPrice})
    AND (${minRooms}::float8 IS NULL OR rooms>=${minRooms})
    AND (${maxRooms}::float8 IS NULL OR rooms<=${maxRooms})
    AND (${minSqm}::float8 IS NULL OR area_sqm>=${minSqm})
    AND (${maxSqm}::float8 IS NULL OR area_sqm<=${maxSqm})
    AND (${minScore}::float8 IS NULL OR score>=${minScore})
    AND (NOT ${subscribed} OR manual_flag)
    AND (NOT ${system} OR system_flag)
    AND (NOT ${followed} OR followed_area)
   ORDER BY
    CASE WHEN ${sort}='score' AND ${dir}='DESC' THEN score END DESC NULLS LAST,
    CASE WHEN ${sort}='score' AND ${dir}='ASC' THEN score END ASC NULLS LAST,
    CASE WHEN ${sort}='asking_price_nis' AND ${dir}='DESC' THEN asking_price_nis END DESC NULLS LAST,
    CASE WHEN ${sort}='asking_price_nis' AND ${dir}='ASC' THEN asking_price_nis END ASC NULLS LAST,
    CASE WHEN ${sort}='asking_pp_sqm' AND ${dir}='DESC' THEN asking_pp_sqm END DESC NULLS LAST,
    CASE WHEN ${sort}='asking_pp_sqm' AND ${dir}='ASC' THEN asking_pp_sqm END ASC NULLS LAST,
    CASE WHEN ${sort}='discount_pct' AND ${dir}='DESC' THEN discount_pct END DESC NULLS LAST,
    CASE WHEN ${sort}='discount_pct' AND ${dir}='ASC' THEN discount_pct END ASC NULLS LAST,
    CASE WHEN ${sort}='days_on_market' AND ${dir}='DESC' THEN days_on_market END DESC NULLS LAST,
    CASE WHEN ${sort}='days_on_market' AND ${dir}='ASC' THEN days_on_market END ASC NULLS LAST,
    CASE WHEN ${sort}='comp_count' AND ${dir}='DESC' THEN comp_count END DESC NULLS LAST,
    CASE WHEN ${sort}='comp_count' AND ${dir}='ASC' THEN comp_count END ASC NULLS LAST,
    CASE WHEN ${sort}='last_seen_at' AND ${dir}='DESC' THEN last_seen_at END DESC NULLS LAST,
    CASE WHEN ${sort}='last_seen_at' AND ${dir}='ASC' THEN last_seen_at END ASC NULLS LAST,
    last_seen_at DESC
   LIMIT ${limit} OFFSET ${offset}`;

  const facets=await sql`
   SELECT array_remove(array_agg(DISTINCT c.name_he ORDER BY c.name_he),NULL) cities,
     count(*)::int universe_count,
     count(*) FILTER(WHERE s.id IS NOT NULL)::int subscribed_count
   FROM listings l LEFT JOIN cities c ON c.id=l.city_id
   LEFT JOIN asset_subscriptions s ON s.entity_type='listing' AND s.entity_id=l.id
   WHERE l.status='active'`;
  return res.status(200).json({assets:rows,total:rows[0]?.total_count||0,facets:facets[0]||{},limit,offset});
 }

 const rows=await sql`
 WITH latest_snap AS (
   SELECT DISTINCT ON(listing_id) * FROM listing_snapshots ORDER BY listing_id,observed_at DESC
 ), latest_score AS (
   SELECT DISTINCT ON(entity_id) entity_id,score,price_gap_score,renewal_score,seller_motivation_score,
     comp_confidence_score,risk_deduction,calculated_at,model_version
   FROM opportunity_scores WHERE entity_type='listing' ORDER BY entity_id,calculated_at DESC
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
   (sc.entity_id IS NOT NULL) system_flag,(sub.id IS NOT NULL) manual_flag,
   coalesce(comps.comp_count,0)::int comp_count,comps.latest_comp_date,
   CASE WHEN comps.comp_count>=20 THEN 'high' WHEN comps.comp_count>=8 THEN 'medium'
        WHEN comps.comp_count>=3 THEN 'low' ELSE 'insufficient' END confidence,
   coalesce(sig.days_on_market,0)::int days_on_market,coalesce(sig.price_reductions,0)::int price_reductions,
   sig.original_asking_price::float8 original_price,l.url,l.last_seen_at
 FROM listings l
 JOIN latest_snap s ON s.listing_id=l.id
 LEFT JOIN neighborhoods n ON n.id=l.neighborhood_id
 LEFT JOIN cities c ON c.id=l.city_id
 LEFT JOIN latest_score sc ON sc.entity_id=l.id
 LEFT JOIN asset_subscriptions sub ON sub.entity_type='listing' AND sub.entity_id=l.id
 LEFT JOIN listing_seller_signals sig ON sig.listing_id=l.id
 LEFT JOIN comps ON comps.neighborhood_id=l.neighborhood_id
 WHERE l.status='active' AND (sc.entity_id IS NOT NULL OR sub.id IS NOT NULL)
 ORDER BY (sub.id IS NOT NULL) DESC,sc.score DESC NULLS LAST,l.last_seen_at DESC
 LIMIT 300`;
 res.setHeader('Cache-Control','s-maxage=60, stale-while-revalidate=300');
 res.status(200).json({data:rows,source:'edge-postgres'});
}
