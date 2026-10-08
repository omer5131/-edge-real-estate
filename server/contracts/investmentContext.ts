export type EvidenceStatus =
  | 'supported'
  | 'provisional'
  | 'insufficient_evidence'
  | 'unavailable';

export const normalizeConfidence=(value:unknown):number|null=>{
  if(value===null||value===undefined||value==='')return null;
  const n=Number(value);if(!Number.isFinite(n))return null;
  const scaled=n>1?n/100:n;
  return Math.max(0,Math.min(1,scaled));
};

export const classifySourceUrl=(url:unknown):'item'|'search'|'unknown'=>
  typeof url==='string'&&/\/realestate\/item\//.test(url)?'item':url?'search':'unknown';

export type EvidenceMeta = {
  status: EvidenceStatus;
  confidence: number | null;
  sampleSize: number | null;
  observedAt: string | null;
  modelVersion: string | null;
  sourceIds: string[];
  notes: string[];
};

export type AssetRef = {
  listingId: string;
  propertyId: string | null;
  buildingId: string | null;
  neighborhoodId: string | null;
};

export type AssetIdentity = AssetRef & {
  canonicalAddress: string | null;
  cityId: string | null;
  cityName: string | null;
  neighborhoodName: string | null;
  streetId: string | null;
  parcelId: string | null;
  latitude: number | null;
  longitude: number | null;
  identityEvidence: EvidenceMeta;
  neighborhoodEvidence: EvidenceMeta;
  buildingEvidence: EvidenceMeta;
};

export type MarketMetric = {
  key: string;
  label: string;
  value: number | string | null;
  unit: string | null;
  period: string | null;
  evidence: EvidenceMeta;
};

export type NeighborhoodIntelligenceResponse = {
  neighborhoodId: string;
  slug: string;
  name: string;
  city: string;
  marketFreshness?: {status:string;cacheStatus:string;calculatedAt:string|null;sourceRevisionAt?:string|null;cacheCalculatedAt?:string|null;notes:string[]};
  market: MarketMetric[];
  population: MarketMetric[];
  socioeconomic: MarketMetric[];
  education: MarketMetric[];
  housing: MarketMetric[];
  renewal: MarketMetric[];
  planning: MarketMetric[];
  infrastructure: MarketMetric[];
  mapping: {
    statisticalAreas: Array<{
      code: string;
      year: number | null;
      weight: number | null;
      method: string;
      confidence: number | null;
      analyticsSafe: boolean;
      sourceEvidence: unknown;
    }>;
    evidence: EvidenceMeta;
  };
};

export type ComparableSale = {
  transactionId: string;
  address: string | null;
  dealDate: string;
  salePriceNis: number | null;
  areaSqm: number | null;
  rooms: number | null;
  floor: number | null;
  pricePerSqm: number | null;
  distanceMeters: number | null;
  relation: 'same_building' | 'same_street' | 'nearby' | 'same_neighborhood' | 'fallback';
  similarityScore: number;
  weight: number;
  selected: boolean;
  selectionReasons: string[];
  rejectionReasons: string[];
};

export type ValuationResponse = {
  asset: AssetRef;
  comparables: ComparableSale[];
  valuation: {
    lowNis: number | null;
    baseNis: number | null;
    highNis: number | null;
    pricePerSqm: number | null;
    discountToBasePct: number | null;
  };
  evidence: EvidenceMeta;
};

export type SimilarActiveListing = {
  listingId: string;
  address: string | null;
  currentAskingPriceNis: number | null;
  originalAskingPriceNis: number | null;
  askingPricePerSqm: number | null;
  areaSqm: number | null;
  rooms: number | null;
  floor: number | null;
  daysOnMarket: number | null;
  priceReductions: number | null;
  distanceMeters: number | null;
  similarityScore: number;
  sourceId: string;
  sourceUrl: string | null;
  sourceUrlKind: 'item' | 'search' | 'unknown';
  firstSeenAt: string | null;
  lastSeenAt: string | null;
};

export type SimilarListingsResponse = {
  asset: AssetRef;
  listings: SimilarActiveListing[];
  rejectedListings: Array<{listingId:string;address:string|null;reasons:string[]}>;
  summary: {
    inventoryCount: number;
    medianAskingPriceNis: number | null;
    medianAskingPricePerSqm: number | null;
    medianDaysOnMarket: number | null;
    subjectAskingPercentile: number | null;
    subjectDeltaToMedianPct: number | null;
  };
  evidence: EvidenceMeta;
};

export type HistoricalSale = {
  transactionId:string;
  address:string|null;
  dealDate:string;
  salePriceNis:number;
  pricePerSqm:number|null;
  areaSqm:number|null;
  rooms:number|null;
  floor:number|null;
  relation:'same_building'|'same_street'|'same_neighborhood';
  similarityScore:number;
};

export type HistoricalMarketContext = {
  similarSales:HistoricalSale[];
  trend:Array<{
    periodStart:string;
    executedTransactionCount:number;
    medianExecutedPriceNis:number|null;
    medianExecutedPriceSqm:number|null;
    p25ExecutedPriceSqm:number|null;
    p75ExecutedPriceSqm:number|null;
    activeSaleListingCount:number;
    medianAskingPriceSqm:number|null;
    askingToExecutedPremiumPct:number|null;
    transactionConfidence:number|null;
  }>;
  summary:{
    latestMedianExecutedPriceSqm:number|null;
    changeVs12MonthsAgoPct:number|null;
    latestTransactionCount:number|null;
    latestAskingPremiumPct:number|null;
  };
  evidence:EvidenceMeta;
};

export type PlanningContext = {
  renewalProjects: unknown[];
  plans: unknown[];
  infrastructure: unknown[];
  evidence: EvidenceMeta;
};

export type AssetContextResponse = {
  asset: AssetIdentity;
  inventoryEvidence?: {lastObservedAt:string|null;ageDays:number|null;sourceUrlKind:string;availability:string;coverage?:Record<string,number|null>;notes:string[]};
  listing: {
    askingPriceNis: number | null;
    areaSqm: number | null;
    rooms: number | null;
    floor: number | null;
    askingPricePerSqm: number | null;
    sourceId: string;
    sourceUrl: string | null;
    sourceUrlKind: 'item' | 'search' | 'unknown';
    firstSeenAt: string | null;
    lastSeenAt: string | null;
  };
  valuation: ValuationResponse | null;
  activeMarket: SimilarListingsResponse | null;
  historicalMarket: HistoricalMarketContext | null;
  neighborhood: NeighborhoodIntelligenceResponse | null;
  planning: PlanningContext;
  evidence: EvidenceMeta;
};

export const insufficientEvidence = (
  notes: string[] = [],
  sourceIds: string[] = []
): EvidenceMeta => ({
  status: 'insufficient_evidence',
  confidence: null,
  sampleSize: null,
  observedAt: null,
  modelVersion: null,
  sourceIds,
  notes
});
