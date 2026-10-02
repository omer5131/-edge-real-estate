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
    latest.area_sqm::float8,latest.rooms::float8,latest.floor::float8
    FROM listings l JOIN latest ON latest.listing_id=l.id
    JOIN neighborhoods n ON n.id=l.neighborhood_id JOIN cities c ON c.id=l.city_id WHERE l.id=${id}::uuid`;
  if(!listing)return res.status(404).json({error:'not_found'});

  const comps=await sql`
    SELECT coalesce(address_text,'עסקה') address,to_char(deal_date,'MM/YYYY') date,area_sqm::float8 sqm,
      amount_nis::float8 price,COALESCE(normalized_pp_sqm,pp_sqm)::float8 price_sqm,
      ownership_fraction::float8,source_id,deal_date
    FROM comparable_transactions
    WHERE neighborhood_id=${listing.neighborhood_id}::uuid
      AND deal_date>=current_date-interval '24 months'
      AND (${listing.area_sqm}::numeric IS NULL OR area_sqm BETWEEN ${listing.area_sqm}::numeric*.75 AND ${listing.area_sqm}::numeric*1.25)
    ORDER BY deal_date DESC LIMIT 8`;

  const renewal=await sql`SELECT project_name name,plan_number,status,existing_units,planned_units,permits_count,in_execution,
    source_url official_url,map_url,observed_at FROM renewal_projects
    WHERE neighborhood_id=${listing.neighborhood_id}::uuid
    ORDER BY in_execution DESC,permits_count DESC NULLS LAST,observed_at DESC LIMIT 5`;
  const [seller]=await sql`SELECT * FROM listing_seller_signals WHERE listing_id=${id}::uuid`;
  const [confidence]=await sql`SELECT * FROM neighborhood_market_confidence WHERE neighborhood_id=${listing.neighborhood_id}::uuid`;
  res.status(200).json({listing,comps,renewal,seller:seller||{},confidence:confidence||{confidence:'insufficient',sample_12m:0}});
 }catch(e){res.status(503).json({error:String(e)});}
}