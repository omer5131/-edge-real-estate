import {unlockerConfig,unlockYad2} from './brightData.js';
import {parseYad2Html,validatePage,normalizeListing,yad2Url} from './yad2Source.js';
import {collectionPlan} from './yad2Incremental.js';
import {pipelineDb,pipelineLease,positiveLimit} from './yad2Pipeline.js';
// Acquisition owns source access/checkpoints, never research-dataset writes.
export async function collectYad2(deps:any={}) {
 const env=deps.env??process.env,config=unlockerConfig(env),db=pipelineDb(deps);
 const max=Math.min(positiveLimit(env.YAD2_MAX_REQUESTS,3),60),dayCap=Math.min(positiveLimit(env.YAD2_DAILY_REQUEST_CAP,60),60),monthCap=Math.min(positiveLimit(env.YAD2_MONTHLY_REQUEST_CAP,4000),4000);
 const lease=await pipelineLease(db,1);
 const report:any={ok:true,service:'collector',provider:'brightdata',requests:0,pages:0,saved:0,scopes:[]};let currentScope:string;
 async function reserve() {
  if(report.requests>=max)throw new Error('Run request budget reached');
  await lease.renew();const date=new Date().toISOString();
  const rows=await db.query('SELECT yad2_reserve_unlocker($1,$2,$3,$4) AS allowed',[`day:${date.slice(0,10)}`,`month:${date.slice(0,7)}`,dayCap,monthCap]);
  if(!rows[0]?.allowed)throw new Error('Persistent day/month request budget reached');report.requests++;
 }
 async function load(url:string,feed:boolean) {
  return parseYad2Html(await unlockYad2(url,config,reserve,deps.fetch??fetch),url,feed);
 }
 try {
  const scopes=await db.query(`SELECT * FROM yad2_crawl_scopes WHERE enabled ORDER BY collector_attempted_at NULLS FIRST,id`);
  for(let scope of scopes) {
   if(env.YAD2_SCOPE_ID&&scope.id!==env.YAD2_SCOPE_ID)continue;
   currentScope=scope.id;await lease.renew();
   await db.query('UPDATE yad2_crawl_scopes SET collector_attempted_at=now() WHERE id=$1',[scope.id]);
   if(!scope.cycle_id) {
    const crawl=(await db.query('INSERT INTO yad2_crawls DEFAULT VALUES RETURNING id'))[0].id;
    scope=(await db.query(`UPDATE yad2_crawl_scopes SET cycle_id=$2::uuid,cycle_started_at=now(),
     backfill_started_at=COALESCE(backfill_started_at,now()),cursor_url=url,cycle_pages=0,known_pages=0 WHERE id=$1 RETURNING *`,[scope.id,crawl]))[0];
   }
   const plan=collectionPlan(scope);
   const context={config:scope.config,incremental:plan.incremental,started:plan.started.toISOString(),baseline:plan.baseline.toISOString(),oldest:plan.oldest};
   const result:any={id:scope.id,phase:plan.incremental?'incremental':'initial_backfill',completed:false,coverage:'bounded_public_pages'};report.scopes.push(result);
   let pages=0;
   while(pages<plan.maxPages) {
    await lease.renew();
    let page=(await db.query('SELECT * FROM yad2_source_pages WHERE scope_id=$1 AND crawl_id=$2::uuid AND completed_at IS NULL ORDER BY collected_at LIMIT 1',[scope.id,scope.cycle_id]))[0];
    if(!page) {
     const url=yad2Url(scope.cursor_url??scope.url,scope.market),payload=validatePage(await load(url,true));
     if(payload.next_url) {
      const next=yad2Url(payload.next_url,scope.market),a=new URL(url),b=new URL(next);a.searchParams.delete('page');b.searchParams.delete('page');
      if(a.toString()!==b.toString()||next===url)throw new Error('Unexpected source pagination');
      if((await db.query('SELECT id FROM yad2_source_pages WHERE crawl_id=$1::uuid AND url=$2',[scope.cycle_id,next])).length)throw new Error('Repeated source page');
     }
     page=(await db.query(`INSERT INTO yad2_source_pages(scope_id,crawl_id,url,payload,context) VALUES($1,$2::uuid,$3,$4::jsonb,$5::jsonb) RETURNING *`,[scope.id,scope.cycle_id,url,JSON.stringify(payload),JSON.stringify(context)]))[0];report.pages++;
    }
    for(const raw of page.payload.listings) {
     if(String(raw.url??'').includes('/yad1/'))continue;
     const {id}=normalizeListing({url:raw.url});
     const existing=(await db.query('SELECT state FROM yad2_source_records WHERE market=$1 AND listing_id=$2',[scope.market,id]))[0];
     if(existing&&existing.state!=='awaiting_detail')continue;
     if(!existing) {
      if((await db.query('SELECT listing_id FROM yad2_dataset WHERE market=$1 AND listing_id=$2',[scope.market,id])).length)continue;
      const cached=(await db.query('SELECT data FROM yad2_publication_cache WHERE market=$1 AND listing_id=$2',[scope.market,id]))[0],payload=cached?.data??raw;
      await db.query(`INSERT INTO yad2_source_records(market,listing_id,scope_id,crawl_id,page_id,payload,context,state)
       VALUES($1,$2,$3,$4::uuid,$5::uuid,$6::jsonb,$7::jsonb,$8) ON CONFLICT DO NOTHING`,[scope.market,id,scope.id,scope.cycle_id,page.id,JSON.stringify(payload),JSON.stringify(page.context),cached||payload.published_at?'ready':'awaiting_detail']);report.saved++;
     }
     const record=(await db.query('SELECT * FROM yad2_source_records WHERE market=$1 AND listing_id=$2',[scope.market,id]))[0];
     if(record.state==='awaiting_detail') {
      const detail:any=await load(record.payload.url,false);
      if(normalizeListing({url:detail.url}).id!==id)throw new Error('Detail identity mismatch');
      await db.query(`UPDATE yad2_source_records SET payload=$3::jsonb,state='ready' WHERE market=$1 AND listing_id=$2 AND state='awaiting_detail'`,[scope.market,id,JSON.stringify({...record.payload,...detail})]);
     }
    }
    // Restart-safe counts use durable acquisitions, not this execution's counters.
    const acquired=await db.query('SELECT listing_id FROM yad2_source_records WHERE page_id=$1::uuid',[page.id]);
    const knownPages=acquired.length?0:Number(scope.known_pages??0)+1,total=Number(scope.cycle_pages??0)+1,next=page.payload.next_url;
    const finish=!next||(plan.incremental&&(total>=plan.maxPages||knownPages>=plan.knownPageStop));
    const checkpoint=finish?{
     text:`UPDATE yad2_crawl_scopes SET last_completed_at=cycle_started_at,backfill_completed_at=COALESCE(backfill_completed_at,now()),
      cycle_id=NULL,cursor_url=NULL,cycle_started_at=NULL,cycle_pages=0,known_pages=0,last_error=NULL WHERE id=$1`,params:[scope.id]
    }:{text:'UPDATE yad2_crawl_scopes SET cursor_url=$2,cycle_pages=$3,known_pages=$4,last_error=NULL WHERE id=$1',params:[scope.id,next,total,knownPages]};
    const writes:any[]=[{text:'UPDATE yad2_source_pages SET completed_at=now() WHERE id=$1::uuid',params:[page.id]},checkpoint];
    if(finish)writes.push({text:`UPDATE yad2_crawls SET finished_at=now(),status='success',report=$2::jsonb WHERE id=$1::uuid`,params:[scope.cycle_id,JSON.stringify({...result,completed:true,discovery_truncated:!!next})]});
    await db.transaction(writes);pages++;scope={...scope,cursor_url:next,cycle_pages:total,known_pages:knownPages};
    if(finish){result.completed=true;result.discovery_truncated=!!next;break;}
   }
  }
 }catch(error) {
  report.ok=false;report.error=error instanceof Error?error.message:'Collection failed';
  if(currentScope)await db.query('UPDATE yad2_crawl_scopes SET last_error=$2 WHERE id=$1',[currentScope,report.error]);
 }finally{await lease.release();}
 return report;
}
