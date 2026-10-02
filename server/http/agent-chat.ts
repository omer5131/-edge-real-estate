import type { VercelRequest,VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { catalog } from './data-explorer.js';
import { askEdge,translateSql } from '../agent/deepseekAgents.js';
import { queryDatabase } from '../db.js';
const input=z.object({question:z.string().trim().min(1).max(2000),history:z.array(z.object({role:z.enum(['user','assistant']),content:z.string().max(4000)})).max(8).default([])});
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
 if(req.method==='GET')return res.json({configured:!!process.env.DEEPSEEK_API_KEY,provider:'deepseek',model:process.env.DEEPSEEK_MODEL||'deepseek-flash',dailyLimits:{global:50,perIp:10},dataShared:'Dataset schema and semantic metadata; the Edge assistant also sends bounded query results to DeepSeek.'});
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
  return res.json(await askEdge(parsed.data.question,parsed.data.history,datasets,signal));
 }catch(error:any){console.error('DeepSeek agent request failed',error?.name);return res.status(502).json({error:'The DeepSeek agent could not complete this request. Check provider configuration, account credits, and dataset availability.'});}
}
