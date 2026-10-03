import {queryDatabase} from './db.js';

const median=(xs:number[])=>{const a=xs.filter(Number.isFinite).sort((x,y)=>x-y);if(!a.length)return null;const m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2};
const q=(xs:number[],p:number)=>{const a=xs.filter(Number.isFinite).sort((x,y)=>x-y);if(!a.length)return null;const pos=(a.length-1)*p,lo=Math.floor(pos),hi=Math.ceil(pos);return lo===hi?a[lo]:a[lo]+(a[hi]-a[lo])*(pos-lo)};

export async function getValuationContext(listing:any){
 if(!listing?.neighborhood_id)return {comparables:[],valuation:{lowNis:null,baseNis:null,highNis:null,pricePerSqm:null,discountToBasePct:null},evidence:{status:'insufficient_evidence',confidence:null,sampleSize:0,observedAt:null,modelVersion:'valuation-v1',sourceIds:['transactions'],notes:['Listing has no canonical neighborhood.']}};
 const rows=await queryDatabase(
  "select id::text transaction_id,address_text,deal_date::text,amount_nis::float8 sale_price_nis,area_sqm::float8,rooms::float8,floor::float8,coalesce(normalized_pp_sqm,pp_sqm)::float8 price_per_sqm from transactions where is_comparable=true and neighborhood_id=$1::uuid and deal_date>=current_date-interval '5 years' and coalesce(normalized_pp_sqm,pp_sqm)>0 and amount_nis>0 order by deal_date desc limit 250",
  [listing.neighborhood_id]
 );
 const seen=new Set<string>(), scored:any[]=[];
 for(const r of rows){
  const fp=[String(r.deal_date).slice(0,10),Number(r.sale_price_nis||0),Number(r.area_sqm||0),Number(r.rooms||0),Number(r.floor??-999)].join('|');
  if(seen.has(fp))continue;seen.add(fp);
  let score=0,total=0;
  const add=(s:number,w:number)=>{score+=Math.max(0,Math.min(1,s))*w;total+=w};
  if(listing.area_sqm&&r.area_sqm)add(1-Math.abs(Number(listing.area_sqm)-Number(r.area_sqm))/Math.max(Number(listing.area_sqm),1),.45);
  if(listing.rooms!=null&&r.rooms!=null)add(1-Math.abs(Number(listing.rooms)-Number(r.rooms))/Math.max(Number(listing.rooms),1),.25);
  if(listing.floor!=null&&r.floor!=null)add(1-Math.abs(Number(listing.floor)-Number(r.floor))/10,.10);
  const age=Math.max(0,(Date.now()-new Date(r.deal_date).getTime())/86400000);add(Math.exp(-age/(365*3)),.20);
  scored.push({...r,similarity:total?score/total:0});
 }
 const selected=scored.sort((a,b)=>b.similarity-a.similarity).filter(r=>r.similarity>=.5).slice(0,12);
 const ppsm=selected.map(r=>Number(r.price_per_sqm)).filter(Number.isFinite),area=Number(listing.area_sqm||0),ask=Number(listing.asking_price_ils||0);
 const lowp=q(ppsm,.25),basep=median(ppsm),highp=q(ppsm,.75);
 const low=lowp&&area?lowp*area:null,base=basep&&area?basep*area:null,high=highp&&area?highp*area:null;
 const avg=selected.length?selected.reduce((s,r)=>s+r.similarity,0)/selected.length:0;
 const conf=selected.length?Math.min(.85,(Math.min(selected.length,10)/10)*.6+avg*.25):null;
 return {
  comparables:selected.map(r=>({transactionId:r.transaction_id,address:r.address_text,dealDate:r.deal_date,salePriceNis:Number(r.sale_price_nis),areaSqm:Number(r.area_sqm)||null,rooms:Number(r.rooms)||null,floor:Number(r.floor)||null,pricePerSqm:Number(r.price_per_sqm)||null,distanceMeters:null,relation:'same_neighborhood',similarityScore:Number(r.similarity.toFixed(4)),weight:Number((r.similarity**2).toFixed(4)),selected:true,selectionReasons:['same canonical neighborhood','apartment similarity','transaction recency'],rejectionReasons:[]})),
  valuation:{lowNis:low?Math.round(low):null,baseNis:base?Math.round(base):null,highNis:high?Math.round(high):null,pricePerSqm:basep?Math.round(basep):null,discountToBasePct:base&&ask?Number((100*(base-ask)/base).toFixed(2)):null},
  evidence:{status:selected.length>=3?'supported':selected.length?'provisional':'insufficient_evidence',confidence:conf==null?null:Number(conf.toFixed(3)),sampleSize:selected.length,observedAt:selected[0]?.deal_date||null,modelVersion:'valuation-v1',sourceIds:['transactions'],notes:listing.building_id?[]:['Canonical building identity is unavailable; v1 relies on neighborhood and apartment similarity.']}
 };
}
