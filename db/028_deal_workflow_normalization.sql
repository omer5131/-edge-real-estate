-- Edge deal workflow normalization.
-- Phase 0 design artifact: additive only; do not auto-apply until reviewed.

CREATE TABLE IF NOT EXISTS deal_scenarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  name text NOT NULL,
  scenario_type text NOT NULL DEFAULT 'custom'
    CHECK (scenario_type IN ('conservative','base','upside','custom')),
  is_primary boolean NOT NULL DEFAULT false,
  assumptions jsonb NOT NULL DEFAULT '{}'::jsonb,
  outputs jsonb NOT NULL DEFAULT '{}'::jsonb,
  calculation_version text,
  calculated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS deal_scenarios_deal_idx
  ON deal_scenarios(deal_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS deal_scenarios_one_primary_idx
  ON deal_scenarios(deal_id)
  WHERE is_primary;

CREATE TABLE IF NOT EXISTS investment_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid REFERENCES deals(id) ON DELETE CASCADE,
  listing_id uuid REFERENCES listings(id) ON DELETE CASCADE,
  property_id uuid REFERENCES properties(id) ON DELETE CASCADE,
  building_id uuid REFERENCES buildings(id) ON DELETE CASCADE,
  neighborhood_id uuid REFERENCES neighborhoods(id) ON DELETE CASCADE,
  category text NOT NULL DEFAULT 'general'
    CHECK (category IN ('seller','visit','legal','building','renovation','financing','renewal','general')),
  content text NOT NULL,
  evidence_url text,
  attachment_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    deal_id IS NOT NULL OR listing_id IS NOT NULL OR property_id IS NOT NULL
    OR building_id IS NOT NULL OR neighborhood_id IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS investment_notes_deal_idx
  ON investment_notes(deal_id, created_at DESC);
CREATE INDEX IF NOT EXISTS investment_notes_listing_idx
  ON investment_notes(listing_id, created_at DESC);
CREATE INDEX IF NOT EXISTS investment_notes_neighborhood_idx
  ON investment_notes(neighborhood_id, created_at DESC);

CREATE TABLE IF NOT EXISTS due_diligence_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  section text NOT NULL,
  item_key text NOT NULL,
  label text NOT NULL,
  status text NOT NULL DEFAULT 'unknown'
    CHECK (status IN ('unknown','in_progress','verified','issue','not_applicable')),
  notes text,
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(deal_id,item_key)
);

CREATE INDEX IF NOT EXISTS due_diligence_deal_status_idx
  ON due_diligence_items(deal_id,status,sort_order);

CREATE TABLE IF NOT EXISTS deal_events (
  id bigserial PRIMARY KEY,
  deal_id uuid NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  listing_id uuid REFERENCES listings(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  event_at timestamptz NOT NULL DEFAULT now(),
  actor_type text NOT NULL DEFAULT 'system'
    CHECK (actor_type IN ('user','system','agent','source')),
  summary text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS deal_events_deal_time_idx
  ON deal_events(deal_id,event_at DESC);
CREATE INDEX IF NOT EXISTS deal_events_listing_time_idx
  ON deal_events(listing_id,event_at DESC)
  WHERE listing_id IS NOT NULL;
