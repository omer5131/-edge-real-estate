-- Neighborhood-first intelligence model.
-- Product grain: neighborhoods.id. Statistical areas/parcels remain supporting geography only.

CREATE TABLE IF NOT EXISTS neighborhood_stat_area_map (
  neighborhood_id uuid NOT NULL REFERENCES neighborhoods(id) ON DELETE CASCADE,
  stat_area_id uuid NOT NULL REFERENCES statistical_areas(id) ON DELETE CASCADE,
  overlap_ratio numeric CHECK(overlap_ratio IS NULL OR overlap_ratio BETWEEN 0 AND 1),
  mapping_method text NOT NULL CHECK(mapping_method IN ('verified','polygon_overlap','configured_crosswalk','derived_address')),
  mapping_confidence numeric NOT NULL DEFAULT 1 CHECK(mapping_confidence BETWEEN 0 AND 1),
  mapping_version text NOT NULL DEFAULT 'neighborhood-map-v1',
  mapped_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(neighborhood_id,stat_area_id)
);
CREATE INDEX IF NOT EXISTS neighborhood_stat_area_stat_idx ON neighborhood_stat_area_map(stat_area_id);

CREATE TABLE IF NOT EXISTS dataset_neighborhood_evidence (
  dataset_slug text NOT NULL,
  source_record_id text NOT NULL,
  neighborhood_id uuid NOT NULL REFERENCES neighborhoods(id) ON DELETE CASCADE,
  source_grain text NOT NULL,
  observation_date date,
  observation_year integer,
  mapping_method text NOT NULL,
  mapping_confidence numeric NOT NULL CHECK(mapping_confidence BETWEEN 0 AND 1),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  linked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(dataset_slug,source_record_id,neighborhood_id)
);
CREATE INDEX IF NOT EXISTS dataset_neighborhood_evidence_neighborhood_idx
  ON dataset_neighborhood_evidence(neighborhood_id,dataset_slug,observation_date DESC);
CREATE INDEX IF NOT EXISTS dataset_neighborhood_evidence_dataset_idx
  ON dataset_neighborhood_evidence(dataset_slug,source_record_id);

