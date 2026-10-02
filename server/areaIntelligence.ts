import {queryDatabase} from './db.js';
import {bayesianAdjust,confidenceLevel,percentileRank,weightedAreaScore,type ScoreModel,type ScoreWeights} from './areaScoring.js';

const TODAY=()=>new Date().toISOString().slice(0,10);

export async function getActiveAreaScoreModel():Promise<ScoreModel>{
  const rows=await queryDatabase(`
    SELECT version,weights,parameters
    FROM area_score_models WHERE is_active=true
    ORDER BY activated_at DESC NULLS LAST,created_at DESC LIMIT 1
  `);
  if(!rows.length)throw new Error('No active area score model');
  return rows[0] as ScoreModel;
}

async function upsertAreaDimensions(){
  const rows=await queryDatabase(`
    INSERT INTO area_dimensions(stat_area_id,locality_code,statistical_area_code,boundary_year,locality_name,city_id,geom,centroid,updated_at)
    SELECT s.id,COALESCE(NULLIF(c.settlement_code,''),c.id::text),s.stat_area_code,COALESCE(s.year,2022),
           c.name_he,c.id,s.geom,
           CASE WHEN s.geom IS NULL THEN NULL ELSE ST_PointOnSurface(s.geom) END,now()
    FROM statistical_areas s
    LEFT JOIN cities c ON c.id=s.city_id
    WHERE COALESCE(s.year,2022)=2022
    ON CONFLICT(locality_code,statistical_area_code,boundary_year) DO UPDATE SET
      stat_area_id=EXCLUDED.stat_area_id,locality_name=EXCLUDED.locality_name,city_id=EXCLUDED.city_id,
      geom=EXCLUDED.geom,centroid=EXCLUDED.centroid,updated_at=now()
    RETURNING id
  `);
  return rows.length;
}

