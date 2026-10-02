import type {VercelRequest,VercelResponse} from '@vercel/node';
import {queryDatabase} from '../db.js';
import {refreshAreaIntelligence} from '../areaIntelligence.js';

const tileLayers:Record<string,string>={
  deal_heat:'c.deal_heat',area_score:'c.area_score',price_sqm:'c.median_price_sqm_12m',
  price_growth:'c.price_change_1y',renewal:'c.renewal_expansion_ratio',
  population_growth:'c.population_growth_22_24',yield:'c.estimated_gross_yield'
};
const sections=new Set(['summary','market','deals','renewal','demographics','infrastructure','evidence']);
const components=['deal','market','renewal','demographics','rental','infrastructure','supply'];

function authorized(req:VercelRequest){
  if(process.env.VERCEL_ENV==='preview') return true;
  const secret=process.env.CRON_SECRET;
  return Boolean(secret&&req.headers.authorization===`Bearer ${secret}`);
}
function validWeights(weights:any){
  if(!weights||typeof weights!=='object')return false;
  const keys=Object.keys(weights); if(keys.some(k=>!components.includes(k)))return false;
  const values=components.map(k=>Number(weights[k]??0));
  return values.every(v=>Number.isFinite(v)&&v>=0)&&Math.abs(values.reduce((a,b)=>a+b,0)-100)<.001;
}

async function tile(req:VercelRequest,res:VercelResponse){
  const z=Number(req.query.z),x=Number(req.query.x),y=Number(req.query.y),layer=String(req.query.layer||'deal_heat');
  if(!Number.isInteger(z)||!Number.isInteger(x)||!Number.isInteger(y)||z<0||z>18||x<0||y<0)
    return res.status(400).json({error:'invalid_tile'});
  const value=tileLayers[layer]; if(!value)return res.status(400).json({error:'invalid_layer',allowed:Object.keys(tileLayers)});
  const rows=await queryDatabase(`
    WITH bounds AS(SELECT ST_TileEnvelope($1,$2,$3) geom), features AS(
      SELECT a.id::text id,a.locality_code,a.statistical_area_code,a.locality_name,
        ${value}::float8 value,c.deal_heat::float8,c.area_score::float8,c.confidence_score::float8,
        c.confidence_level,c.coverage_pct::float8,c.deal_count,c.transaction_count_12m,
        c.median_price_sqm_12m::float8,c.price_change_1y::float8,
        ST_AsMVTGeom(ST_Transform(a.geom,3857),b.geom,4096,64,true) geom
      FROM area_dimensions a JOIN area_map_cache c ON c.area_id=a.id CROSS JOIN bounds b
      WHERE a.geom IS NOT NULL AND ST_Intersects(ST_Transform(a.geom,3857),b.geom) AND ${value} IS NOT NULL
    ) SELECT ST_AsMVT(features,'areas',4096,'geom','id') tile FROM features
  `,[z,x,y]);
  const raw=rows[0]?.tile;
  const body=Buffer.isBuffer(raw)?raw:raw instanceof Uint8Array?Buffer.from(raw):
    typeof raw==='string'?Buffer.from(raw.replace(/^\\x/,''),'hex'):Buffer.alloc(0);
  res.setHeader('Content-Type','application/vnd.mapbox-vector-tile');
  res.setHeader('Cache-Control','public, s-maxage=300, stale-while-revalidate=3600');
  return res.status(200).send(body);
}

