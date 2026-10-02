import { withRun } from '../db.js';
import { ingestDealsForSettlement, enrichRecentParcels } from '../sources/over.js';
import { ingestUrbanRenewalOfficial } from '../sources/urbanRenewal.js';
import { ingestListingArchive } from '../sources/listings.js';
import { ingestYad2Rent } from '../sources/yad2Rent.js';
import { resolveTransactionNeighborhoods } from './resolveNeighborhoods.js';
import { recomputeOpportunityScores } from './scoring.js';

const TARGET_CITIES=['חיפה','נתניה','פתח תקווה'];

export async function runEdgeIngestion(){
 const report:Record<string,unknown>={startedAt:new Date().toISOString(),jobs:[]};
 const jobs=report.jobs as any[];

 async function job(label:string,fn:()=>Promise<any>){
   const startedAt=new Date().toISOString();
   try{
     const result=await fn();
     const row={job:label,ok:true,startedAt,finishedAt:new Date().toISOString(),...result};
     jobs.push(row);
     return result;
   }catch(error:any){
     const row={job:label,ok:false,startedAt,finishedAt:new Date().toISOString(),error:error?.message??String(error)};
     jobs.push(row);
     console.error('Edge job failed',label,error);
     return null;
   }
 }

 for(const settlement of TARGET_CITIES){
   await job(`transactions:${settlement}`,()=>withRun('over_deals','transactions',{settlement},runId=>ingestDealsForSettlement(settlement,runId)));
 }

 await job('neighborhood_resolution',()=>withRun('over_deals','neighborhood_resolution',{},()=>resolveTransactionNeighborhoods()));
 await job('renewal_projects',()=>withRun('urban_renewal_gov','renewal_projects',{},runId=>ingestUrbanRenewalOfficial(runId)));
 await job('parcel_enrichment',()=>withRun('over_nadlan','parcel_enrichment',{},runId=>enrichRecentParcels(runId)));
 await job('listing_history',()=>withRun('over_listing_archive','listing_history',{},runId=>ingestListingArchive(runId)));
 await job('rental_snapshots',()=>withRun('yad2_rent','rental_snapshots',{},()=>ingestYad2Rent()));
 await job('opportunity_scoring',()=>withRun('over_listing_archive','opportunity_scoring',{model:'edge-v0.1'},()=>recomputeOpportunityScores()));

 report.finishedAt=new Date().toISOString();
 report.ok=jobs.some(j=>j.ok);
 report.failedJobs=jobs.filter(j=>!j.ok).length;
 return report;
}
