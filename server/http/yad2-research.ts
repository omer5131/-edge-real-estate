import type {VercelRequest,VercelResponse} from '@vercel/node';
import {queryDatabase} from '../db.js';
export default async function handler(req:VercelRequest,res:VercelResponse) {
 if(req.method!=='GET')return res.status(405).json({error:'method_not_allowed'});
 try {
  const q=req.query;
  if(q.history) {
   if(!['sale','rent'].includes(String(q.market)))return res.status(400).json({error:'market_required'});
   return res.json({rows:await queryDatabase('SELECT * FROM yad2_listing_changes WHERE market=$1 AND listing_id=$2 ORDER BY id DESC LIMIT 500',[q.market,q.history])});
  }
  const where:string[]=[];const params:any[]=[];
  const add=(expr:string,value:any)=>{params.push(value);where.push(expr.replace('?',`$${params.length}`));};
  for(const field of ['market','city','neighborhood','status'])if(typeof q[field]==='string')add(`${field}=?`,q[field]);
  for(const [param,col,op] of [['minPrice','price','>='],['maxPrice','price','<='],['minRooms','rooms','>='],['maxRooms','rooms','<='],['minArea','area_sqm','>='],['maxArea','area_sqm','<=']]) {
   if(q[param]!==undefined){const v=Number(q[param]);if(!Number.isFinite(v))return res.status(400).json({error:'invalid_filter'});add(`${col}${op}?`,v);}
  }
  if(typeof q.search==='string')add("concat_ws(' ',address,city,neighborhood,data->>'description') ILIKE ?",`%${q.search}%`);
  if(q.priceDrops==='true')where.push("EXISTS(SELECT 1 FROM yad2_listing_changes c WHERE c.market=yad2_dataset.market AND c.listing_id=yad2_dataset.listing_id AND c.event='price_drop')");
  const limit=Math.min(200,Math.max(1,Number(q.limit)||50));const offset=Math.max(0,Number(q.offset)||0);
  if(!Number.isInteger(limit)||!Number.isInteger(offset))return res.status(400).json({error:'invalid_pagination'});
  const clause=where.length?'WHERE '+where.join(' AND '):'';
  const [rows,count]=await Promise.all([queryDatabase(`SELECT * FROM yad2_dataset ${clause} ORDER BY last_seen_at DESC,market,listing_id LIMIT $${params.length+1} OFFSET $${params.length+2}`,[...params,limit,offset]),queryDatabase(`SELECT count(*)::int total FROM yad2_dataset ${clause}`,params)]);
  return res.json({rows,total:count[0].total,limit,offset});
 }catch(e:any){return res.status(503).json({error:'yad2_dataset_unavailable'});}
}
