-- Edge canonical real-estate intelligence schema
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS data_sources (
  id text PRIMARY KEY,
  name text NOT NULL,
  kind text NOT NULL,
  base_url text,
  authority text,
  is_enabled boolean NOT NULL DEFAULT true,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ingestion_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id text NOT NULL REFERENCES data_sources(id),
  job_type text NOT NULL,
  scope jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL CHECK (status IN ('running','success','partial','failed')),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  fetched_count integer NOT NULL DEFAULT 0,
  inserted_count integer NOT NULL DEFAULT 0,
  updated_count integer NOT NULL DEFAULT 0,
  error_count integer NOT NULL DEFAULT 0,
  error_summary text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS raw_records (
  id bigserial PRIMARY KEY,
  source_id text NOT NULL REFERENCES data_sources(id),
  external_id text NOT NULL,
  entity_hint text,
  payload_hash text NOT NULL,
  payload jsonb NOT NULL,
  observed_at timestamptz NOT NULL DEFAULT now(),
  source_updated_at timestamptz,
  ingestion_run_id uuid REFERENCES ingestion_runs(id),
  UNIQUE (source_id, external_id, payload_hash)
);
CREATE INDEX IF NOT EXISTS raw_records_source_external_idx ON raw_records(source_id, external_id);
CREATE INDEX IF NOT EXISTS raw_records_payload_gin ON raw_records USING gin(payload);

CREATE TABLE IF NOT EXISTS cities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name_he text NOT NULL,
  name_en text,
  settlement_code text,
  district text,
  geom geometry(MultiPolygon,4326),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (name_he)
);

CREATE TABLE IF NOT EXISTS neighborhoods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  city_id uuid NOT NULL REFERENCES cities(id),
  name_he text NOT NULL,
  name_en text,
  slug text NOT NULL UNIQUE,
  geom geometry(MultiPolygon,4326),
  is_focus boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (city_id, name_he)
);
CREATE INDEX IF NOT EXISTS neighborhoods_geom_gix ON neighborhoods USING gist(geom);

CREATE TABLE IF NOT EXISTS statistical_areas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  city_id uuid REFERENCES cities(id),
  stat_area_code text NOT NULL,
  year integer,
  population integer,
  socio_economic_cluster numeric,
  geom geometry(MultiPolygon,4326),
  source_id text REFERENCES data_sources(id),
  observed_at timestamptz NOT NULL DEFAULT now(),
  raw_record_id bigint REFERENCES raw_records(id),
  UNIQUE (stat_area_code, year)
);
CREATE INDEX IF NOT EXISTS statistical_areas_geom_gix ON statistical_areas USING gist(geom);

CREATE TABLE IF NOT EXISTS streets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  city_id uuid NOT NULL REFERENCES cities(id),
  name_he text NOT NULL,
  normalized_name text NOT NULL,
  source_street_code text,
  UNIQUE (city_id, normalized_name)
);

CREATE TABLE IF NOT EXISTS parcels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  city_id uuid REFERENCES cities(id),
  gush integer NOT NULL,
  helka integer NOT NULL,
  suffix text NOT NULL DEFAULT '',
  centroid geometry(Point,4326),
  geom geometry(MultiPolygon,4326),
  stat_area_id uuid REFERENCES statistical_areas(id),
  source_id text REFERENCES data_sources(id),
  observed_at timestamptz NOT NULL DEFAULT now(),
  raw_record_id bigint REFERENCES raw_records(id),
  UNIQUE (gush, helka, suffix)
);
CREATE INDEX IF NOT EXISTS parcels_geom_gix ON parcels USING gist(geom);

CREATE TABLE IF NOT EXISTS buildings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  city_id uuid NOT NULL REFERENCES cities(id),
  neighborhood_id uuid REFERENCES neighborhoods(id),
  street_id uuid REFERENCES streets(id),
  parcel_id uuid REFERENCES parcels(id),
  street_number text,
  canonical_address text NOT NULL,
  lat double precision,
  lon double precision,
  built_year integer,
  floors integer,
  units integer,
  geom geometry(Point,4326),
  source_id text REFERENCES data_sources(id),
  observed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (city_id, canonical_address)
);
CREATE INDEX IF NOT EXISTS buildings_geom_gix ON buildings USING gist(geom);

