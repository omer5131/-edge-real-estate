-- Extend neighborhood market analytics with liquidity and listing lifecycle signals.

ALTER TABLE neighborhood_market_periods
  ADD COLUMN IF NOT EXISTS transaction_count_3m integer,
  ADD COLUMN IF NOT EXISTS months_of_sale_inventory numeric,
  ADD COLUMN IF NOT EXISTS sale_listing_to_transaction_ratio numeric;

ALTER TABLE listing_market_benchmarks
  ADD COLUMN IF NOT EXISTS first_seen_at timestamptz,
  ADD COLUMN IF NOT EXISTS days_on_market integer,
  ADD COLUMN IF NOT EXISTS first_asking_price_nis numeric,
  ADD COLUMN IF NOT EXISTS price_change_since_first_pct numeric,
  ADD COLUMN IF NOT EXISTS snapshot_count integer,
  ADD COLUMN IF NOT EXISTS executed_percentile numeric,
  ADD COLUMN IF NOT EXISTS relative_value_signal text;

DROP VIEW IF EXISTS semantic_neighborhood_market_history;
CREATE VIEW semantic_neighborhood_market_history AS
SELECT
  n.id neighborhood_id,n.slug,n.name_he neighborhood_name,c.name_he city_name,
  p.period_type,p.period_start,
  p.executed_transaction_count,p.transaction_count_3m,
  p.median_executed_price_nis,p.median_executed_price_sqm,
  p.p25_executed_price_sqm,p.p75_executed_price_sqm,p.median_area_sqm,p.median_rooms,
  p.active_sale_listing_count,p.median_asking_price_nis,p.median_asking_price_sqm,
  p.active_rent_listing_count,p.median_asking_rent_nis,p.median_rent_sqm,
  p.asking_to_executed_premium_pct,p.months_of_sale_inventory,p.sale_listing_to_transaction_ratio,
  p.transaction_confidence,p.listing_confidence,p.calculated_at
FROM neighborhood_market_periods p
JOIN neighborhoods n ON n.id=p.neighborhood_id
JOIN cities c ON c.id=n.city_id;

DROP VIEW IF EXISTS semantic_listing_market_benchmarks;
CREATE VIEW semantic_listing_market_benchmarks AS
SELECT
  b.listing_id,l.source_id,l.source_listing_id,l.canonical_address,l.url,l.status,
  n.id neighborhood_id,n.slug neighborhood_slug,n.name_he neighborhood_name,c.name_he city_name,
  b.listing_observed_at,b.first_seen_at,b.days_on_market,b.asking_price_nis,b.first_asking_price_nis,
  b.price_change_since_first_pct,b.snapshot_count,b.area_sqm,b.rooms,b.asking_price_sqm,
  b.historical_sample_count,b.matched_historical_sample_count,
  b.historical_median_price_sqm,b.matched_historical_median_price_sqm,
  b.current_listing_sample_count,b.current_listing_median_price_sqm,
  b.executed_discount_pct,b.matched_executed_discount_pct,b.current_asking_discount_pct,
  b.neighborhood_price_change_1y_pct,b.trend_adjusted_executed_price_sqm,b.trend_adjusted_discount_pct,
  b.executed_percentile,b.relative_value_signal,
  b.benchmark_confidence,b.benchmark_method,b.evidence,b.calculated_at
FROM listing_market_benchmarks b
JOIN listings l ON l.id=b.listing_id
JOIN neighborhoods n ON n.id=b.neighborhood_id
JOIN cities c ON c.id=n.city_id;
