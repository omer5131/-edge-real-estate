import {addressRelation,numberOrNull} from './evidenceValues.js';
import {queryDatabase} from './db.js';
import {listingLifecycle} from './listingLifecycle.js';
import {classifySourceUrl} from './contracts/investmentContext.js';
import type {SimilarListingsResponse} from './contracts/investmentContext.js';
import {normalizeAddress,streetKey} from './valuationContext.js';

const median=(xs:number[])=>{const a=xs.filter(Number.isFinite).sort((x,y)=>x-y);if(!a.length)return null;const m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2};
const clamp=(n:number)=>Math.max(0,Math.min(1,n));

export function buildActiveMarketFromRows(listing:any,rows:any[]):SimilarListingsResponse{
  const asset={listingId:String(listing?.id??listing?.listing_id??''),propertyId:listing?.property_id??null,buildingId:listing?.building_id??null,neighborhoodId:listing?.neighborhood_id??null};
  if(!asset.neighborhoodId){
    return {asset,listings:[],rejectedListings:[],summary:{inventoryCount:0,medianAskingPriceNis:null,medianAskingPricePerSqm:null,medianDaysOnMarket:null,subjectAskingPercentile:null,subjectDeltaToMedianPct:null},evidence:{status:'insufficient_evidence',confidence:null,sampleSize:0,observedAt:null,modelVersion:'similar-listings-v2.1',sourceIds:['listings'],notes:['Listing has no canonical neighborhood.']}};
  }
  const subjectAddress=normalizeAddress(listing.canonical_address||listing.address);
  const subjectStreet=streetKey(subjectAddress);
  const subjectArea=Number(listing.area_sqm||0);
  const subjectRooms=listing.rooms==null?null:Number(listing.rooms);
  const rejectedListings:Array<{listingId:string;address:string|null;reasons:string[]}>=[];

  const eligible=rows.filter((r:any)=>{
    const reasons:string[]=[];
    const area=Number(r.area_sqm||0),rooms=r.rooms==null?null:Number(r.rooms);
    if(subjectArea>0){
      if(!(area>0))reasons.push('missing_area');
      else {
        const ratio=area/subjectArea;
        if(ratio<.75||ratio>1.25)reasons.push('area_outside_25pct_band');
      }
    }
    if(subjectRooms!=null){
      if(rooms==null)reasons.push('missing_rooms');
      else if(Math.abs(rooms-subjectRooms)>1)reasons.push('rooms_outside_1_room_band');
    }
    if(!(Number(r.asking_price_nis)>0))reasons.push('missing_asking_price');
    if(reasons.length){
      rejectedListings.push({listingId:String(r.id),address:r.canonical_address??null,reasons});
      return false;
    }
    return true;
  });

  const scored=eligible.map((r:any)=>{
    let score=0,total=0;
    const add=(s:number,w:number)=>{score+=clamp(s)*w;total+=w};
    const addr=normalizeAddress(r.canonical_address);
    const street=streetKey(addr);
    const kind=addressRelation(listing,r);
    const relation=kind==='same_building'?1:kind==='same_street'?.9:.68;
    add(relation,.25);
    if(subjectArea&&r.area_sqm)add(1-Math.abs(subjectArea-Number(r.area_sqm))/subjectArea,.40);
    if(subjectRooms!=null&&r.rooms!=null)add(1-Math.abs(subjectRooms-Number(r.rooms))/Math.max(subjectRooms,1),.25);
    if(numberOrNull(listing.floor)!=null&&numberOrNull(r.floor)!=null)add(1-Math.abs(Number(listing.floor)-Number(r.floor))/10,.10);
    return {...r,similarity:total?score/total:0};
  }).filter((r:any)=>{
    if(r.similarity>=.55)return true;
    rejectedListings.push({listingId:String(r.id),address:r.canonical_address??null,reasons:['similarity_below_0.55']});
    return false;
  }).sort((a:any,b:any)=>b.similarity-a.similarity).slice(0,20);

  const asks=scored.map((r:any)=>Number(r.asking_price_nis)).filter(Number.isFinite);
  const ppsm=scored.map((r:any)=>Number(r.area_sqm)>0?Number(r.asking_price_nis)/Number(r.area_sqm):NaN).filter(Number.isFinite);
  const dom=scored.map((r:any)=>listingLifecycle(r.snapshot_count,r.observed_span_days).daysOnMarket??NaN).filter(Number.isFinite);
  const ask=Number(listing.asking_price_ils??listing.askingPriceNis??0),medAsk=median(asks),pct=ask&&asks.length?100*asks.filter((x:number)=>x<=ask).length/asks.length:null;
  const avgSimilarity=scored.length?scored.reduce((n:number,r:any)=>n+Number(r.similarity||0),0)/scored.length:0;
  const status=scored.length>=5&&avgSimilarity>=.7?'supported':scored.length?'provisional':'insufficient_evidence';
  const confidence=scored.length?Number(Math.min(.82,.18+Math.min(scored.length,10)*.055+avgSimilarity*.18).toFixed(3)):null;
  const notes=['v2.1 active-market eligibility requires area within ±25%, rooms within ±1, then scores address/street, area, rooms and floor.'];
  if(scored.length<5)notes.push('Competitive inventory is small; summary remains provisional.');
  if(dom.length<scored.length)notes.push('DOM is null until a listing has at least two observations spanning one or more days.');
  if(rejectedListings.length)notes.push(`${rejectedListings.length} active candidates were rejected by hard eligibility or similarity rules.`);

  return {
    asset,
    listings:scored.map((r:any)=>{
      const life=listingLifecycle(r.snapshot_count,r.observed_span_days),lifecycleSupported=life.supported;
      return {listingId:String(r.id),address:r.canonical_address??null,currentAskingPriceNis:Number(r.asking_price_nis)||null,originalAskingPriceNis:lifecycleSupported&&Number(r.original_asking_price)>0?Number(r.original_asking_price):null,askingPricePerSqm:Number(r.area_sqm)>0?Number(r.asking_price_nis)/Number(r.area_sqm):null,areaSqm:Number(r.area_sqm)||null,rooms:Number(r.rooms)||null,floor:numberOrNull(r.floor),daysOnMarket:life.daysOnMarket,priceReductions:lifecycleSupported&&r.price_reductions!=null?Number(r.price_reductions):null,distanceMeters:numberOrNull(r.distance_meters),similarityScore:Number(r.similarity.toFixed(4)),sourceId:String(r.source_id),sourceUrl:r.url||null,sourceUrlKind:classifySourceUrl(r.url),firstSeenAt:r.first_seen_at||null,lastSeenAt:r.last_seen_at||null};
    }),
    rejectedListings,
    summary:{inventoryCount:scored.length,medianAskingPriceNis:medAsk,medianAskingPricePerSqm:median(ppsm),medianDaysOnMarket:median(dom),subjectAskingPercentile:pct==null?null:Number(pct.toFixed(1)),subjectDeltaToMedianPct:ask&&medAsk?Number((100*(ask-medAsk)/medAsk).toFixed(2)):null},
    evidence:{status,confidence,sampleSize:scored.length,observedAt:scored[0]?.last_seen_at||null,modelVersion:'similar-listings-v2.1',sourceIds:[...new Set(scored.map((r:any)=>String(r.source_id||'listings')))],notes}
  };
}

