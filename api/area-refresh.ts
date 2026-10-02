import type {VercelRequest,VercelResponse} from '@vercel/node';
import {refreshAreaIntelligence} from '../server/areaIntelligence.js';

function authorized(req:VercelRequest){
 const secret=process.env.CRON_SECRET;
 return Boolean(secret&&req.headers.authorization===`Bearer ${secret}`);
}

export default async function handler(req:VercelRequest,res:VercelResponse){
 if(!['GET','POST'].includes(req.method||''))return res.status(405).json({error:'method_not_allowed'});
 if(!authorized(req))return res.status(401).json({error:'unauthorized'});
 try{
   const result=await refreshAreaIntelligence();
   return res.status(200).json({ok:true,...result});
 }catch(error){
   return res.status(500).json({ok:false,error:String(error)});
 }
}
