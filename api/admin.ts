import type { VercelRequest,VercelResponse } from '@vercel/node';
import { sql } from '../server/db.js';

export default async function handler(req:VercelRequest,res:VercelResponse){
 try{
  if(req.method==='GET'){
   const [config]=await sql`SELECT * FROM score_configurations WHERE is_active=true ORDER BY updated_at DESC LIMIT 1`;
   const areas=await sql`SELECT n.id,n.slug,n.name_he,c.name_he city,coalesce(f.is_active,false) followed,coalesce(f.research_depth,'basic') research_depth
    FROM neighborhoods n JOIN cities c ON c.id=n.city_id LEFT JOIN followed_areas f ON f.neighborhood_id=n.id ORDER BY c.name_he,n.name_he`;
   return res.status(200).json({config,areas});
  }
  if(req.method==='POST'){
   const b=req.body||{};
   if(b.action==='score'){
    const allowed=['base_score','price_gap_weight','price_gap_min','price_gap_max','renewal_project_weight','renewal_execution_bonus','renewal_permit_bonus','renewal_max','seller_dom_divisor','seller_reduction_weight','seller_max','comp_high_min','comp_medium_min','comp_min_required','comp_high_score','comp_medium_score','comp_low_score','low_comp_risk'];
    const current=await sql`SELECT * FROM score_configurations WHERE is_active=true LIMIT 1`; if(!current.length)return res.status(404).json({error:'no_active_config'});
    const v:any={...current[0]}; for(const k of allowed)if(b[k]!=null)v[k]=Number(b[k]);
    const version='edge-admin-'+Date.now();
    await sql`UPDATE score_configurations SET is_active=false WHERE is_active=true`;
    const rows=await sql`INSERT INTO score_configurations(name,is_active,model_version,base_score,price_gap_weight,price_gap_min,price_gap_max,renewal_project_weight,renewal_execution_bonus,renewal_permit_bonus,renewal_max,seller_dom_divisor,seller_reduction_weight,seller_max,comp_high_min,comp_medium_min,comp_min_required,comp_high_score,comp_medium_score,comp_low_score,low_comp_risk)
    VALUES(${b.name||'Custom Edge Score'},true,${version},${v.base_score},${v.price_gap_weight},${v.price_gap_min},${v.price_gap_max},${v.renewal_project_weight},${v.renewal_execution_bonus},${v.renewal_permit_bonus},${v.renewal_max},${v.seller_dom_divisor},${v.seller_reduction_weight},${v.seller_max},${v.comp_high_min},${v.comp_medium_min},${v.comp_min_required},${v.comp_high_score},${v.comp_medium_score},${v.comp_low_score},${v.low_comp_risk}) RETURNING *`;
    return res.status(200).json({config:rows[0]});
   }
   if(b.action==='area'){
    if(!b.neighborhood_id)return res.status(400).json({error:'neighborhood_id_required'});
    const rows=await sql`INSERT INTO followed_areas(neighborhood_id,label,is_active,research_depth) VALUES(${b.neighborhood_id}::uuid,${b.label||null},${b.followed!==false},${b.research_depth||'full'})
      ON CONFLICT(neighborhood_id) DO UPDATE SET is_active=EXCLUDED.is_active,research_depth=EXCLUDED.research_depth,label=coalesce(EXCLUDED.label,followed_areas.label) RETURNING *`;
    await sql`UPDATE neighborhoods SET is_focus=${b.followed!==false} WHERE id=${b.neighborhood_id}::uuid`;
    return res.status(200).json({area:rows[0]});
   }
   return res.status(400).json({error:'unknown_action'});
  }
  res.status(405).json({error:'method_not_allowed'});
 }catch(e){res.status(500).json({error:String(e)})}
}
