import {queryDatabase} from './db.js';
import type {SimilarListingsResponse} from './contracts/investmentContext.js';
import {normalizeAddress,streetKey} from './valuationContext.js';

const median=(xs:number[])=>{const a=xs.filter(Number.isFinite).sort((x,y)=>x-y);if(!a.length)return null;const m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2};
const clamp=(n:number)=>Math.max(0,Math.min(1,n));

export function buildActiveMarketFromRows(listing:any,rows:any[]):SimilarListingsResponse{
  const asset={listingId:String(listing?.id??listing?.listing_id??''),propertyId:listing?.property_id??null,buildingId:listing?.building_id??null,neighborhoodId:listing?.neighborhood_id??null};
  if(!asset.neighborhoodId){
    return {asset,listings:[],summary:{inventoryCount:0,medianAskingPriceNis:null,medianAskingPricePerSqm:null,medianDaysOnMarket:null,subjectAskingPercentile:null,subjectDeltaToMedianPct:null},evidence:{status:'insufficient_evidence',confidence:null,sampleSize:0,observedAt:null,modelVersion:'similar-listings-v2',sourceIds:['listings'],notes:['Listing has no canonical neighborhood.']}};
  }
  const subjectAddress=normalizeAddress(listing.canonical_address||listing.address);
  const subjectStreet=streetKey(subjectAddress);
  const scored=rows.map((r:any)=>{
    let score=0,total=0;
    const add=(s:number,w:number)=>{score+=clamp(s)*w;total+=w};
    const addr=normalizeAddress(r.canonical_address);
    const street=streetKey(addr);
    const relation=subjectAddress&&addr&&subjectAddress===addr?1:subjectStreet&&street&&subjectStreet===street?0.9:0.68;
    add(relation,.25);
    if(listing.area_sqm&&r.area_sqm)add(1-Math.abs(Number(listing.area_sqm)-Number(r.area_sqm))/Math.max(Number(listing.area_sqm),1),.40);
    if(listing.rooms!=null&&r.rooms!=null)add(1-Math.abs(Number(listing.rooms)-Number(r.rooms))/Math.max(Number(listing.rooms),1),.25);
    if(listing.floor!=null&&r.floor!=null)add(1-Math.abs(Number(listing.floor)-Number(r.floor))/10,.10);
    return {...r,similarity:total?score/total:0};
  }).filter((r:any)=>r.similarity>=.48).sort((a:any,b:any)=>b.similarity-a.similarity).slice(0,20);
  const asks=scored.map((r:any)=>Number(r.asking_price_nis)).filter(Number.isFinite);
  const ppsm=scored.map((r:any)=>Number(r.area_sqm)>0?Number(r.asking_price_nis)/Number(r.area_sqm):NaN).filter(Number.isFinite);
  const dom=scored.map((r:any)=>r.days_on_market==null?NaN:Number(r.days_on_market)).filter(Number.isFinite);
  const ask=Number(listing.asking_price_ils??listing.askingPriceNis??0),medAsk=median(asks),pct=ask&&asks.length?100*asks.filter((x:number)=>x<=ask).length/asks.length:null;
  const notes=['v2 active-market similarity uses canonical neighborhood, address/street, area, rooms and floor.'];
  if(scored.length<3)notes.push('Competitive inventory is sparse; summary remains provisional.');
  return {
    asset,
    listings:scored.map((r:any)=>({listingId:String(r.id),address:r.canonical_address??null,currentAskingPriceNis:Number(r.asking_price_nis)||null,originalAskingPriceNis:Number(r.original_asking_price)||null,askingPricePerSqm:Number(r.area_sqm)>0?Number(r.asking_price_nis)/Number(r.area_sqm):null,areaSqm:Number(r.area_sqm)||null,rooms:Number(r.rooms)||null,floor:Number(r.floor)||null,daysOnMarket:r.days_on_market==null?null:Number(r.days_on_market),priceReductions:r.price_reductions==null?null:Number(r.price_reductions),distanceMeters:Number.isFinite(Number(r.distance_meters))?Number(r.distance_meters):null,similarityScore:Number(r.similarity.toFixed(4)),sourceId:String(r.source_id),sourceUrl:r.url||null,firstSeenAt:r.first_seen_at||null,lastSeenAt:r.last_seen_at||null})),
    summary:{inventoryCount:scored.length,medianAskingPriceNis:medAsk,medianAskingPricePerSqm:median(ppsm),medianDaysOnMarket:median(dom),subjectAskingPercentile:pct==null?null:Number(pct.toFixed(1)),subjectDeltaToMedianPct:ask&&medAsk?Number((100*(ask-medAsk)/medAsk).toFixed(2)):null},
    evidence:{status:scored.length>=3?'supported':scored.length?'provisional':'insufficient_evidence',confidence:scored.length?Number(Math.min(.84,.25+scored.length*.065).toFixed(2)):null,sampleSize:scored.length,observedAt:scored[0]?.last_seen_at||null,modelVersion:'similar-listings-v2',sourceIds:[...new Set(rows.map(r=>String(r.source_id||'listings')))],notes}
  };
}

export async function getActiveMarketContext(listing:any){
  if(!listing?.neighborhood_id)return buildActiveMarketFromRows(listing,[]);
  const rows=await queryDatabase(
    "with latest as (select distinct on(listing_id) listing_id,asking_price_nis,area_sqm,rooms,floor,observed_at from listing_snapshots order by listing_id,observed_at desc) select l.id::text,l.canonical_address,l.source_id,l.url,l.first_seen_at,l.last_seen_at,latest.asking_price_nis::float8,latest.area_sqm::float8,latest.rooms::float8,latest.floor::float8,sig.original_asking_price::float8,sig.days_on_market::int,sig.price_reductions::int from listings l join latest on latest.listing_id=l.id left join listing_seller_signals sig on sig.listing_id=l.id where l.status='active' and l.neighborhood_id=$1::uuid and l.id<>$2::uuid order by l.last_seen_at desc limit 180",
    [listing.neighborhood_id,listing.id]
  );
  return buildActiveMarketFromRows(listing,rows);
}
