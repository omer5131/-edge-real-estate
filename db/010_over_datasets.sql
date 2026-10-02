-- Independent OVER dataset cache. Original columns are added as generated text columns.
CREATE TABLE IF NOT EXISTS over_datasets (
  dataset_id uuid PRIMARY KEY,
  title text NOT NULL,
  table_name text NOT NULL UNIQUE,
  source_table text,
  source_schema jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  date_column text,
  min_record_year integer NOT NULL DEFAULT 2022 CHECK(min_record_year BETWEEN 1900 AND 2100),
  enabled boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','backfilling','syncing','healthy','failed','disabled')),
  cursor jsonb,
  watermark jsonb,
  row_count bigint NOT NULL DEFAULT 0,
  last_checked_at timestamptz,
  last_success_at timestamptz,
  last_reconciled_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS over_sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id uuid NOT NULL REFERENCES over_datasets(dataset_id),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status text NOT NULL DEFAULT 'running',
  fetched_count bigint NOT NULL DEFAULT 0,
  inserted_count bigint NOT NULL DEFAULT 0,
  checkpoint jsonb,
  error text
);
CREATE INDEX IF NOT EXISTS over_sync_runs_dataset_idx ON over_sync_runs(dataset_id,started_at DESC);
CREATE TABLE IF NOT EXISTS over_sync_lock (
  name text PRIMARY KEY,
  owner uuid NOT NULL,
  expires_at timestamptz NOT NULL
);
INSERT INTO over_datasets(dataset_id,title,table_name) VALUES
 ('30fc7a04-0576-4b90-97c8-553c84f4fb73','Haifa streets and statistical areas','over_30fc7a0405764b9097c8553c84f4fb73'),
 ('fd06f5ae-8a4f-4120-b275-8a514ad23499','Israel real-estate transactions — Tax Authority','over_fd06f5ae8a4f4120b2758a514ad23499')
