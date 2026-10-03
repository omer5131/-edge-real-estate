import {queryDatabase} from './db.js';

export async function getAreaContext(neighborhoodId:string){
 const [summary]=await queryDatabase("select neighborhood_id::text,neighborhood_slug,neighborhood_name,city_name,transaction_count_12m,median_price_sqm_12m::float8,price_change_1y::float8,population_growth_22_24::float8,renewal_expansion_ratio::float8,estimated_gross_yield::float8,confidence_score::float8,confidence_level,coverage_pct::float8,updated_at from semantic_neighborhood_summary where neighborhood_id=$1::uuid",[neighborhoodId]);
 const [cbs]=await queryDatabase("select observation_year,population::float8,population_growth_from_2022_pct::float8,employment_pct::float8,academic_certificate_pct::float8,median_annual_employee_wage::float8,average_household_size::float8,owner_households_pct::float8,renter_households_pct::float8,median_age::float8,statistical_area_count,mapping_confidence::float8,profile_quality,safe_for_score,crosswalk_method,source_evidence,calculated_at from semantic_neighborhood_cbs_profile where neighborhood_id=$1::uuid order by observation_year desc limit 1",[neighborhoodId]);
 return {
  summary:summary||null,cbs:cbs||null,
  evidence:{status:cbs?.safe_for_score?'supported':cbs?'provisional':'insufficient_evidence',confidence:cbs?.mapping_confidence==null?null:Number(cbs.mapping_confidence),sampleSize:cbs?.statistical_area_count==null?null:Number(cbs.statistical_area_count),observedAt:cbs?.calculated_at||summary?.updated_at||null,modelVersion:'area-context-v1',sourceIds:['semantic_neighborhood_summary','semantic_neighborhood_cbs_profile'],notes:cbs&&!cbs.safe_for_score?['CBS neighborhood profile is provisional until the official neighborhood/statistical-area crosswalk is validated.']:[]}
 };
}