async function refreshMappings(){
  const counts={transactions:0,listings:0,renewal:0,infrastructure:0};
  let rows=await queryDatabase(`
    INSERT INTO transaction_area_map(transaction_id,area_id,mapping_method,mapping_confidence,mapped_at)
    SELECT t.id,a.id,'parcel_stat_area',1,now()
    FROM transactions t
    JOIN parcels p ON p.id=t.parcel_id
    JOIN area_dimensions a ON a.stat_area_id=p.stat_area_id
    ON CONFLICT(transaction_id) DO UPDATE SET
      area_id=EXCLUDED.area_id,mapping_method=EXCLUDED.mapping_method,
      mapping_confidence=EXCLUDED.mapping_confidence,mapped_at=now()
    RETURNING transaction_id
  `);
  counts.transactions+=rows.length;

  rows=await queryDatabase(`
    INSERT INTO transaction_area_map(transaction_id,area_id,mapping_method,mapping_confidence,mapped_at)
    SELECT DISTINCT ON(t.id) t.id,a.id,'parcel_intersection',.95,now()
    FROM transactions t
    JOIN parcels p ON p.id=t.parcel_id AND p.geom IS NOT NULL
    JOIN area_dimensions a ON a.geom IS NOT NULL AND ST_Intersects(a.geom,ST_PointOnSurface(p.geom))
    LEFT JOIN transaction_area_map m ON m.transaction_id=t.id
    WHERE m.transaction_id IS NULL
    ORDER BY t.id,a.id
    ON CONFLICT(transaction_id) DO NOTHING
    RETURNING transaction_id
  `);
  counts.transactions+=rows.length;

  rows=await queryDatabase(`
    WITH listing_points AS(
      SELECT l.id,COALESCE(b.geom,pb.geom) geom,
             CASE WHEN b.geom IS NOT NULL THEN 'building_point' ELSE 'parcel_intersection' END method
      FROM listings l
      LEFT JOIN buildings b ON b.id=l.building_id
      LEFT JOIN properties pr ON pr.id=l.property_id
      LEFT JOIN buildings pb ON pb.id=pr.building_id
      WHERE COALESCE(b.geom,pb.geom) IS NOT NULL
    )
    INSERT INTO listing_area_map(listing_id,area_id,mapping_method,mapping_confidence,mapped_at)
    SELECT DISTINCT ON(lp.id) lp.id,a.id,lp.method,
      CASE WHEN lp.method='building_point' THEN .98 ELSE .95 END,now()
    FROM listing_points lp
    JOIN area_dimensions a ON a.geom IS NOT NULL AND ST_Intersects(a.geom,lp.geom)
    ORDER BY lp.id,a.id
    ON CONFLICT(listing_id) DO UPDATE SET
      area_id=EXCLUDED.area_id,mapping_method=EXCLUDED.mapping_method,
      mapping_confidence=EXCLUDED.mapping_confidence,mapped_at=now()
    RETURNING listing_id
  `);
  counts.listings=rows.length;

  rows=await queryDatabase(`
    INSERT INTO renewal_area_map(project_id,area_id,overlap_ratio,mapped_at)
    SELECT r.id,a.id,
      CASE WHEN ST_Area(r.geom::geography)>0
        THEN ST_Area(ST_Intersection(r.geom,a.geom)::geography)/ST_Area(r.geom::geography) END,
      now()
    FROM renewal_projects r
    JOIN area_dimensions a ON r.geom IS NOT NULL AND a.geom IS NOT NULL AND ST_Intersects(r.geom,a.geom)
    ON CONFLICT(project_id,area_id) DO UPDATE SET overlap_ratio=EXCLUDED.overlap_ratio,mapped_at=now()
    RETURNING project_id
  `);
  counts.renewal=rows.length;

  rows=await queryDatabase(`
    INSERT INTO infrastructure_area_map(project_id,area_id,distance_m,mapped_at)
    SELECT i.id,a.id,ST_Distance(i.geom::geography,a.geom::geography),now()
    FROM infrastructure_projects i
    JOIN area_dimensions a ON i.geom IS NOT NULL AND a.geom IS NOT NULL
      AND ST_DWithin(i.geom::geography,a.geom::geography,3000)
    ON CONFLICT(project_id,area_id) DO UPDATE SET distance_m=EXCLUDED.distance_m,mapped_at=now()
    RETURNING project_id
  `);
  counts.infrastructure=rows.length;
  return counts;
}

async function metric(metricKey:string,selectSql:string){
  return queryDatabase(`
    INSERT INTO area_metric_snapshots(area_id,as_of_date,metric_key,numeric_value,sample_count,confidence,source_evidence)
    ${selectSql}
    ON CONFLICT(area_id,as_of_date,metric_key) DO UPDATE SET
      numeric_value=EXCLUDED.numeric_value,sample_count=EXCLUDED.sample_count,
      confidence=EXCLUDED.confidence,source_evidence=EXCLUDED.source_evidence,calculated_at=now()
    RETURNING id
  `);
}

