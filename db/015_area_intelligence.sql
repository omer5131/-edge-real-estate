-- Scalable statistical-area intelligence layer for map heat and dashboards.
-- Canonical grain: CBS statistical area boundary version 2022 (or later explicit versions).
CREATE TABLE IF NOT EXISTS area_dimensions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stat_area_id uuid UNIQUE REFERENCES statistical_areas(id) ON DELETE CASCADE,
  locality_code text NOT NULL,
  statistical_area_code text NOT NULL,
  boundary_year integer NOT NULL DEFAULT 2022,
  locality_name text,
  city_id uuid REFERENCES cities(id),
  geom geometry(MultiPolygon,4326),
  centroid geometry(Point,4326),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(locality_code,statistical_area_code,boundary_year)
);
CREATE INDEX IF NOT EXISTS area_dimensions_city_idx ON area_dimensions(city_id,boundary_year);
CREATE INDEX IF NOT EXISTS area_dimensions_geom_gix ON area_dimensions USING gist(geom);

CREATE TABLE IF NOT EXISTS transaction_area_map (
  transaction_id uuid PRIMARY KEY REFERENCES transactions(id) ON DELETE CASCADE,
  area_id uuid NOT NULL REFERENCES area_dimensions(id) ON DELETE CASCADE,
  mapping_method text NOT NULL CHECK(mapping_method IN ('parcel_stat_area','parcel_intersection','direct_geometry','verified_code')),
  mapping_confidence numeric NOT NULL CHECK(mapping_confidence BETWEEN 0 AND 1),
  mapping_version text NOT NULL DEFAULT 'area-map-v1',
  mapped_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS transaction_area_map_area_idx ON transaction_area_map(area_id);

CREATE TABLE IF NOT EXISTS listing_area_map (
  listing_id uuid PRIMARY KEY REFERENCES listings(id) ON DELETE CASCADE,
  area_id uuid NOT NULL REFERENCES area_dimensions(id) ON DELETE CASCADE,
  mapping_method text NOT NULL CHECK(mapping_method IN ('building_point','parcel_stat_area','parcel_intersection','verified_address','verified_code')),
  mapping_confidence numeric NOT NULL CHECK(mapping_confidence BETWEEN 0 AND 1),
  mapping_version text NOT NULL DEFAULT 'area-map-v1',
  mapped_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS listing_area_map_area_idx ON listing_area_map(area_id);

CREATE TABLE IF NOT EXISTS renewal_area_map (
  project_id uuid NOT NULL REFERENCES renewal_projects(id) ON DELETE CASCADE,
  area_id uuid NOT NULL REFERENCES area_dimensions(id) ON DELETE CASCADE,
  overlap_ratio numeric,
  mapping_version text NOT NULL DEFAULT 'area-map-v1',
  mapped_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(project_id,area_id)
);
CREATE INDEX IF NOT EXISTS renewal_area_map_area_idx ON renewal_area_map(area_id);

CREATE TABLE IF NOT EXISTS infrastructure_area_map (
  project_id uuid NOT NULL REFERENCES infrastructure_projects(id) ON DELETE CASCADE,
  area_id uuid NOT NULL REFERENCES area_dimensions(id) ON DELETE CASCADE,
  distance_m numeric NOT NULL,
  mapping_version text NOT NULL DEFAULT 'area-map-v1',
  mapped_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(project_id,area_id)
);
CREATE INDEX IF NOT EXISTS infrastructure_area_map_area_idx ON infrastructure_area_map(area_id,distance_m);

CREATE TABLE IF NOT EXISTS area_metric_definitions (
  metric_key text PRIMARY KEY,
  label text NOT NULL,
  component text NOT NULL CHECK(component IN ('deal','market','renewal','demographics','rental','infrastructure','supply','confidence','context')),
  value_type text NOT NULL DEFAULT 'number',
  unit text,
  direction text NOT NULL DEFAULT 'higher' CHECK(direction IN ('higher','lower','neutral')),
  normalization text NOT NULL DEFAULT 'city_percentile' CHECK(normalization IN ('city_percentile','national_percentile','absolute','none')),
  enabled boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS area_metric_snapshots (
  id bigserial PRIMARY KEY,
  area_id uuid NOT NULL REFERENCES area_dimensions(id) ON DELETE CASCADE,
  as_of_date date NOT NULL,
  metric_key text NOT NULL REFERENCES area_metric_definitions(metric_key),
  numeric_value numeric,
  text_value text,
  sample_count integer,
  confidence numeric CHECK(confidence IS NULL OR confidence BETWEEN 0 AND 1),
  source_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  calculated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(area_id,as_of_date,metric_key)
);
CREATE INDEX IF NOT EXISTS area_metric_snapshots_lookup_idx ON area_metric_snapshots(area_id,metric_key,as_of_date DESC);
CREATE INDEX IF NOT EXISTS area_metric_snapshots_metric_idx ON area_metric_snapshots(metric_key,as_of_date DESC);

CREATE TABLE IF NOT EXISTS area_score_models (
  version text PRIMARY KEY,
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT false,
  weights jsonb NOT NULL,
  parameters jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS area_score_models_one_active_idx ON area_score_models((is_active)) WHERE is_active;

CREATE TABLE IF NOT EXISTS area_score_snapshots (
  id bigserial PRIMARY KEY,
  area_id uuid NOT NULL REFERENCES area_dimensions(id) ON DELETE CASCADE,
  score_version text NOT NULL REFERENCES area_score_models(version),
  calculated_at timestamptz NOT NULL DEFAULT now(),
  deal_score_raw numeric CHECK(deal_score_raw IS NULL OR deal_score_raw BETWEEN 0 AND 100),
  deal_score_adjusted numeric CHECK(deal_score_adjusted IS NULL OR deal_score_adjusted BETWEEN 0 AND 100),
  area_score numeric CHECK(area_score IS NULL OR area_score BETWEEN 0 AND 100),
  confidence_score numeric CHECK(confidence_score IS NULL OR confidence_score BETWEEN 0 AND 100),
  confidence_level text NOT NULL CHECK(confidence_level IN ('high','medium','low','insufficient')),
  coverage_pct numeric NOT NULL DEFAULT 0 CHECK(coverage_pct BETWEEN 0 AND 100),
  component_scores jsonb NOT NULL DEFAULT '{}'::jsonb,
  inputs jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS area_score_snapshots_latest_idx ON area_score_snapshots(area_id,calculated_at DESC);

CREATE TABLE IF NOT EXISTS area_map_cache (
  area_id uuid PRIMARY KEY REFERENCES area_dimensions(id) ON DELETE CASCADE,
  score_version text,
  deal_heat numeric,
  area_score numeric,
  confidence_score numeric,
  confidence_level text,
  coverage_pct numeric,
  deal_count integer NOT NULL DEFAULT 0,
  transaction_count_12m integer NOT NULL DEFAULT 0,
  median_price_sqm_12m numeric,
  price_change_1y numeric,
  population_growth_22_24 numeric,
  renewal_expansion_ratio numeric,
  estimated_gross_yield numeric,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS area_map_cache_heat_idx ON area_map_cache(deal_heat DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS area_map_cache_score_idx ON area_map_cache(area_score DESC NULLS LAST);

CREATE TABLE IF NOT EXISTS area_refresh_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status text NOT NULL DEFAULT 'running' CHECK(status IN ('running','success','partial','failed')),
  score_version text,
  areas_processed integer NOT NULL DEFAULT 0,
  mappings_updated integer NOT NULL DEFAULT 0,
  metrics_updated integer NOT NULL DEFAULT 0,
  error text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

INSERT INTO area_metric_definitions(metric_key,label,component,unit,direction,normalization) VALUES
 ('deal_score_adjusted','Adjusted deal heat','deal','score','higher','none'),
 ('median_price_sqm_12m','Median executed price / sqm, 12m','market','NIS/sqm','neutral','city_percentile'),
 ('price_change_1y','Executed price momentum, 1y','market','percent','higher','city_percentile'),
 ('transaction_count_12m','Executed transactions, 12m','confidence','count','higher','none'),
 ('renewal_expansion_ratio','Renewal proposed/existing units','renewal','ratio','higher','city_percentile'),
 ('population_growth_22_24','Population growth 2022-2024','demographics','percent','higher','city_percentile'),
 ('estimated_gross_yield','Estimated gross rental yield','rental','percent','higher','city_percentile'),
 ('infrastructure_access','Infrastructure access','infrastructure','score','higher','city_percentile'),
 ('future_supply_ratio','Future housing supply ratio','supply','ratio','neutral','city_percentile')
ON CONFLICT(metric_key) DO NOTHING;

INSERT INTO area_score_models(version,name,is_active,weights,parameters,activated_at)
VALUES(
 'area-score-v1',
 'Area investment score v1',
 true,
 '{"deal":25,"market":15,"renewal":20,"demographics":15,"rental":10,"infrastructure":10,"supply":5}'::jsonb,
 '{"bayesian_k":5,"minimum_component_coverage_pct":60,"deal_max_age_days":60,"confidence":{"high":80,"medium":60,"low":35}}'::jsonb,
 now()
)
ON CONFLICT(version) DO NOTHING;

CREATE OR REPLACE VIEW area_latest_scores AS
SELECT DISTINCT ON(area_id) *
FROM area_score_snapshots
ORDER BY area_id,calculated_at DESC;

COMMENT ON TABLE area_dimensions IS 'Stable application geography. Dashboards and map APIs depend on this table, not raw provider-specific geography.';
COMMENT ON TABLE area_metric_snapshots IS 'Long-form metrics make new datasets/metrics additive without schema churn.';
COMMENT ON TABLE area_map_cache IS 'Small denormalized read model for interactive map/tile requests.';
