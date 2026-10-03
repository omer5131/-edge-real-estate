import type { VercelRequest,VercelResponse } from '@vercel/node';
import { sql } from '../server/db.js';

const median=(xs:number[])=>{
 const a=xs.filter(Number.isFinite).sort((x,y)=>x-y);
 if(!a.length)return null;
 const m=Math.floor(a.length/2);
 return a.length%2?a[m]:(a[m-1]+a[m])/2;
};
const quantile=(xs:number[],q:number)=>{
 const a=xs.filter(Number.isFinite).sort((x,y)=>x-y);
 if(!a.length)return null;
 const pos=(a.length-1)*q,lo=Math.floor(pos),hi=Math.ceil(pos);
 return lo===hi?a[lo]:a[lo]+(a[hi]-a[lo])*(pos-lo);
};

export default async function handler(req:VercelRequest,res:VercelResponse){
 if(req.method!=='GET')return res.status(405).json({error:'method_not_allowed'});
 const id=typeof req.query.id==='string'?req.query.id:'';
 if(!id)return res.status(400).json({error:'id_required'});
 try{
  const [listing]=await sql`WITH latest AS(
    SELECT DISTINCT ON(listing_id)* FROM listing_snapshots WHERE listing_id=${id}::uuid ORDER BY listing_id,observed_at DESC
  ) SELECT l.id::text,l.property_id::text,l.building_id::text,l.canonical_address address,l.neighborhood_id,n.name_he neighborhood,c.name_he city,l.url,
    l.first_seen_at,l.last_seen_at,latest.asking_price_nis::float8 asking_price_ils,
    latest.area_sqm::float8,latest.rooms::float8,latest.floor::float8,
    sub.id subscription_id,sub.status subscription_status,sub.enrichment_level
    FROM listings l JOIN latest ON latest.listing_id=l.id
    JOIN neighborhoods n ON n.id=l.neighborhood_id JOIN cities c ON c.id=l.city_id
    LEFT JOIN asset_subscriptions sub ON sub.entity_type='listing' AND sub.entity_id=l.id
    WHERE l.id=${id}::uuid`;
  if(!listing)return res.status(404).json({error:'not_found'});
  const subscribed=!!listing.subscription_id;

  const basicComps=await sql`SELECT coalesce(address_text,'עסקה') address,to_char(deal_date,'MM/YYYY') date,
    area_sqm::float8 sqm,amount_nis::float8 price,COALESCE(normalized_pp_sqm,pp_sqm)::float8 price_sqm,deal_date
    FROM comparable_transactions WHERE neighborhood_id=${listing.neighborhood_id}::uuid
      AND deal_date>=current_date-interval '18 months'
      AND (${listing.area_sqm}::numeric IS NULL OR area_sqm BETWEEN ${listing.area_sqm}::numeric*.8 AND ${listing.area_sqm}::numeric*1.2)
    ORDER BY deal_date DESC LIMIT ${subscribed?12:3}`;
  const [confidence]=await sql`SELECT * FROM neighborhood_market_confidence WHERE neighborhood_id=${listing.neighborhood_id}::uuid`;
  if(!subscribed)return res.status(200).json({tier:'basic',listing,comps:basicComps,confidence:confidence||{confidence:'insufficient',sample_12m:0}});

  const valuationRows=await sql`
   SELECT t.id::text transaction_id,t.address_text,t.deal_date,
    t.amount_nis::float8 sale_price_nis,t.area_sqm::float8,t.rooms::float8,t.floor::float8,
    COALESCE(t.normalized_pp_sqm,t.pp_sqm)::float8 price_per_sqm,
    (
     CASE WHEN ${listing.area_sqm}::numeric IS NOT NULL AND t.area_sqm>0
      THEN greatest(0,1-abs(t.area_sqm-${listing.area_sqm}::numeric)/greatest(${listing.area_sqm}::numeric,1))*.45 ELSE 0 END
     +CASE WHEN ${listing.rooms}::numeric IS NOT NULL AND t.rooms IS NOT NULL
      THEN greatest(0,1-abs(t.rooms-${listing.rooms}::numeric)/greatest(${listing.rooms}::numeric,1))*.25 ELSE 0 END
     +CASE WHEN ${listing.floor}::numeric IS NOT NULL AND t.floor IS NOT NULL
      THEN greatest(0,1-abs(t.floor-${listing.floor}::numeric)/10)*.10 ELSE 0 END
     +exp(-greatest(0,current_date-t.deal_date)/(365.0*3))*.20
    )::float8 similarity
   FROM transactions t
   WHERE t.is_comparable=true AND t.neighborhood_id=${listing.neighborhood_id}::uuid
    AND t.deal_date>=current_date-interval '5 years'
    AND COALESCE(t.normalized_pp_sqm,t.pp_sqm)>0 AND t.amount_nis>0
   ORDER BY similarity DESC,t.deal_date DESC LIMIT 40
  `;
  const selected=valuationRows.filter((r:any)=>Number(r.similarity)>=.50).slice(0,12);
  const ppsm=selected.map((r:any)=>Number(r.price_per_sqm)).filter(Number.isFinite);
  const lowPpsm=quantile(ppsm,.25),basePpsm=quantile(ppsm,.5),highPpsm=quantile(ppsm,.75);
  const area=Number(listing.area_sqm||0),ask=Number(listing.asking_price_ils||0);
  const lowValue=lowPpsm&&area?lowPpsm*area:null,baseValue=basePpsm&&area?basePpsm*area:null,highValue=highPpsm&&area?highPpsm*area:null;
  const avgSimilarity=selected.length?selected.reduce((s:number,r:any)=>s+Number(r.similarity||0),0)/selected.length:0;
  const valuationConfidence=selected.length?Math.min(.85,(Math.min(selected.length,10)/10)*.6+avgSimilarity*.25):null;
  const valuation={
   asset:{listingId:listing.id,propertyId:listing.property_id||null,buildingId:listing.building_id||null,neighborhoodId:listing.neighborhood_id||null},
   comparables:selected.map((r:any)=>({transactionId:r.transaction_id,address:r.address_text,dealDate:r.deal_date,salePriceNis:Number(r.sale_price_nis),areaSqm:Number(r.area_sqm)||null,rooms:Number(r.rooms)||null,floor:Number(r.floor)||null,pricePerSqm:Number(r.price_per_sqm)||null,distanceMeters:null,relation:'same_neighborhood',similarityScore:Number(Number(r.similarity).toFixed(4)),weight:Number((Number(r.similarity)**2).toFixed(4)),selected:true,selectionReasons:['same canonical neighborhood','apartment similarity','transaction recency'],rejectionReasons:[]})),
   valuation:{lowNis:lowValue?Math.round(lowValue):null,baseNis:baseValue?Math.round(baseValue):null,highNis:highValue?Math.round(highValue):null,pricePerSqm:basePpsm?Math.round(basePpsm):null,discountToBasePct:baseValue&&ask?Number((100*(baseValue-ask)/baseValue).toFixed(2)):null},
   evidence:{status:selected.length>=3?'supported':selected.length?'provisional':'insufficient_evidence',confidence:valuationConfidence==null?null:Number(valuationConfidence.toFixed(3)),sampleSize:selected.length,observedAt:selected[0]?.deal_date||null,modelVersion:'valuation-v1',sourceIds:['transactions'],notes:listing.building_id?[]:['Canonical building identity is unavailable; v1 relies on neighborhood and apartment similarity.']}
  };

  const activeRows=await sql`
   WITH latest AS(
    SELECT DISTINCT ON(listing_id) listing_id,asking_price_nis,area_sqm,rooms,floor,observed_at
    FROM listing_snapshots ORDER BY listing_id,observed_at DESC
   )
   SELECT l.id::text,l.canonical_address,l.source_id,l.url,l.first_seen_at,l.last_seen_at,
    latest.asking_price_nis::float8,latest.area_sqm::float8,latest.rooms::float8,latest.floor::float8,
    sig.original_asking_price::float8,sig.days_on_market::int,sig.price_reductions::int,
    (
     CASE WHEN ${listing.area_sqm}::numeric IS NOT NULL AND latest.area_sqm>0
      THEN greatest(0,1-abs(latest.area_sqm-${listing.area_sqm}::numeric)/greatest(${listing.area_sqm}::numeric,1))*.55 ELSE 0 END
     +CASE WHEN ${listing.rooms}::numeric IS NOT NULL AND latest.rooms IS NOT NULL
      THEN greatest(0,1-abs(latest.rooms-${listing.rooms}::numeric)/greatest(${listing.rooms}::numeric,1))*.30 ELSE 0 END
     +CASE WHEN ${listing.floor}::numeric IS NOT NULL AND latest.floor IS NOT NULL
      THEN greatest(0,1-abs(latest.floor-${listing.floor}::numeric)/10)*.15 ELSE 0 END
    )::float8 similarity
   FROM listings l JOIN latest ON latest.listing_id=l.id
   LEFT JOIN listing_seller_signals sig ON sig.listing_id=l.id
   WHERE l.status='active' AND l.neighborhood_id=${listing.neighborhood_id}::uuid AND l.id<>${id}::uuid
   ORDER BY similarity DESC,l.last_seen_at DESC LIMIT 50
  `;
  const similar=activeRows.filter((r:any)=>Number(r.similarity)>=.45).slice(0,20);
  const competingAsks=similar.map((r:any)=>Number(r.asking_price_nis)).filter(Number.isFinite);
  const competingPpsm=similar.map((r:any)=>Number(r.area_sqm)>0?Number(r.asking_price_nis)/Number(r.area_sqm):NaN).filter(Number.isFinite);
  const competingDom=similar.map((r:any)=>r.days_on_market==null?NaN:Number(r.days_on_market)).filter(Number.isFinite);
  const medAsk=median(competingAsks);
  const percentile=ask&&competingAsks.length?100*competingAsks.filter((x:number)=>x<=ask).length/competingAsks.length:null;
  const activeMarket={
   listings:similar.map((r:any)=>({listingId:r.id,address:r.canonical_address,currentAskingPriceNis:Number(r.asking_price_nis)||null,originalAskingPriceNis:Number(r.original_asking_price)||null,askingPricePerSqm:Number(r.area_sqm)>0?Number(r.asking_price_nis)/Number(r.area_sqm):null,areaSqm:Number(r.area_sqm)||null,rooms:Number(r.rooms)||null,floor:Number(r.floor)||null,daysOnMarket:r.days_on_market==null?null:Number(r.days_on_market),priceReductions:r.price_reductions==null?null:Number(r.price_reductions),distanceMeters:null,similarityScore:Number(Number(r.similarity).toFixed(4)),sourceId:r.source_id,sourceUrl:r.url||null,firstSeenAt:r.first_seen_at||null,lastSeenAt:r.last_seen_at||null})),
   summary:{inventoryCount:similar.length,medianAskingPriceNis:medAsk,medianAskingPricePerSqm:median(competingPpsm),medianDaysOnMarket:median(competingDom),subjectAskingPercentile:percentile==null?null:Number(percentile.toFixed(1)),subjectDeltaToMedianPct:ask&&medAsk?Number((100*(ask-medAsk)/medAsk).toFixed(2)):null},
   evidence:{status:similar.length>=3?'supported':similar.length?'provisional':'insufficient_evidence',confidence:similar.length?Number(Math.min(.8,.25+similar.length*.07).toFixed(2)):null,sampleSize:similar.length,observedAt:similar[0]?.last_seen_at||null,modelVersion:'similar-listings-v1',sourceIds:['listings','listing_snapshots'],notes:['v1 similarity uses neighborhood, area, rooms and floor; distance requires stronger canonical location coverage.']}
  };

  const renewal=await sql`SELECT project_name name,plan_number,status,existing_units,planned_units,permits_count,in_execution,
    source_url official_url,map_url,observed_at FROM renewal_projects WHERE neighborhood_id=${listing.neighborhood_id}::uuid
    ORDER BY in_execution DESC,permits_count DESC NULLS LAST,observed_at DESC LIMIT 10`;
  const plans=await sql`SELECT plan_number,name,status,authority,housing_units,source_url,observed_at FROM planning_plans WHERE neighborhood_id=${listing.neighborhood_id}::uuid ORDER BY observed_at DESC LIMIT 20`;
  const infrastructure=await sql`SELECT name,category,status,source_url,observed_at FROM infrastructure_projects WHERE neighborhood_id=${listing.neighborhood_id}::uuid ORDER BY observed_at DESC LIMIT 20`;
  const history=await sql`SELECT observed_at,asking_price_nis::float8,area_sqm::float8,rooms::float8,floor::float8 FROM listing_snapshots WHERE listing_id=${id}::uuid ORDER BY observed_at`;
  const [seller]=await sql`SELECT * FROM listing_seller_signals WHERE listing_id=${id}::uuid`;
  const [rent]=await sql`SELECT * FROM neighborhood_rent_metrics WHERE neighborhood_id=${listing.neighborhood_id}::uuid`;
  const [score]=await sql`SELECT score,price_gap_score,renewal_score,seller_motivation_score,comp_confidence_score,risk_deduction,model_version,inputs,explanation,calculated_at FROM opportunity_scores WHERE entity_type='listing' AND entity_id=${id}::uuid ORDER BY calculated_at DESC LIMIT 1`;
  res.status(200).json({tier:'full',listing,comps:basicComps,valuation,activeMarket,renewal,plans,infrastructure,history,seller:seller||{},rent:rent||null,score:score||null,confidence:confidence||{confidence:'insufficient',sample_12m:0}});
 }catch(e){res.status(503).json({error:String(e)});}
}