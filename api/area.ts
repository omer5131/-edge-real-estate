import type {VercelRequest,VercelResponse} from '@vercel/node';
import {queryDatabase} from '../server/db.js';

const allowed=new Set(['summary','market','deals','renewal','demographics','infrastructure','evidence']);

async function summary(areaId:string){
  const [rows,metrics]=await Promise.all([
    queryDatabase(`
      SELECT a.id::text area_id,a.locality_code,a.statistical_area_code,a.boundary_year,a.locality_name,
       ST_Y(a.centroid)::float8 lat,ST_X(a.centroid)::float8 lon,
       c.score_version,c.deal_heat::float8,c.area_score::float8,c.confidence_score::float8,
       c.confidence_level,c.coverage_pct::float8,c.deal_count,c.transaction_count_12m,
       c.median_price_sqm_12m::float8,c.price_change_1y::float8,c.population_growth_22_24::float8,
       c.renewal_expansion_ratio::float8,c.estimated_gross_yield::float8,c.updated_at
      FROM area_dimensions a LEFT JOIN area_map_cache c ON c.area_id=a.id WHERE a.id=$1
    `,[areaId]),
    queryDatabase(`
      SELECT DISTINCT ON(metric_key) metric_key,numeric_value::float8,text_value,sample_count,
       confidence::float8,as_of_date,source_evidence,calculated_at
      FROM area_metric_snapshots WHERE area_id=$1
      ORDER BY metric_key,as_of_date DESC,calculated_at DESC
    `,[areaId])
  ]);
  return {area:rows[0]||null,metrics};
}

async function market(areaId:string){
 return queryDatabase(`
   SELECT t.id::text,t.deal_date,t.amount_nis::float8,t.area_sqm::float8,t.rooms::float8,t.pp_sqm::float8,
     t.nature,m.mapping_confidence::float8,m.mapping_method
   FROM transaction_area_map m JOIN transactions t ON t.id=m.transaction_id
   WHERE m.area_id=$1 AND t.deal_date>=current_date-interval '36 months'
   ORDER BY t.deal_date DESC LIMIT 500
 `,[areaId]);
}

async function deals(areaId:string){
 return queryDatabase(`
   WITH latest_snap AS(
    SELECT DISTINCT ON(listing_id) listing_id,asking_price_nis,area_sqm,rooms,floor,observed_at
    FROM listing_snapshots ORDER BY listing_id,observed_at DESC
   ), latest_score AS(
    SELECT DISTINCT ON(entity_id) entity_id,score,model_version,calculated_at
    FROM opportunity_scores WHERE entity_type='listing' ORDER BY entity_id,calculated_at DESC
   )
   SELECT l.id::text,l.canonical_address,l.url,l.first_seen_at,l.last_seen_at,l.status,
     s.asking_price_nis::float8,s.area_sqm::float8,s.rooms::float8,s.floor::float8,
     CASE WHEN s.area_sqm>0 THEN (s.asking_price_nis/s.area_sqm)::float8 END asking_price_sqm,
     sc.score::float8,sc.model_version,sc.calculated_at,m.mapping_confidence::float8,m.mapping_method
   FROM listing_area_map m JOIN listings l ON l.id=m.listing_id
   LEFT JOIN latest_snap s ON s.listing_id=l.id
   LEFT JOIN latest_score sc ON sc.entity_id=l.id
   WHERE m.area_id=$1
   ORDER BY (l.status='active') DESC,sc.score DESC NULLS LAST,l.last_seen_at DESC LIMIT 250
 `,[areaId]);
}

async function renewal(areaId:string){
 return queryDatabase(`
   SELECT r.id::text,r.project_name,r.developer,r.plan_number,r.route,r.status,r.stage,
     r.existing_units,r.planned_units,r.additional_units,r.in_execution,r.planning_certainty::float8,
     r.source_url,r.observed_at,m.overlap_ratio::float8
   FROM renewal_area_map m JOIN renewal_projects r ON r.id=m.project_id
   WHERE m.area_id=$1 ORDER BY r.in_execution DESC,r.planning_certainty DESC NULLS LAST,r.observed_at DESC
 `,[areaId]);
}

async function demographics(areaId:string){
 return queryDatabase(`
   SELECT d.period_year,d.population,d.households,d.avg_household_income_nis::float8,d.academic_pct::float8,
     d.socio_economic_cluster::float8,d.population_growth_pct::float8,d.age_distribution,d.household_composition,
     d.observed_at
   FROM area_dimensions a JOIN demographic_snapshots d ON d.stat_area_id=a.stat_area_id
   WHERE a.id=$1 ORDER BY d.period_year
 `,[areaId]);
}

async function infrastructure(areaId:string){
 return queryDatabase(`
   SELECT i.id::text,i.name,i.category,i.status,i.expected_completion,i.description,i.source_url,i.observed_at,
     m.distance_m::float8
   FROM infrastructure_area_map m JOIN infrastructure_projects i ON i.id=m.project_id
   WHERE m.area_id=$1 AND m.distance_m<=3000 ORDER BY m.distance_m,i.name LIMIT 250
 `,[areaId]);
}

async function evidence(areaId:string){
 return queryDatabase(`
   SELECT m.metric_key,d.label,d.component,d.unit,m.numeric_value::float8,m.text_value,m.sample_count,
     m.confidence::float8,m.as_of_date,m.source_evidence,m.calculated_at
   FROM area_metric_snapshots m JOIN area_metric_definitions d USING(metric_key)
   WHERE m.area_id=$1 ORDER BY m.metric_key,m.as_of_date DESC,m.calculated_at DESC
 `,[areaId]);
}

export default async function handler(req:VercelRequest,res:VercelResponse){
 if(req.method!=='GET')return res.status(405).json({error:'method_not_allowed'});
 const areaId=String(req.query.areaId||''),section=String(req.query.section||'summary');
 if(!/^[0-9a-f-]{36}$/i.test(areaId))return res.status(400).json({error:'invalid_area_id'});
 if(!allowed.has(section))return res.status(400).json({error:'invalid_section',allowed:[...allowed]});
 try{
   const result=section==='summary'?await summary(areaId):
    section==='market'?await market(areaId):
    section==='deals'?await deals(areaId):
    section==='renewal'?await renewal(areaId):
    section==='demographics'?await demographics(areaId):
    section==='infrastructure'?await infrastructure(areaId):
    await evidence(areaId);
   res.setHeader('Cache-Control',section==='deals'?'s-maxage=60, stale-while-revalidate=300':'s-maxage=300, stale-while-revalidate=1800');
   return res.status(200).json({mode:'live',section,areaId,data:result});
 }catch(error){return res.status(503).json({mode:'unavailable',error:String(error)});}
}
