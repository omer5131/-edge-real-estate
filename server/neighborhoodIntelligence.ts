import {queryDatabase} from './db.js';
import {bayesianAdjust,confidenceLevel,percentileRank,weightedAreaScore,type ScoreWeights} from './areaScoring.js';

const asOf=()=>new Date().toISOString().slice(0,10);

async function activeModel(){
 const rows=await queryDatabase(`SELECT version,weights,parameters FROM area_score_models WHERE is_active=true ORDER BY activated_at DESC NULLS LAST LIMIT 1`);
 if(!rows.length)throw new Error('No active score model');
 return rows[0];
}


async function hydrateSupportingGeography(){
 const out={statisticalAreas:0,parcels:0,parcelStatArea:0,evidenceCrosswalk:0,neighborhoodGeometries:0};

 let rows=await queryDatabase(`
  WITH src AS(
   SELECT locality_code,statistical_area_code,COALESCE(observation_year,2022)::int year,
    ST_GeomFromText(geometry_wkt) raw_geom
   FROM research_statistical_areas_2022
   WHERE geometry_wkt IS NOT NULL AND geometry_wkt<>'' AND locality_code IS NOT NULL AND statistical_area_code IS NOT NULL
  ), norm AS(
   SELECT locality_code,statistical_area_code,year,
    ST_Multi(ST_CollectionExtract(ST_MakeValid(
      CASE WHEN abs(ST_X(ST_Centroid(raw_geom)))>180 OR abs(ST_Y(ST_Centroid(raw_geom)))>90
           THEN ST_Transform(ST_SetSRID(raw_geom,2039),4326)
           ELSE ST_SetSRID(raw_geom,4326) END
    ),3)) geom
   FROM src
  )
  INSERT INTO statistical_areas(city_id,stat_area_code,year,geom,source_id,observed_at)
  SELECT c.id,n.statistical_area_code,n.year,n.geom,'cbs',now()
  FROM norm n JOIN cities c ON c.settlement_code=n.locality_code
  WHERE n.geom IS NOT NULL AND NOT ST_IsEmpty(n.geom)
  ON CONFLICT(city_id,stat_area_code,year) DO UPDATE SET geom=EXCLUDED.geom,observed_at=now()
  RETURNING id
 `);
 out.statisticalAreas=rows.length;

 rows=await queryDatabase(`
  WITH src AS(
   SELECT block::int gush,parcel::int helka,COALESCE(NULLIF("GUSH_SUFFI",''),'') suffix,
    NULLIF("LOCALITY_I",'') locality_code,ST_GeomFromText(geometry_wkt) raw_geom
   FROM research_parcels
   WHERE geometry_wkt IS NOT NULL AND geometry_wkt<>''
     AND block<>'' AND parcel<>'' AND block !~ '[^0-9]' AND parcel !~ '[^0-9]'
  ), norm AS(
   SELECT *,ST_Multi(ST_CollectionExtract(ST_MakeValid(
    CASE WHEN abs(ST_X(ST_Centroid(raw_geom)))>180 OR abs(ST_Y(ST_Centroid(raw_geom)))>90
         THEN ST_Transform(ST_SetSRID(raw_geom,2039),4326)
         ELSE ST_SetSRID(raw_geom,4326) END
   ),3)) geom FROM src
  )
  INSERT INTO parcels(city_id,gush,helka,suffix,centroid,geom,source_id,observed_at)
  SELECT c.id,n.gush,n.helka,n.suffix,ST_PointOnSurface(n.geom),n.geom,'over_gov',now()
  FROM norm n LEFT JOIN cities c ON c.settlement_code=regexp_replace(n.locality_code,'[.]0+','')
  WHERE n.geom IS NOT NULL AND NOT ST_IsEmpty(n.geom)
  ON CONFLICT(gush,helka,suffix) DO UPDATE SET
   city_id=COALESCE(parcels.city_id,EXCLUDED.city_id),centroid=EXCLUDED.centroid,geom=EXCLUDED.geom,observed_at=now()
  RETURNING id
 `);
 out.parcels=rows.length;

 rows=await queryDatabase(`
  UPDATE parcels p SET stat_area_id=s.id
  FROM statistical_areas s
  WHERE p.geom IS NOT NULL AND s.geom IS NOT NULL
    AND p.city_id=s.city_id
    AND (p.stat_area_id IS NULL OR p.stat_area_id<>s.id)
    AND ST_Intersects(s.geom,ST_PointOnSurface(p.geom))
  RETURNING p.id
 `);
 out.parcelStatArea=rows.length;

 rows=await queryDatabase(`
  WITH observed AS(
   SELECT DISTINCT b.neighborhood_id,s.id stat_area_id,1.0::numeric confidence
   FROM buildings b JOIN statistical_areas s ON s.city_id=b.city_id
   WHERE b.neighborhood_id IS NOT NULL AND b.geom IS NOT NULL AND s.geom IS NOT NULL AND ST_Intersects(s.geom,b.geom)
   UNION
   SELECT DISTINCT ct.neighborhood_id,p.stat_area_id,.95::numeric
   FROM comparable_transactions ct JOIN parcels p ON p.id=ct.parcel_id
   WHERE ct.neighborhood_id IS NOT NULL AND p.stat_area_id IS NOT NULL
   UNION
   SELECT DISTINCT r.neighborhood_id,s.id,.90::numeric
   FROM renewal_projects r JOIN statistical_areas s ON s.city_id=r.city_id
   WHERE r.neighborhood_id IS NOT NULL AND r.geom IS NOT NULL AND s.geom IS NOT NULL
     AND ST_Intersects(r.geom,s.geom)
     AND ST_Area(ST_Intersection(r.geom,s.geom)::geography)/NULLIF(ST_Area(s.geom::geography),0) >= .20
  )
  INSERT INTO neighborhood_stat_area_map(neighborhood_id,stat_area_id,overlap_ratio,mapping_method,mapping_confidence,mapped_at)
  SELECT neighborhood_id,stat_area_id,NULL,'verified',max(confidence),now()
  FROM observed GROUP BY neighborhood_id,stat_area_id
  ON CONFLICT(neighborhood_id,stat_area_id) DO UPDATE SET
   mapping_method='verified',mapping_confidence=GREATEST(neighborhood_stat_area_map.mapping_confidence,EXCLUDED.mapping_confidence),mapped_at=now()
  RETURNING neighborhood_id
 `);
 out.evidenceCrosswalk=rows.length;

 rows=await queryDatabase(`
  UPDATE neighborhoods n SET geom=x.geom
  FROM(
   SELECT m.neighborhood_id,ST_Multi(ST_Union(s.geom)) geom
   FROM neighborhood_stat_area_map m JOIN statistical_areas s ON s.id=m.stat_area_id
   WHERE s.geom IS NOT NULL GROUP BY m.neighborhood_id
  ) x
  WHERE n.id=x.neighborhood_id AND (n.geom IS NULL OR NOT ST_Equals(n.geom,x.geom))
  RETURNING n.id
 `);
 out.neighborhoodGeometries=rows.length;
 return out;
}

