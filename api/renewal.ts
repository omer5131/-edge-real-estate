import type {VercelRequest,VercelResponse} from '@vercel/node';
import {sql} from '../server/db.js';
import {getRenewalProfile,listRenewalProfiles} from '../server/renewalProfiles.js';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export default async function handler(req:VercelRequest,res:VercelResponse){
 if(req.method!=='GET')return res.status(405).json({error:'method_not_allowed'});
 const param=(key:string)=>typeof req.query[key]==='string'?String(req.query[key]):'';
 try{
  if(param('view')==='profiles'){
   res.setHeader('Cache-Control','no-store');
   const id=param('id'),neighborhoodId=param('neighborhoodId');
   if((id&&!uuid.test(id))||(neighborhoodId&&!uuid.test(neighborhoodId)))return res.status(400).json({error:'invalid_id'});
   if(id){const data=await getRenewalProfile(id);return res.status(data?200:404).json(data?{data}:{error:'not_found'});}
   return res.json({data:await listRenewalProfiles({city:param('city'),neighborhoodId,q:param('q').slice(0,150)})});
  }
  const city=param('city')||null;
  const rows=await sql`SELECT rp.id,rp.source_project_id,rp.project_name,rp.developer,rp.plan_number,rp.route,
   rp.status,rp.stage,rp.existing_units,rp.planned_units,rp.additional_units,rp.permits_count,rp.declared_at,
   rp.effective_year,rp.in_execution,rp.planning_certainty,rp.source_url,rp.map_url,rp.observed_at,
   c.name_he city,n.name_he neighborhood,ST_AsGeoJSON(rp.geom)::jsonb geometry
   FROM renewal_projects rp LEFT JOIN cities c ON c.id=rp.city_id LEFT JOIN neighborhoods n ON n.id=rp.neighborhood_id
   WHERE (${city}::text IS NULL OR c.name_he=${city}) ORDER BY rp.in_execution DESC,rp.observed_at DESC LIMIT 1000`;
  res.setHeader('Cache-Control','s-maxage=900, stale-while-revalidate=86400');
  return res.json({data:rows,source:'edge-postgres'});
 }catch(error:any){return res.status(503).json({error:'renewal_profiles_unavailable',message:/does not exist/.test(error.message)?'Project research schema is not installed yet.': 'Project data could not be loaded. Retry shortly.'});}
}