export async function getActiveMarketContext(listing:any){
  if(!listing?.neighborhood_id)return buildActiveMarketFromRows(listing,[]);
  const rows=await queryDatabase(
    `with latest as (
       select distinct on(listing_id) listing_id,asking_price_nis,area_sqm,rooms,floor,observed_at
       from listing_snapshots order by listing_id,observed_at desc
     ), lifecycle as (
       select listing_id,count(*)::int snapshot_count,
              extract(epoch from (max(observed_at)-min(observed_at)))/86400.0 observed_span_days
       from listing_snapshots group by listing_id
     )
     select l.id::text,l.neighborhood_id::text,l.canonical_address,l.source_id,l.url,l.first_seen_at,l.last_seen_at,
            latest.asking_price_nis::float8,latest.area_sqm::float8,latest.rooms::float8,latest.floor::float8,
            sig.original_asking_price::float8,sig.price_reductions::int,
            lifecycle.snapshot_count,lifecycle.observed_span_days::float8
     from listings l join latest on latest.listing_id=l.id
     join lifecycle on lifecycle.listing_id=l.id
     left join listing_seller_signals sig on sig.listing_id=l.id
     where l.status='active' and l.neighborhood_id=$1::uuid and l.id<>$2::uuid
     order by l.last_seen_at desc limit 180`,
    [listing.neighborhood_id,listing.id]
  );
  return buildActiveMarketFromRows(listing,rows);
}