async function refreshCrosswalk(){
 const rows=await queryDatabase(`
   INSERT INTO neighborhood_stat_area_map(neighborhood_id,stat_area_id,overlap_ratio,mapping_method,mapping_confidence,mapped_at)
   SELECT n.id,s.id,
     ST_Area(ST_Intersection(n.geom,s.geom)::geography)/NULLIF(ST_Area(s.geom::geography),0),
     'polygon_overlap',
     CASE WHEN ST_Area(ST_Intersection(n.geom,s.geom)::geography)/NULLIF(ST_Area(s.geom::geography),0)>=.8 THEN .95 ELSE .7 END,
     now()
   FROM neighborhoods n
   JOIN statistical_areas s ON s.city_id=n.city_id
   WHERE n.geom IS NOT NULL AND s.geom IS NOT NULL AND ST_Intersects(n.geom,s.geom)
     AND ST_Area(ST_Intersection(n.geom,s.geom)::geography)/NULLIF(ST_Area(s.geom::geography),0)>=.25
   ON CONFLICT(neighborhood_id,stat_area_id) DO UPDATE SET
     overlap_ratio=EXCLUDED.overlap_ratio,mapping_method=EXCLUDED.mapping_method,
     mapping_confidence=EXCLUDED.mapping_confidence,mapped_at=now()
   RETURNING neighborhood_id
 `);
 return rows.length;
}

