import {databaseTransaction as defaultTransaction} from '../db.js';
import {normalizeListing} from './yad2Source.js';

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
export async function projectLegacy(market:string) {
 const table=market==='sale'?'listings':'rental_listings';
 const snapshots=market==='sale'?'listing_snapshots':'rental_listing_snapshots';
 const fk=market==='sale'?'listing_id':'rental_listing_id';
 const price=market==='sale'?'asking_price_nis':'asking_rent_nis';
 // Only exact city/neighborhood matches are resolved; nationwide unmatched rows remain in research.
 await defaultTransaction([
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
export async function runYad2Dataset(deps:any={}) {
 let collected:any;
 try {collected=await (await import('./yad2Collector.js')).collectYad2(deps);}
 catch {collected={ok:false,error:'Collector preflight failed; check credentials, free-tier confirmation and schema'};}
 const processed=await (await import('./yad2Processor.js')).processYad2(deps);
 return {ok:collected.ok&&processed.ok,collected,processed};
}

export function completeScopeWrites(scopeId:string,cycleId:string) { return [
     {text:`UPDATE yad2_scope_membership SET missing_cycles=missing_cycles+1 WHERE scope_id=$1 AND last_seen_crawl<>$2::uuid`,params:[scopeId,cycleId]},
     {text:`UPDATE yad2_dataset d SET status='inactive' WHERE d.status='active'
      AND EXISTS(SELECT 1 FROM yad2_scope_membership m JOIN yad2_crawl_scopes s ON s.id=m.scope_id AND s.enabled WHERE m.market=d.market AND m.listing_id=d.listing_id)
      AND NOT EXISTS(SELECT 1 FROM yad2_scope_membership m JOIN yad2_crawl_scopes s ON s.id=m.scope_id AND s.enabled WHERE m.market=d.market AND m.listing_id=d.listing_id AND m.missing_cycles<3)`},
     {text:`UPDATE yad2_crawl_scopes SET last_completed_at=now(),last_error=NULL,cycle_id=NULL,cursor_url=NULL,cycle_pages=0,last_page_ids=NULL WHERE id=$1`,params:[scopeId]}
    ]; }
