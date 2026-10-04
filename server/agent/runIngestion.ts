import { withRun } from '../db.js';
import { discoverTargetParcels, ingestTargetParcelDeals, enrichRecentParcels } from '../sources/over.js';
import { resolveTransactionNeighborhoods } from './resolveNeighborhoods.js';

export async function runEdgeIngestion(options:{skipOver?:boolean}={}){
 const skipOver=options.skipOver===true;
 const report:Record<string,unknown>={startedAt:new Date().toISOString(),jobs:[]};
 const jobs=report.jobs as any[];

 async function job(label:string,fn:()=>Promise<any>){
   const startedAt=new Date().toISOString();
   try{
     const result=await fn();
     jobs.push({job:label,ok:true,startedAt,finishedAt:new Date().toISOString(),...result});
     return result;
   }catch(error:any){
     jobs.push({job:label,ok:false,startedAt,finishedAt:new Date().toISOString(),error:error?.message??String(error)});
     console.error('Edge job failed',label,error);
     return null;
   }
 }

 if(skipOver) jobs.push({job:'over_parcel_sources',ok:true,skipped:true,reason:'OVER parcel collection disabled for this run'});

 // Production recurring collection is intentionally limited to parcel/deal data.
 // CBS and other research datasets are collected separately by /api/over-datasets.
 if(!skipOver)await job('neighborhood_resolution',()=>withRun('over_deals','neighborhood_resolution',{},()=>resolveTransactionNeighborhoods()));
 if(!skipOver)await job('target_parcel_discovery',()=>withRun('over_nadlan','target_parcel_discovery',{},runId=>discoverTargetParcels(runId)));
 if(!skipOver)await job('target_parcel_deals',()=>withRun('over_deals','target_parcel_deals',{},runId=>ingestTargetParcelDeals(runId)));
 if(!skipOver)await job('parcel_enrichment',()=>withRun('over_nadlan','parcel_enrichment',{},runId=>enrichRecentParcels(runId)));

 report.finishedAt=new Date().toISOString();
 report.ok=jobs.length>0 && jobs.every(j=>j.ok);
 report.failedJobs=jobs.filter(j=>!j.ok).length;
 return report;
}