async function linkEvidence(){
 const counts:any={transactions:0,saleListings:0,rentListings:0,renewal:0,census:0,population2024:0,municipal:0};
 let rows=await queryDatabase(`
   INSERT INTO dataset_neighborhood_evidence(dataset_slug,source_record_id,neighborhood_id,source_grain,observation_date,mapping_method,mapping_confidence,payload)
   SELECT 'transactions',ct.id::text,
     COALESCE(ct.neighborhood_id,b.neighborhood_id,nsm.neighborhood_id),'transaction',ct.deal_date,
     CASE WHEN ct.neighborhood_id IS NOT NULL THEN 'canonical_neighborhood'
          WHEN b.neighborhood_id IS NOT NULL THEN 'property_building_neighborhood'
          ELSE 'parcel_stat_area_crosswalk' END,
     CASE WHEN ct.neighborhood_id IS NOT NULL THEN 1
          WHEN b.neighborhood_id IS NOT NULL THEN .95
          ELSE COALESCE(nsm.mapping_confidence,.8) END,
     jsonb_build_object('price_sqm',COALESCE(ct.normalized_pp_sqm,ct.pp_sqm),'deal_date',ct.deal_date,
       'resolution',CASE WHEN ct.neighborhood_id IS NOT NULL THEN 'direct'
                         WHEN b.neighborhood_id IS NOT NULL THEN 'property_building'
                         ELSE 'parcel_crosswalk' END)
   FROM comparable_transactions ct
   LEFT JOIN properties p ON p.id=ct.property_id
   LEFT JOIN buildings b ON b.id=p.building_id
   LEFT JOIN parcels par ON par.id=ct.parcel_id
   LEFT JOIN neighborhood_stat_area_map nsm ON nsm.stat_area_id=par.stat_area_id
   WHERE COALESCE(ct.neighborhood_id,b.neighborhood_id,nsm.neighborhood_id) IS NOT NULL
   ON CONFLICT(dataset_slug,source_record_id,neighborhood_id) DO UPDATE SET
     observation_date=EXCLUDED.observation_date,payload=EXCLUDED.payload,linked_at=now()
   RETURNING 1
 `); counts.transactions=rows.length;

 rows=await queryDatabase(`
   WITH latest AS(
     SELECT DISTINCT ON(listing_id) listing_id,observed_at,asking_price_nis,area_sqm,rooms,floor
     FROM listing_snapshots ORDER BY listing_id,observed_at DESC
   )
   INSERT INTO dataset_neighborhood_evidence(dataset_slug,source_record_id,neighborhood_id,source_grain,observation_date,mapping_method,mapping_confidence,payload)
   SELECT 'sale_listings',l.id::text,l.neighborhood_id,'listing',
     COALESCE(s.observed_at::date,l.last_seen_at::date),'canonical_neighborhood',1,
     jsonb_build_object('asking_price_nis',s.asking_price_nis,'area_sqm',s.area_sqm,'rooms',s.rooms,'floor',s.floor,
       'status',l.status,'first_seen_at',l.first_seen_at,'last_seen_at',l.last_seen_at)
   FROM listings l LEFT JOIN latest s ON s.listing_id=l.id
   WHERE l.neighborhood_id IS NOT NULL
   ON CONFLICT(dataset_slug,source_record_id,neighborhood_id) DO UPDATE SET
     observation_date=EXCLUDED.observation_date,payload=EXCLUDED.payload,linked_at=now()
   RETURNING 1
 `); counts.saleListings=rows.length;

 rows=await queryDatabase(`
   WITH latest AS(
     SELECT DISTINCT ON(rental_listing_id) rental_listing_id,observed_at,asking_rent_nis,area_sqm,rooms,floor
     FROM rental_listing_snapshots ORDER BY rental_listing_id,observed_at DESC
   )
   INSERT INTO dataset_neighborhood_evidence(dataset_slug,source_record_id,neighborhood_id,source_grain,observation_date,mapping_method,mapping_confidence,payload)
   SELECT 'rent_listings',l.id::text,l.neighborhood_id,'listing',
     COALESCE(s.observed_at::date,l.last_seen_at::date),'canonical_neighborhood',1,
     jsonb_build_object('asking_rent_nis',s.asking_rent_nis,'area_sqm',s.area_sqm,'rooms',s.rooms,'floor',s.floor,
       'status',l.status,'first_seen_at',l.first_seen_at,'last_seen_at',l.last_seen_at)
   FROM rental_listings l LEFT JOIN latest s ON s.rental_listing_id=l.id
   WHERE l.neighborhood_id IS NOT NULL
   ON CONFLICT(dataset_slug,source_record_id,neighborhood_id) DO UPDATE SET
     observation_date=EXCLUDED.observation_date,payload=EXCLUDED.payload,linked_at=now()
   RETURNING 1
 `); counts.rentListings=rows.length;

 rows=await queryDatabase(`
   INSERT INTO dataset_neighborhood_evidence(dataset_slug,source_record_id,neighborhood_id,source_grain,observation_date,mapping_method,mapping_confidence,payload)
   SELECT 'urban_renewal_complexes',r.id::text,r.neighborhood_id,'renewal_project',r.observed_at::date,
     'canonical_neighborhood',1,
     jsonb_build_object('status',r.status,'stage',r.stage,'existing_units',r.existing_units,'planned_units',r.planned_units,'planning_certainty',r.planning_certainty)
   FROM renewal_projects r WHERE r.neighborhood_id IS NOT NULL
   ON CONFLICT(dataset_slug,source_record_id,neighborhood_id) DO UPDATE SET
     observation_date=EXCLUDED.observation_date,payload=EXCLUDED.payload,linked_at=now()
   RETURNING 1
 `); counts.renewal=rows.length;

 rows=await queryDatabase(`
   INSERT INTO dataset_neighborhood_evidence(dataset_slug,source_record_id,neighborhood_id,source_grain,observation_year,mapping_method,mapping_confidence,payload)
   SELECT 'census_2022',c._record_id,nm.neighborhood_id,'statistical_area',2022,
     'stat_area_crosswalk',nm.mapping_confidence,
     jsonb_build_object('population',c.population,'employment_pct',c.employment_pct,'median_employee_wage',c.median_annual_employee_wage,'academic_pct',c."AcadmCert_pcnt")
   FROM research_census_2022 c
   JOIN cities city ON city.settlement_code=c.locality_code
   JOIN statistical_areas s ON s.city_id=city.id AND s.stat_area_code=c.statistical_area_code AND s.year=2022
   JOIN neighborhood_stat_area_map nm ON nm.stat_area_id=s.id
   ON CONFLICT(dataset_slug,source_record_id,neighborhood_id) DO UPDATE SET
     observation_year=EXCLUDED.observation_year,mapping_confidence=EXCLUDED.mapping_confidence,payload=EXCLUDED.payload,linked_at=now()
   RETURNING 1
 `); counts.census=rows.length;

 rows=await queryDatabase(`
   INSERT INTO dataset_neighborhood_evidence(dataset_slug,source_record_id,neighborhood_id,source_grain,observation_year,mapping_method,mapping_confidence,payload)
   SELECT 'area_population_2024',p._record_id,nm.neighborhood_id,'statistical_area',2024,
     'stat_area_crosswalk',nm.mapping_confidence,jsonb_build_object('population',p.population)
   FROM research_area_population_2024 p
   JOIN cities city ON city.settlement_code=p.locality_code
   JOIN statistical_areas s ON s.city_id=city.id AND s.stat_area_code=p.statistical_area_code AND s.year=2022
   JOIN neighborhood_stat_area_map nm ON nm.stat_area_id=s.id
   ON CONFLICT(dataset_slug,source_record_id,neighborhood_id) DO UPDATE SET
     observation_year=EXCLUDED.observation_year,mapping_confidence=EXCLUDED.mapping_confidence,payload=EXCLUDED.payload,linked_at=now()
   RETURNING 1
 `); counts.population2024=rows.length;

 const municipal=[
   ['municipal_wages','average_wage'],
   ['municipal_migration','net_internal_migration'],
   ['construction_starts','housing_starts']
 ];
 for(const [slug,field] of municipal){
   const rows2=await queryDatabase(`
     INSERT INTO dataset_neighborhood_evidence(dataset_slug,source_record_id,neighborhood_id,source_grain,observation_year,mapping_method,mapping_confidence,payload)
     SELECT $1,concat(v.municipality,':',v.observation_year),n.id,'municipality',v.observation_year,
       'municipality_inheritance',.55,jsonb_build_object('value',v.value)
     FROM (
       SELECT municipality,observation_year,${field}::numeric value FROM research_${slug}
     ) v JOIN cities c ON c.name_he=v.municipality JOIN neighborhoods n ON n.city_id=c.id
     ON CONFLICT(dataset_slug,source_record_id,neighborhood_id) DO UPDATE SET
       observation_year=EXCLUDED.observation_year,payload=EXCLUDED.payload,linked_at=now()
     RETURNING 1
   `,[slug]);
   counts.municipal+=rows2.length;
 }
 return counts;
}

