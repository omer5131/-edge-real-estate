-- Derived intelligence. These are reproducible views, not source facts.

CREATE OR REPLACE VIEW data_freshness AS
SELECT
  ds.id AS source_id,
  ds.name,
  ds.is_enabled,
  max(ir.finished_at) FILTER (WHERE ir.status='success') AS last_success_at,
  max(ir.finished_at) FILTER (WHERE ir.status='failed') AS last_failure_at,
  count(*) FILTER (WHERE ir.status='failed' AND ir.started_at > now()-interval '7 days') AS failures_7d
FROM data_sources ds
LEFT JOIN ingestion_runs ir ON ir.source_id=ds.id
GROUP BY ds.id,ds.name,ds.is_enabled;

CREATE OR REPLACE VIEW city_market_metrics_12m AS
SELECT
  c.id AS city_id,
  c.name_he,
  count(t.id) AS transaction_count,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY t.pp_sqm)
    FILTER (WHERE t.pp_sqm IS NOT NULL) AS median_pp_sqm,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY t.amount_nis)
    FILTER (WHERE t.amount_nis IS NOT NULL) AS median_transaction_price,
  max(t.deal_date) AS latest_transaction_date
FROM cities c
LEFT JOIN transactions t
  ON t.city_id=c.id AND t.deal_date >= current_date - interval '12 months'
GROUP BY c.id,c.name_he;

CREATE OR REPLACE VIEW renewal_city_summary AS
SELECT
  c.id AS city_id,
  c.name_he,
  count(rp.id) AS active_projects,
  coalesce(sum(rp.existing_units),0) AS existing_units_in_projects,
  coalesce(sum(rp.planned_units),0) AS planned_units,
  coalesce(sum(rp.additional_units),0) AS additional_units,
  count(*) FILTER (WHERE rp.in_execution) AS projects_in_execution,
  max(rp.observed_at) AS observed_at
FROM cities c
LEFT JOIN renewal_projects rp ON rp.city_id=c.id
GROUP BY c.id,c.name_he;

CREATE OR REPLACE VIEW listing_seller_signals AS
WITH ordered AS (
  SELECT
    ls.*,
    lag(ls.asking_price_nis) OVER (PARTITION BY ls.listing_id ORDER BY ls.observed_at) AS previous_price
  FROM listing_snapshots ls
),
agg AS (
  SELECT
    listing_id,
    min(observed_at) AS first_snapshot_at,
    max(observed_at) AS last_snapshot_at,
    count(*) FILTER (
      WHERE previous_price IS NOT NULL AND asking_price_nis < previous_price
    ) AS price_reductions
  FROM ordered
  GROUP BY listing_id
),
first_price AS (
  SELECT DISTINCT ON (listing_id) listing_id,asking_price_nis AS original_asking_price
  FROM listing_snapshots
  ORDER BY listing_id,observed_at ASC
),
last_price AS (
  SELECT DISTINCT ON (listing_id) listing_id,asking_price_nis AS current_asking_price
  FROM listing_snapshots
  ORDER BY listing_id,observed_at DESC
)
SELECT
  l.id AS listing_id,
  l.source_id,
  l.source_listing_id,
  l.first_seen_at,
  l.last_seen_at,
  greatest(0,extract(day FROM (l.last_seen_at-l.first_seen_at)))::int AS days_on_market,
  a.price_reductions::int,
  f.original_asking_price,
  lp.current_asking_price,
  CASE WHEN f.original_asking_price > 0 AND lp.current_asking_price IS NOT NULL
    THEN round(100*(f.original_asking_price-lp.current_asking_price)/f.original_asking_price,2)
  END AS total_reduction_pct
FROM listings l
LEFT JOIN agg a ON a.listing_id=l.id
LEFT JOIN first_price f ON f.listing_id=l.id
LEFT JOIN last_price lp ON lp.listing_id=l.id;
