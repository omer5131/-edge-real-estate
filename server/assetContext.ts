import type {AssetContextResponse,AssetIdentity,EvidenceMeta} from './contracts/investmentContext.js';
import {getValuationContext} from './valuationContext.js';
import {getActiveMarketContext} from './activeMarketContext.js';
import {getAreaContext} from './areaContext.js';
import {getPlanningContext} from './planningContext.js';

const worstStatus=(items:EvidenceMeta[])=>{
  const statuses=items.map(x=>x.status);
  if(statuses.every(x=>x==='unavailable'))return 'unavailable' as const;
  if(statuses.some(x=>x==='insufficient_evidence'))return 'insufficient_evidence' as const;
  if(statuses.some(x=>x==='provisional'))return 'provisional' as const;
  return 'supported' as const;
};

export function assetIdentityFromListing(listing:any):AssetIdentity{
  const hasNeighborhood=Boolean(listing?.neighborhood_id);
  const identityEvidence:EvidenceMeta={
      status:hasNeighborhood?'supported':'insufficient_evidence',
      confidence:hasNeighborhood?1:null,
      sampleSize:1,
      observedAt:listing?.last_seen_at??null,
      modelVersion:'asset-identity-v1',
      sourceIds:[String(listing?.source_id||'listings')],
      notes:[...(listing?.building_id?[]:['Canonical building identity is not yet resolved.']),...(hasNeighborhood?[]:['Canonical neighborhood identity is missing.'])]
    };
  return {
    listingId:String(listing?.id??''),
    propertyId:listing?.property_id??null,
    buildingId:listing?.building_id??null,
    neighborhoodId:listing?.neighborhood_id??null,
    canonicalAddress:listing?.address??listing?.canonical_address??null,
    cityId:listing?.city_id??null,
    cityName:listing?.city??null,
    neighborhoodName:listing?.neighborhood??null,
    streetId:listing?.street_id??null,
    parcelId:listing?.parcel_id??null,
    latitude:listing?.latitude??null,
    longitude:listing?.longitude??null,
    identityEvidence
  };
}

export async function getAssetContext(listing:any):Promise<AssetContextResponse>{
  const [valuation,activeMarket,neighborhood,planning]=await Promise.all([
    getValuationContext(listing),
    getActiveMarketContext(listing),
    listing?.neighborhood_id?getAreaContext(listing.neighborhood_id):Promise.resolve(null),
    getPlanningContext(listing?.neighborhood_id)
  ]);
  const asset=assetIdentityFromListing(listing);
  const evidenceItems:EvidenceMeta[]=[asset.identityEvidence,valuation.evidence,activeMarket.evidence,planning.evidence];
  if(neighborhood)evidenceItems.push(neighborhood.mapping.evidence);
  const confidenceVals=evidenceItems.map(x=>x.confidence).filter((x):x is number=>typeof x==='number'&&Number.isFinite(x));
  const evidence:EvidenceMeta={
    status:worstStatus(evidenceItems),
    confidence:confidenceVals.length?Number((confidenceVals.reduce((a,b)=>a+b,0)/confidenceVals.length).toFixed(3)):null,
    sampleSize:evidenceItems.reduce((n,x)=>n+(x.sampleSize??0),0),
    observedAt:evidenceItems.map(x=>x.observedAt).filter((x):x is string=>Boolean(x)).sort().at(-1)??null,
    modelVersion:'asset-context-v1',
    sourceIds:[...new Set(evidenceItems.flatMap(x=>x.sourceIds))],
    notes:[...new Set(evidenceItems.flatMap(x=>x.notes))]
  };
  const asking=listing?.asking_price_ils==null?null:Number(listing.asking_price_ils);
  const area=listing?.area_sqm==null?null:Number(listing.area_sqm);
  return {
    asset,
    listing:{
      askingPriceNis:asking,
      areaSqm:area,
      rooms:listing?.rooms==null?null:Number(listing.rooms),
      floor:listing?.floor==null?null:Number(listing.floor),
      askingPricePerSqm:asking&&area?asking/area:null,
      sourceId:String(listing?.source_id||'listings'),
      sourceUrl:listing?.url??null,
      firstSeenAt:listing?.first_seen_at??null,
      lastSeenAt:listing?.last_seen_at??null
    },
    valuation,
    activeMarket,
    neighborhood,
    planning,
    evidence
  };
}
