import {queryDatabase} from './db.js';

export async function refreshNeighborhoodIdentity(){
  const result={sourceMappings:0,parcelMappings:0,parcelEnrichment:0,statAreaMappings:0,officialCrosswalk:0,geometriesPromoted:0,aliases:0,hierarchyEdges:0};

  let rows=await queryDatabase(`
    INSERT INTO neighborhood_aliases(neighborhood_id,source_id,alias,normalized_alias,language,alias_type,confidence,is_primary)
    SELECT id,'edge',name_he,
      lower(regexp_replace(replace(replace(name_he,'״',''),'"',''),'[[:space:][:punct:]]','','g')),
      'he','canonical_name',1,true
    FROM neighborhoods
    ON CONFLICT(neighborhood_id,source_id,normalized_alias,alias_type) DO NOTHING
    RETURNING id
  `);
  result.aliases+=rows.length;

  rows=await queryDatabase(`
    INSERT INTO neighborhood_source_mappings(neighborhood_id,source_id,source_entity_type,source_entity_id,source_name,mapping_method,mapping_confidence,evidence)
    SELECT l.neighborhood_id,l.source_id,'listing',l.source_listing_id,l.canonical_address,'direct_canonical',1,
      jsonb_build_object('listing_id',l.id,'first_seen_at',l.first_seen_at,'last_seen_at',l.last_seen_at)
    FROM listings l WHERE l.neighborhood_id IS NOT NULL
    ON CONFLICT(source_id,source_entity_type,source_entity_id,neighborhood_id) DO UPDATE SET
      source_name=EXCLUDED.source_name,mapping_method='direct_canonical',mapping_confidence=1,evidence=EXCLUDED.evidence,mapped_at=now()
    RETURNING id
  `);
  result.sourceMappings+=rows.length;

  rows=await queryDatabase(`
    INSERT INTO neighborhood_source_mappings(neighborhood_id,source_id,source_entity_type,source_entity_id,source_name,mapping_method,mapping_confidence,evidence)
    SELECT r.neighborhood_id,r.source_id,'renewal_project',r.source_project_id,r.project_name,'direct_canonical',1,
      jsonb_build_object('project_id',r.id,'status',r.status,'stage',r.stage,'planning_certainty',r.planning_certainty)
    FROM renewal_projects r WHERE r.neighborhood_id IS NOT NULL
    ON CONFLICT(source_id,source_entity_type,source_entity_id,neighborhood_id) DO UPDATE SET
      source_name=EXCLUDED.source_name,mapping_method='direct_canonical',mapping_confidence=1,evidence=EXCLUDED.evidence,mapped_at=now()
    RETURNING id
  `);
  result.sourceMappings+=rows.length;

  rows=await queryDatabase(`
    INSERT INTO neighborhood_source_mappings(neighborhood_id,source_id,source_entity_type,source_entity_id,source_name,mapping_method,mapping_confidence,evidence)
    SELECT ct.neighborhood_id,ct.source_id,'transaction',ct.source_external_id,ct.address_text,'direct_canonical',1,
      jsonb_build_object('transaction_id',ct.id,'parcel_id',ct.parcel_id,'deal_date',ct.deal_date)
    FROM comparable_transactions ct WHERE ct.neighborhood_id IS NOT NULL
    ON CONFLICT(source_id,source_entity_type,source_entity_id,neighborhood_id) DO UPDATE SET
      source_name=EXCLUDED.source_name,mapping_method='direct_canonical',mapping_confidence=1,evidence=EXCLUDED.evidence,mapped_at=now()
    RETURNING id
  `);
  result.sourceMappings+=rows.length;

  rows=await queryDatabase(`
    INSERT INTO neighborhood_parcel_map(neighborhood_id,parcel_id,mapping_method,mapping_confidence,evidence)
    SELECT DISTINCT ct.neighborhood_id,ct.parcel_id,'direct_transaction',1,
      jsonb_build_object('source','comparable_transactions')
    FROM comparable_transactions ct
    WHERE ct.neighborhood_id IS NOT NULL AND ct.parcel_id IS NOT NULL
    ON CONFLICT(neighborhood_id,parcel_id) DO UPDATE SET
      mapping_method='direct_transaction',
      mapping_confidence=GREATEST(neighborhood_parcel_map.mapping_confidence,1),
      mapped_at=now()
    RETURNING parcel_id
  `);
  result.parcelMappings=rows.length;

  rows=await queryDatabase(`
    WITH candidate AS(
      SELECT DISTINCT ON(target.id) target.id target_id,src.geom,src.centroid,src.stat_area_id,src.city_id
      FROM parcels target
      JOIN neighborhood_parcel_map npm ON npm.parcel_id=target.id
      JOIN parcels src ON src.gush=target.gush AND src.helka=target.helka
      WHERE src.geom IS NOT NULL
      ORDER BY target.id,(src.stat_area_id IS NOT NULL) DESC,src.observed_at DESC
    )
    UPDATE parcels p SET
      geom=COALESCE(p.geom,c.geom),
      centroid=COALESCE(p.centroid,c.centroid),
      stat_area_id=COALESCE(p.stat_area_id,c.stat_area_id),
      city_id=COALESCE(p.city_id,c.city_id)
    FROM candidate c
    WHERE p.id=c.target_id
      AND (p.geom IS NULL OR p.centroid IS NULL OR p.stat_area_id IS NULL OR p.city_id IS NULL)
    RETURNING p.id
  `);
  result.parcelEnrichment=rows.length;

  rows=await queryDatabase(`
    WITH evidence AS(
      SELECT npm.neighborhood_id,p.stat_area_id,
        count(DISTINCT npm.parcel_id)::int parcel_count,
        avg(npm.mapping_confidence)::numeric avg_confidence
      FROM neighborhood_parcel_map npm
      JOIN parcels p ON p.id=npm.parcel_id
      WHERE p.stat_area_id IS NOT NULL
      GROUP BY npm.neighborhood_id,p.stat_area_id
    )
    INSERT INTO neighborhood_stat_area_map(neighborhood_id,stat_area_id,overlap_ratio,mapping_method,mapping_confidence,mapping_version,mapped_at)
    SELECT neighborhood_id,stat_area_id,NULL,'parcel_evidence',
      CASE WHEN parcel_count>=3 THEN LEAST(.98,avg_confidence)
           WHEN parcel_count=2 THEN LEAST(.90,avg_confidence)
           ELSE LEAST(.72,avg_confidence) END,
      'edge-neighborhood-v1',now()
    FROM evidence
    ON CONFLICT(neighborhood_id,stat_area_id) DO UPDATE SET
      mapping_method=CASE
        WHEN neighborhood_stat_area_map.mapping_method='verified' THEN neighborhood_stat_area_map.mapping_method
        ELSE EXCLUDED.mapping_method END,
      mapping_confidence=GREATEST(neighborhood_stat_area_map.mapping_confidence,EXCLUDED.mapping_confidence),
      mapped_at=now()
    RETURNING neighborhood_id
  `);
  result.statAreaMappings=rows.length;

  await queryDatabase(`
    INSERT INTO neighborhood_source_mappings(neighborhood_id,source_id,source_entity_type,source_entity_id,source_name,mapping_method,mapping_confidence,overlap_pct,evidence)
    SELECT m.neighborhood_id,'cbs','statistical_area',s.id::text,s.stat_area_code,m.mapping_method,m.mapping_confidence,m.overlap_ratio,
      jsonb_build_object('stat_area_code',s.stat_area_code,'boundary_year',s."year")
    FROM neighborhood_stat_area_map m JOIN statistical_areas s ON s.id=m.stat_area_id
    ON CONFLICT(source_id,source_entity_type,source_entity_id,neighborhood_id) DO UPDATE SET
      mapping_method=EXCLUDED.mapping_method,mapping_confidence=EXCLUDED.mapping_confidence,
      overlap_pct=EXCLUDED.overlap_pct,evidence=EXCLUDED.evidence,mapped_at=now()
  `);


  const official=await queryDatabase(`
    WITH raw AS(
      SELECT k.locality_code,k.statistical_area_code,k.neighborhood_names,
        c.id city_id,s.id stat_area_id
      FROM cbs_neighborhood_stat_area_key k
      JOIN cities c ON c.settlement_code=k.locality_code
      JOIN statistical_areas s ON s.city_id=c.id AND s.stat_area_code=k.statistical_area_code AND s."year"=2022
    ), names AS(
      SELECT r.*,unnest(r.neighborhood_names) source_neighborhood
      FROM raw r
    ), norm AS(
      SELECT n.*,
        lower(regexp_replace(replace(replace(source_neighborhood,'״',''),'"',''),'[[:space:][:punct:]]','','g')) normalized_source
      FROM names n
    ), matched AS(
      SELECT DISTINCT no.id neighborhood_id,n.stat_area_id,n.source_neighborhood
      FROM norm n
      JOIN neighborhoods no ON no.city_id=n.city_id
      LEFT JOIN neighborhood_aliases a ON a.neighborhood_id=no.id
      WHERE lower(regexp_replace(replace(replace(no.name_he,'״',''),'"',''),'[[:space:][:punct:]]','','g'))=n.normalized_source
         OR a.normalized_alias=n.normalized_source
    ), multiplicity AS(
      SELECT stat_area_id,count(DISTINCT neighborhood_id)::int neighborhood_count
      FROM matched GROUP BY stat_area_id
    )
    INSERT INTO neighborhood_stat_area_map(
      neighborhood_id,stat_area_id,overlap_ratio,mapping_method,mapping_confidence,mapping_version,source_evidence,mapped_at
    )
    SELECT m.neighborhood_id,m.stat_area_id,
      CASE WHEN x.neighborhood_count=1 THEN 1::numeric ELSE NULL END,
      'official_crosswalk',
      CASE WHEN x.neighborhood_count=1 THEN .98 ELSE .85 END,
      'cbs-2022-neighborhood-key',
      jsonb_build_object(
        'source','CBS 2022 main streets and neighborhoods key',
        'source_neighborhood',m.source_neighborhood,
        'exclusive',x.neighborhood_count=1,
        'neighborhoods_in_stat_area',x.neighborhood_count
      ),
      now()
    FROM matched m JOIN multiplicity x USING(stat_area_id)
    ON CONFLICT(neighborhood_id,stat_area_id) DO UPDATE SET
      overlap_ratio=EXCLUDED.overlap_ratio,
      mapping_method='official_crosswalk',
      mapping_confidence=GREATEST(neighborhood_stat_area_map.mapping_confidence,EXCLUDED.mapping_confidence),
      mapping_version=EXCLUDED.mapping_version,
      source_evidence=EXCLUDED.source_evidence,
      mapped_at=now()
    RETURNING neighborhood_id
  `);
  result.officialCrosswalk=official.length;

  const candidates=await queryDatabase(`
    WITH mapped AS(
      SELECT m.neighborhood_id,s.geom,m.mapping_confidence,m.overlap_ratio,
        COALESCE((m.source_evidence->>'exclusive')::boolean,false) exclusive
      FROM neighborhood_stat_area_map m
      JOIN statistical_areas s ON s.id=m.stat_area_id
      WHERE s.geom IS NOT NULL AND m.mapping_confidence>=.85
    ), agg AS(
      SELECT neighborhood_id,
        ST_Multi(ST_Union(geom)) FILTER(WHERE exclusive OR overlap_ratio=1) geom,
        avg(mapping_confidence) FILTER(WHERE exclusive OR overlap_ratio=1)::numeric avg_confidence,
        count(*)::int total_areas,
        count(*) FILTER(WHERE exclusive OR overlap_ratio=1)::int exclusive_areas
      FROM mapped GROUP BY neighborhood_id
    )
    SELECT neighborhood_id,geom,
      LEAST(.96,COALESCE(avg_confidence,.8) * (exclusive_areas::numeric/NULLIF(total_areas,0)))::numeric confidence,
      exclusive_areas area_count
    FROM agg
    WHERE exclusive_areas>=1
      AND exclusive_areas::numeric/NULLIF(total_areas,0)>=.8
  `);

  for(const c of candidates){
    const version='edge-neighborhood-v1-cbs-official';
    await queryDatabase(`
      UPDATE neighborhood_geometries SET is_active=false
      WHERE neighborhood_id=$1 AND is_active AND geometry_version<>$2
    `,[c.neighborhood_id,version]);
    const inserted=await queryDatabase(`
      INSERT INTO neighborhood_geometries(neighborhood_id,geometry_version,geom,geometry_method,source_id,confidence,is_active,evidence)
      VALUES($1,$2,$3::geometry,'cbs_official_stat_area_union','cbs',$4,true,$5::jsonb)
      ON CONFLICT(neighborhood_id,geometry_version) DO UPDATE SET
        geom=EXCLUDED.geom,confidence=EXCLUDED.confidence,is_active=true,evidence=EXCLUDED.evidence
      RETURNING id
    `,[c.neighborhood_id,version,c.geom,c.confidence,JSON.stringify({statistical_area_count:c.area_count})]);
    if(inserted.length)result.geometriesPromoted++;
    await queryDatabase(`
      UPDATE neighborhoods SET geom=$2::geometry,boundary_version=$3,geometry_method='cbs_official_stat_area_union',
        geometry_source='cbs-2022-neighborhood-key',geometry_confidence=$4,updated_at=now()
      WHERE id=$1
    `,[c.neighborhood_id,c.geom,version,c.confidence]);
  }

  const hierarchy=await queryDatabase(`
    WITH ins_city AS(
      INSERT INTO geo_relationships(parent_type,parent_id,child_type,child_id,relationship_type,confidence,source_id,metadata)
      SELECT 'city',c.id,'neighborhood',n.id,'contains',1,'edge',
        jsonb_build_object('city_name',c.name_he,'neighborhood_slug',n.slug)
      FROM neighborhoods n JOIN cities c ON c.id=n.city_id
      ON CONFLICT(parent_type,parent_id,child_type,child_id,relationship_type) DO UPDATE SET confidence=1
      RETURNING 1
    ), ins_stat AS(
      INSERT INTO geo_relationships(parent_type,parent_id,child_type,child_id,relationship_type,confidence,source_id,metadata)
      SELECT 'neighborhood',m.neighborhood_id,'statistical_area',m.stat_area_id,'contains',m.mapping_confidence,'cbs',
        jsonb_build_object('mapping_method',m.mapping_method,'overlap_ratio',m.overlap_ratio,'mapping_version',m.mapping_version)
      FROM neighborhood_stat_area_map m
      ON CONFLICT(parent_type,parent_id,child_type,child_id,relationship_type) DO UPDATE SET
        confidence=EXCLUDED.confidence,source_id=EXCLUDED.source_id,metadata=EXCLUDED.metadata
      RETURNING 1
    ), ins_parcel AS(
      INSERT INTO geo_relationships(parent_type,parent_id,child_type,child_id,relationship_type,confidence,source_id,metadata)
      SELECT 'neighborhood',m.neighborhood_id,'parcel',m.parcel_id,'contains',m.mapping_confidence,'edge',
        jsonb_build_object('mapping_method',m.mapping_method,'mapping_version',m.mapping_version)
      FROM neighborhood_parcel_map m
      ON CONFLICT(parent_type,parent_id,child_type,child_id,relationship_type) DO UPDATE SET
        confidence=EXCLUDED.confidence,metadata=EXCLUDED.metadata
      RETURNING 1
    )
    SELECT (SELECT count(*) FROM ins_city)+(SELECT count(*) FROM ins_stat)+(SELECT count(*) FROM ins_parcel) count
  `);
  result.hierarchyEdges=Number(hierarchy[0]?.count??0);

  return result;
}