async function upsertMetric(key:string,sqlBody:string){
 return queryDatabase(`
   INSERT INTO neighborhood_metric_snapshots(neighborhood_id,as_of_date,metric_key,numeric_value,sample_count,confidence,evidence_count,source_datasets,source_evidence)
   ${sqlBody}
   ON CONFLICT(neighborhood_id,as_of_date,metric_key) DO UPDATE SET
     numeric_value=EXCLUDED.numeric_value,sample_count=EXCLUDED.sample_count,confidence=EXCLUDED.confidence,
     evidence_count=EXCLUDED.evidence_count,source_datasets=EXCLUDED.source_datasets,
     source_evidence=EXCLUDED.source_evidence,calculated_at=now()
   RETURNING id
 `);
}

async function refreshMetrics(){
 const day=asOf(); let count=0;
 count+=(await upsertMetric('transaction_count_12m',`
   SELECT resolved_neighborhood_id,'${day}'::date,'transaction_count_12m',count(*)::numeric,count(*)::int,
     LEAST(1,count(*)::numeric/20),count(*)::int,ARRAY['transactions'],
     jsonb_build_object('dataset','transactions','source_grain','transaction','window','12 months')
   FROM (
     SELECT ct.*,COALESCE(ct.neighborhood_id,b.neighborhood_id,nsm.neighborhood_id) resolved_neighborhood_id
     FROM comparable_transactions ct
     LEFT JOIN properties p ON p.id=ct.property_id LEFT JOIN buildings b ON b.id=p.building_id
     LEFT JOIN parcels par ON par.id=ct.parcel_id LEFT JOIN neighborhood_stat_area_map nsm ON nsm.stat_area_id=par.stat_area_id
   ) q
   WHERE resolved_neighborhood_id IS NOT NULL AND deal_date>=current_date-interval '12 months'
   GROUP BY resolved_neighborhood_id
 `)).length;
 count+=(await upsertMetric('median_price_sqm_12m',`
   SELECT resolved_neighborhood_id,'${day}'::date,'median_price_sqm_12m',
     percentile_cont(.5) WITHIN GROUP(ORDER BY COALESCE(normalized_pp_sqm,pp_sqm)),
     count(*)::int,LEAST(1,count(*)::numeric/20),count(*)::int,ARRAY['transactions'],
     jsonb_build_object('dataset','transactions','source_grain','transaction','window','12 months')
   FROM (
     SELECT ct.*,COALESCE(ct.neighborhood_id,b.neighborhood_id,nsm.neighborhood_id) resolved_neighborhood_id
     FROM comparable_transactions ct
     LEFT JOIN properties p ON p.id=ct.property_id LEFT JOIN buildings b ON b.id=p.building_id
     LEFT JOIN parcels par ON par.id=ct.parcel_id LEFT JOIN neighborhood_stat_area_map nsm ON nsm.stat_area_id=par.stat_area_id
   ) q
   WHERE resolved_neighborhood_id IS NOT NULL AND deal_date>=current_date-interval '12 months' AND COALESCE(normalized_pp_sqm,pp_sqm)>0
   GROUP BY resolved_neighborhood_id
 `)).length;
 count+=(await upsertMetric('price_change_1y',`
   WITH x AS(
    SELECT resolved_neighborhood_id neighborhood_id,
     percentile_cont(.5) WITHIN GROUP(ORDER BY COALESCE(normalized_pp_sqm,pp_sqm)) FILTER(WHERE deal_date>=current_date-interval '12 months') p1,
     percentile_cont(.5) WITHIN GROUP(ORDER BY COALESCE(normalized_pp_sqm,pp_sqm)) FILTER(WHERE deal_date<current_date-interval '12 months') p0,
     count(*) FILTER(WHERE deal_date>=current_date-interval '12 months')::int n
    FROM (
      SELECT ct.*,COALESCE(ct.neighborhood_id,b.neighborhood_id,nsm.neighborhood_id) resolved_neighborhood_id
      FROM comparable_transactions ct
      LEFT JOIN properties p ON p.id=ct.property_id LEFT JOIN buildings b ON b.id=p.building_id
      LEFT JOIN parcels par ON par.id=ct.parcel_id LEFT JOIN neighborhood_stat_area_map nsm ON nsm.stat_area_id=par.stat_area_id
    ) q
    WHERE resolved_neighborhood_id IS NOT NULL AND deal_date>=current_date-interval '24 months'
    GROUP BY resolved_neighborhood_id
   )
   SELECT neighborhood_id,'${day}'::date,'price_change_1y',100*(p1/p0-1),n,LEAST(1,n::numeric/20),n,
     ARRAY['transactions'],jsonb_build_object('dataset','transactions','current_median',p1,'prior_median',p0)
   FROM x WHERE p0>0 AND p1 IS NOT NULL
 `)).length;
 count+=(await upsertMetric('renewal_expansion_ratio',`
   SELECT neighborhood_id,'${day}'::date,'renewal_expansion_ratio',
     sum(planned_units)::numeric/NULLIF(sum(existing_units),0),count(*)::int,
     CASE WHEN count(*)>=3 THEN .9 ELSE .7 END,count(*)::int,ARRAY['urban_renewal_complexes'],
     jsonb_build_object('dataset','urban_renewal_complexes','source_grain','renewal_project')
   FROM renewal_projects WHERE neighborhood_id IS NOT NULL AND existing_units>0 GROUP BY neighborhood_id
 `)).length;
 count+=(await upsertMetric('estimated_gross_yield',`
   SELECT n.id,'${day}'::date,'estimated_gross_yield',
     CASE WHEN rm.median_rent_nis>0 AND sm.sale_price>0 THEN 100*(12*rm.median_rent_nis/sm.sale_price) END,
     LEAST(COALESCE(rm.active_supply,0),COALESCE(sm.n,0)),.65,
     COALESCE(rm.active_supply,0)+COALESCE(sm.n,0),ARRAY['rent_listings','sale_listings'],
     jsonb_build_object('rent_source','neighborhood_rent_metrics','sale_source','active listings')
   FROM neighborhoods n
   JOIN neighborhood_rent_metrics rm ON rm.neighborhood_id=n.id
   JOIN (
    SELECT l.neighborhood_id,percentile_cont(.5) WITHIN GROUP(ORDER BY s.asking_price_nis) sale_price,count(*)::int n
    FROM listings l JOIN LATERAL(
      SELECT asking_price_nis FROM listing_snapshots s WHERE s.listing_id=l.id ORDER BY observed_at DESC LIMIT 1
    ) s ON true WHERE l.status='active' AND l.neighborhood_id IS NOT NULL AND s.asking_price_nis>0 GROUP BY l.neighborhood_id
   ) sm ON sm.neighborhood_id=n.id
 `)).length;

 const econ=[
  ['municipal_average_wage','municipal_wages','average_wage'],
  ['net_internal_migration','municipal_migration','net_internal_migration'],
  ['construction_starts','construction_starts','housing_starts']
 ];
 for(const [metric,slug,field] of econ){
   count+=(await upsertMetric(metric,`
     SELECT n.id,'${day}'::date,'${metric}',x.value,1,.55,1,ARRAY['${slug}'],
       jsonb_build_object('dataset','${slug}','source_grain','municipality','warning','City-level context inherited by neighborhood')
     FROM neighborhoods n JOIN cities c ON c.id=n.city_id
     JOIN LATERAL(
       SELECT ${field}::numeric value,observation_year FROM research_${slug} r
       WHERE r.municipality=c.name_he AND ${field} IS NOT NULL ORDER BY observation_year DESC LIMIT 1
     ) x ON true
   `)).length;
 }
 return count;
}