async function refreshMetrics(model:ScoreModel){
  const asOf=TODAY();
  let updated=0;

  updated+=(await metric('transaction_count_12m',`
    SELECT m.area_id,'${asOf}'::date,'transaction_count_12m',count(*)::numeric,count(*)::int,
      LEAST(1,count(*)::numeric/20),jsonb_build_object('source','transactions','window','12 months')
    FROM transaction_area_map m JOIN transactions t ON t.id=m.transaction_id
    WHERE t.deal_date>=current_date-interval '12 months'
    GROUP BY m.area_id
  `)).length;

  updated+=(await metric('median_price_sqm_12m',`
    SELECT m.area_id,'${asOf}'::date,'median_price_sqm_12m',
      percentile_cont(.5) WITHIN GROUP(ORDER BY t.pp_sqm),count(*)::int,
      LEAST(1,count(*)::numeric/20),jsonb_build_object('source','transactions','window','12 months')
    FROM transaction_area_map m JOIN transactions t ON t.id=m.transaction_id
    WHERE t.deal_date>=current_date-interval '12 months' AND t.pp_sqm>0
    GROUP BY m.area_id
  `)).length;

  updated+=(await metric('price_change_1y',`
    WITH x AS(
      SELECT m.area_id,
       percentile_cont(.5) WITHIN GROUP(ORDER BY t.pp_sqm) FILTER(WHERE t.deal_date>=current_date-interval '12 months') p1,
       percentile_cont(.5) WITHIN GROUP(ORDER BY t.pp_sqm) FILTER(WHERE t.deal_date>=current_date-interval '24 months' AND t.deal_date<current_date-interval '12 months') p0,
       count(*) FILTER(WHERE t.deal_date>=current_date-interval '12 months')::int n
      FROM transaction_area_map m JOIN transactions t ON t.id=m.transaction_id
      WHERE t.pp_sqm>0 AND t.deal_date>=current_date-interval '24 months'
      GROUP BY m.area_id
    )
    SELECT area_id,'${asOf}'::date,'price_change_1y',
      CASE WHEN p0>0 THEN 100*(p1/p0-1) END,n,LEAST(1,n::numeric/20),
      jsonb_build_object('source','transactions','current_median',p1,'prior_median',p0)
    FROM x WHERE p1 IS NOT NULL AND p0 IS NOT NULL
  `)).length;

  updated+=(await metric('renewal_expansion_ratio',`
    WITH x AS(
      SELECT m.area_id,
        sum(COALESCE(r.planned_units,0)*COALESCE(NULLIF(m.overlap_ratio,0),1)) planned,
        sum(COALESCE(r.existing_units,0)*COALESCE(NULLIF(m.overlap_ratio,0),1)) existing,
        count(*)::int n
      FROM renewal_area_map m JOIN renewal_projects r ON r.id=m.project_id GROUP BY m.area_id
    )
    SELECT area_id,'${asOf}'::date,'renewal_expansion_ratio',
      CASE WHEN existing>0 THEN planned/existing END,n,
      CASE WHEN n>=3 THEN .9 WHEN n>=1 THEN .7 ELSE .3 END,
      jsonb_build_object('source','renewal_projects','projects',n)
    FROM x WHERE existing>0
  `)).length;

  updated+=(await metric('population_growth_22_24',`
    WITH x AS(
      SELECT a.id area_id,
       max(d.population) FILTER(WHERE d.period_year=2022) p22,
       max(d.population) FILTER(WHERE d.period_year=2024) p24
      FROM area_dimensions a
      JOIN demographic_snapshots d ON d.stat_area_id=a.stat_area_id
      GROUP BY a.id
    )
    SELECT area_id,'${asOf}'::date,'population_growth_22_24',
      CASE WHEN p22>0 THEN 100*(p24::numeric/p22-1) END,2,.9,
      jsonb_build_object('source','demographic_snapshots','from',2022,'to',2024)
    FROM x WHERE p22>0 AND p24 IS NOT NULL
  `)).length;

  updated+=(await metric('infrastructure_access',`
    SELECT area_id,'${asOf}'::date,'infrastructure_access',
      max(CASE WHEN distance_m<=500 THEN 100 WHEN distance_m<=1000 THEN 80 WHEN distance_m<=2000 THEN 55 ELSE 30 END),
      count(*)::int,.8,jsonb_build_object('source','infrastructure_projects','radius_m',3000)
    FROM infrastructure_area_map GROUP BY area_id
  `)).length;

  const k=Number(model.parameters.bayesian_k??5);
  const deals=await queryDatabase(`
    WITH latest_score AS(
      SELECT DISTINCT ON(entity_id) entity_id,score,comp_confidence_score
      FROM opportunity_scores WHERE entity_type='listing'
      ORDER BY entity_id,calculated_at DESC
    ), weighted AS(
      SELECT lm.area_id,a.city_id,ls.score,
       CASE
        WHEN current_date-l.first_seen_at::date<=7 THEN 1.0
        WHEN current_date-l.first_seen_at::date<=14 THEN .9
        WHEN current_date-l.first_seen_at::date<=30 THEN .75
        WHEN current_date-l.first_seen_at::date<=60 THEN .5 ELSE 0 END freshness,
       GREATEST(.25,LEAST(1,COALESCE(ls.comp_confidence_score,50)/100.0)) confidence_weight
      FROM listing_area_map lm
      JOIN area_dimensions a ON a.id=lm.area_id
      JOIN listings l ON l.id=lm.listing_id AND l.status='active'
      JOIN latest_score ls ON ls.entity_id=l.id
    ), area_agg AS(
      SELECT area_id,city_id,
       sum(score*freshness*confidence_weight)/NULLIF(sum(freshness*confidence_weight),0) raw_score,
       count(*) FILTER(WHERE freshness>0)::int n
      FROM weighted WHERE freshness>0 GROUP BY area_id,city_id
    ), city_agg AS(
      SELECT city_id,
       sum(score*freshness*confidence_weight)/NULLIF(sum(freshness*confidence_weight),0) prior_score
      FROM weighted WHERE freshness>0 GROUP BY city_id
    )
    SELECT a.area_id,a.raw_score,a.n,c.prior_score
    FROM area_agg a LEFT JOIN city_agg c USING(city_id)
  `);
  for(const row of deals){
    const adjusted=bayesianAdjust(Number(row.raw_score),Number(row.n),row.prior_score==null?null:Number(row.prior_score),k);
    await queryDatabase(`
      INSERT INTO area_metric_snapshots(area_id,as_of_date,metric_key,numeric_value,sample_count,confidence,source_evidence)
      VALUES($1,$2::date,'deal_score_adjusted',$3,$4,LEAST(1,$4::numeric/10),
        jsonb_build_object('raw_score',$5::numeric,'city_prior',$6::numeric,'bayesian_k',$7::numeric))
      ON CONFLICT(area_id,as_of_date,metric_key) DO UPDATE SET
        numeric_value=EXCLUDED.numeric_value,sample_count=EXCLUDED.sample_count,
        confidence=EXCLUDED.confidence,source_evidence=EXCLUDED.source_evidence,calculated_at=now()
    `,[row.area_id,asOf,adjusted,row.n,row.raw_score,row.prior_score,k]);
    updated++;
  }
  return updated;
}

