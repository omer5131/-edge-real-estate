import type {VercelRequest,VercelResponse} from '@vercel/node';
import {sql} from '../server/db.js';
import {getAssetContext} from '../server/assetContext.js';
import {listingLifecycle} from '../server/listingLifecycle.js';
import {classifySourceUrl} from '../server/contracts/investmentContext.js';

export default async function handler(req:VercelRequest,res:VercelResponse){
 if(req.method!=='GET')return res.status(405).json({error:'method_not_allowed'});
 const id=typeof req.query.id==='string'?req.query.id:'';
 if(!id)return res.status(400).json({error:'id_required'});
 try{
  const [listing]=await sql`WITH latest AS(
    SELECT DISTINCT ON(listing_id)* FROM listing_snapshots WHERE listing_id=${id}::uuid ORDER BY listing_id,observed_at DESC
  ) SELECT l.id::text,l.source_id,l.source_listing_id,l.property_id::text,l.building_id::text,l.city_id::text,l.canonical_address address,l.neighborhood_id::text,
    n.name_he neighborhood,c.name_he city,l.url,l.first_seen_at,l.last_seen_at,
    latest.asking_price_nis::float8 asking_price_ils,latest.area_sqm::float8,latest.rooms::float8,latest.floor::float8,
    sub.id subscription_id,sub.status subscription_status,sub.enrichment_level
    FROM listings l JOIN latest ON latest.listing_id=l.id
    LEFT JOIN neighborhoods n ON n.id=l.neighborhood_id LEFT JOIN cities c ON c.id=l.city_id
    LEFT JOIN asset_subscriptions sub ON sub.entity_type='listing' AND sub.entity_id=l.id
    WHERE l.id=${id}::uuid`;
  if(!listing)return res.status(404).json({error:'not_found'});
  listing.source_url_kind=classifySourceUrl(listing.url);
  const subscribed=!!listing.subscription_id;

  let basicComps:any[]=[];
  let confidence:any={confidence:'insufficient',sample_12m:0};
  if(listing.neighborhood_id){
    basicComps=await sql`SELECT coalesce(address_text,'עסקה') address,to_char(deal_date,'MM/YYYY') date,
      area_sqm::float8 sqm,amount_nis::float8 price,COALESCE(normalized_pp_sqm,pp_sqm)::float8 price_sqm,deal_date
      FROM comparable_transactions WHERE neighborhood_id=${listing.neighborhood_id}::uuid
        AND deal_date>=current_date-interval '18 months'
        AND (${listing.area_sqm}::numeric IS NULL OR area_sqm BETWEEN ${listing.area_sqm}::numeric*.8 AND ${listing.area_sqm}::numeric*1.2)
      ORDER BY deal_date DESC LIMIT ${subscribed?12:3}`;
    const confidenceRows=await sql`SELECT * FROM neighborhood_market_confidence WHERE neighborhood_id=${listing.neighborhood_id}::uuid`;
    confidence=confidenceRows[0]||confidence;
  }
  if(!subscribed)return res.status(200).json({tier:'basic',listing,comps:basicComps,confidence});

  const context=await getAssetContext(listing);
  const history=await sql`SELECT observed_at,asking_price_nis::float8,area_sqm::float8,rooms::float8,floor::float8 FROM listing_snapshots WHERE listing_id=${id}::uuid ORDER BY observed_at`;
  const [seller]=await sql`SELECT * FROM listing_seller_signals WHERE listing_id=${id}::uuid`;
  const observedTimes=history.map((x:any)=>new Date(x.observed_at).getTime()).filter((x:number)=>Number.isFinite(x)).sort((a:number,b:number)=>a-b);
  const observedSpanDays=observedTimes.length>=2?(observedTimes.at(-1)!-observedTimes[0])/86400000:null;
  const life=listingLifecycle(history.length,observedSpanDays);
  const sellerContext={...(seller||{}),days_on_market:life.daysOnMarket,price_reductions:life.supported?seller?.price_reductions??null:null,lifecycle_evidence:life.status,snapshot_count:history.length};
  const rent=listing.neighborhood_id?await sql`SELECT * FROM neighborhood_rent_metrics WHERE neighborhood_id=${listing.neighborhood_id}::uuid`: [];
  const [score]=await sql`SELECT score,price_gap_score,renewal_score,seller_motivation_score,comp_confidence_score,risk_deduction,model_version,inputs,explanation,calculated_at FROM opportunity_scores WHERE entity_type='listing' AND entity_id=${id}::uuid ORDER BY calculated_at DESC LIMIT 1`;

  return res.status(200).json({
    tier:'full',
    context,
    asset:context.asset,
    listing,
    comps:basicComps,
    valuation:context.valuation,
    activeMarket:context.activeMarket,
    neighborhood:context.neighborhood,
    areaContext:context.neighborhood,
    planning:context.planning,
    renewal:context.planning.renewalProjects,
    plans:context.planning.plans,
    infrastructure:context.planning.infrastructure,
    evidence:context.evidence,
    history,
    seller:sellerContext,
    rent:rent[0]||null,
    score:score||null,
    confidence
  });
 }catch(e){return res.status(503).json({error:String(e)});}
}
