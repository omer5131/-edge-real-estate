import {queryDatabase} from './db.js';
import type {ValuationResponse} from './contracts/investmentContext.js';

const median=(xs:number[])=>{const a=xs.filter(Number.isFinite).sort((x,y)=>x-y);if(!a.length)return null;const m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2};
const quantile=(xs:number[],p:number)=>{const a=xs.filter(Number.isFinite).sort((x,y)=>x-y);if(!a.length)return null;const pos=(a.length-1)*p,lo=Math.floor(pos),hi=Math.ceil(pos);return lo===hi?a[lo]:a[lo]+(a[hi]-a[lo])*(pos-lo)};
const clamp=(n:number)=>Math.max(0,Math.min(1,n));

export const normalizeAddress=(value:unknown)=>String(value??'').normalize('NFKC').toLowerCase().replace(/[״"'׳',.-]/g,' ').replace(/\s+/g,' ').trim();
export const streetKey=(value:unknown)=>normalizeAddress(value).replace(/\b\d+[א-ת]?\b/g,' ').replace(/\b(דירה|קומה|כניסה)\b.*$/,'').replace(/\s+/g,' ').trim();

function relationFor(listing:any,row:any){
  const subject=normalizeAddress(listing.canonical_address||listing.address);
  const candidate=normalizeAddress(row.address_text||row.address);
  if(subject&&candidate&&subject===candidate)return 'same_building' as const;
  const sStreet=streetKey(subject),cStreet=streetKey(candidate);
  if(sStreet&&cStreet&&sStreet===cStreet)return 'same_street' as const;
  const d=Number(row.distance_meters);
  if(Number.isFinite(d)&&d<=1200)return 'nearby' as const;
  if(listing.neighborhood_id&&row.neighborhood_id===listing.neighborhood_id)return 'same_neighborhood' as const;
  return 'fallback' as const;
}

function relationScore(relation:string){
  return relation==='same_building'?1:relation==='same_street'?.92:relation==='nearby'?.82:relation==='same_neighborhood'?.68:.45;
}

export function buildValuationFromRows(listing:any,rows:any[]):ValuationResponse{
  const asset={listingId:String(listing?.id??listing?.listing_id??''),propertyId:listing?.property_id??null,buildingId:listing?.building_id??null,neighborhoodId:listing?.neighborhood_id??null};
  if(!asset.neighborhoodId){
    return {asset,comparables:[],valuation:{lowNis:null,baseNis:null,highNis:null,pricePerSqm:null,discountToBasePct:null},evidence:{status:'insufficient_evidence',confidence:null,sampleSize:0,observedAt:null,modelVersion:'valuation-v2',sourceIds:['transactions'],notes:['Listing has no canonical neighborhood.']}};
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
    if(listing.floor!=null&&row.floor!=null)add(1-Math.abs(Number(listing.floor)-Number(row.floor))/10,.05);
    const age=Math.max(0,(Date.now()-new Date(row.deal_date).getTime())/86400000);
    add(Math.exp(-age/(365*3)),.15);
    const similarity=total?score/total:0;
    const selectionReasons=[relation.replaceAll('_',' ')];
    if(listing.area_sqm&&row.area_sqm&&Math.abs(Number(listing.area_sqm)-Number(row.area_sqm))/Math.max(Number(listing.area_sqm),1)<=.2)selectionReasons.push('similar area');
    if(listing.rooms!=null&&row.rooms!=null&&Math.abs(Number(listing.rooms)-Number(row.rooms))<=1)selectionReasons.push('similar room count');
    const rejectionReasons:string[]=[];
    if(similarity<.55)rejectionReasons.push('similarity below v2 selection threshold');
    scored.push({...row,relation,similarity,selectionReasons,rejectionReasons,fp});
  }
  scored.sort((a,b)=>b.similarity-a.similarity);
  const selected=scored.filter(r=>r.similarity>=.55).slice(0,12);
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
    salePriceNis:Number(r.sale_price_nis),
    areaSqm:Number.isFinite(Number(r.area_sqm))?Number(r.area_sqm):null,
    rooms:Number.isFinite(Number(r.rooms))?Number(r.rooms):null,
    floor:Number.isFinite(Number(r.floor))?Number(r.floor):null,
    pricePerSqm:Number.isFinite(Number(r.price_per_sqm))?Number(r.price_per_sqm):null,
    distanceMeters:Number.isFinite(Number(r.distance_meters))?Number(r.distance_meters):null,
    relation:r.relation,
    similarityScore:Number(r.similarity.toFixed(4)),
    weight:selectedFlag?Number((r.similarity**2).toFixed(4)):0,
    selected:selectedFlag,
    selectionReasons:selectedFlag?r.selectionReasons:[],
    rejectionReasons:selectedFlag?[]:r.rejectionReasons
  });
  const sourceIds=[...new Set(rows.map(r=>String(r.source_id||'transactions')))];
  const notes:string[]=[];
  if(!listing.building_id)notes.push('Canonical building identity is unavailable; exact-address/street matching is used before neighborhood fallback.');
  if(!selected.length)notes.push('No closed sales passed the v2 similarity threshold.');
  else if(selected.length<3)notes.push('Valuation is provisional because fewer than three comparable sales passed selection.');
  return {
    asset,
    comparables:[...selected.map(r=>map(r,true)),...rejected.map(r=>map(r,false))],
    valuation:{lowNis:low?Math.round(low):null,baseNis:base?Math.round(base):null,highNis:high?Math.round(high):null,pricePerSqm:basep?Math.round(basep):null,discountToBasePct:base&&ask?Number((100*(base-ask)/base).toFixed(2)):null},
    evidence:{status:selected.length>=3?'supported':selected.length?'provisional':'insufficient_evidence',confidence:conf==null?null:Number(conf.toFixed(3)),sampleSize:selected.length,observedAt:selected[0]?.deal_date||null,modelVersion:'valuation-v2',sourceIds,notes}
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
