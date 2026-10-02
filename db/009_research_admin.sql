CREATE TABLE IF NOT EXISTS score_configurations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 name text NOT NULL,
 is_active boolean NOT NULL DEFAULT false,
 model_version text NOT NULL,
 base_score numeric NOT NULL DEFAULT 50,
 price_gap_weight numeric NOT NULL DEFAULT 1.5,
 price_gap_min numeric NOT NULL DEFAULT -10,
 price_gap_max numeric NOT NULL DEFAULT 25,
 renewal_project_weight numeric NOT NULL DEFAULT 2,
 renewal_execution_bonus numeric NOT NULL DEFAULT 5,
 renewal_permit_bonus numeric NOT NULL DEFAULT 3,
 renewal_max numeric NOT NULL DEFAULT 18,
 seller_dom_divisor numeric NOT NULL DEFAULT 18,
 seller_reduction_weight numeric NOT NULL DEFAULT 3,
 seller_max numeric NOT NULL DEFAULT 14,
 comp_high_min integer NOT NULL DEFAULT 20,
 comp_medium_min integer NOT NULL DEFAULT 8,
 comp_min_required integer NOT NULL DEFAULT 3,
 comp_high_score numeric NOT NULL DEFAULT 10,
 comp_medium_score numeric NOT NULL DEFAULT 7,
 comp_low_score numeric NOT NULL DEFAULT 5,
 low_comp_risk numeric NOT NULL DEFAULT 4,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_score_config ON score_configurations(is_active) WHERE is_active;
INSERT INTO score_configurations(name,is_active,model_version)
SELECT 'Default Edge Score',true,'edge-v0.3'
WHERE NOT EXISTS(SELECT 1 FROM score_configurations);

CREATE TABLE IF NOT EXISTS followed_areas (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 neighborhood_id uuid NOT NULL REFERENCES neighborhoods(id) ON DELETE CASCADE,
 label text,
 is_active boolean NOT NULL DEFAULT true,
 research_depth text NOT NULL DEFAULT 'full' CHECK(research_depth IN ('basic','full')),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(neighborhood_id)
);
INSERT INTO followed_areas(neighborhood_id,label,is_active,research_depth)
SELECT id,name_he,true,'full' FROM neighborhoods WHERE is_focus
ON CONFLICT(neighborhood_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS asset_subscriptions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 entity_type text NOT NULL CHECK(entity_type IN ('listing','property','building','parcel')),
 entity_id uuid NOT NULL,
 status text NOT NULL DEFAULT 'watching' CHECK(status IN ('watching','shortlist','contacted','viewing','due_diligence','offer','archived')),
 enrichment_level text NOT NULL DEFAULT 'full' CHECK(enrichment_level IN ('basic','full')),
 notes text,
 subscribed_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(entity_type,entity_id)
);
CREATE INDEX IF NOT EXISTS asset_subscriptions_status_idx ON asset_subscriptions(status,updated_at DESC);

CREATE TABLE IF NOT EXISTS asset_research_snapshots (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 subscription_id uuid NOT NULL REFERENCES asset_subscriptions(id) ON DELETE CASCADE,
 observed_at timestamptz NOT NULL DEFAULT now(),
 asking_price_nis numeric,
 estimated_value_nis numeric,
 estimated_rent_nis numeric,
 opportunity_score numeric,
 seller_signal jsonb NOT NULL DEFAULT '{}'::jsonb,
 comp_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
 renewal_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
 planning_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
 source_freshness jsonb NOT NULL DEFAULT '{}'::jsonb,
 UNIQUE(subscription_id,observed_at)
);

CREATE OR REPLACE VIEW research_assets AS
WITH latest AS (
 SELECT DISTINCT ON(listing_id) listing_id,asking_price_nis,area_sqm,rooms,floor,observed_at
 FROM listing_snapshots ORDER BY listing_id,observed_at DESC
), score AS (
 SELECT DISTINCT ON(entity_id) entity_id,score,calculated_at,model_version
 FROM opportunity_scores WHERE entity_type='listing' ORDER BY entity_id,calculated_at DESC
)
SELECT l.id,l.source_id,l.source_listing_id,l.canonical_address,l.url,l.status,l.first_seen_at,l.last_seen_at,
 n.slug neighborhood_id,n.name_he neighborhood,c.name_he city,
 s.asking_price_nis,s.area_sqm,s.rooms,s.floor,s.observed_at,
 CASE WHEN s.area_sqm>0 THEN s.asking_price_nis/s.area_sqm END asking_pp_sqm,
 sc.score,sc.calculated_at score_at,sc.model_version,
 sub.id subscription_id,sub.status subscription_status,sub.enrichment_level,sub.subscribed_at
FROM listings l
JOIN neighborhoods n ON n.id=l.neighborhood_id
JOIN cities c ON c.id=l.city_id
LEFT JOIN latest s ON s.listing_id=l.id
LEFT JOIN score sc ON sc.entity_id=l.id
LEFT JOIN asset_subscriptions sub ON sub.entity_type='listing' AND sub.entity_id=l.id;