async function scoreAreas(model:ScoreModel){
  const rows=await queryDatabase(`
    WITH latest AS(
      SELECT DISTINCT ON(m.area_id,m.metric_key)
        m.area_id,m.metric_key,m.numeric_value,m.sample_count,m.confidence
      FROM area_metric_snapshots m ORDER BY m.area_id,m.metric_key,m.as_of_date DESC,m.calculated_at DESC
    )
    SELECT a.id area_id,a.city_id,
      jsonb_object_agg(l.metric_key,jsonb_build_object('value',l.numeric_value,'sample_count',l.sample_count,'confidence',l.confidence))
        FILTER(WHERE l.metric_key IS NOT NULL) metrics
    FROM area_dimensions a LEFT JOIN latest l ON l.area_id=a.id
    GROUP BY a.id,a.city_id
  `);
  const metricKeys=['price_change_1y','renewal_expansion_ratio','population_growth_22_24','estimated_gross_yield','infrastructure_access'];
  const peers=new Map<string,Map<string,number[]>>();
  for(const row of rows){
    const city=String(row.city_id??'national'),metrics=row.metrics||{};
    if(!peers.has(city))peers.set(city,new Map());
    for(const key of metricKeys){
      const v=metrics[key]?.value;
      if(v==null)continue;
      const map=peers.get(city)!; if(!map.has(key))map.set(key,[]); map.get(key)!.push(Number(v));
    }
  }
  let processed=0;
  for(const row of rows){
    const metrics=row.metrics||{},city=String(row.city_id??'national'),peer=peers.get(city)||new Map();
    const pct=(key:string)=>metrics[key]?.value==null?null:percentileRank(peer.get(key)||[],Number(metrics[key].value));
    const components:any={
      deal:metrics.deal_score_adjusted?.value==null?null:Number(metrics.deal_score_adjusted.value),
      market:pct('price_change_1y'),
      renewal:pct('renewal_expansion_ratio'),
      demographics:pct('population_growth_22_24'),
      rental:pct('estimated_gross_yield'),
      infrastructure:pct('infrastructure_access'),
      supply:null
    };
    const area=weightedAreaScore(components,model.weights as ScoreWeights,Number(model.parameters.minimum_component_coverage_pct??60));
    const evidence=Object.values(metrics) as any[];
    const confidenceScore=evidence.length
      ?100*evidence.reduce((s,m)=>s+Number(m.confidence??0),0)/evidence.length
      :0;
    const level=confidenceLevel(confidenceScore,model.parameters.confidence);
    const dealRaw=metrics.deal_score_adjusted?.source_evidence?.raw_score??null;
    const dealAdjusted=components.deal;
    await queryDatabase(`
      INSERT INTO area_score_snapshots(area_id,score_version,deal_score_raw,deal_score_adjusted,area_score,
        confidence_score,confidence_level,coverage_pct,component_scores,inputs)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb)
    `,[row.area_id,model.version,dealRaw,dealAdjusted,area.score,confidenceScore,level,area.coveragePct,JSON.stringify(area.components),JSON.stringify({metrics})]);
    await queryDatabase(`
      INSERT INTO area_map_cache(area_id,score_version,deal_heat,area_score,confidence_score,confidence_level,coverage_pct,
       deal_count,transaction_count_12m,median_price_sqm_12m,price_change_1y,population_growth_22_24,renewal_expansion_ratio,estimated_gross_yield,updated_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,now())
      ON CONFLICT(area_id) DO UPDATE SET
       score_version=EXCLUDED.score_version,deal_heat=EXCLUDED.deal_heat,area_score=EXCLUDED.area_score,
       confidence_score=EXCLUDED.confidence_score,confidence_level=EXCLUDED.confidence_level,coverage_pct=EXCLUDED.coverage_pct,
       deal_count=EXCLUDED.deal_count,transaction_count_12m=EXCLUDED.transaction_count_12m,
       median_price_sqm_12m=EXCLUDED.median_price_sqm_12m,price_change_1y=EXCLUDED.price_change_1y,
       population_growth_22_24=EXCLUDED.population_growth_22_24,renewal_expansion_ratio=EXCLUDED.renewal_expansion_ratio,
       estimated_gross_yield=EXCLUDED.estimated_gross_yield,updated_at=now()
    `,[
      row.area_id,model.version,dealAdjusted,area.score,confidenceScore,level,area.coveragePct,
      Number(metrics.deal_score_adjusted?.sample_count??0),Number(metrics.transaction_count_12m?.value??0),
      metrics.median_price_sqm_12m?.value??null,metrics.price_change_1y?.value??null,
      metrics.population_growth_22_24?.value??null,metrics.renewal_expansion_ratio?.value??null,
      metrics.estimated_gross_yield?.value??null
    ]);
    processed++;
  }
  return processed;
}

export async function refreshAreaIntelligence(){
  const model=await getActiveAreaScoreModel();
  const run=await queryDatabase('INSERT INTO area_refresh_runs(score_version) VALUES($1) RETURNING id',[model.version]);
  const runId=run[0].id;
  try{
    const dimensions=await upsertAreaDimensions();
    const mappings=await refreshMappings();
    const metrics=await refreshMetrics(model);
    const areas=await scoreAreas(model);
    const mapped=Object.values(mappings).reduce((a,b)=>a+b,0);
    await queryDatabase(`
      UPDATE area_refresh_runs SET finished_at=now(),status='success',areas_processed=$2,mappings_updated=$3,
        metrics_updated=$4,metadata=$5::jsonb WHERE id=$1
    `,[runId,areas,mapped,metrics,JSON.stringify({dimensions,mappings})]);
    return {runId,scoreVersion:model.version,dimensions,mappings,metrics,areas};
  }catch(error){
    await queryDatabase('UPDATE area_refresh_runs SET finished_at=now(),status=\'failed\',error=$2 WHERE id=$1',[runId,String(error)]);
    throw error;
  }
}
