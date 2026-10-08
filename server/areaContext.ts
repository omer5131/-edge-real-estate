import {getCurrentAreaMarkets,reconcileAreaMarket} from './currentAreaMarket.js';
import {queryDatabase} from './db.js';
import {normalizeConfidence} from './contracts/investmentContext.js';
import type {EvidenceMeta,MarketMetric,NeighborhoodIntelligenceResponse} from './contracts/investmentContext.js';

const numberOrNull=(v:unknown)=>v==null||v===''?null:Number(v);
const metric=(key:string,label:string,value:number|string|null,unit:string|null,period:string|null,evidence:EvidenceMeta):MarketMetric=>({key,label,value,unit,period,evidence});

export function buildAreaIntelligenceFromRows(input:any):NeighborhoodIntelligenceResponse|null{
  const summary=input?.summary??null,cbs=input?.cbs??null,identity=input?.identity??null,mappings=input?.mappings??[];
  if(!summary&&!identity)return null;
  const neighborhoodId=String(summary?.neighborhood_id??identity?.neighborhood_id??'');
  const slug=String(summary?.neighborhood_slug??identity?.slug??'');
  const name=String(summary?.neighborhood_name??identity?.name_he??'');
  const city=String(summary?.city_name??identity?.city_name??'');
  const freshness=summary?.market_freshness;
  const marketEvidence:EvidenceMeta={status:Number(summary?.transaction_count_12m||0)>=3?'supported':'insufficient_evidence',confidence:normalizeConfidence(summary?.confidence_score),sampleSize:summary?.transaction_count_12m==null?null:Number(summary.transaction_count_12m),observedAt:freshness?.calculatedAt??summary?.updated_at??null,modelVersion:freshness?.modelVersion??summary?.score_version??'area-market-v1',sourceIds:[freshness?'comparable_transactions':'semantic_neighborhood_summary'],notes:freshness?.notes??['Cached area metric; see calculation date.']};
  const cbsSafe=Boolean(cbs?.safe_for_score);
  const cbsEvidence:EvidenceMeta={status:cbsSafe?'supported':cbs?'provisional':'insufficient_evidence',confidence:normalizeConfidence(cbs?.mapping_confidence),sampleSize:cbs?.statistical_area_count==null?null:Number(cbs.statistical_area_count),observedAt:cbs?.calculated_at??null,modelVersion:'cbs-neighborhood-profile-v1',sourceIds:['semantic_neighborhood_cbs_profile'],notes:cbs&&!cbsSafe?['CBS profile is display-safe but not analytics-score-safe until the official 2022 neighborhood/statistical-area crosswalk is validated.']:[]};
  const futureEvidence=(source:string,count:number,observedAt:unknown):EvidenceMeta=>({status:count>0?'supported':'insufficient_evidence',confidence:count>0?.8:null,sampleSize:count,observedAt:observedAt?String(observedAt):null,modelVersion:'future-context-v1',sourceIds:[source],notes:[]});
  const renewal=input?.renewal??{},planning=input?.planning??{},infrastructure=input?.infrastructure??{};
  const renewalEvidence=futureEvidence('renewal_projects',Number(renewal.count||0),renewal.observed_at);
  const unitsEvidence=(e:EvidenceMeta,r:any)=>({...e,status:r.known_units===0?'insufficient_evidence':r.known_units!=null&&r.known_units<r.count?'provisional':e.status,notes:r.known_units!=null&&r.known_units<r.count?['Unit total is partial; some project records have unknown units.']:e.notes}) as EvidenceMeta;
  const planningEvidence=futureEvidence('planning_plans',Number(planning.count||0),planning.observed_at);
  const infrastructureEvidence=futureEvidence('infrastructure_projects',Number(infrastructure.count||0),infrastructure.observed_at);
  const mappingSupported=mappings.length>0&&mappings.every((m:any)=>Boolean(m.analytics_safe));
  const mappingEvidence:EvidenceMeta={status:mappingSupported?'supported':mappings.length?'provisional':'insufficient_evidence',confidence:mappings.length?Math.min(...mappings.map((m:any)=>normalizeConfidence(m.mapping_confidence)??0)):null,sampleSize:mappings.length,observedAt:mappings[0]?.mapped_at??null,modelVersion:mappings[0]?.mapping_version??'geo-crosswalk-v1',sourceIds:[...new Set<string>(mappings.map((m:any)=>m.mapping_method==='official_crosswalk'?'cbs':'curated_crosswalk'))],notes:mappingSupported?[]:['At least one statistical-area mapping is not yet analytics-safe.']};
  const year=cbs?.observation_year?String(cbs.observation_year):null;
  return {
    neighborhoodId,slug,name,city,marketFreshness:freshness??null,
    market:[
      metric('median_price_sqm_12m','Median closed-sale price per m²',numberOrNull(summary?.median_price_sqm_12m),'NIS/m²','12m',marketEvidence),
      metric('price_change_1y','Closed-sale price change',numberOrNull(summary?.price_change_1y),'%','1y',marketEvidence),
      metric('transaction_count_12m','Closed transactions',numberOrNull(summary?.transaction_count_12m),'count','12m',marketEvidence),
      metric('estimated_gross_yield','Estimated gross yield',numberOrNull(summary?.estimated_gross_yield),'%',null,marketEvidence)
    ],
    population:[
      metric('population','Population',numberOrNull(cbs?.population),'people',year,cbsEvidence),
      metric('population_growth_from_2022_pct','Population growth from 2022',numberOrNull(cbs?.population_growth_from_2022_pct),'%',year,cbsEvidence)
    ],
    socioeconomic:[
      metric('employment_pct','Employment rate',numberOrNull(cbs?.employment_pct),'%',year,cbsEvidence),
      metric('median_annual_employee_wage','Median annual employee wage',numberOrNull(cbs?.median_annual_employee_wage),'NIS/year',year,cbsEvidence)
    ],
    education:[metric('academic_certificate_pct','Academic certificate',numberOrNull(cbs?.academic_certificate_pct),'%',year,cbsEvidence)],
    housing:[
      metric('average_household_size','Average household size',numberOrNull(cbs?.average_household_size),'people',year,cbsEvidence),
      metric('owner_households_pct','Owner households',numberOrNull(cbs?.owner_households_pct),'%',year,cbsEvidence),
      metric('renter_households_pct','Renter households',numberOrNull(cbs?.renter_households_pct),'%',year,cbsEvidence)
    ],
    renewal:[
      metric('renewal_project_count','Renewal projects',Number(renewal.count||0),'count',null,renewalEvidence),
      metric('renewal_planned_units','Planned renewal units',numberOrNull(renewal.planned_units),'units',null,unitsEvidence(renewalEvidence,renewal))
    ],
    planning:[
      metric('planning_plan_count','Planning plans',Number(planning.count||0),'count',null,planningEvidence),
      metric('planning_housing_units','Housing units in plans',numberOrNull(planning.housing_units),'units',null,unitsEvidence(planningEvidence,planning))
    ],
    infrastructure:[metric('infrastructure_project_count','Infrastructure projects',Number(infrastructure.count||0),'count',null,infrastructureEvidence)],
    mapping:{statisticalAreas:mappings.map((m:any)=>({code:String(m.stat_area_code),year:m.boundary_year==null?null:Number(m.boundary_year),weight:m.overlap_ratio==null?null:Number(m.overlap_ratio),method:String(m.mapping_method),confidence:normalizeConfidence(m.mapping_confidence),analyticsSafe:Boolean(m.analytics_safe),sourceEvidence:m.source_evidence??null})),evidence:mappingEvidence}
  };
}