CREATE TABLE IF NOT EXISTS neighborhood_metric_definitions (
  metric_key text PRIMARY KEY,
  label text NOT NULL,
  category text NOT NULL,
  preferred_dataset text,
  aggregation text NOT NULL DEFAULT 'latest',
  unit text,
  normalization text NOT NULL DEFAULT 'city_percentile',
  description text,
  enabled boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS neighborhood_metric_snapshots (
  id bigserial PRIMARY KEY,
  neighborhood_id uuid NOT NULL REFERENCES neighborhoods(id) ON DELETE CASCADE,
  as_of_date date NOT NULL,
  metric_key text NOT NULL REFERENCES neighborhood_metric_definitions(metric_key),
  numeric_value numeric,
  text_value text,
  sample_count integer,
  confidence numeric CHECK(confidence IS NULL OR confidence BETWEEN 0 AND 1),
  evidence_count integer NOT NULL DEFAULT 0,
  source_datasets text[] NOT NULL DEFAULT '{}',
  source_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  calculated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(neighborhood_id,as_of_date,metric_key)
);
CREATE INDEX IF NOT EXISTS neighborhood_metric_latest_idx
  ON neighborhood_metric_snapshots(neighborhood_id,metric_key,as_of_date DESC);

CREATE TABLE IF NOT EXISTS neighborhood_score_snapshots (
  id bigserial PRIMARY KEY,
  neighborhood_id uuid NOT NULL REFERENCES neighborhoods(id) ON DELETE CASCADE,
  score_version text NOT NULL REFERENCES area_score_models(version),
  calculated_at timestamptz NOT NULL DEFAULT now(),
  deal_score_raw numeric CHECK(deal_score_raw IS NULL OR deal_score_raw BETWEEN 0 AND 100),
  deal_score_adjusted numeric CHECK(deal_score_adjusted IS NULL OR deal_score_adjusted BETWEEN 0 AND 100),
  investment_score numeric CHECK(investment_score IS NULL OR investment_score BETWEEN 0 AND 100),
  confidence_score numeric CHECK(confidence_score IS NULL OR confidence_score BETWEEN 0 AND 100),
  confidence_level text NOT NULL CHECK(confidence_level IN ('high','medium','low','insufficient')),
  coverage_pct numeric NOT NULL DEFAULT 0 CHECK(coverage_pct BETWEEN 0 AND 100),
  component_scores jsonb NOT NULL DEFAULT '{}'::jsonb,
  inputs jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS neighborhood_score_latest_idx
  ON neighborhood_score_snapshots(neighborhood_id,calculated_at DESC);

CREATE TABLE IF NOT EXISTS neighborhood_map_cache (
  neighborhood_id uuid PRIMARY KEY REFERENCES neighborhoods(id) ON DELETE CASCADE,
  score_version text,
  deal_heat numeric,
  investment_score numeric,
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
  average_wage numeric,
  net_internal_migration numeric,
  construction_starts numeric,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS neighborhood_map_heat_idx ON neighborhood_map_cache(deal_heat DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS neighborhood_map_score_idx ON neighborhood_map_cache(investment_score DESC NULLS LAST);

INSERT INTO neighborhood_metric_definitions(metric_key,label,category,preferred_dataset,aggregation,unit,normalization,description) VALUES
 ('deal_score_adjusted','Adjusted deal heat','deal','sale_listings','weighted_avg','score','none','Freshness/confidence weighted opportunity score with city-prior shrinkage.'),
 ('median_price_sqm_12m','Median executed price / sqm, 12m','market','transactions','median','NIS/sqm','city_percentile','Executed transactions only.'),
 ('price_change_1y','Executed price momentum, 1y','market','transactions','ratio','percent','city_percentile','Median price/sqm latest 12m versus preceding 12m.'),
 ('transaction_count_12m','Executed transactions, 12m','confidence','transactions','count','count','none','Recent executed transaction sample.'),
 ('population_growth_22_24','Population growth 2022-2024','demographics','area_population_2024','weighted_avg','percent','city_percentile','Aggregated from statistical areas mapped to neighborhood.'),
 ('employment_pct','Employment rate','demographics','census_2022','weighted_avg','percent','city_percentile','Population-weighted census metric where available.'),
 ('median_employee_wage','Median annual employee wage','economics','census_2022','weighted_avg','NIS','city_percentile','Neighborhood census wage where available.'),
 ('municipal_average_wage','Municipal average wage','economics','municipal_wages','latest','NIS','city_percentile','City-level context inherited by neighborhoods; never presented as neighborhood-specific measurement.'),
 ('net_internal_migration','Municipal net internal migration','demographics','municipal_migration','latest','people','city_percentile','City-level context inherited by neighborhoods.'),
 ('construction_starts','Municipal housing starts','supply','construction_starts','latest','units','city_percentile','City-level supply context inherited by neighborhoods.'),
 ('renewal_expansion_ratio','Renewal proposed/existing units','renewal','urban_renewal_complexes','ratio','ratio','city_percentile','Projects directly mapped to the neighborhood.'),
 ('estimated_gross_yield','Estimated gross rental yield','rental','rent_listings','ratio','percent','city_percentile','Comparable rent/sale categories only.'),
 ('infrastructure_access','Infrastructure accessibility','infrastructure','infrastructure_projects','weighted_score','score','city_percentile','Distance and project-status adjusted transport/infrastructure access.')
ON CONFLICT(metric_key) DO NOTHING;

CREATE OR REPLACE VIEW neighborhood_latest_scores AS
SELECT DISTINCT ON(neighborhood_id) *
FROM neighborhood_score_snapshots
ORDER BY neighborhood_id,calculated_at DESC;

COMMENT ON TABLE dataset_neighborhood_evidence IS
  'Canonical evidence bridge. Dashboard/score metrics must trace back to dataset rows through neighborhood_id.';
COMMENT ON TABLE neighborhood_metric_snapshots IS
  'Primary dashboard fact table. All analytical metrics are keyed by neighborhood_id regardless of source grain.';