CREATE TABLE IF NOT EXISTS properties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id uuid NOT NULL REFERENCES buildings(id),
  sub_parcel text,
  floor numeric,
  rooms numeric,
  area_sqm numeric,
  property_type text,
  last_verified_at timestamptz,
  UNIQUE (building_id, sub_parcel)
);

CREATE TABLE IF NOT EXISTS transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id text NOT NULL REFERENCES data_sources(id),
  source_external_id text NOT NULL,
  raw_record_id bigint REFERENCES raw_records(id),
  city_id uuid REFERENCES cities(id),
  parcel_id uuid REFERENCES parcels(id),
  property_id uuid REFERENCES properties(id),
  deal_date date,
  amount_nis numeric,
  area_sqm numeric,
  rooms numeric,
  floor numeric,
  nature text,
  pp_sqm numeric GENERATED ALWAYS AS (
    CASE WHEN area_sqm > 0 AND amount_nis > 0 THEN amount_nis / area_sqm ELSE NULL END
  ) STORED,
  source_updated_at timestamptz,
  observed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_id, source_external_id)
);
CREATE INDEX IF NOT EXISTS transactions_city_date_idx ON transactions(city_id, deal_date DESC);
CREATE INDEX IF NOT EXISTS transactions_parcel_date_idx ON transactions(parcel_id, deal_date DESC);

CREATE TABLE IF NOT EXISTS listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id text NOT NULL REFERENCES data_sources(id),
  source_listing_id text NOT NULL,
  property_id uuid REFERENCES properties(id),
  building_id uuid REFERENCES buildings(id),
  city_id uuid REFERENCES cities(id),
  neighborhood_id uuid REFERENCES neighborhoods(id),
  canonical_address text,
  url text,
  first_seen_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'active',
  UNIQUE (source_id, source_listing_id)
);

CREATE TABLE IF NOT EXISTS listing_snapshots (
  id bigserial PRIMARY KEY,
  listing_id uuid NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  observed_at timestamptz NOT NULL DEFAULT now(),
  asking_price_nis numeric,
  area_sqm numeric,
  rooms numeric,
  floor numeric,
  broker_name text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (listing_id, observed_at)
);
CREATE INDEX IF NOT EXISTS listing_snapshots_listing_time_idx ON listing_snapshots(listing_id, observed_at DESC);

CREATE TABLE IF NOT EXISTS renewal_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id text NOT NULL REFERENCES data_sources(id),
  source_project_id text NOT NULL,
  city_id uuid REFERENCES cities(id),
  neighborhood_id uuid REFERENCES neighborhoods(id),
  project_name text,
  developer text,
  plan_number text,
  route text,
  status text,
  stage text,
  existing_units integer,
  planned_units integer,
  additional_units integer,
  permits_count integer,
  declared_at date,
  effective_year integer,
  in_execution boolean,
  planning_certainty numeric,
  source_url text,
  map_url text,
  geom geometry(MultiPolygon,4326),
  source_updated_at timestamptz,
  observed_at timestamptz NOT NULL DEFAULT now(),
  raw_record_id bigint REFERENCES raw_records(id),
  UNIQUE (source_id, source_project_id)
);
CREATE INDEX IF NOT EXISTS renewal_projects_geom_gix ON renewal_projects USING gist(geom);

CREATE TABLE IF NOT EXISTS renewal_project_parcels (
  project_id uuid NOT NULL REFERENCES renewal_projects(id) ON DELETE CASCADE,
  parcel_id uuid NOT NULL REFERENCES parcels(id) ON DELETE CASCADE,
  PRIMARY KEY (project_id, parcel_id)
);

CREATE TABLE IF NOT EXISTS planning_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id text NOT NULL REFERENCES data_sources(id),
  source_plan_id text NOT NULL,
  plan_number text,
  name text,
  status text,
  authority text,
  approved_at date,
  deposited_at date,
  housing_units integer,
  source_url text,
  geom geometry(MultiPolygon,4326),
  source_updated_at timestamptz,
  observed_at timestamptz NOT NULL DEFAULT now(),
  raw_record_id bigint REFERENCES raw_records(id),
  UNIQUE (source_id, source_plan_id)
);