export async function getAreaContext(neighborhoodId:string){
  if(!neighborhoodId)return null;
  const [summaryRows,cbsRows,identityRows,mappings,renewalRows,planningRows,infrastructureRows,currentMarkets]=await Promise.all([
    queryDatabase("select * from semantic_neighborhood_summary where neighborhood_id=$1::uuid",[neighborhoodId]),
    queryDatabase("select * from semantic_neighborhood_cbs_profile where neighborhood_id=$1::uuid order by observation_year desc limit 1",[neighborhoodId]),
    queryDatabase("select n.id::text neighborhood_id,n.slug,n.name_he,c.name_he city_name from neighborhoods n join cities c on c.id=n.city_id where n.id=$1::uuid",[neighborhoodId]),
    queryDatabase("select s.stat_area_code,s.year boundary_year,m.overlap_ratio::float8,m.mapping_method,m.mapping_confidence::float8,m.mapping_version,m.mapped_at,m.source_evidence,(m.mapping_method='official_crosswalk' and m.mapping_confidence>=.9) analytics_safe from neighborhood_stat_area_map m join statistical_areas s on s.id=m.stat_area_id where m.neighborhood_id=$1::uuid order by m.mapping_confidence desc,s.stat_area_code",[neighborhoodId]),
    queryDatabase("select count(*)::int count,sum(planned_units)::float8 planned_units,count(planned_units)::int known_units,max(observed_at) observed_at from renewal_projects where neighborhood_id=$1::uuid",[neighborhoodId]),
    queryDatabase("select count(*)::int count,sum(housing_units)::float8 housing_units,count(housing_units)::int known_units,max(observed_at) observed_at from planning_plans where neighborhood_id=$1::uuid",[neighborhoodId]),
    queryDatabase("select count(*)::int count,max(observed_at) observed_at from infrastructure_projects where neighborhood_id=$1::uuid",[neighborhoodId]),
    getCurrentAreaMarkets([neighborhoodId])
  ]);
  return buildAreaIntelligenceFromRows({summary:reconcileAreaMarket(summaryRows[0]??{neighborhood_id:neighborhoodId},currentMarkets[0]),cbs:cbsRows[0]??null,identity:identityRows[0]??null,mappings,renewal:renewalRows[0]??{},planning:planningRows[0]??{},infrastructure:infrastructureRows[0]??{}});
}
