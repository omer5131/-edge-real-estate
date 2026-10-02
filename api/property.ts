import type { VercelRequest,VercelResponse } from '@vercel/node';
import { sql } from '../server/db.js';
export default async function handler(req:VercelRequest,res:VercelResponse){
 if(req.method!=='GET')return res.status(405).json({error:'method_not_allowed'});
 const id=typeof req.query.id==='string'?req.query.id:'';
 if(!id)return res.status(400).json({error:'id_required'});
 try{
  const [listing]=await sql`WITH latest AS(
    SELECT DISTINCT ON(listing_id)* FROM listing_snapshots WHERE listing_id=${id}::uuid ORDER BY listing_id,observed_at DESC
  ) SELECT l.id::text,l.canonical_address address,l.neighborhood_id,n.name_he neighborhood,c.name_he city,l.url,
    l.first_seen_at,l.last_seen_at,latest.asking_price_nis::float8 asking_price_ils,
    latest.area_sqm::float8,latest.rooms::float8,latest.floor::float8,
    sub.id subscription_id,sub.status subscription_status,sub.enrichment_level
    FROM listings l JOIN latest ON latest.listing_id=l.id
    JOIN neighborhoods n ON n.id=l.neighborhood_id JOIN cities c ON c.id=l.city_id
    LEFT JOIN asset_subscriptions sub ON sub.entity_type='listing' AND sub.entity_id=l.id
    WHERE l.id=${id}::uuid`;
  if(!listing)return res.status(404).json({error:'not_found'});
  const subscribed=!!listing.subscription_id;

  const basicComps=await sql`SELECT coalesce(address_text,'עסקה') address,to_char(deal_date,'MM/YYYY') date,
    area_sqm::float8 sqm,amount_nis::float8 price,COALESCE(normalized_pp_sqm,pp_sqm)::float8 price_sqm,deal_date
    FROM comparable_transactions WHERE neighborhood_id=${listing.neighborhood_id}::uuid
      AND deal_date>=current_date-interval '18 months'
      AND (${listing.area_sqm}::numeric IS NULL OR area_sqm BETWEEN ${listing.area_sqm}::numeric*.8 AND ${listing.area_sqm}::numeric*1.2)
    ORDER BY deal_date DESC LIMIT ${subscribed?12:3}`;
  const [confidence]=await sql`SELECT * FROM neighborhood_market_confidence WHERE neighborhood_id=${listing.neighborhood_id}::uuid`;
  if(!subscribed)return res.status(200).json({tier:'basic',listing,comps:basicComps,confidence:confidence||{confidence:'insufficient',sample_12m:0}});

  const renewal=await sql`SELECT project_name name,plan_number,status,existing_units,planned_units,permits_count,in_execution,
    source_url official_url,map_url,observed_at FROM renewal_projects WHERE neighborhood_id=${listing.neighborhood_id}::uuid
    ORDER BY in_execution DESC,permits_count DESC NULLS LAST,observed_at DESC LIMIT 10`;
  const plans=await sql`SELECT plan_number,name,status,authority,housing_units,source_url,observed_at FROM planning_plans WHERE neighborhood_id=${listing.neighborhood_id}::uuid ORDER BY observed_at DESC LIMIT 20`;
  const infrastructure=await sql`SELECT name,category,status,source_url,observed_at FROM infrastructure_projects WHERE neighborhood_id=${listing.neighborhood_id}::uuid ORDER BY observed_at DESC LIMIT 20`;
  const history=await sql`SELECT observed_at,asking_price_nis::float8,area_sqm::float8,rooms::float8,floor::float8 FROM listing_snapshots WHERE listing_id=${id}::uuid ORDER BY observed_at`;
  const [seller]=await sql`SELECT * FROM listing_seller_signals WHERE listing_id=${id}::uuid`;
  const [rent]=await sql`SELECT * FROM neighborhood_rent_metrics WHERE neighborhood_id=${listing.neighborhood_id}::uuid`;
  const [score]=await sql`SELECT score,price_gap_score,renewal_score,seller_motivation_score,comp_confidence_score,risk_deduction,model_version,inputs,explanation,calculated_at FROM opportunity_scores WHERE entity_type='listing' AND entity_id=${id}::uuid ORDER BY calculated_at DESC LIMIT 1`;
  res.status(200).json({tier:'full',listing,comps:basicComps,renewal,plans,infrastructure,history,seller:seller||{},rent:rent||null,score:score||null,confidence:confidence||{confidence:'insufficient',sample_12m:0}});
 }catch(e){res.status(503).json({error:String(e)});}
}