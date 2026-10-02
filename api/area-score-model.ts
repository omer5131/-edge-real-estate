import type {VercelRequest,VercelResponse} from '@vercel/node';
import {queryDatabase} from '../server/db.js';

const COMPONENTS=['deal','market','renewal','demographics','rental','infrastructure','supply'] as const;

function authorized(req:VercelRequest){
 const secret=process.env.CRON_SECRET;
 return Boolean(secret&&req.headers.authorization===`Bearer ${secret}`);
}

function validWeights(weights:any){
 if(!weights||typeof weights!=='object')return false;
 const keys=Object.keys(weights);
 if(keys.some(k=>!COMPONENTS.includes(k as any)))return false;
 const values=COMPONENTS.map(k=>Number(weights[k]??0));
 return values.every(v=>Number.isFinite(v)&&v>=0)&&Math.abs(values.reduce((a,b)=>a+b,0)-100)<.001;
}

export default async function handler(req:VercelRequest,res:VercelResponse){
 try{
  if(req.method==='GET'){
    const rows=await queryDatabase(`
      SELECT version,name,is_active,weights,parameters,created_at,activated_at
      FROM area_score_models ORDER BY is_active DESC,created_at DESC
    `);
    return res.status(200).json({models:rows});
  }
  if(req.method!=='POST')return res.status(405).json({error:'method_not_allowed'});
  if(!authorized(req))return res.status(401).json({error:'unauthorized'});
  const body=typeof req.body==='string'?JSON.parse(req.body):req.body||{};
  if(body.action==='activate'){
    const version=String(body.version||'');
    const exists=await queryDatabase('SELECT 1 FROM area_score_models WHERE version=$1',[version]);
    if(!exists.length)return res.status(404).json({error:'unknown_version'});
    await queryDatabase('UPDATE area_score_models SET is_active=false WHERE is_active=true');
    await queryDatabase('UPDATE area_score_models SET is_active=true,activated_at=now() WHERE version=$1',[version]);
    return res.status(200).json({ok:true,active:version});
  }
  if(body.action==='create'){
    const version=String(body.version||'').trim(),name=String(body.name||version).trim();
    if(!/^[a-z0-9][a-z0-9._-]{2,80}$/i.test(version))return res.status(400).json({error:'invalid_version'});
    if(!validWeights(body.weights))return res.status(400).json({error:'weights_must_total_100'});
    const parameters=body.parameters&&typeof body.parameters==='object'?body.parameters:{};
    await queryDatabase(`
      INSERT INTO area_score_models(version,name,is_active,weights,parameters)
      VALUES($1,$2,false,$3::jsonb,$4::jsonb)
    `,[version,name,JSON.stringify(body.weights),JSON.stringify(parameters)]);
    return res.status(201).json({ok:true,version});
  }
  return res.status(400).json({error:'unsupported_action'});
 }catch(error){return res.status(500).json({error:String(error)});}
}
