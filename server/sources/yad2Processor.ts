import {pipelineDb,pipelineLease,positiveLimit} from './yad2Pipeline.js';
import {normalizeListing} from './yad2Source.js';
import {eligibleNewListing} from './yad2Incremental.js';
import {listingWrite,projectLegacy} from './yad2Dataset.js';
// Offline consumer: no provider imports, API keys, HTTP calls or source checkpoints.
export async function processYad2(deps:any={}) {
 const db=pipelineDb(deps),limit=positiveLimit(deps.limit??process.env.YAD2_PROCESS_LIMIT,500),lease=await pipelineLease(db,2);
 const report:any={ok:true,service:'processor',processed:0,filtered:0,errors:0};
 try {
  const records=await db.query(`SELECT * FROM yad2_source_records WHERE state='ready' ORDER BY collected_at LIMIT $1`,[limit]);
  for(const record of records) {
   await lease.renew();let row:any,eligible=false,reason='outside_publication_window_or_city';
   try {
    row=normalizeListing(record.payload).data;
    const ctx=record.context,plan={...ctx,baseline:new Date(ctx.baseline),started:new Date(ctx.started)};
    eligible=eligibleNewListing(row,ctx.config,plan as any,new Date(record.collected_at));
   }catch{reason='invalid_source_record';}
   if(!eligible) {
    await db.query(`UPDATE yad2_source_records SET state='filtered',reason=$3,processed_at=now() WHERE market=$1 AND listing_id=$2 AND state='ready'`,[record.market,record.listing_id,reason]);report.filtered++;continue;
   }
   const writes=listingWrite(record.market,row,record.scope_id,record.crawl_id);
   writes[0].text=writes[0].text.slice(0,writes[0].text.indexOf('ON CONFLICT'))+'ON CONFLICT(market,listing_id) DO NOTHING';
   writes.push({text:`UPDATE yad2_source_records SET state='processed',reason=NULL,processed_at=now() WHERE market=$1 AND listing_id=$2 AND state='ready'`,params:[record.market,record.listing_id]});
   await db.transaction(writes);report.processed++;
  }
  for(const market of ['sale','rent'])await (deps.projectLegacy??projectLegacy)(market);
 }catch{report.ok=false;report.errors++;report.error='Processing or downstream projection failed; saved records remain available';}
 finally{await lease.release();}return report;
}
