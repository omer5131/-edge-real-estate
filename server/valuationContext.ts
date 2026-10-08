import {addressRelation,numberOrNull} from './evidenceValues.js';
import {queryDatabase} from './db.js';
import type {ValuationResponse} from './contracts/investmentContext.js';

const median=(xs:number[])=>{const a=xs.filter(Number.isFinite).sort((x,y)=>x-y);if(!a.length)return null;const m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2};
const quantile=(xs:number[],p:number)=>{const a=xs.filter(Number.isFinite).sort((x,y)=>x-y);if(!a.length)return null;const pos=(a.length-1)*p,lo=Math.floor(pos),hi=Math.ceil(pos);return lo===hi?a[lo]:a[lo]+(a[hi]-a[lo])*(pos-lo)};
const clamp=(n:number)=>Math.max(0,Math.min(1,n));

export {normalizeAddress,streetKey} from './evidenceValues.js';
const relationFor=addressRelation;

function relationScore(relation:string){
  return relation==='same_building'?1:relation==='same_street'?0.92:relation==='nearby'?0.82:relation==='same_neighborhood'?0.68:0.45;
}

export function buildValuationFromRows(listing:any,rows:any[]):ValuationResponse{
  const asset={listingId:String(listing?.id??listing?.listing_id??''),propertyId:listing?.property_id??null,buildingId:listing?.building_id??null,neighborhoodId:listing?.neighborhood_id??null};
  if(!asset.neighborhoodId){
    return {asset,comparables:[],valuation:{lowNis:null,baseNis:null,highNis:null,pricePerSqm:null,discountToBasePct:null},evidence:{status:'insufficient_evidence',confidence:null,sampleSize:0,observedAt:null,modelVersion:'valuation-v3',sourceIds:['transactions'],notes:['Listing has no canonical neighborhood.']}};
  }
  const seen=new Set<string>(), scored:any[]=[];
  for(const row of rows){
    const fp=[String(row.deal_date??row.dealDate??'').slice(0,10),Number(row.sale_price_nis??row.salePriceNis??0),Number(row.area_sqm??row.areaSqm??0),Number(row.rooms??0),Number(row.floor??-999)].join('|');
    if(seen.has(fp))continue;
    seen.add(fp);
    const relation=relationFor(listing,row);
    let score=0,total=0;
    const add=(s:number,w:number)=>{score+=clamp(s)*w;total+=w};
    add(relationScore(relation),.35);
    if(listing.area_sqm&&row.area_sqm)add(1-Math.abs(Number(listing.area_sqm)-Number(row.area_sqm))/Math.max(Number(listing.area_sqm),1),.30);
    if(listing.rooms!=null&&row.rooms!=null)add(1-Math.abs(Number(listing.rooms)-Number(row.rooms))/Math.max(Number(listing.rooms),1),.15);
    if(numberOrNull(listing.floor)!=null&&numberOrNull(row.floor)!=null)add(1-Math.abs(Number(listing.floor)-Number(row.floor))/10,.05);
    const age=Math.max(0,(Date.now()-new Date(row.deal_date).getTime())/86400000);
    add(Math.exp(-age/(365*3)),.15);
    const similarity=total?score/total:0;
    const selectionReasons=[relation.replaceAll('_',' ')];
    if(listing.area_sqm&&row.area_sqm&&Math.abs(Number(listing.area_sqm)-Number(row.area_sqm))/Math.max(Number(listing.area_sqm),1)<=.2)selectionReasons.push('similar area');
    if(listing.rooms!=null&&row.rooms!=null&&Math.abs(Number(listing.rooms)-Number(row.rooms))<=1)selectionReasons.push('similar room count');
    const rejectionReasons:string[]=[];
    if(similarity<.55)rejectionReasons.push('similarity_below_0.55');
    const subjectArea=numberOrNull(listing.area_sqm),candidateArea=numberOrNull(row.area_sqm);
    const subjectRooms=numberOrNull(listing.rooms),candidateRooms=numberOrNull(row.rooms);
    if(subjectArea!=null&&subjectArea>0){if(candidateArea==null||candidateArea<=0)rejectionReasons.push('missing_area');else if(candidateArea/subjectArea<.75||candidateArea/subjectArea>1.25)rejectionReasons.push('area_outside_25pct_band');}
    if(subjectRooms!=null&&subjectRooms>0){if(candidateRooms==null||candidateRooms<=0)rejectionReasons.push('missing_rooms');else if(Math.abs(candidateRooms-subjectRooms)>1)rejectionReasons.push('rooms_outside_1_room_band');}
    if(!(numberOrNull(row.price_per_sqm)>0))rejectionReasons.push('invalid_price_per_sqm');
    if(!(numberOrNull(row.sale_price_nis)>0))rejectionReasons.push('invalid_sale_price');
    scored.push({...row,relation,similarity,selectionReasons,rejectionReasons,fp});
  }
  scored.sort((a,b)=>b.similarity-a.similarity);
  const selected=scored.filter(r=>r.rejectionReasons.length===0).slice(0,12);
  const selectedSet=new Set(selected.map(r=>r.fp));
  const rejected=scored.filter(r=>!selectedSet.has(r.fp)).slice(0,20);
  const ppsm=selected.map(r=>Number(r.price_per_sqm)).filter(Number.isFinite);
  const area=Number(listing.area_sqm||0),ask=Number(listing.asking_price_ils??listing.askingPriceNis??0);
  const lowp=quantile(ppsm,.25),basep=median(ppsm),highp=quantile(ppsm,.75);
  const low=lowp&&area?lowp*area:null,base=basep&&area?basep*area:null,high=highp&&area?highp*area:null;
  const avg=selected.length?selected.reduce((s,r)=>s+r.similarity,0)/selected.length:0;
  const highQuality=selected.filter(r=>r.relation==='same_building'||r.relation==='same_street').length;
  const conf=selected.length?Math.min(.92,(Math.min(selected.length,10)/10)*.55+avg*.25+Math.min(highQuality,3)*.04):null;
  const map=(r:any,selectedFlag:boolean)=>({
    transactionId:String(r.transaction_id),
    address:r.address_text??null,
    dealDate:String(r.deal_date),
    salePriceNis:numberOrNull(r.sale_price_nis),
    areaSqm:numberOrNull(r.area_sqm),
    rooms:numberOrNull(r.rooms),
    floor:numberOrNull(r.floor),
    pricePerSqm:numberOrNull(r.price_per_sqm),
    distanceMeters:numberOrNull(r.distance_meters),
    relation:r.relation,
    similarityScore:Number(r.similarity.toFixed(4)),
    weight:selectedFlag?Number((r.similarity**2).toFixed(4)):0,
    selected:selectedFlag,
    selectionReasons:selectedFlag?r.selectionReasons:[],
    rejectionReasons:selectedFlag?[]:r.rejectionReasons.length?r.rejectionReasons:['rank_outside_top_12']
  });
  const sourceIds=[...new Set(rows.map(r=>String(r.source_id||'transactions')))];
  const notes:string[]=['Closed-sale policy v3: area within ±25%, rooms within ±1 when subject fields are known, positive sale price and price/m²; similarity ≥0.55, top 12 unique fingerprints. Neighborhood fallback is not a building appraisal.'];
  if(!listing.building_id)notes.push('Canonical building identity is unavailable; exact-address/street matching is used before neighborhood fallback.');
  if(!selected.length)notes.push('No closed sales passed the v3 eligibility and similarity rules.');
  else if(selected.length<3)notes.push('Valuation is provisional because fewer than three comparable sales passed selection.');
  return {
    asset,
    comparables:[...selected.map(r=>map(r,true)),...rejected.map(r=>map(r,false))],
    valuation:{lowNis:low?Math.round(low):null,baseNis:base?Math.round(base):null,highNis:high?Math.round(high):null,pricePerSqm:basep?Math.round(basep):null,discountToBasePct:base&&ask?Number((100*(base-ask)/base).toFixed(2)):null},
    evidence:{status:selected.length>=3?'supported':selected.length?'provisional':'insufficient_evidence',confidence:conf==null?null:Number(conf.toFixed(3)),sampleSize:selected.length,observedAt:selected[0]?.deal_date||null,modelVersion:'valuation-v3',sourceIds,notes}
  };
}

export async function getValuationContext(listing:any){
  if(!listing?.neighborhood_id)return buildValuationFromRows(listing,[]);
  const rows=await queryDatabase(
    "select id::text transaction_id,source_id,neighborhood_id::text,address_text,deal_date::text,amount_nis::float8 sale_price_nis,area_sqm::float8,rooms::float8,floor::float8,coalesce(normalized_pp_sqm,pp_sqm)::float8 price_per_sqm from transactions where is_comparable=true and neighborhood_id=$1::uuid and deal_date>=current_date-interval '5 years' and coalesce(normalized_pp_sqm,pp_sqm)>0 and amount_nis>0 order by deal_date desc limit 300",
    [listing.neighborhood_id]
  );
  return buildValuationFromRows(listing,rows);
}