export async function neighborhoodIdentity(neighborhoodId:string){
  const [canonical,aliases,mappings,statAreas,parcels,geometries]=await Promise.all([
    queryDatabase(`
      SELECT s.*,CASE WHEN s.geom IS NULL THEN NULL ELSE ST_AsGeoJSON(s.geom)::jsonb END geometry
      FROM semantic_neighborhoods s WHERE s.neighborhood_id=$1
    `,[neighborhoodId]),
    queryDatabase(`
      SELECT source_id,alias,normalized_alias,language,alias_type,confidence,is_primary,metadata
      FROM neighborhood_aliases WHERE neighborhood_id=$1 ORDER BY is_primary DESC,confidence DESC,alias
    `,[neighborhoodId]),
    queryDatabase(`
      SELECT source_id,source_entity_type,source_entity_id,source_name,mapping_method,mapping_confidence,
        overlap_pct,valid_from,valid_to,evidence,mapped_at
      FROM neighborhood_source_mappings WHERE neighborhood_id=$1
      ORDER BY source_entity_type,source_id,mapping_confidence DESC
      LIMIT 1000
    `,[neighborhoodId]),
    queryDatabase(`
      SELECT s.id::text stat_area_id,s.stat_area_code,s."year" boundary_year,m.mapping_method,
        m.mapping_confidence::float8,m.overlap_ratio::float8
      FROM neighborhood_stat_area_map m JOIN statistical_areas s ON s.id=m.stat_area_id
      WHERE m.neighborhood_id=$1 ORDER BY m.mapping_confidence DESC,s.stat_area_code
    `,[neighborhoodId]),
    queryDatabase(`
      SELECT p.id::text parcel_id,p.gush,p.helka,p.suffix,npm.mapping_method,npm.mapping_confidence::float8,
        npm.overlap_pct::float8,(p.geom IS NOT NULL) has_geometry,p.stat_area_id::text
      FROM neighborhood_parcel_map npm JOIN parcels p ON p.id=npm.parcel_id
      WHERE npm.neighborhood_id=$1 ORDER BY npm.mapping_confidence DESC,p.gush,p.helka
      LIMIT 1000
    `,[neighborhoodId]),
    queryDatabase(`
      SELECT geometry_version,geometry_method,source_id,confidence::float8,is_active,valid_from,valid_to,evidence,created_at,
        ST_AsGeoJSON(geom)::jsonb geometry
      FROM neighborhood_geometries WHERE neighborhood_id=$1
      ORDER BY is_active DESC,created_at DESC
    `,[neighborhoodId])
  ]);
  return {canonical:canonical[0]??null,aliases,mappings,statAreas,parcels,geometries};
}
