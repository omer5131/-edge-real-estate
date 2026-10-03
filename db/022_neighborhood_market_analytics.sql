-- Neighborhood market analytics: historical transactions, current listings, CBS profile and listing benchmarks.

CREATE TABLE IF NOT EXISTS neighborhood_market_periods (
  neighborhood_id uuid NOT NULL REFERENCES neighborhoods(id) ON DELETE CASCADE,
  period_type text NOT NULL CHECK(period_type IN ('month','quarter','rolling_12m')),
  period_start date NOT NULL,
  executed_transaction_count integer NOT NULL DEFAULT 0,
  median_executed_price_nis numeric,
  median_executed_price_sqm numeric,
  p25_executed_price_sqm numeric,
  p75_executed_price_sqm numeric,
  median_area_sqm numeric,
  median_rooms numeric,
  active_sale_listing_count integer,
  median_asking_price_nis numeric,
  median_asking_price_sqm numeric,
  active_rent_listing_count integer,
  median_asking_rent_nis numeric,
  median_rent_sqm numeric,
  asking_to_executed_premium_pct numeric,
  transaction_confidence numeric CHECK(transaction_confidence IS NULL OR transaction_confidence BETWEEN 0 AND 1),
  listing_confidence numeric CHECK(listing_confidence IS NULL OR listing_confidence BETWEEN 0 AND 1),
  calculated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(neighborhood_id,period_type,period_start)
);
CREATE INDEX IF NOT EXISTS neighborhood_market_periods_recent_idx
  ON neighborhood_market_periods(neighborhood_id,period_type,period_start DESC);

CREATE TABLE IF NOT EXISTS neighborhood_cbs_profiles (
  neighborhood_id uuid NOT NULL REFERENCES neighborhoods(id) ON DELETE CASCADE,
  observation_year integer NOT NULL,
  population numeric,
  population_growth_from_2022_pct numeric,
  employment_pct numeric,
  academic_certificate_pct numeric,
  median_annual_employee_wage numeric,
  average_household_size numeric,
  owner_households_pct numeric,
  renter_households_pct numeric,
  median_age numeric,
  statistical_area_count integer NOT NULL DEFAULT 0,
  mapping_confidence numeric CHECK(mapping_confidence IS NULL OR mapping_confidence BETWEEN 0 AND 1),
  source_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  calculated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(neighborhood_id,observation_year)
);
CREATE INDEX IF NOT EXISTS neighborhood_cbs_profiles_latest_idx
  ON neighborhood_cbs_profiles(neighborhood_id,observation_year DESC);

CREATE TABLE IF NOT EXISTS listing_market_benchmarks (
  listing_id uuid PRIMARY KEY REFERENCES listings(id) ON DELETE CASCADE,
  neighborhood_id uuid NOT NULL REFERENCES neighborhoods(id) ON DELETE CASCADE,
  calculated_at timestamptz NOT NULL DEFAULT now(),
  listing_observed_at timestamptz,
  asking_price_nis numeric,
  area_sqm numeric,
  rooms numeric,
  asking_price_sqm numeric,
  historical_window_months integer NOT NULL DEFAULT 12,
  historical_sample_count integer NOT NULL DEFAULT 0,
  matched_historical_sample_count integer NOT NULL DEFAULT 0,
  historical_median_price_sqm numeric,
  matched_historical_median_price_sqm numeric,
  current_listing_sample_count integer NOT NULL DEFAULT 0,
  current_listing_median_price_sqm numeric,
  executed_discount_pct numeric,
  matched_executed_discount_pct numeric,
  current_asking_discount_pct numeric,
  neighborhood_price_change_1y_pct numeric,
  trend_adjusted_executed_price_sqm numeric,
  trend_adjusted_discount_pct numeric,
  benchmark_confidence numeric CHECK(benchmark_confidence IS NULL OR benchmark_confidence BETWEEN 0 AND 1),
  benchmark_method text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS listing_market_benchmarks_neighborhood_idx
  ON listing_market_benchmarks(neighborhood_id,benchmark_confidence DESC,calculated_at DESC);

CREATE OR REPLACE VIEW semantic_neighborhood_market_history AS
SELECT
  n.id neighborhood_id,n.slug,n.name_he neighborhood_name,c.name_he city_name,
  p.period_type,p.period_start,
  p.executed_transaction_count,p.median_executed_price_nis,p.median_executed_price_sqm,
  p.p25_executed_price_sqm,p.p75_executed_price_sqm,p.median_area_sqm,p.median_rooms,
  p.active_sale_listing_count,p.median_asking_price_nis,p.median_asking_price_sqm,
  p.active_rent_listing_count,p.median_asking_rent_nis,p.median_rent_sqm,
  p.asking_to_executed_premium_pct,p.transaction_confidence,p.listing_confidence,p.calculated_at
FROM neighborhood_market_periods p
JOIN neighborhoods n ON n.id=p.neighborhood_id
JOIN cities c ON c.id=n.city_id;

CREATE OR REPLACE VIEW semantic_listing_market_benchmarks AS
SELECT
  b.listing_id,l.source_id,l.source_listing_id,l.canonical_address,l.url,l.status,
  n.id neighborhood_id,n.slug neighborhood_slug,n.name_he neighborhood_name,c.name_he city_name,
  b.listing_observed_at,b.asking_price_nis,b.area_sqm,b.rooms,b.asking_price_sqm,
  b.historical_sample_count,b.matched_historical_sample_count,
  b.historical_median_price_sqm,b.matched_historical_median_price_sqm,
  b.current_listing_sample_count,b.current_listing_median_price_sqm,
  b.executed_discount_pct,b.matched_executed_discount_pct,b.current_asking_discount_pct,
  b.neighborhood_price_change_1y_pct,b.trend_adjusted_executed_price_sqm,b.trend_adjusted_discount_pct,
  b.benchmark_confidence,b.benchmark_method,b.evidence,b.calculated_at
FROM listing_market_benchmarks b
JOIN listings l ON l.id=b.listing_id
JOIN neighborhoods n ON n.id=b.neighborhood_id
JOIN cities c ON c.id=n.city_id;

CREATE OR REPLACE VIEW semantic_neighborhood_cbs_profile AS
SELECT
  p.neighborhood_id,n.slug,n.name_he neighborhood_name,c.name_he city_name,p.observation_year,
  p.population,p.population_growth_from_2022_pct,p.employment_pct,p.academic_certificate_pct,
  p.median_annual_employee_wage,p.average_household_size,p.owner_households_pct,p.renter_households_pct,
  p.median_age,p.statistical_area_count,p.mapping_confidence,p.source_evidence,p.calculated_at
FROM neighborhood_cbs_profiles p
JOIN neighborhoods n ON n.id=p.neighborhood_id
JOIN cities c ON c.id=n.city_id;

COMMENT ON TABLE listing_market_benchmarks IS
 'Per-listing market benchmark against executed historical transactions and current asking market at canonical neighborhood grain. Prefer matched room/size comps when sample is adequate.';
COMMENT ON VIEW semantic_neighborhood_market_history IS
 'Agent-safe neighborhood market trend view. Executed transactions and asking listings remain explicitly separate.';
COMMENT ON VIEW semantic_listing_market_benchmarks IS
 'Agent-safe active listing comparison view: discount/premium versus executed history, matched historical comps and current asking market.';
COMMENT ON VIEW semantic_neighborhood_cbs_profile IS
 'Neighborhood CBS profile aggregated only through safe statistical-area crosswalks.';