CREATE TABLE IF NOT EXISTS demographic_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  neighborhood_id uuid REFERENCES neighborhoods(id),
  stat_area_id uuid REFERENCES statistical_areas(id),
  source_id text NOT NULL REFERENCES data_sources(id),
  period_year integer NOT NULL,
  population integer,
  households integer,
  avg_household_income_nis numeric,
  academic_pct numeric,
  socio_economic_cluster numeric,
  population_growth_pct numeric,
  age_distribution jsonb NOT NULL DEFAULT '{}'::jsonb,
  household_composition jsonb NOT NULL DEFAULT '{}'::jsonb,
  observed_at timestamptz NOT NULL DEFAULT now(),
  raw_record_id bigint REFERENCES raw_records(id),
  UNIQUE NULLS NOT DISTINCT (source_id, neighborhood_id, stat_area_id, period_year)
);

CREATE TABLE IF NOT EXISTS infrastructure_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id text NOT NULL REFERENCES data_sources(id),
  source_project_id text NOT NULL,
  name text NOT NULL,
  category text,
  status text,
  expected_completion date,
  description text,
  geom geometry(Geometry,4326),
  source_url text,
  observed_at timestamptz NOT NULL DEFAULT now(),
  raw_record_id bigint REFERENCES raw_records(id),
  UNIQUE (source_id, source_project_id)
);

CREATE TABLE IF NOT EXISTS entity_aliases (
  id bigserial PRIMARY KEY,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  source_id text NOT NULL REFERENCES data_sources(id),
  alias_type text NOT NULL,
  alias_value text NOT NULL,
  confidence numeric NOT NULL DEFAULT 1.0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (source_id, alias_type, alias_value)
);

CREATE TABLE IF NOT EXISTS opportunity_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL CHECK (entity_type IN ('neighborhood','building','property','listing')),
  entity_id uuid NOT NULL,
  score numeric NOT NULL CHECK (score >= 0 AND score <= 100),
  price_gap_score numeric,
  renewal_score numeric,
  area_momentum_score numeric,
  yield_score numeric,
  seller_motivation_score numeric,
  comp_confidence_score numeric,
  risk_deduction numeric,
  model_version text NOT NULL,
  inputs jsonb NOT NULL DEFAULT '{}'::jsonb,
  explanation jsonb NOT NULL DEFAULT '{}'::jsonb,
  calculated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS opportunity_scores_entity_idx ON opportunity_scores(entity_type, entity_id, calculated_at DESC);

CREATE TABLE IF NOT EXISTS deals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid REFERENCES properties(id),
  listing_id uuid REFERENCES listings(id),
  stage text NOT NULL DEFAULT 'Lead',
  status text NOT NULL DEFAULT 'open',
  asking_price_nis numeric,
  offer_price_nis numeric,
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  next_action text,
  contact jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes text,
  due_diligence jsonb NOT NULL DEFAULT '{}'::jsonb,
  documents jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO data_sources (id,name,kind,base_url,authority) VALUES
  ('over_deals','OVER Real Estate Deals','rest','https://www.over.org.il/api/deals','רשות המסים / OVER'),
  ('over_nadlan','OVER נדל"ן לעם','rest','https://www.over.org.il/api/nadlan','OVER'),
  ('over_gov','OVER Government Archive','rest','https://www.over.org.il/api','data.gov.il / OVER'),
  ('urban_renewal_gov','Government Urban Renewal','dataset','https://data.gov.il','הרשות הממשלתית להתחדשות עירונית'),
  ('cbs','CBS / הלמ"ס','dataset','https://www.cbs.gov.il','הלמ"ס'),
  ('listing_feed','Authorized Listing Feed','feed',NULL,'Configured provider')
ON CONFLICT (id) DO NOTHING;

INSERT INTO cities (name_he, name_en) VALUES
  ('חיפה','Haifa'), ('נתניה','Netanya'), ('פתח תקווה','Petah Tikva')
ON CONFLICT (name_he) DO NOTHING;

INSERT INTO neighborhoods (city_id,name_he,name_en,slug,is_focus)
SELECT c.id, v.name_he, v.name_en, v.slug, true
FROM (VALUES
  ('חיפה','קריית אליעזר','Kiryat Eliezer','kiryat-eliezer-haifa'),
  ('חיפה','קריית שפרינצק','Kiryat Sprinzak','kiryat-sprinzak-haifa'),
  ('נתניה','קריית נורדאו','Kiryat Nordau','kiryat-nordau-netanya'),
  ('פתח תקווה','יוספטל','Yoseftal','yoseftal-petah-tikva')
) v(city_name,name_he,name_en,slug)
JOIN cities c ON c.name_he=v.city_name
ON CONFLICT (slug) DO NOTHING;