async function dashboard(req:VercelRequest,res:VercelResponse){
  const areaId=String(req.query.areaId||''),section=String(req.query.section||'summary');
  if(!/^[0-9a-f-]{36}$/i.test(areaId))return res.status(400).json({error:'invalid_area_id'});
  if(!sections.has(section))return res.status(400).json({error:'invalid_section',allowed:[...sections]});
  let data:any;
  if(section==='summary'){
    const [area,metrics]=await Promise.all([
      queryDatabase(`SELECT a.id::text area_id,a.locality_code,a.statistical_area_code,a.boundary_year,a.locality_name,
       ST_Y(a.centroid)::float8 lat,ST_X(a.centroid)::float8 lon,c.*
       FROM area_dimensions a LEFT JOIN area_map_cache c ON c.area_id=a.id WHERE a.id=$1`,[areaId]),
      queryDatabase(`SELECT DISTINCT ON(metric_key) metric_key,numeric_value::float8,text_value,sample_count,
       confidence::float8,as_of_date,source_evidence,calculated_at
       FROM area_metric_snapshots WHERE area_id=$1 ORDER BY metric_key,as_of_date DESC,calculated_at DESC`,[areaId])
    ]);
    data={area:area[0]||null,metrics};
  }else if(section==='market'){
    data=await queryDatabase(`SELECT t.id::text,t.deal_date,t.amount_nis::float8,t.area_sqm::float8,t.rooms::float8,
      t.pp_sqm::float8,t.nature,m.mapping_confidence::float8,m.mapping_method
      FROM transaction_area_map m JOIN transactions t ON t.id=m.transaction_id
      WHERE m.area_id=$1 AND t.deal_date>=current_date-interval '36 months'
      ORDER BY t.deal_date DESC LIMIT 500`,[areaId]);
  }else if(section==='deals'){
    data=await queryDatabase(`WITH latest_snap AS(
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
    LEFT JOIN latest_snap s ON s.listing_id=l.id LEFT JOIN latest_score sc ON sc.entity_id=l.id
    WHERE m.area_id=$1 ORDER BY (l.status='active') DESC,sc.score DESC NULLS LAST,l.last_seen_at DESC LIMIT 250`,[areaId]);
  }else if(section==='renewal'){
    data=await queryDatabase(`SELECT r.id::text,r.project_name,r.developer,r.plan_number,r.route,r.status,r.stage,
      r.existing_units,r.planned_units,r.additional_units,r.in_execution,r.planning_certainty::float8,r.source_url,
      r.observed_at,m.overlap_ratio::float8
      FROM renewal_area_map m JOIN renewal_projects r ON r.id=m.project_id WHERE m.area_id=$1
      ORDER BY r.in_execution DESC,r.planning_certainty DESC NULLS LAST,r.observed_at DESC`,[areaId]);
  }else if(section==='demographics'){
    data=await queryDatabase(`SELECT d.period_year,d.population,d.households,d.avg_household_income_nis::float8,
      d.academic_pct::float8,d.socio_economic_cluster::float8,d.population_growth_pct::float8,
      d.age_distribution,d.household_composition,d.observed_at
      FROM area_dimensions a JOIN demographic_snapshots d ON d.stat_area_id=a.stat_area_id
      WHERE a.id=$1 ORDER BY d.period_year`,[areaId]);
  }else if(section==='infrastructure'){
    data=await queryDatabase(`SELECT i.id::text,i.name,i.category,i.status,i.expected_completion,i.description,
      i.source_url,i.observed_at,m.distance_m::float8 FROM infrastructure_area_map m
      JOIN infrastructure_projects i ON i.id=m.project_id
      WHERE m.area_id=$1 AND m.distance_m<=3000 ORDER BY m.distance_m,i.name LIMIT 250`,[areaId]);
  }else{
    data=await queryDatabase(`SELECT m.metric_key,d.label,d.component,d.unit,m.numeric_value::float8,m.text_value,
      m.sample_count,m.confidence::float8,m.as_of_date,m.source_evidence,m.calculated_at
      FROM area_metric_snapshots m JOIN area_metric_definitions d USING(metric_key)
      WHERE m.area_id=$1 ORDER BY m.metric_key,m.as_of_date DESC,m.calculated_at DESC`,[areaId]);
  }
  res.setHeader('Cache-Control',section==='deals'?'s-maxage=60, stale-while-revalidate=300':'s-maxage=300, stale-while-revalidate=1800');
  return res.status(200).json({mode:'live',section,areaId,data});
}

async function models(req:VercelRequest,res:VercelResponse){
  if(req.method==='GET'){
    const rows=await queryDatabase(`SELECT version,name,is_active,weights,parameters,created_at,activated_at
      FROM area_score_models ORDER BY is_active DESC,created_at DESC`);
    return res.status(200).json({models:rows});
  }
  if(req.method!=='POST')return res.status(405).json({error:'method_not_allowed'});
  if(!authorized(req))return res.status(401).json({error:'unauthorized'});
  const body=typeof req.body==='string'?JSON.parse(req.body):req.body||{};
  if(body.action==='activate'){
    const version=String(body.version||'');
    const exists=await queryDatabase('SELECT 1 FROM area_score_models WHERE version=$1',[version]);
    if(!exists.length)return res.status(404).json({error:'unknown_version'});
    await queryDatabase('UPDATE area_score_models SET is_active=false WHERE is_active=true');
    await queryDatabase('UPDATE area_score_models SET is_active=true,activated_at=now() WHERE version=$1',[version]);
    return res.status(200).json({ok:true,active:version});
  }
  if(body.action==='create'){
    const version=String(body.version||'').trim(),name=String(body.name||version).trim();
    if(!/^[a-z0-9][a-z0-9._-]{2,80}$/i.test(version))return res.status(400).json({error:'invalid_version'});
    if(!validWeights(body.weights))return res.status(400).json({error:'weights_must_total_100'});
    await queryDatabase(`INSERT INTO area_score_models(version,name,is_active,weights,parameters)
      VALUES($1,$2,false,$3::jsonb,$4::jsonb)`,
      [version,name,JSON.stringify(body.weights),JSON.stringify(body.parameters||{})]);
    return res.status(201).json({ok:true,version});
  }
  return res.status(400).json({error:'unsupported_action'});
}

export default async function handler(req:VercelRequest,res:VercelResponse){
  try{
    const mode=String(req.query.mode||req.body?.mode||'');
    if(mode==='area-tiles'&&req.method==='GET')return await tile(req,res);
    if(mode==='area-dashboard'&&req.method==='GET')return await dashboard(req,res);
    if(mode==='area-score-model')return await models(req,res);
    if(mode==='area-refresh'){
      if(!['GET','POST'].includes(req.method||''))return res.status(405).json({error:'method_not_allowed'});
      if(!authorized(req))return res.status(401).json({error:'unauthorized'});
      return res.status(200).json({ok:true,...await refreshAreaIntelligence()});
    }
    return res.status(400).json({error:'unsupported_area_mode'});
  }catch(error){return res.status(503).json({mode:'unavailable',error:String(error)});}
}
