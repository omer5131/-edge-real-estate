-- Manual/external listing intake.
INSERT INTO data_sources(id,name,kind,base_url,authority,is_enabled,config)
VALUES('external_manual','External / Manual Listing Intake','listing',NULL,'user',true,'{"manual":true,"supports":["sale","rent","url"]}'::jsonb)
ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,is_enabled=true,config=EXCLUDED.config,updated_at=now();

CREATE TABLE IF NOT EXISTS external_listing_intake (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intake_mode text NOT NULL CHECK(intake_mode IN ('url','manual')),
  listing_type text NOT NULL CHECK(listing_type IN ('sale','rent')),
  url text,
  source_listing_key text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processed','needs_input','failed')),
  submitted_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  extracted_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_listing_id uuid,
  canonical_rental_listing_id uuid,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  UNIQUE(listing_type,source_listing_key)
);
CREATE INDEX IF NOT EXISTS external_listing_intake_status_idx ON external_listing_intake(status,created_at DESC);
