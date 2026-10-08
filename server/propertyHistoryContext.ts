import {addressRelation,numberOrNull} from './evidenceValues.js';
import {queryDatabase} from './db.js';
import type {HistoricalMarketContext} from './contracts/investmentContext.js';
import {normalizeAddress,streetKey} from './valuationContext.js';

const clamp=(n:number)=>Math.max(0,Math.min(1,n));
const relationFor=(listing:any,row:any)=>{const r=addressRelation(listing,row);return r==='same_building'||r==='same_street'?r:'same_neighborhood'};
const relScore=(r:string)=>r==='same_building'?1:r==='same_street'?.92:.68;

export function buildHistoricalMarketContext(listing:any,rows:any[],periods:any[]):HistoricalMarketContext{
  const subjectArea=Number(listing?.area_sqm||0),subjectRooms=listing?.rooms==null?null:Number(listing.rooms);
  const seen=new Set<string>(),similar:any[]=[];
  for(const r of rows){
    const area=Number(r.area_sqm||0),rooms=r.rooms==null?null:Number(r.rooms);
    if(subjectArea>0&&(!(area>0)||area/subjectArea<.75||area/subjectArea>1.25))continue;
    if(subjectRooms!=null&&(rooms==null||Math.abs(rooms-subjectRooms)>1))continue;
    const fp=[String(r.deal_date).slice(0,10),Number(r.sale_price_nis||0),area,Number(rooms||0),Number(r.floor??-999)].join('|');
    if(seen.has(fp))continue;seen.add(fp);
    const relation=relationFor(listing,r);
    let score=0,total=0;
    const add=(s:number,w:number)=>{score+=clamp(s)*w;total+=w};
    add(relScore(relation),.35);
    if(subjectArea&&area)add(1-Math.abs(subjectArea-area)/subjectArea,.35);
    if(subjectRooms!=null&&rooms!=null)add(1-Math.abs(subjectRooms-rooms)/Math.max(subjectRooms,1),.20);
    if(listing.floor!=null&&r.floor!=null)add(1-Math.abs(Number(listing.floor)-Number(r.floor))/10,.10);
    const similarity=total?score/total:0;
    if(similarity>=.60)similar.push({...r,relation,similarity});
  }
  similar.sort((a,b)=>b.similarity-a.similarity||String(b.deal_date).localeCompare(String(a.deal_date)));
  const trend=periods.map((p:any)=>({
    periodStart:String(p.period_start),
    executedTransactionCount:Number(p.executed_transaction_count||0),
    medianExecutedPriceNis:p.median_executed_price_nis==null?null:Number(p.median_executed_price_nis),
    medianExecutedPriceSqm:p.median_executed_price_sqm==null?null:Number(p.median_executed_price_sqm),
    p25ExecutedPriceSqm:p.p25_executed_price_sqm==null?null:Number(p.p25_executed_price_sqm),
    p75ExecutedPriceSqm:p.p75_executed_price_sqm==null?null:Number(p.p75_executed_price_sqm),
    activeSaleListingCount:Number(p.active_sale_listing_count||0),
    medianAskingPriceSqm:p.median_asking_price_sqm==null?null:Number(p.median_asking_price_sqm),
    askingToExecutedPremiumPct:p.asking_to_executed_premium_pct==null?null:Number(p.asking_to_executed_premium_pct),
    transactionConfidence:p.transaction_confidence==null?null:Number(p.transaction_confidence)>1?Number(p.transaction_confidence)/100:Number(p.transaction_confidence)
  })).sort((a,b)=>a.periodStart.localeCompare(b.periodStart));
  const latest=trend.at(-1)??null;
  const latestDate=latest?new Date(latest.periodStart):null;
  let prior:any=null;
  if(latestDate){
    const target=new Date(latestDate);target.setUTCFullYear(target.getUTCFullYear()-1);
    prior=[...trend].reverse().find(x=>new Date(x.periodStart)<=target)??null;
  }
  const change=latest?.medianExecutedPriceSqm&&prior?.medianExecutedPriceSqm
    ?100*(latest.medianExecutedPriceSqm-prior.medianExecutedPriceSqm)/prior.medianExecutedPriceSqm:null;
  return {
    similarSales:similar.slice(0,24).map(r=>({
      transactionId:String(r.transaction_id),address:r.address_text??null,dealDate:String(r.deal_date),
      salePriceNis:Number(r.sale_price_nis),pricePerSqm:r.price_per_sqm==null?null:Number(r.price_per_sqm),
      areaSqm:r.area_sqm==null?null:Number(r.area_sqm),rooms:r.rooms==null?null:Number(r.rooms),floor:numberOrNull(r.floor),
      relation:r.relation,similarityScore:Number(r.similarity.toFixed(4))
    })),
    trend,
    summary:{
      latestMedianExecutedPriceSqm:latest?.medianExecutedPriceSqm??null,
      changeVs12MonthsAgoPct:change==null?null:Number(change.toFixed(2)),
      latestTransactionCount:latest?.executedTransactionCount??null,
      latestAskingPremiumPct:latest?.askingToExecutedPremiumPct??null
    },
    evidence:{
      status:similar.length>=3&&trend.length>=3?'supported':similar.length||trend.length?'provisional':'insufficient_evidence',
      confidence:similar.length||trend.length?Number(Math.min(.9,.3+Math.min(similar.length,10)*.04+Math.min(trend.length,12)*.015).toFixed(3)):null,
      sampleSize:similar.length,
      observedAt:latest?.periodStart??similar[0]?.deal_date??null,
      modelVersion:'historical-market-v1',
      sourceIds:['transactions','neighborhood_market_periods'],
      notes:['Historical similar sales are subject-relative executed transactions; neighborhood trend metrics are contextual and are not directly substituted into the subject valuation.']
    }
  };
}

export async function getHistoricalMarketContext(listing:any){
  if(!listing?.neighborhood_id)return buildHistoricalMarketContext(listing,[],[]);
  const [rows,periods]=await Promise.all([
    queryDatabase("select id::text transaction_id,neighborhood_id::text,address_text,deal_date::text,amount_nis::float8 sale_price_nis,area_sqm::float8,rooms::float8,floor::float8,coalesce(normalized_pp_sqm,pp_sqm)::float8 price_per_sqm from transactions where neighborhood_id=$1::uuid and is_comparable=true and deal_date>=current_date-interval '5 years' and amount_nis>0 and coalesce(normalized_pp_sqm,pp_sqm)>0 order by deal_date desc limit 500",[listing.neighborhood_id]),
    queryDatabase("select period_start::text,executed_transaction_count,median_executed_price_nis::float8,median_executed_price_sqm::float8,p25_executed_price_sqm::float8,p75_executed_price_sqm::float8,active_sale_listing_count,median_asking_price_sqm::float8,asking_to_executed_premium_pct::float8,transaction_confidence::float8 from neighborhood_market_periods where neighborhood_id=$1::uuid and period_type='month' and period_start>=current_date-interval '36 months' order by period_start",[listing.neighborhood_id])
  ]);
  return buildHistoricalMarketContext(listing,rows,periods);
}
