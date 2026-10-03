-- Semantic graph for dataset-aware agents and neighborhood-first analytics.

CREATE TABLE IF NOT EXISTS semantic_entities (
  entity_key text PRIMARY KEY,
  label text NOT NULL,
  grain text NOT NULL,
  primary_table text NOT NULL,
  primary_key text NOT NULL,
  description text NOT NULL,
  hierarchy_level integer NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS semantic_relationships (
  relationship_key text PRIMARY KEY,
  from_entity text NOT NULL REFERENCES semantic_entities(entity_key),
  to_entity text NOT NULL REFERENCES semantic_entities(entity_key),
  relationship_type text NOT NULL,
  join_rule jsonb NOT NULL,
  inheritance_rule jsonb,
  confidence numeric NOT NULL DEFAULT 1 CHECK(confidence BETWEEN 0 AND 1),
  description text NOT NULL
);

CREATE TABLE IF NOT EXISTS semantic_metrics (
  metric_key text PRIMARY KEY,
  label text NOT NULL,
  entity_key text NOT NULL REFERENCES semantic_entities(entity_key),
  preferred_table text NOT NULL,
  expression_hint text NOT NULL,
  time_field text,
  unit text,
  default_window text,
  aggregation text NOT NULL,
  source_grain text NOT NULL,
  inheritance text NOT NULL DEFAULT 'direct',
  confidence_rule text,
  description text NOT NULL,
  caveats text[] NOT NULL DEFAULT '{}',
  synonyms text[] NOT NULL DEFAULT '{}',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS semantic_dataset_roles (
  table_name text PRIMARY KEY,
  entity_key text REFERENCES semantic_entities(entity_key),
  dataset_role text NOT NULL,
  source_grain text NOT NULL,
  neighborhood_link_rule text,
  inheritance_rule text,
  preferred_for text[] NOT NULL DEFAULT '{}',
  avoid_for text[] NOT NULL DEFAULT '{}',
  notes text NOT NULL DEFAULT ''
);

INSERT INTO semantic_entities(entity_key,label,grain,primary_table,primary_key,description,hierarchy_level) VALUES
 ('city','City','municipality','cities','id','Municipality/locality. Used for city-wide context and neighborhood parentage.',1),
 ('neighborhood','Neighborhood','neighborhood','neighborhoods','id','Primary product analysis entity. Map, dashboard, metrics and investment score are keyed by neighborhood_id.',2),
 ('statistical_area','Statistical area','CBS statistical area','statistical_areas','id','Supporting geography for census/population data. Never the primary dashboard entity.',3),
 ('parcel','Parcel','cadastral parcel','parcels','id','Land parcel used to resolve transactions/buildings geographically.',4),
 ('building','Building','building','buildings','id','Resolved building/address entity.',5),
 ('property','Property','property','properties','id','Resolved dwelling/property entity.',6),
 ('listing','Listing','listing','listings','id','Current or historical sale/rent market offer.',7),
 ('transaction','Transaction','executed transaction','transactions','id','Completed/recorded real-estate transaction.',7)
ON CONFLICT(entity_key) DO UPDATE SET
 label=EXCLUDED.label,grain=EXCLUDED.grain,primary_table=EXCLUDED.primary_table,primary_key=EXCLUDED.primary_key,
 description=EXCLUDED.description,hierarchy_level=EXCLUDED.hierarchy_level;

INSERT INTO semantic_relationships(relationship_key,from_entity,to_entity,relationship_type,join_rule,inheritance_rule,confidence,description) VALUES
 ('neighborhood_city','neighborhood','city','belongs_to','{"from":"neighborhoods.city_id","to":"cities.id"}',NULL,1,'Every neighborhood belongs to exactly one city.'),
 ('stat_area_neighborhood','statistical_area','neighborhood','crosswalk','{"table":"neighborhood_stat_area_map","from":"stat_area_id","to":"neighborhood_id"}','{"method":"weighted_overlap","weight":"overlap_ratio","confidence":"mapping_confidence"}',.9,'Use only explicit crosswalk rows. Statistical areas support neighborhood analytics; they do not replace neighborhood identity.'),
 ('parcel_stat_area','parcel','statistical_area','belongs_to','{"from":"parcels.stat_area_id","to":"statistical_areas.id"}',NULL,.95,'Parcel point/polygon assigned to statistical area.'),
 ('building_neighborhood','building','neighborhood','belongs_to','{"from":"buildings.neighborhood_id","to":"neighborhoods.id"}',NULL,1,'Preferred direct neighborhood link for buildings.'),
 ('listing_neighborhood','listing','neighborhood','belongs_to','{"from":"listings.neighborhood_id","to":"neighborhoods.id"}',NULL,1,'Preferred direct neighborhood link for listings.'),
 ('transaction_neighborhood','transaction','neighborhood','resolved_to','{"evidence_table":"dataset_neighborhood_evidence","dataset_slug":"transactions","priority":["comparable_transactions.neighborhood_id","property->building.neighborhood_id","parcel->statistical_area->neighborhood_stat_area_map"]}',NULL,.95,'Transaction neighborhood resolution uses the canonical resolver priority. For dashboard drilldown join dataset_neighborhood_evidence(dataset_slug=transactions) to comparable_transactions by source_record_id.')
ON CONFLICT(relationship_key) DO UPDATE SET
 join_rule=EXCLUDED.join_rule,inheritance_rule=EXCLUDED.inheritance_rule,confidence=EXCLUDED.confidence,description=EXCLUDED.description;

INSERT INTO semantic_dataset_roles(table_name,entity_key,dataset_role,source_grain,neighborhood_link_rule,inheritance_rule,preferred_for,avoid_for,notes) VALUES
 ('comparable_transactions','transaction','canonical_market_evidence','transaction','direct neighborhood_id','none',
  ARRAY['executed price','price per sqm','transaction volume','price trend','comps','liquidity'],
  ARRAY['asking price','rent','seller motivation'],
  'Preferred transaction table for valuation. Applies quality filters and preserves ownership/normalization fields.'),
 ('transactions','transaction','raw_canonical_market','transaction','parcel/property/city resolution','none',
  ARRAY['source inspection'],ARRAY['valuation when comparable_transactions is available'],
  'Raw canonical executed transactions. Prefer comparable_transactions for neighborhood valuation.'),
 ('rental_listings','listing','canonical_rent_listing','listing','direct neighborhood_id','none',
  ARRAY['active rent inventory','asking rent','rent listing identity'],ARRAY['executed rent','signed lease price'],
  'Join latest rental_listing_snapshots for current asking rent.'),
 ('rental_listing_snapshots','listing','rent_snapshot','listing snapshot','via rental_listings.neighborhood_id','none',
  ARRAY['current asking rent','rent per sqm','rooms','area'],ARRAY['signed lease price'],
  'Multiple observations per rental listing; select latest observed_at for current state.'),
 ('listing_snapshots','listing','sale_snapshot','listing snapshot','via listings.neighborhood_id','none',
  ARRAY['current asking sale price','asking price per sqm','rooms','area'],ARRAY['executed transaction price'],
  'Multiple observations per listing; select latest observed_at for current state.'),
 ('listings','listing','canonical_sale_listing','listing','direct neighborhood_id','none',
  ARRAY['active sale inventory','listing identity'],ARRAY['current price without latest snapshot'],
  'Join latest listing_snapshots for current asking price.'),
 ('neighborhood_rent_metrics','neighborhood','derived_rental_metric','neighborhood','direct neighborhood_id','none',
  ARRAY['median asking rent','rental supply'],ARRAY['executed rent','signed lease price'],
  'Listing-based rent aggregate; not signed contracts.'),
 ('renewal_projects','neighborhood','canonical_renewal','project','direct neighborhood_id','none',
  ARRAY['renewal pipeline','planned units','project stage'],ARRAY['treating all planned units as approved'],
  'Project status/planning certainty must be retained.'),
 ('demographic_snapshots','neighborhood','canonical_demographic','statistical area or neighborhood','stat-area crosswalk or direct neighborhood_id','weighted statistical-area inheritance',
  ARRAY['population','households','education','socio-economic context'],ARRAY['mixing boundary years'],
  'When statistical-area based, aggregate through neighborhood_stat_area_map and preserve year.'),
 ('dataset_neighborhood_evidence','neighborhood','lineage_bridge','mixed','explicit neighborhood_id','source-grain-specific',
  ARRAY['provenance','mapping confidence','source grain'],ARRAY['direct business metric calculation when canonical tables exist'],
  'Use for evidence lineage and coverage, not as a replacement for canonical fact tables.'),
 ('neighborhood_metric_snapshots','neighborhood','semantic_metric_fact','neighborhood','direct neighborhood_id','already resolved',
  ARRAY['dashboard KPIs','agent neighborhood metrics','score inputs'],ARRAY['raw row-level drilldown'],
  'Primary semantic fact table for neighborhood analytics.'),
 ('neighborhood_map_cache','neighborhood','serving_cache','neighborhood','direct neighborhood_id','already resolved',
  ARRAY['map heat','fast summary'],ARRAY['historical trend','evidence drilldown'],
  'Serving cache only; not authoritative history.')
ON CONFLICT(table_name) DO UPDATE SET
 entity_key=EXCLUDED.entity_key,dataset_role=EXCLUDED.dataset_role,source_grain=EXCLUDED.source_grain,
 neighborhood_link_rule=EXCLUDED.neighborhood_link_rule,inheritance_rule=EXCLUDED.inheritance_rule,
 preferred_for=EXCLUDED.preferred_for,avoid_for=EXCLUDED.avoid_for,notes=EXCLUDED.notes;

INSERT INTO semantic_metrics(metric_key,label,entity_key,preferred_table,expression_hint,time_field,unit,default_window,aggregation,source_grain,inheritance,confidence_rule,description,caveats,synonyms) VALUES
 ('median_price_sqm_12m','Median executed price per sqm','neighborhood','neighborhood_metric_snapshots',
  'metric_key=median_price_sqm_12m','as_of_date','NIS/sqm','12 months','median','transaction','direct',
  'confidence grows with comparable transaction sample size',
  'Median executed comparable transaction price per sqm for the latest 12 months.',
  ARRAY['Executed transactions only','Do not mix with asking price'],
  ARRAY['price per sqm','sqm price','מחיר למטר','מחיר למ"ר']),
 ('price_change_1y','Executed price change 1Y','neighborhood','neighborhood_metric_snapshots',
  'metric_key=price_change_1y','as_of_date','percent','24 months','ratio of medians','transaction','direct',
  'requires adequate samples in both periods',
  'Change between latest 12-month median executed price/sqm and preceding 12 months.',
  ARRAY['Not an appraisal','Sparse samples reduce confidence'],
  ARRAY['price growth','1y appreciation','עליית מחירים']),
 ('deal_score_adjusted','Deal heat','neighborhood','neighborhood_metric_snapshots',
  'metric_key=deal_score_adjusted','as_of_date','score 0-100','60 days','weighted average','listing','direct',
  'Bayesian shrinkage to city prior and listing confidence/freshness weights',
  'Current opportunity heat from active scored listings.',
  ARRAY['Current deal environment, not long-term area quality'],
  ARRAY['deal heat','opportunity heat','עסקאות חמות']),
 ('estimated_gross_yield','Estimated gross yield','neighborhood','neighborhood_metric_snapshots',
  'metric_key=estimated_gross_yield','as_of_date','percent','current','ratio','listing','direct',
  'depends on rental and sale comparable sample coverage',
  'Estimated gross yield using asking rent and sale evidence.',
  ARRAY['Asking prices/rents','Not realized net yield'],
  ARRAY['yield','rental yield','תשואה']),
 ('renewal_expansion_ratio','Urban renewal expansion ratio','neighborhood','neighborhood_metric_snapshots',
  'metric_key=renewal_expansion_ratio','as_of_date','ratio','current','ratio','renewal project','direct',
  'project status and mapping confidence affect interpretation',
  'Planned units divided by existing units in mapped renewal projects.',
  ARRAY['Do not interpret planned units as delivered units'],
  ARRAY['renewal','urban renewal','התחדשות עירונית']),
 ('municipal_average_wage','Municipal average wage context','neighborhood','neighborhood_metric_snapshots',
  'metric_key=municipal_average_wage','as_of_date','NIS','latest','latest','municipality','city_to_neighborhood',
  'inheritance confidence is intentionally lower than direct neighborhood metrics',
  'City-level wage context inherited by neighborhoods in that municipality.',
  ARRAY['Municipality-level context; not measured inside the neighborhood'],
  ARRAY['wage','salary','שכר']),
 ('net_internal_migration','Municipal net migration context','neighborhood','neighborhood_metric_snapshots',
  'metric_key=net_internal_migration','as_of_date','people','latest','latest','municipality','city_to_neighborhood',
  'inheritance confidence is intentionally lower than direct neighborhood metrics',
  'City-level migration context inherited by neighborhoods.',
  ARRAY['Municipality-level context'],
  ARRAY['migration','net migration','הגירה']),
 ('construction_starts','Municipal construction starts context','neighborhood','neighborhood_metric_snapshots',
  'metric_key=construction_starts','as_of_date','units','latest','latest','municipality','city_to_neighborhood',
  'inheritance confidence is intentionally lower than direct neighborhood metrics',
  'City-level housing supply context inherited by neighborhoods.',
  ARRAY['Municipality-level context','More supply is not inherently positive or negative'],
  ARRAY['housing starts','construction','התחלות בנייה'])
ON CONFLICT(metric_key) DO UPDATE SET
 label=EXCLUDED.label,preferred_table=EXCLUDED.preferred_table,expression_hint=EXCLUDED.expression_hint,
 time_field=EXCLUDED.time_field,unit=EXCLUDED.unit,default_window=EXCLUDED.default_window,
 aggregation=EXCLUDED.aggregation,source_grain=EXCLUDED.source_grain,inheritance=EXCLUDED.inheritance,
 confidence_rule=EXCLUDED.confidence_rule,description=EXCLUDED.description,caveats=EXCLUDED.caveats,
 synonyms=EXCLUDED.synonyms,metadata=EXCLUDED.metadata;

CREATE OR REPLACE VIEW semantic_neighborhood_metrics AS
SELECT
  n.id neighborhood_id,n.slug neighborhood_slug,n.name_he neighborhood_name,
  c.id city_id,c.name_he city_name,c.settlement_code,
  m.metric_key,d.label metric_label,d.category,d.preferred_dataset,
  m.numeric_value,m.text_value,m.sample_count,m.confidence,m.evidence_count,
  m.source_datasets,m.source_evidence,m.as_of_date,m.calculated_at
FROM neighborhood_metric_snapshots m
JOIN neighborhoods n ON n.id=m.neighborhood_id
JOIN cities c ON c.id=n.city_id
JOIN neighborhood_metric_definitions d ON d.metric_key=m.metric_key;

CREATE OR REPLACE VIEW semantic_neighborhood_summary AS
SELECT n.id neighborhood_id,n.slug neighborhood_slug,n.name_he neighborhood_name,c.name_he city_name,c.settlement_code,
  mc.score_version,mc.deal_heat,mc.investment_score,mc.confidence_score,mc.confidence_level,mc.coverage_pct,
  mc.deal_count,mc.transaction_count_12m,mc.median_price_sqm_12m,mc.price_change_1y,
  mc.population_growth_22_24,mc.renewal_expansion_ratio,mc.estimated_gross_yield,
  mc.average_wage,mc.net_internal_migration,mc.construction_starts,mc.updated_at
FROM neighborhoods n JOIN cities c ON c.id=n.city_id
LEFT JOIN neighborhood_map_cache mc ON mc.neighborhood_id=n.id;

COMMENT ON VIEW semantic_neighborhood_metrics IS 'Primary long-form semantic view for agent questions about neighborhood metrics. Use metric_key and neighborhood_id/slug; inspect source_datasets and confidence.';
COMMENT ON VIEW semantic_neighborhood_summary IS 'Fast one-row-per-neighborhood semantic summary for comparison/map questions. For evidence/history use semantic_neighborhood_metrics and canonical fact tables.';
