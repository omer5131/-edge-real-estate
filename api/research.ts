import type { VercelRequest,VercelResponse } from '@vercel/node';
import { sql } from '../server/db.js';

export default async function handler(req:VercelRequest,res:VercelResponse){
 try{
  if(req.method==='GET'){
   const q=String(req.query.q||'').trim(),area=String(req.query.area||''),subscribed=String(req.query.subscribed||'');
   const minPrice=Number(req.query.minPrice||0),maxPrice=Number(req.query.maxPrice||0),rooms=Number(req.query.rooms||0);
   const rows=await sql`SELECT * FROM research_assets
    WHERE (${q}='' OR canonical_address ILIKE ${'%'+q+'%'} OR neighborhood ILIKE ${'%'+q+'%'} OR city ILIKE ${'%'+q+'%'})
      AND (${area}='' OR neighborhood_id=${area})
      AND (${minPrice}=0 OR asking_price_nis>=${minPrice})
      AND (${maxPrice}=0 OR asking_price_nis<=${maxPrice})
      AND (${rooms}=0 OR rooms=${rooms})
      AND (${subscribed}!='true' OR subscription_id IS NOT NULL)
    ORDER BY (subscription_id IS NOT NULL) DESC,score DESC NULLS LAST,last_seen_at DESC LIMIT 300`;
   return res.status(200).json({assets:rows});
  }
  if(req.method==='POST'){
   const b=req.body||{};if(!b.entity_id)return res.status(400).json({error:'entity_id_required'});
   if(b.action==='unsubscribe'){
    await sql`DELETE FROM asset_subscriptions WHERE entity_type=${b.entity_type||'listing'} AND entity_id=${b.entity_id}::uuid`;
    return res.status(200).json({ok:true,subscribed:false});
   }
   const rows=await sql`INSERT INTO asset_subscriptions(entity_type,entity_id,status,enrichment_level,notes)
    VALUES(${b.entity_type||'listing'},${b.entity_id}::uuid,${b.status||'watching'},'full',${b.notes||null})
    ON CONFLICT(entity_type,entity_id) DO UPDATE SET status=EXCLUDED.status,enrichment_level='full',notes=coalesce(EXCLUDED.notes,asset_subscriptions.notes),updated_at=now()
    RETURNING *`;
   return res.status(200).json({ok:true,subscribed:true,subscription:rows[0]});
  }
  res.status(405).json({error:'method_not_allowed'});
 }catch(e){res.status(500).json({error:String(e)})}
}
