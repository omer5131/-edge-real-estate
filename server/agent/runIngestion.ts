import { withRun } from '../db';
import { ingestDealsForSettlement, enrichRecentParcels } from '../sources/over';
import { ingestUrbanRenewalOfficial } from '../sources/urbanRenewal';
import { ingestListingArchive } from '../sources/listings';
import { ingestYad2Rent } from '../sources/yad2Rent';
import { resolveTransactionNeighborhoods } from './resolveNeighborhoods';
import { recomputeOpportunityScores } from './scoring';

const TARGET_CITIES=['חיפה','נתניה','פתח תקווה'];

export async function runEdgeIngestion(){
 const report:Record<string,unknown>={startedAt:new Date().toISOString(),jobs:[]};
 const jobs=report.jobs as unknown[];

 for(const settlement of TARGET_CITIES){
   const r=await withRun('over_deals','transactions',{settlement},runId=>ingestDealsForSettlement(settlement,runId));
   jobs.push({source:'over_deals',settlement,...r});
 }

 const resolved=await withRun('over_deals','neighborhood_resolution',{},()=>resolveTransactionNeighborhoods());
 jobs.push({source:'over_deals',job:'neighborhood_resolution',...resolved});

 const renewal=await withRun('urban_renewal_gov','renewal_projects',{},runId=>ingestUrbanRenewalOfficial(runId));
 jobs.push({source:'urban_renewal_gov',...renewal});

 const parcel=await withRun('over_nadlan','parcel_enrichment',{},runId=>enrichRecentParcels(runId));
 jobs.push({source:'over_nadlan',...parcel});

 const listings=await withRun('over_listing_archive','listing_history',{},runId=>ingestListingArchive(runId));
 jobs.push({source:'over_listing_archive',...listings});

 const rents=await withRun('yad2_rent','rental_snapshots',{},()=>ingestYad2Rent());
 jobs.push({source:'yad2_rent',...rents});

 const scores=await withRun('over_listing_archive','opportunity_scoring',{model:'edge-v0.1'},()=>recomputeOpportunityScores());
 jobs.push({source:'edge-derived',...scores});

 report.finishedAt=new Date().toISOString();
 return report;
}
