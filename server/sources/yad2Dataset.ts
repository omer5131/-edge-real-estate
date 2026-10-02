import { randomUUID } from 'node:crypto';
import { queryDatabase, databaseTransaction } from '../db.js';
import { scrapeJson, pageRules, listingFields, normalizeListing, validatePage, yad2Url } from './scrapingBee.js';

export function listingWrite(market:string,row:any,scopeId:string,crawlId:string) {
 const {id,data}=normalizeListing(row);
 return [{text:`INSERT INTO yad2_dataset(market,listing_id,url,price,city,neighborhood,address,rooms,area_sqm,floor,published_at,data)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)
 ON CONFLICT(market,listing_id) DO UPDATE SET url=EXCLUDED.url,price=EXCLUDED.price,
 city=EXCLUDED.city,neighborhood=EXCLUDED.neighborhood,address=EXCLUDED.address,
 rooms=EXCLUDED.rooms,area_sqm=EXCLUDED.area_sqm,floor=EXCLUDED.floor,published_at=EXCLUDED.published_at,
 changed_at=CASE WHEN yad2_dataset.data IS DISTINCT FROM EXCLUDED.data OR yad2_dataset.status<>'active' THEN now() ELSE yad2_dataset.changed_at END,
 data=EXCLUDED.data,last_seen_at=now(),status='active'`,params:[market,id,data.url,data.price,data.city,data.neighborhood,data.address,data.rooms,data.area_sqm,String(data.floor??''),data.published_at,JSON.stringify(data)]},
 {text:`INSERT INTO yad2_scope_membership(scope_id,market,listing_id,last_seen_crawl)
 VALUES($1,$2,$3,$4::uuid) ON CONFLICT(scope_id,market,listing_id)
 DO UPDATE SET last_seen_crawl=EXCLUDED.last_seen_crawl,missing_cycles=0`,params:[scopeId,market,id,crawlId]}];
}
async function projectLegacy(market:string) {
 const table=market==='sale'?'listings':'rental_listings';
 const snapshots=market==='sale'?'listing_snapshots':'rental_listing_snapshots';
 const fk=market==='sale'?'listing_id':'rental_listing_id';
 const price=market==='sale'?'asking_price_nis':'asking_rent_nis';
 // Only exact city/neighborhood matches are resolved; nationwide unmatched rows remain in research.
 await databaseTransaction([
 {text:`INSERT INTO ${table}(source_id,source_listing_id,city_id,neighborhood_id,canonical_address,url,first_seen_at,last_seen_at,status)
 SELECT $1,d.listing_id,c.id,n.id,d.address,d.url,d.first_seen_at,d.last_seen_at,d.status FROM yad2_dataset d
 LEFT JOIN LATERAL(SELECT id FROM cities WHERE name_he=d.city ORDER BY id LIMIT 1)c ON true
 LEFT JOIN LATERAL(SELECT id FROM neighborhoods WHERE city_id=c.id AND name_he=d.neighborhood ORDER BY id LIMIT 1)n ON true
 WHERE d.market=$2 ON CONFLICT(source_id,source_listing_id) DO UPDATE SET city_id=EXCLUDED.city_id,
 neighborhood_id=EXCLUDED.neighborhood_id,canonical_address=EXCLUDED.canonical_address,url=EXCLUDED.url,last_seen_at=EXCLUDED.last_seen_at,status=EXCLUDED.status`,params:[`yad2_${market}`,market]},
 {text:`INSERT INTO ${snapshots}(${fk},observed_at,${price},area_sqm,rooms,floor,payload)
 SELECT l.id,d.last_seen_at,d.price,d.area_sqm,d.rooms,${market==='sale'?"CASE WHEN d.floor ~ '^[-]?[0-9]+$' THEN d.floor::numeric ELSE NULL END":'d.floor'},d.data
 FROM yad2_dataset d JOIN ${table} l ON l.source_id=$1 AND l.source_listing_id=d.listing_id
 WHERE d.market=$2 AND d.price IS NOT NULL AND NOT EXISTS(SELECT 1 FROM ${snapshots} s WHERE s.${fk}=l.id AND s.observed_at>=d.changed_at)
 ON CONFLICT DO NOTHING`,params:[`yad2_${market}`,market]}
 ]);
}
export async function runYad2Dataset() {
 if(!process.env.SCRAPINGBEE_API_KEY)throw new Error('SCRAPINGBEE_API_KEY is not configured');
 const lock=randomUUID();
 // A renewable lease avoids concurrent workers without holding a connection during HTTP calls.
 const acquired=await queryDatabase(`INSERT INTO yad2_worker_lock(id,token,expires_at) VALUES(1,$1,now()+interval '5 minutes')
 ON CONFLICT(id) DO UPDATE SET token=EXCLUDED.token,expires_at=EXCLUDED.expires_at
 WHERE yad2_worker_lock.expires_at<now() RETURNING token`,[lock]);
 if(!acquired.length)return {skipped:true,reason:'Worker already running'};
 const report:any={scopes:[],requests:0,listings:0};
 let crawlId:string;
 const heartbeat=async()=>{const r=await queryDatabase(`UPDATE yad2_worker_lock SET expires_at=now()+interval '5 minutes' WHERE id=1 AND token=$1 AND expires_at>now() RETURNING token`,[lock]);if(!r.length)throw new Error('Worker lease lost');};
 try {
  crawlId=(await queryDatabase('INSERT INTO yad2_crawls DEFAULT VALUES RETURNING id'))[0].id;
  const scopes=await queryDatabase('SELECT * FROM yad2_crawl_scopes WHERE enabled ORDER BY id');
  for(const scope of scopes) {
   let pages=Number(scope.cycle_pages??0),seen=0;
   const cycleId=scope.cycle_id??crawlId;
   try {
    if(!scope.cycle_id)await queryDatabase('UPDATE yad2_crawl_scopes SET cycle_id=$2::uuid,cursor_url=url,cycle_pages=0,last_page_ids=NULL WHERE id=$1',[scope.id,cycleId]);
    let url:string|null=yad2Url(scope.cursor_url??scope.url,scope.market);let lastIds=scope.last_page_ids;const visited=new Set<string>();const ids=new Set<string>();
    const maxPages=Number(scope.config?.max_pages??process.env.YAD2_MAX_PAGES??10000);
    if(!Number.isInteger(maxPages)||maxPages<1)throw new Error('Invalid page limit');
    while(url) {
     await heartbeat();
     if(pages>=maxPages)throw new Error('Page cap reached; scope incomplete. Split into smaller city/property scopes.');
     if(visited.has(url))throw new Error('Pagination loop; scope incomplete');
     visited.add(url);report.requests++;
     const page=validatePage(await scrapeJson(url,pageRules));pages++;
     const pageIds=page.listings.map((r:any)=>normalizeListing(r).id).sort();
     if(pageIds.length && JSON.stringify(pageIds)===JSON.stringify(lastIds))throw new Error('Repeated page across checkpoint; scope incomplete');
     let newIds=0;
     for(const summary of page.listings) {
      const item=normalizeListing(summary);
      if(ids.has(item.id))continue;ids.add(item.id);newIds++;
      let row=summary;
      if(scope.config?.details!==false) {
       await heartbeat();report.requests++;
       row=await scrapeJson(item.data.url,listingFields);
       // Identity comes from the discovered real link, never from AI inference.
       row={...row,url:item.data.url};
      }
      await heartbeat();await databaseTransaction(listingWrite(scope.market,row,scope.id,cycleId));seen++;report.listings++;
     }
     if(page.listings.length && !newIds)throw new Error('Repeated results page; scope incomplete');
     url=page.next_url?yad2Url(new URL(page.next_url,url).toString(),scope.market):null;
     lastIds=pageIds;
     if(url)await queryDatabase('UPDATE yad2_crawl_scopes SET cursor_url=$2,cycle_pages=$3,last_page_ids=$4::jsonb WHERE id=$1',[scope.id,url,pages,JSON.stringify(pageIds)]);
    }
    await heartbeat();
    // Require three successful complete cycles missing from every enabled scope that saw this listing.
    await databaseTransaction(completeScopeWrites(scope.id,cycleId));
    report.scopes.push({id:scope.id,status:'success',pages,seen});
   }catch(e:any){const error=e.message;report.scopes.push({id:scope.id,status:'failed',pages,seen,error});await queryDatabase('UPDATE yad2_crawl_scopes SET last_error=$2 WHERE id=$1',[scope.id,error]);}
  }
  for(const market of ['sale','rent'])await projectLegacy(market);
  report.ok=report.scopes.length>0&&report.scopes.every((s:any)=>s.status==='success');
  await queryDatabase('UPDATE yad2_crawls SET finished_at=now(),status=$2,report=$3::jsonb WHERE id=$1::uuid',[crawlId,report.ok?'success':'partial',JSON.stringify(report)]);
  return report;
 }catch(e:any){if(crawlId)await queryDatabase(`UPDATE yad2_crawls SET finished_at=now(),status='failed',report=$2::jsonb WHERE id=$1::uuid`,[crawlId,JSON.stringify({error:e.message,...report})]);throw e;}
 finally{await queryDatabase('DELETE FROM yad2_worker_lock WHERE id=1 AND token=$1',[lock]);}
}

export function completeScopeWrites(scopeId:string,cycleId:string) { return [
     {text:`UPDATE yad2_scope_membership SET missing_cycles=missing_cycles+1 WHERE scope_id=$1 AND last_seen_crawl<>$2::uuid`,params:[scopeId,cycleId]},
     {text:`UPDATE yad2_dataset d SET status='inactive' WHERE d.status='active'
      AND EXISTS(SELECT 1 FROM yad2_scope_membership m JOIN yad2_crawl_scopes s ON s.id=m.scope_id AND s.enabled WHERE m.market=d.market AND m.listing_id=d.listing_id)
      AND NOT EXISTS(SELECT 1 FROM yad2_scope_membership m JOIN yad2_crawl_scopes s ON s.id=m.scope_id AND s.enabled WHERE m.market=d.market AND m.listing_id=d.listing_id AND m.missing_cycles<3)`},
     {text:`UPDATE yad2_crawl_scopes SET last_completed_at=now(),last_error=NULL,cycle_id=NULL,cursor_url=NULL,cycle_pages=0,last_page_ids=NULL WHERE id=$1`,params:[scopeId]}
    ]; }
