import type {VercelRequest,VercelResponse} from '@vercel/node';
import {sql} from '../server/db.js';

export default async function handler(req:VercelRequest,res:VercelResponse){
 if(req.method!=='GET')return res.status(405).json({error:'method_not_allowed'});
 const id=typeof req.query.id==='string'?req.query.id:'';
 if(!id)return res.status(400).json({error:'id_required'});
 try{
  const [subject]=await sql`
   WITH latest AS(
    SELECT DISTINCT ON(listing_id) listing_id,asking_price_nis,area_sqm,rooms,floor
    FROM listing_snapshots WHERE listing_id=${id}::uuid ORDER BY listing_id,observed_at DESC
   )
   SELECT l.id::text listing_id,l.property_id::text,l.building_id::text,l.neighborhood_id::text,
    l.canonical_address,latest.asking_price_nis::float8,latest.area_sqm::float8,
    latest.rooms::float8,latest.floor::float8
   FROM listings l JOIN latest ON latest.listing_id=l.id WHERE l.id=${id}::uuid
  `;
  if(!subject)return res.status(404).json({error:'not_found'});
  const asset={listingId:subject.listing_id,propertyId:subject.property_id||null,buildingId:subject.building_id||null,neighborhoodId:subject.neighborhood_id||null};
  if(!subject.neighborhood_id)return res.status(200).json({asset,comparables:[],valuation:{lowNis:null,baseNis:null,highNis:null,pricePerSqm:null,discountToBasePct:null},evidence:{status:'insufficient_evidence',confidence:null,sampleSize:0,observedAt:null,modelVersion:'valuation-v1',sourceIds:['transactions'],notes:['Listing has no canonical neighborhood.']}});

  const rows=await sql`
   WITH candidates AS(
    SELECT t.id::text transaction_id,t.address_text,t.deal_date,
     t.amount_nis::float8 sale_price_nis,t.area_sqm::float8,t.rooms::float8,t.floor::float8,
     COALESCE(t.normalized_pp_sqm,t.pp_sqm)::float8 price_per_sqm,
     (
      CASE WHEN ${subject.area_sqm}::numeric IS NOT NULL AND t.area_sqm>0
       THEN greatest(0,1-abs(t.area_sqm-${subject.area_sqm}::numeric)/greatest(${subject.area_sqm}::numeric,1))*.45 ELSE 0 END
      +CASE WHEN ${subject.rooms}::numeric IS NOT NULL AND t.rooms IS NOT NULL
       THEN greatest(0,1-abs(t.rooms-${subject.rooms}::numeric)/greatest(${subject.rooms}::numeric,1))*.25 ELSE 0 END
      +CASE WHEN ${subject.floor}::numeric IS NOT NULL AND t.floor IS NOT NULL
       THEN greatest(0,1-abs(t.floor-${subject.floor}::numeric)/10)*.10 ELSE 0 END
      +exp(-extract(day from (current_date-t.deal_date))/(365.0*3))*.20
     )::float8 similarity
    FROM transactions t
    WHERE t.is_comparable=true AND t.neighborhood_id=${subject.neighborhood_id}::uuid
     AND t.deal_date>=current_date-interval '5 years'
     AND COALESCE(t.normalized_pp_sqm,t.pp_sqm)>0 AND t.amount_nis>0
   ), selected AS(
    SELECT * FROM candidates WHERE similarity>=.50 ORDER BY similarity DESC,deal_date DESC LIMIT 12
   )
   SELECT *,count(*) over()::int selected_count,
    percentile_cont(.25) within group(order by price_per_sqm) over() low_ppsqm,
    percentile_cont(.50) within group(order by price_per_sqm) over() base_ppsqm,
    percentile_cont(.75) within group(order by price_per_sqm) over() high_ppsqm
   FROM selected ORDER BY similarity DESC
  `;
  const first=rows[0],count=Number(first?.selected_count||0),area=Number(subject.area_sqm||0),ask=Number(subject.asking_price_nis||0);
  const low=first&&area?Number(first.low_ppsqm)*area:null,base=first&&area?Number(first.base_ppsqm)*area:null,high=first&&area?Number(first.high_ppsqm)*area:null;
  const avg=count?rows.reduce((s:any,r:any)=>s+Number(r.similarity||0),0)/count:0;
  const confidence=count?Math.min(.85,(Math.min(count,10)/10)*.6+avg*.25):null;
  return res.status(200).json({
   asset,
   comparables:rows.map((r:any)=>({transactionId:r.transaction_id,address:r.address_text,dealDate:r.deal_date,salePriceNis:Number(r.sale_price_nis),areaSqm:Number(r.area_sqm)||null,rooms:Number(r.rooms)||null,floor:Number(r.floor)||null,pricePerSqm:Number(r.price_per_sqm)||null,distanceMeters:null,relation:'same_neighborhood',similarityScore:Number(Number(r.similarity).toFixed(4)),weight:Number((Number(r.similarity)**2).toFixed(4)),selected:true,selectionReasons:['same canonical neighborhood','apartment similarity','transaction recency'],rejectionReasons:[]})),
   valuation:{lowNis:low?Math.round(low):null,baseNis:base?Math.round(base):null,highNis:high?Math.round(high):null,pricePerSqm:first?Math.round(Number(first.base_ppsqm)):null,discountToBasePct:base&&ask?Number((100*(base-ask)/base).toFixed(2)):null},
   evidence:{status:count>=3?'supported':count?'provisional':'insufficient_evidence',confidence:confidence==null?null:Number(confidence.toFixed(3)),sampleSize:count,observedAt:first?.deal_date||null,modelVersion:'valuation-v1',sourceIds:['transactions'],notes:subject.building_id?[]:['Canonical building identity is unavailable; v1 relies on neighborhood and apartment similarity.']}
  });
 }catch(e){return res.status(503).json({error:String(e)})}
}