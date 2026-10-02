import type {VercelRequest,VercelResponse} from '@vercel/node';
import {queryDatabase} from '../db.js';
import {yad2Url} from '../sources/yad2Source.js';
export default async function handler(req:VercelRequest,res:VercelResponse) {
 res.setHeader('Cache-Control','no-store');
 try {
  if(req.method==='GET') {
   const [scopes,runs]=await Promise.all([queryDatabase('SELECT * FROM yad2_crawl_scopes ORDER BY id'),queryDatabase('SELECT * FROM yad2_crawls ORDER BY started_at DESC LIMIT 20')]);
   return res.json({scopes,runs});
  }
  if(req.method!=='POST')return res.status(405).json({error:'method_not_allowed'});
  if(!process.env.CRON_SECRET||req.headers.authorization!==`Bearer ${process.env.CRON_SECRET}`)return res.status(401).json({error:'unauthorized'});
  const {id,market,url,enabled=true,config={}}=req.body??{};
  if(typeof id!=='string'||!/^[-a-zA-Z0-9_]{1,80}$/.test(id)||!['rent','sale'].includes(market)||typeof enabled!=='boolean')return res.status(400).json({error:'invalid_scope'});
  if(config.max_pages!==undefined&&(!Number.isInteger(config.max_pages)||config.max_pages<1))return res.status(400).json({error:'invalid_page_limit'});
  if(config.details!==undefined&&typeof config.details!=='boolean')return res.status(400).json({error:'invalid_details_option'});
  if(config.published_within_days!==undefined&&(!Number.isInteger(config.published_within_days)||config.published_within_days<1||config.published_within_days>366))return res.status(400).json({error:'invalid_publication_window'});
  if(config.city_names!==undefined&&(!Array.isArray(config.city_names)||!config.city_names.length||config.city_names.some((name:any)=>typeof name!=='string'||!name.trim())))return res.status(400).json({error:'invalid_city_names'});
  const rows=await queryDatabase(`INSERT INTO yad2_crawl_scopes(id,market,url,enabled,config) VALUES($1,$2,$3,$4,$5::jsonb)
   ON CONFLICT(id) DO UPDATE SET market=EXCLUDED.market,url=EXCLUDED.url,enabled=EXCLUDED.enabled,config=EXCLUDED.config WHERE yad2_crawl_scopes.market=EXCLUDED.market AND yad2_crawl_scopes.url=EXCLUDED.url RETURNING *`,[id,market,yad2Url(url,market),enabled,JSON.stringify(config)]);
  if(!rows.length)return res.status(409).json({error:'Use a new scope ID when changing coverage'});
  return res.json({scope:rows[0]});
 }catch{return res.status(503).json({error:'yad2_admin_unavailable'});}
}
