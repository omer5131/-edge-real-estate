import {queryDatabase} from './db.js';
import type {PlanningContext} from './contracts/investmentContext.js';

export function buildPlanningContext(renewalProjects:any[],plans:any[],infrastructure:any[]):PlanningContext{
  const all=[...renewalProjects,...plans,...infrastructure];
  const includesResearch=all.some((x:any)=>x.source_id==='renewal_research');
  const sourceIds=[...new Set(all.map((x:any)=>String(x.source_id||'unknown')).filter(Boolean))];
  const observed=all.map((x:any)=>x.observed_at).filter(Boolean).sort().at(-1)??null;
  return {
    renewalProjects,
    plans,
    infrastructure,
    evidence:{
      status:all.length?(includesResearch?'provisional':'supported'):'insufficient_evidence',
      confidence:all.length && !includesResearch ? .82 : null,
      sampleSize:all.length,
      observedAt:observed,
      modelVersion:'planning-context-v1',
      sourceIds,
      notes:all.length?(includesResearch?['Includes attributed project research; developer claims and asset membership require verification.']:[]):['No renewal, statutory planning, or infrastructure evidence is currently mapped to this neighborhood.']
    }
  };
}

export async function getPlanningContext(neighborhoodId:string|null|undefined){
  if(!neighborhoodId)return buildPlanningContext([],[],[]);
  const [renewal,plans,infrastructure]=await Promise.all([
    queryDatabase("select id::text,source_id,source_project_id,project_name name,developer,plan_number,route,status,stage,existing_units,planned_units,additional_units,permits_count,in_execution,planning_certainty::float8,source_url official_url,map_url,observed_at from renewal_projects where neighborhood_id=$1::uuid order by in_execution desc,permits_count desc nulls last,observed_at desc limit 20",[neighborhoodId]),
    queryDatabase("select id::text,source_id,source_plan_id,plan_number,name,status,authority,approved_at,deposited_at,housing_units,source_url,observed_at from planning_plans where neighborhood_id=$1::uuid order by observed_at desc limit 30",[neighborhoodId]),
    queryDatabase("select id::text,source_id,source_project_id,name,category,status,expected_completion,description,source_url,observed_at from infrastructure_projects where neighborhood_id=$1::uuid order by observed_at desc limit 30",[neighborhoodId])
  ]);
  return buildPlanningContext(renewal,plans,infrastructure);
}