ON CONFLICT(dataset_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS over_30fc7a0405764b9097c8553c84f4fb73 (
 _edge_hash text PRIMARY KEY, _edge_source_key text NOT NULL, _edge_payload jsonb NOT NULL,
 _edge_loaded_at timestamptz NOT NULL DEFAULT now(), _edge_seen_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE over_30fc7a0405764b9097c8553c84f4fb73 ADD COLUMN IF NOT EXISTS "סוג רחוב" text GENERATED ALWAYS AS (_edge_payload->>'סוג רחוב') STORED;
ALTER TABLE over_30fc7a0405764b9097c8553c84f4fb73 ADD COLUMN IF NOT EXISTS "שם רחוב" text GENERATED ALWAYS AS (_edge_payload->>'שם רחוב') STORED;
ALTER TABLE over_30fc7a0405764b9097c8553c84f4fb73 ADD COLUMN IF NOT EXISTS "סמל" text GENERATED ALWAYS AS (_edge_payload->>'סמל') STORED;
ALTER TABLE over_30fc7a0405764b9097c8553c84f4fb73 ADD COLUMN IF NOT EXISTS "מבית" text GENERATED ALWAYS AS (_edge_payload->>'מבית') STORED;
ALTER TABLE over_30fc7a0405764b9097c8553c84f4fb73 ADD COLUMN IF NOT EXISTS "עד בית" text GENERATED ALWAYS AS (_edge_payload->>'עד בית') STORED;
ALTER TABLE over_30fc7a0405764b9097c8553c84f4fb73 ADD COLUMN IF NOT EXISTS "שיוך לאזור סטטיסטי" text GENERATED ALWAYS AS (_edge_payload->>'שיוך לאזור סטטיסטי') STORED;
ALTER TABLE over_30fc7a0405764b9097c8553c84f4fb73 ADD COLUMN IF NOT EXISTS "שם אזור סטטסיטי" text GENERATED ALWAYS AS (_edge_payload->>'שם אזור סטטסיטי') STORED;
ALTER TABLE over_30fc7a0405764b9097c8553c84f4fb73 ADD COLUMN IF NOT EXISTS "first_seen" text GENERATED ALWAYS AS (_edge_payload->>'first_seen') STORED;
ALTER TABLE over_30fc7a0405764b9097c8553c84f4fb73 ADD COLUMN IF NOT EXISTS "row_hash" text GENERATED ALWAYS AS (_edge_payload->>'row_hash') STORED;
CREATE INDEX IF NOT EXISTS over_30fc7a0405764b9097c8553c84f4fb73_source_key ON over_30fc7a0405764b9097c8553c84f4fb73(_edge_source_key);

CREATE TABLE IF NOT EXISTS over_fd06f5ae8a4f4120b2758a514ad23499 (
 _edge_hash text PRIMARY KEY, _edge_source_key text NOT NULL, _edge_payload jsonb NOT NULL,
 _edge_loaded_at timestamptz NOT NULL DEFAULT now(), _edge_seen_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE over_fd06f5ae8a4f4120b2758a514ad23499 ADD COLUMN IF NOT EXISTS "settlement_code" text GENERATED ALWAYS AS (_edge_payload->>'settlement_code') STORED;
ALTER TABLE over_fd06f5ae8a4f4120b2758a514ad23499 ADD COLUMN IF NOT EXISTS "settlement" text GENERATED ALWAYS AS (_edge_payload->>'settlement') STORED;
ALTER TABLE over_fd06f5ae8a4f4120b2758a514ad23499 ADD COLUMN IF NOT EXISTS "gush" text GENERATED ALWAYS AS (_edge_payload->>'gush') STORED;
ALTER TABLE over_fd06f5ae8a4f4120b2758a514ad23499 ADD COLUMN IF NOT EXISTS "chelka" text GENERATED ALWAYS AS (_edge_payload->>'chelka') STORED;
ALTER TABLE over_fd06f5ae8a4f4120b2758a514ad23499 ADD COLUMN IF NOT EXISTS "sub_chelka" text GENERATED ALWAYS AS (_edge_payload->>'sub_chelka') STORED;
ALTER TABLE over_fd06f5ae8a4f4120b2758a514ad23499 ADD COLUMN IF NOT EXISTS "deal_date" text GENERATED ALWAYS AS (_edge_payload->>'deal_date') STORED;
ALTER TABLE over_fd06f5ae8a4f4120b2758a514ad23499 ADD COLUMN IF NOT EXISTS "deal_amount" text GENERATED ALWAYS AS (_edge_payload->>'deal_amount') STORED;
ALTER TABLE over_fd06f5ae8a4f4120b2758a514ad23499 ADD COLUMN IF NOT EXISTS "declared_amount" text GENERATED ALWAYS AS (_edge_payload->>'declared_amount') STORED;
ALTER TABLE over_fd06f5ae8a4f4120b2758a514ad23499 ADD COLUMN IF NOT EXISTS "deal_nature" text GENERATED ALWAYS AS (_edge_payload->>'deal_nature') STORED;
ALTER TABLE over_fd06f5ae8a4f4120b2758a514ad23499 ADD COLUMN IF NOT EXISTS "portion" text GENERATED ALWAYS AS (_edge_payload->>'portion') STORED;
ALTER TABLE over_fd06f5ae8a4f4120b2758a514ad23499 ADD COLUMN IF NOT EXISTS "year_built" text GENERATED ALWAYS AS (_edge_payload->>'year_built') STORED;
ALTER TABLE over_fd06f5ae8a4f4120b2758a514ad23499 ADD COLUMN IF NOT EXISTS "asset_area" text GENERATED ALWAYS AS (_edge_payload->>'asset_area') STORED;
ALTER TABLE over_fd06f5ae8a4f4120b2758a514ad23499 ADD COLUMN IF NOT EXISTS "room_num" text GENERATED ALWAYS AS (_edge_payload->>'room_num') STORED;
ALTER TABLE over_fd06f5ae8a4f4120b2758a514ad23499 ADD COLUMN IF NOT EXISTS "scraped_at" text GENERATED ALWAYS AS (_edge_payload->>'scraped_at') STORED;
ALTER TABLE over_fd06f5ae8a4f4120b2758a514ad23499 ADD COLUMN IF NOT EXISTS "first_seen" text GENERATED ALWAYS AS (_edge_payload->>'first_seen') STORED;
ALTER TABLE over_fd06f5ae8a4f4120b2758a514ad23499 ADD COLUMN IF NOT EXISTS "row_hash" text GENERATED ALWAYS AS (_edge_payload->>'row_hash') STORED;
CREATE INDEX IF NOT EXISTS over_fd06f5ae8a4f4120b2758a514ad23499_source_key ON over_fd06f5ae8a4f4120b2758a514ad23499(_edge_source_key);

ALTER TABLE over_datasets ADD COLUMN IF NOT EXISTS date_column text;
ALTER TABLE over_datasets ADD COLUMN IF NOT EXISTS min_record_year integer NOT NULL DEFAULT 2022;
UPDATE over_datasets SET date_column='deal_date' WHERE dataset_id='fd06f5ae-8a4f-4120-b275-8a514ad23499' AND date_column IS NULL;
