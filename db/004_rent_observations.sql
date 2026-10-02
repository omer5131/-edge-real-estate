ALTER TABLE demographic_snapshots ADD COLUMN IF NOT EXISTS rental_households_pct numeric;
ALTER TABLE demographic_snapshots ADD COLUMN IF NOT EXISTS median_employee_wage_nis numeric;
ALTER TABLE demographic_snapshots ADD COLUMN IF NOT EXISTS median_self_employed_income_nis numeric;

CREATE TABLE IF NOT EXISTS rental_listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id text NOT NULL REFERENCES data_sources(id),
  source_listing_id text NOT NULL,
  city_id uuid REFERENCES cities(id),
  neighborhood_id uuid REFERENCES neighborhoods(id),
  canonical_address text,
  url text,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'active',
  UNIQUE(source_id,source_listing_id)
);

CREATE TABLE IF NOT EXISTS rental_listing_snapshots (
  id bigserial PRIMARY KEY,
  rental_listing_id uuid NOT NULL REFERENCES rental_listings(id) ON DELETE CASCADE,
  observed_at timestamptz NOT NULL DEFAULT now(),
  asking_rent_nis numeric NOT NULL,
  area_sqm numeric,
  rooms numeric,
  floor text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE(rental_listing_id,observed_at)
);

CREATE INDEX IF NOT EXISTS rental_listing_snapshots_time_idx ON rental_listing_snapshots(rental_listing_id,observed_at DESC);

INSERT INTO data_sources(id,name,kind,base_url,authority) VALUES
 ('yad2_rent','Yad2 Rental Listings','public_web','https://www.yad2.co.il/realestate/rent','Yad2 public listings'),
 ('cbs_census_2022','CBS Census 2022','dataset','https://census.cbs.gov.il','הלמ"ס'),
 ('xplan','Planning Administration XPLAN','gis','https://ags.iplan.gov.il/services/','מינהל התכנון')
ON CONFLICT(id) DO NOTHING;

CREATE OR REPLACE VIEW neighborhood_rent_metrics AS
WITH latest AS (
  SELECT DISTINCT ON (rental_listing_id)
    rental_listing_id,asking_rent_nis,area_sqm,rooms,observed_at
  FROM rental_listing_snapshots
  ORDER BY rental_listing_id,observed_at DESC
)
SELECT
  rl.neighborhood_id,
  count(*) FILTER (WHERE rl.status='active')::int AS active_supply,
  percentile_cont(.5) WITHIN GROUP(ORDER BY latest.asking_rent_nis)
    FILTER(WHERE rl.status='active') AS median_rent_nis,
  percentile_cont(.5) WITHIN GROUP(ORDER BY latest.asking_rent_nis/latest.area_sqm)
    FILTER(WHERE rl.status='active' AND latest.area_sqm>0) AS median_rent_pp_sqm,
  percentile_cont(.5) WITHIN GROUP(ORDER BY latest.asking_rent_nis)
    FILTER(WHERE rl.status='active' AND latest.rooms BETWEEN 2.5 AND 3.5) AS median_rent_3_rooms,
  max(latest.observed_at) AS observed_at
FROM rental_listings rl
JOIN latest ON latest.rental_listing_id=rl.id
GROUP BY rl.neighborhood_id;
