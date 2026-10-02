import { withRun } from '../db.js';
import { discoverTargetParcels, ingestTargetParcelDeals, enrichRecentParcels } from '../sources/over.js';
import { ingestUrbanRenewalOfficial } from '../sources/urbanRenewal.js';
import { ingestListingArchive } from '../sources/listings.js';
import { ingestYad2Rent } from '../sources/yad2Rent.js';
import { resolveTransactionNeighborhoods } from './resolveNeighborhoods.js';
import { recomputeOpportunityScores } from './scoring.js';

export async function runEdgeIngestion(){
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

 // Resolve any already-collected rows first, then use those parcels as target seeds.
 await job('neighborhood_resolution',()=>withRun('over_deals','neighborhood_resolution',{},()=>resolveTransactionNeighborhoods()));

 // Incremental target discovery: a bounded number of address probes per run, checkpointed by street.
 await job('target_parcel_discovery',()=>withRun('over_nadlan','target_parcel_discovery',{},runId=>discoverTargetParcels(runId)));

 // Main transaction ETL: fetch full history only for known target parcels.
 await job('target_parcel_deals',()=>withRun('over_deals','target_parcel_deals',{},runId=>ingestTargetParcelDeals(runId)));

 await job('parcel_enrichment',()=>withRun('over_nadlan','parcel_enrichment',{},runId=>enrichRecentParcels(runId)));
 await job('renewal_projects',()=>withRun('urban_renewal_gov','renewal_projects',{},runId=>ingestUrbanRenewalOfficial(runId)));
 await job('listing_history',()=>withRun('over_listing_archive','listing_history',{},runId=>ingestListingArchive(runId)));
 await job('rental_snapshots',()=>withRun('yad2_rent','rental_snapshots',{},()=>ingestYad2Rent()));
 await job('opportunity_scoring',()=>withRun('over_listing_archive','opportunity_scoring',{model:'edge-v0.2'},()=>recomputeOpportunityScores()));

 report.finishedAt=new Date().toISOString();
 report.ok=jobs.some(j=>j.ok);
 report.failedJobs=jobs.filter(j=>!j.ok).length;
 return report;
}
