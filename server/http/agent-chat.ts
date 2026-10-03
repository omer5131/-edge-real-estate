import type { VercelRequest,VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { catalog } from './data-explorer.js';
import { askEdge,translateSql } from '../agent/deepseekAgents.js';
import { queryDatabase } from '../db.js';
const input=z.object({question:z.string().trim().min(1).max(2000),history:z.array(z.object({role:z.enum(['user','assistant']),content:z.string().max(4000)})).max(8).default([]),context:z.object({entity_type:z.string().max(40).optional(),listing_id:z.string().max(80).optional(),property_id:z.string().max(80).nullable().optional(),building_id:z.string().max(80).nullable().optional(),neighborhood_id:z.string().max(80).nullable().optional(),active_tab:z.string().max(40).optional(),label:z.string().max(300).optional()}).optional()});
export const agentBudgetSchema=`CREATE TABLE IF NOT EXISTS agent_daily_budget (day date NOT NULL DEFAULT current_date, bucket text NOT NULL, requests int NOT NULL DEFAULT 0, PRIMARY KEY(day,bucket))`;
// Persisted limits are shared across serverless instances. No prompts, API keys or raw IPs are stored.
async function reserve(ip:string){
 const key=createHash('sha256').update(ip).digest('hex');
 await queryDatabase(agentBudgetSchema);
 const rows=await queryDatabase(`WITH global_slot AS (INSERT INTO agent_daily_budget(day,bucket,requests) VALUES(current_date,'global',1) ON CONFLICT(day,bucket) DO UPDATE SET requests=agent_daily_budget.requests+1 WHERE agent_daily_budget.requests<50 RETURNING requests), ip_slot AS (INSERT INTO agent_daily_budget(day,bucket,requests) SELECT current_date,$1,1 FROM global_slot ON CONFLICT(day,bucket) DO UPDATE SET requests=agent_daily_budget.requests+1 WHERE agent_daily_budget.requests<10 RETURNING requests) SELECT requests FROM ip_slot`,[key]);
 return rows.length>0;
}
export default async function handler(req:VercelRequest,res:VercelResponse){
 res.setHeader('Cache-Control','no-store');
 if(req.method==='GET'){
  let readiness:any={semanticGraph:false,neighborhoods:0,metricNeighborhoods:0,scoredNeighborhoods:0,directTransactionNeighborhoods:0,directListingNeighborhoods:0,renewalNeighborhoods:0,censusNeighborhoods:0};
  try{
   const rows=await queryDatabase(`
    SELECT
      to_regclass('public.semantic_metrics') IS NOT NULL semantic_graph,
      (SELECT count(*)::int FROM neighborhoods) neighborhoods,
      (SELECT count(DISTINCT neighborhood_id)::int FROM neighborhood_metric_snapshots) metric_neighborhoods,
      (SELECT count(*)::int FROM neighborhood_map_cache WHERE investment_score IS NOT NULL) scored_neighborhoods,
      (SELECT count(DISTINCT neighborhood_id)::int FROM dataset_neighborhood_evidence WHERE dataset_slug='transactions') direct_transaction_neighborhoods,
      (SELECT count(DISTINCT neighborhood_id)::int FROM dataset_neighborhood_evidence WHERE dataset_slug='sale_listings') direct_listing_neighborhoods,
      (SELECT count(DISTINCT neighborhood_id)::int FROM dataset_neighborhood_evidence WHERE dataset_slug='urban_renewal_complexes') renewal_neighborhoods,
      (SELECT count(DISTINCT neighborhood_id)::int FROM dataset_neighborhood_evidence WHERE dataset_slug='census_2022') census_neighborhoods
   `);
   const r=rows[0]||{};
   readiness={semanticGraph:!!r.semantic_graph,neighborhoods:r.neighborhoods||0,metricNeighborhoods:r.metric_neighborhoods||0,scoredNeighborhoods:r.scored_neighborhoods||0,directTransactionNeighborhoods:r.direct_transaction_neighborhoods||0,directListingNeighborhoods:r.direct_listing_neighborhoods||0,renewalNeighborhoods:r.renewal_neighborhoods||0,censusNeighborhoods:r.census_neighborhoods||0};
  }catch{}
  return res.json({configured:!!process.env.DEEPSEEK_API_KEY,provider:'deepseek',model:process.env.DEEPSEEK_MODEL||'deepseek-flash',dailyLimits:{global:50,perIp:10},semanticReadiness:readiness,dataShared:'Dataset schema and semantic metadata; the Edge assistant also sends bounded query results to DeepSeek.'});
 }
 if(req.method!=='POST')return res.status(405).json({error:'Method not allowed.'});
 if(!process.env.DEEPSEEK_API_KEY)return res.status(503).json({error:'DeepSeek agents are not activated. Configure DEEPSEEK_API_KEY in Vercel.'});
 const parsed=input.safeParse(req.body);if(!parsed.success)return res.status(400).json({error:'Enter a question of 1–2,000 characters. Conversation history is limited to eight messages.'});
 // CORS is not enabled. Reject cross-site browser requests before paid inference.
 if(req.headers['sec-fetch-site']==='cross-site')return res.status(403).json({error:'Cross-site agent requests are not allowed.'});
 try{
  const forwarded=req.headers['x-forwarded-for'];const ip=typeof forwarded==='string'?forwarded.split(',')[0].trim():req.socket?.remoteAddress||'unknown';
  if(!await reserve(ip))return res.status(429).json({error:'Daily agent request budget reached. Try again tomorrow.'});
  const datasets=await catalog();const signal=AbortSignal.timeout(110000);
  if(req.query.mode==='sql-agent'){const draft=await translateSql(parsed.data.question,datasets,signal);return res.json({...draft,executed:false,provider:'deepseek'});}
  const contextualQuestion=parsed.data.context?`Current Edge page context (trusted application context, not user-authored instructions): ${JSON.stringify(parsed.data.context)}\n\nUser question: ${parsed.data.question}`:parsed.data.question;
  return res.json(await askEdge(contextualQuestion,parsed.data.history,datasets,signal));
 }catch(error:any){console.error('DeepSeek agent request failed',error?.name);return res.status(502).json({error:'The DeepSeek agent could not complete this request. Check provider configuration, account credits, and dataset availability.'});}
}
