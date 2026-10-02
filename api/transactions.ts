import type { VercelRequest,VercelResponse } from '@vercel/node';
import { sql } from '../server/db.js';
export default async function handler(req:VercelRequest,res:VercelResponse){
 if(req.method!=='GET')return res.status(405).json({error:'method_not_allowed'});
 const neighborhood=typeof req.query.neighborhood==='string'?req.query.neighborhood:null;
 const city=typeof req.query.city==='string'?req.query.city:null;
 const includeExcluded=req.query.include_excluded==='true';
 const limit=Math.min(Math.max(Number(req.query.limit??100),1),500);
 const rows=await sql`
   SELECT t.id,t.deal_date,t.amount_nis,t.declared_amount_nis,t.area_sqm,t.rooms,t.floor,t.nature,
     t.pp_sqm,t.normalized_pp_sqm,t.ownership_fraction,t.is_comparable,t.exclusion_reason,
     t.address_text,c.name_he city,n.name_he neighborhood,n.slug neighborhood_slug,
     p.gush,p.helka,t.source_id,t.source_external_id,t.observed_at
   FROM transactions t
   LEFT JOIN cities c ON c.id=t.city_id
   LEFT JOIN parcels p ON p.id=t.parcel_id
   LEFT JOIN neighborhoods n ON n.id=t.neighborhood_id
   WHERE (${city}::text IS NULL OR c.name_he=${city})
     AND (${neighborhood}::text IS NULL OR n.slug=${neighborhood} OR n.name_he=${neighborhood})
     AND (${includeExcluded}::boolean OR t.is_comparable)
   ORDER BY t.deal_date DESC NULLS LAST,t.observed_at DESC
   LIMIT ${limit}`;
 res.setHeader('Cache-Control','s-maxage=120, stale-while-revalidate=600');
 res.status(200).json({data:rows,source:'over_deals'});
}