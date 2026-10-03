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
   SELECT l.id::text,l.property_id::text,l.building_id::text,l.neighborhood_id::text,
    latest.asking_price_nis::float8,latest.area_sqm::float8,latest.rooms::float8,latest.floor::float8
   FROM listings l JOIN latest ON latest.listing_id=l.id WHERE l.id=${id}::uuid
  `;
  if(!subject)return res.status(404).json({error:'not_found'});
  const asset={listingId:subject.id,propertyId:subject.property_id||null,buildingId:subject.building_id||null,neighborhoodId:subject.neighborhood_id||null};
  if(!subject.neighborhood_id)return res.status(200).json({asset,listings:[],summary:{inventoryCount:0,medianAskingPriceNis:null,medianAskingPricePerSqm:null,medianDaysOnMarket:null,subjectAskingPercentile:null,subjectDeltaToMedianPct:null},evidence:{status:'insufficient_evidence',confidence:null,sampleSize:0,observedAt:null,modelVersion:'similar-listings-v1',sourceIds:['listings'],notes:['Listing has no canonical neighborhood.']}});

  const rows=await sql`
   WITH latest AS(
    SELECT DISTINCT ON(listing_id) listing_id,asking_price_nis,area_sqm,rooms,floor,observed_at
    FROM listing_snapshots ORDER BY listing_id,observed_at DESC
   ), candidates AS(
    SELECT l.id::text,l.canonical_address,l.source_id,l.url,l.first_seen_at,l.last_seen_at,
     latest.asking_price_nis::float8,latest.area_sqm::float8,latest.rooms::float8,latest.floor::float8,
     sig.original_asking_price::float8,sig.days_on_market::int,sig.price_reductions::int,
     (
      CASE WHEN ${subject.area_sqm}::numeric IS NOT NULL AND latest.area_sqm>0
       THEN greatest(0,1-abs(latest.area_sqm-${subject.area_sqm}::numeric)/greatest(${subject.area_sqm}::numeric,1))*.55 ELSE 0 END
      +CASE WHEN ${subject.rooms}::numeric IS NOT NULL AND latest.rooms IS NOT NULL
       THEN greatest(0,1-abs(latest.rooms-${subject.rooms}::numeric)/greatest(${subject.rooms}::numeric,1))*.30 ELSE 0 END
      +CASE WHEN ${subject.floor}::numeric IS NOT NULL AND latest.floor IS NOT NULL
       THEN greatest(0,1-abs(latest.floor-${subject.floor}::numeric)/10)*.15 ELSE 0 END
     )::float8 similarity
    FROM listings l JOIN latest ON latest.listing_id=l.id
    LEFT JOIN listing_seller_signals sig ON sig.listing_id=l.id
    WHERE l.status='active' AND l.neighborhood_id=${subject.neighborhood_id}::uuid AND l.id<>${id}::uuid
   ), selected AS(
    SELECT * FROM candidates WHERE similarity>=.45 ORDER BY similarity DESC,last_seen_at DESC LIMIT 20
   )
   SELECT *,count(*) over()::int inventory_count,
    percentile_cont(.5) within group(order by asking_price_nis) over() median_ask,
    percentile_cont(.5) within group(order by CASE WHEN area_sqm>0 THEN asking_price_nis/area_sqm END) over() median_ppsqm,
    percentile_cont(.5) within group(order by days_on_market) over() median_dom
   FROM selected ORDER BY similarity DESC,last_seen_at DESC
  `;
  const count=Number(rows[0]?.inventory_count||0),ask=Number(subject.asking_price_nis||0),medianAsk=rows[0]?Number(rows[0].median_ask):null;
  const asks=rows.map((r:any)=>Number(r.asking_price_nis)).filter((x:number)=>Number.isFinite(x));
  const percentile=ask&&asks.length?100*asks.filter((x:number)=>x<=ask).length/asks.length:null;
  return res.status(200).json({
   asset,
   listings:rows.map((r:any)=>({listingId:r.id,address:r.canonical_address,currentAskingPriceNis:Number(r.asking_price_nis)||null,originalAskingPriceNis:Number(r.original_asking_price)||null,askingPricePerSqm:Number(r.area_sqm)>0?Number(r.asking_price_nis)/Number(r.area_sqm):null,areaSqm:Number(r.area_sqm)||null,rooms:Number(r.rooms)||null,floor:Number(r.floor)||null,daysOnMarket:r.days_on_market==null?null:Number(r.days_on_market),priceReductions:r.price_reductions==null?null:Number(r.price_reductions),distanceMeters:null,similarityScore:Number(Number(r.similarity).toFixed(4)),sourceId:r.source_id,sourceUrl:r.url||null,firstSeenAt:r.first_seen_at||null,lastSeenAt:r.last_seen_at||null})),
   summary:{inventoryCount:count,medianAskingPriceNis:medianAsk,medianAskingPricePerSqm:rows[0]?Number(rows[0].median_ppsqm):null,medianDaysOnMarket:rows[0]?.median_dom==null?null:Number(rows[0].median_dom),subjectAskingPercentile:percentile==null?null:Number(percentile.toFixed(1)),subjectDeltaToMedianPct:ask&&medianAsk?Number((100*(ask-medianAsk)/medianAsk).toFixed(2)):null},
   evidence:{status:count>=3?'supported':count?'provisional':'insufficient_evidence',confidence:count?Number(Math.min(.8,.25+count*.07).toFixed(2)):null,sampleSize:count,observedAt:rows[0]?.last_seen_at||null,modelVersion:'similar-listings-v1',sourceIds:['listings','listing_snapshots'],notes:['v1 similarity uses neighborhood, area, rooms and floor; distance requires stronger canonical location coverage.']}
  });
 }catch(e){return res.status(503).json({error:String(e)})}
}