async function refreshDealHeat(model:any){
 const rows=await queryDatabase(`
   WITH latest_score AS(
    SELECT DISTINCT ON(entity_id) entity_id,score,comp_confidence_score FROM opportunity_scores
    WHERE entity_type='listing' ORDER BY entity_id,calculated_at DESC
   ), w AS(
    SELECT l.neighborhood_id,n.city_id,s.score,
      CASE WHEN current_date-l.first_seen_at::date<=7 THEN 1 WHEN current_date-l.first_seen_at::date<=14 THEN .9
           WHEN current_date-l.first_seen_at::date<=30 THEN .75 WHEN current_date-l.first_seen_at::date<=60 THEN .5 ELSE 0 END fresh,
      GREATEST(.25,LEAST(1,COALESCE(s.comp_confidence_score,50)/100.0)) conf
    FROM listings l JOIN neighborhoods n ON n.id=l.neighborhood_id JOIN latest_score s ON s.entity_id=l.id
    WHERE l.status='active' AND l.neighborhood_id IS NOT NULL
   ), a AS(
    SELECT neighborhood_id,city_id,sum(score*fresh*conf)/NULLIF(sum(fresh*conf),0) raw,count(*) FILTER(WHERE fresh>0)::int n
    FROM w WHERE fresh>0 GROUP BY neighborhood_id,city_id
   ), c AS(
    SELECT city_id,sum(score*fresh*conf)/NULLIF(sum(fresh*conf),0) prior FROM w WHERE fresh>0 GROUP BY city_id
   ) SELECT a.*,c.prior FROM a LEFT JOIN c USING(city_id)
 `);
 for(const row of rows){
   const adjusted=bayesianAdjust(Number(row.raw),Number(row.n),row.prior==null?null:Number(row.prior),Number(model.parameters.bayesian_k??5));
   await queryDatabase(`
    INSERT INTO neighborhood_metric_snapshots(neighborhood_id,as_of_date,metric_key,numeric_value,sample_count,confidence,evidence_count,source_datasets,source_evidence)
    VALUES($1,$2::date,'deal_score_adjusted',$3::numeric,$4::int,LEAST(1::numeric,$4::numeric/10),$4::int,ARRAY['sale_listings'],$5::jsonb)
    ON CONFLICT(neighborhood_id,as_of_date,metric_key) DO UPDATE SET
      numeric_value=EXCLUDED.numeric_value,sample_count=EXCLUDED.sample_count,confidence=EXCLUDED.confidence,
      evidence_count=EXCLUDED.evidence_count,source_datasets=EXCLUDED.source_datasets,source_evidence=EXCLUDED.source_evidence,calculated_at=now()
   `,[row.neighborhood_id,asOf(),adjusted,row.n,JSON.stringify({raw:row.raw,city_prior:row.prior,bayesian_k:model.parameters.bayesian_k??5})]);
 }
 return rows.length;
}

