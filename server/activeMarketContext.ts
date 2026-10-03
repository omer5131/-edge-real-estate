import {queryDatabase} from './db.js';

const median=(xs:number[])=>{const a=xs.filter(Number.isFinite).sort((x,y)=>x-y);if(!a.length)return null;const m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2};

export async function getActiveMarketContext(listing:any){
 if(!listing?.neighborhood_id)return {listings:[],summary:{inventoryCount:0,medianAskingPriceNis:null,medianAskingPricePerSqm:null,medianDaysOnMarket:null,subjectAskingPercentile:null,subjectDeltaToMedianPct:null},evidence:{status:'insufficient_evidence',confidence:null,sampleSize:0,observedAt:null,modelVersion:'similar-listings-v1',sourceIds:['listings'],notes:['Listing has no canonical neighborhood.']}};
 const rows=await queryDatabase(
  "with latest as (select distinct on(listing_id) listing_id,asking_price_nis,area_sqm,rooms,floor,observed_at from listing_snapshots order by listing_id,observed_at desc) select l.id::text,l.canonical_address,l.source_id,l.url,l.first_seen_at,l.last_seen_at,latest.asking_price_nis::float8,latest.area_sqm::float8,latest.rooms::float8,latest.floor::float8,sig.original_asking_price::float8,sig.days_on_market::int,sig.price_reductions::int from listings l join latest on latest.listing_id=l.id left join listing_seller_signals sig on sig.listing_id=l.id where l.status='active' and l.neighborhood_id=$1::uuid and l.id<>$2::uuid order by l.last_seen_at desc limit 150",
  [listing.neighborhood_id,listing.id]
 );
 const scored=rows.map((r:any)=>{
  let score=0,total=0; const add=(s:number,w:number)=>{score+=Math.max(0,Math.min(1,s))*w;total+=w};
  if(listing.area_sqm&&r.area_sqm)add(1-Math.abs(Number(listing.area_sqm)-Number(r.area_sqm))/Math.max(Number(listing.area_sqm),1),.55);
  if(listing.rooms!=null&&r.rooms!=null)add(1-Math.abs(Number(listing.rooms)-Number(r.rooms))/Math.max(Number(listing.rooms),1),.30);
  if(listing.floor!=null&&r.floor!=null)add(1-Math.abs(Number(listing.floor)-Number(r.floor))/10,.15);
  return {...r,similarity:total?score/total:0};
 }).filter((r:any)=>r.similarity>=.45).sort((a:any,b:any)=>b.similarity-a.similarity).slice(0,20);
 const asks=scored.map((r:any)=>Number(r.asking_price_nis)).filter(Number.isFinite);
 const ppsm=scored.map((r:any)=>Number(r.area_sqm)>0?Number(r.asking_price_nis)/Number(r.area_sqm):NaN).filter(Number.isFinite);
 const dom=scored.map((r:any)=>r.days_on_market==null?NaN:Number(r.days_on_market)).filter(Number.isFinite);
 const ask=Number(listing.asking_price_ils||0),medAsk=median(asks),pct=ask&&asks.length?100*asks.filter((x:number)=>x<=ask).length/asks.length:null;
 return {
  listings:scored.map((r:any)=>({listingId:r.id,address:r.canonical_address,currentAskingPriceNis:Number(r.asking_price_nis)||null,originalAskingPriceNis:Number(r.original_asking_price)||null,askingPricePerSqm:Number(r.area_sqm)>0?Number(r.asking_price_nis)/Number(r.area_sqm):null,areaSqm:Number(r.area_sqm)||null,rooms:Number(r.rooms)||null,floor:Number(r.floor)||null,daysOnMarket:r.days_on_market==null?null:Number(r.days_on_market),priceReductions:r.price_reductions==null?null:Number(r.price_reductions),distanceMeters:null,similarityScore:Number(r.similarity.toFixed(4)),sourceId:r.source_id,sourceUrl:r.url||null,firstSeenAt:r.first_seen_at||null,lastSeenAt:r.last_seen_at||null})),
  summary:{inventoryCount:scored.length,medianAskingPriceNis:medAsk,medianAskingPricePerSqm:median(ppsm),medianDaysOnMarket:median(dom),subjectAskingPercentile:pct==null?null:Number(pct.toFixed(1)),subjectDeltaToMedianPct:ask&&medAsk?Number((100*(ask-medAsk)/medAsk).toFixed(2)):null},
  evidence:{status:scored.length>=3?'supported':scored.length?'provisional':'insufficient_evidence',confidence:scored.length?Number(Math.min(.8,.25+scored.length*.07).toFixed(2)):null,sampleSize:scored.length,observedAt:scored[0]?.last_seen_at||null,modelVersion:'similar-listings-v1',sourceIds:['listings','listing_snapshots'],notes:['v1 similarity uses neighborhood, area, rooms and floor; distance requires stronger canonical location coverage.']}
 };
}
