import type {VercelRequest,VercelResponse} from '@vercel/node';
import {ingestExternalListing,recentExternalIntakes} from '../server/externalListingIngestion.js';

export default async function handler(req:VercelRequest,res:VercelResponse){
 try{
  if(req.method==='GET'){
   const limit=Math.max(1,Math.min(100,Number(req.query.limit||30)));
   return res.status(200).json({ok:true,intakes:await recentExternalIntakes(limit)});
  }
  if(req.method==='POST'){
   const body=typeof req.body==='string'?JSON.parse(req.body):req.body||{};
   const result=await ingestExternalListing(body);
   return res.status(result.ok?200:202).json(result);
  }
  return res.status(405).json({error:'method_not_allowed'});
 }catch(error:any){
  const message=String(error?.message||error);
  const bad=/required|invalid_request|invalid_listing_type|invalid_intake_mode/i.test(message);
  return res.status(bad?400:500).json({ok:false,error:message});
 }
}