async function scoreNeighborhoods(model:any){
 const rows=await queryDatabase(`
  WITH latest AS(
   SELECT DISTINCT ON(neighborhood_id,metric_key) neighborhood_id,metric_key,numeric_value,sample_count,confidence,source_evidence
   FROM neighborhood_metric_snapshots ORDER BY neighborhood_id,metric_key,as_of_date DESC,calculated_at DESC
  )
  SELECT n.id neighborhood_id,n.city_id,
    jsonb_object_agg(l.metric_key,jsonb_build_object('value',l.numeric_value,'sample_count',l.sample_count,'confidence',l.confidence,'evidence',l.source_evidence))
      FILTER(WHERE l.metric_key IS NOT NULL) metrics
  FROM neighborhoods n LEFT JOIN latest l ON l.neighborhood_id=n.id GROUP BY n.id,n.city_id
 `);
 const pctKeys=['price_change_1y','renewal_expansion_ratio','estimated_gross_yield','municipal_average_wage','net_internal_migration','construction_starts'];
 const peers=new Map<string,Map<string,number[]>>();
 for(const row of rows){
  const city=String(row.city_id),m=row.metrics||{}; if(!peers.has(city))peers.set(city,new Map());
  for(const k of pctKeys){if(m[k]?.value==null)continue;const p=peers.get(city)!;if(!p.has(k))p.set(k,[]);p.get(k)!.push(Number(m[k].value));}
 }
 let processed=0;
 for(const row of rows){
  const m=row.metrics||{},peer=peers.get(String(row.city_id))||new Map<string,number[]>();
  const pct=(k:string)=>m[k]?.value==null?null:percentileRank(peer.get(k)||[],Number(m[k].value));
  const supply=pct('construction_starts'); 
  const components:any={
   deal:m.deal_score_adjusted?.value==null?null:Number(m.deal_score_adjusted.value),
   market:pct('price_change_1y'),
   renewal:pct('renewal_expansion_ratio'),
   demographics:pct('net_internal_migration'),
   rental:pct('estimated_gross_yield'),
   infrastructure:null,
   supply:supply==null?null:100-supply
  };
  const result=weightedAreaScore(components,model.weights as ScoreWeights,Number(model.parameters.minimum_component_coverage_pct??60));
  const ev=Object.values(m) as any[];const conf=ev.length?100*ev.reduce((s,x)=>s+Number(x.confidence??0),0)/ev.length:0;
  const level=confidenceLevel(conf,model.parameters.confidence);
  await queryDatabase(`
   INSERT INTO neighborhood_score_snapshots(neighborhood_id,score_version,deal_score_raw,deal_score_adjusted,investment_score,confidence_score,confidence_level,coverage_pct,component_scores,inputs)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb)
  `,[row.neighborhood_id,model.version,m.deal_score_adjusted?.evidence?.raw??null,components.deal,result.score,conf,level,result.coveragePct,JSON.stringify(result.components),JSON.stringify({metrics:m})]);
  await queryDatabase(`
   INSERT INTO neighborhood_map_cache(neighborhood_id,score_version,deal_heat,investment_score,confidence_score,confidence_level,coverage_pct,
    deal_count,transaction_count_12m,median_price_sqm_12m,price_change_1y,renewal_expansion_ratio,estimated_gross_yield,average_wage,net_internal_migration,construction_starts,updated_at)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,now())
   ON CONFLICT(neighborhood_id) DO UPDATE SET score_version=EXCLUDED.score_version,deal_heat=EXCLUDED.deal_heat,
    investment_score=EXCLUDED.investment_score,confidence_score=EXCLUDED.confidence_score,confidence_level=EXCLUDED.confidence_level,
    coverage_pct=EXCLUDED.coverage_pct,deal_count=EXCLUDED.deal_count,transaction_count_12m=EXCLUDED.transaction_count_12m,
    median_price_sqm_12m=EXCLUDED.median_price_sqm_12m,price_change_1y=EXCLUDED.price_change_1y,
    renewal_expansion_ratio=EXCLUDED.renewal_expansion_ratio,estimated_gross_yield=EXCLUDED.estimated_gross_yield,
    average_wage=EXCLUDED.average_wage,net_internal_migration=EXCLUDED.net_internal_migration,
    construction_starts=EXCLUDED.construction_starts,updated_at=now()
  `,[
   row.neighborhood_id,model.version,components.deal,result.score,conf,level,result.coveragePct,
   Number(m.deal_score_adjusted?.sample_count??0),Number(m.transaction_count_12m?.value??0),m.median_price_sqm_12m?.value??null,
   m.price_change_1y?.value??null,m.renewal_expansion_ratio?.value??null,m.estimated_gross_yield?.value??null,
   m.municipal_average_wage?.value??null,m.net_internal_migration?.value??null,m.construction_starts?.value??null
  ]);
  processed++;
 }
 return processed;
}

export async function refreshNeighborhoodIntelligence(){
 const model=await activeModel();
 const crosswalk=await refreshCrosswalk();
 const evidence=await linkEvidence();
 const metrics=await refreshMetrics();
 const dealHeat=await refreshDealHeat(model);
 const neighborhoods=await scoreNeighborhoods(model);
 return {scoreVersion:model.version,crosswalk,evidence,metrics,dealHeat,neighborhoods};
}
