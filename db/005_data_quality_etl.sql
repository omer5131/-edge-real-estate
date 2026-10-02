-- P0: explicit transaction semantics, resumable target-area ETL, and confidence metadata.

ALTER TABLE transactions ADD COLUMN IF NOT EXISTS ownership_fraction numeric;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS declared_amount_nis numeric;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS normalized_pp_sqm numeric;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS is_comparable boolean NOT NULL DEFAULT true;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS exclusion_reason text;

UPDATE transactions
SET declared_amount_nis = COALESCE(declared_amount_nis, amount_nis)
WHERE declared_amount_nis IS NULL;

CREATE TABLE IF NOT EXISTS target_parcels (
  id bigserial PRIMARY KEY,
  neighborhood_id uuid NOT NULL REFERENCES neighborhoods(id) ON DELETE CASCADE,
  parcel_id uuid NOT NULL REFERENCES parcels(id) ON DELETE CASCADE,
  discovery_source text NOT NULL,
  discovered_at timestamptz NOT NULL DEFAULT now(),
  last_deals_sync_at timestamptz,
  is_active boolean NOT NULL DEFAULT true,
  UNIQUE(neighborhood_id, parcel_id)
);

CREATE INDEX IF NOT EXISTS target_parcels_active_idx
  ON target_parcels(neighborhood_id, is_active, last_deals_sync_at);

CREATE TABLE IF NOT EXISTS etl_checkpoints (
  source_id text NOT NULL REFERENCES data_sources(id),
  job_key text NOT NULL,
  cursor jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'idle',
  last_started_at timestamptz,
  last_success_at timestamptz,
  last_error_at timestamptz,
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(source_id, job_key)
);

-- Seed parcel targets already discovered by real transaction/address resolution.
INSERT INTO target_parcels(neighborhood_id, parcel_id, discovery_source)
SELECT DISTINCT neighborhood_id, parcel_id, 'resolved_transaction'
FROM transactions
WHERE neighborhood_id IS NOT NULL AND parcel_id IS NOT NULL
ON CONFLICT(neighborhood_id, parcel_id) DO NOTHING;

-- Conservative comp population. Partial ownership and clearly implausible rows stay queryable,
-- but are never used in valuations.
CREATE OR REPLACE VIEW comparable_transactions AS
SELECT *
FROM transactions
WHERE is_comparable
  AND deal_date IS NOT NULL
  AND amount_nis > 0
  AND area_sqm BETWEEN 15 AND 400
  AND COALESCE(normalized_pp_sqm, pp_sqm) BETWEEN 5000 AND 100000
  AND (ownership_fraction IS NULL OR ownership_fraction >= 0.9);

CREATE OR REPLACE VIEW neighborhood_market_confidence AS
SELECT
  neighborhood_id,
  count(*) FILTER (WHERE deal_date >= current_date - interval '12 months')::int AS sample_12m,
  max(deal_date) AS latest_deal_date,
  CASE
    WHEN count(*) FILTER (WHERE deal_date >= current_date - interval '12 months') >= 20 THEN 'high'
    WHEN count(*) FILTER (WHERE deal_date >= current_date - interval '12 months') >= 8 THEN 'medium'
    WHEN count(*) FILTER (WHERE deal_date >= current_date - interval '12 months') >= 3 THEN 'low'
    ELSE 'insufficient'
  END AS confidence
FROM comparable_transactions
WHERE neighborhood_id IS NOT NULL
GROUP BY neighborhood_id;
