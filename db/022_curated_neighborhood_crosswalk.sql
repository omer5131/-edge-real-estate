-- Curated neighborhood/statistical-area crosswalk evidence.
-- Used when an official source is accessible/indexed but the nationwide CBS key cannot be downloaded.

CREATE TABLE IF NOT EXISTS neighborhood_crosswalk_evidence (
  id bigserial PRIMARY KEY,
  neighborhood_id uuid NOT NULL REFERENCES neighborhoods(id) ON DELETE CASCADE,
  locality_code text,
  statistical_area_code text NOT NULL,
  boundary_reference_year integer,
  source_name text NOT NULL,
  source_url text NOT NULL,
  source_published_at date,
  evidence_type text NOT NULL CHECK(evidence_type IN ('official_municipal','official_government','official_cbs','trusted_secondary')),
  confidence numeric NOT NULL CHECK(confidence BETWEEN 0 AND 1),
  safe_for_identity boolean NOT NULL DEFAULT true,
  safe_for_analytics boolean NOT NULL DEFAULT false,
  safe_for_polygon boolean NOT NULL DEFAULT false,
  notes text,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(neighborhood_id,statistical_area_code,source_url)
);

CREATE INDEX IF NOT EXISTS neighborhood_crosswalk_evidence_neighborhood_idx
  ON neighborhood_crosswalk_evidence(neighborhood_id,statistical_area_code);
CREATE INDEX IF NOT EXISTS neighborhood_crosswalk_evidence_safe_idx
  ON neighborhood_crosswalk_evidence(safe_for_analytics,safe_for_polygon);

CREATE OR REPLACE VIEW semantic_neighborhood_crosswalk_evidence AS
SELECT
  e.id,n.id neighborhood_id,n.slug,n.name_he neighborhood_name,c.name_he city_name,
  e.locality_code,e.statistical_area_code,e.boundary_reference_year,
  e.source_name,e.source_url,e.source_published_at,e.evidence_type,
  e.confidence,e.safe_for_identity,e.safe_for_analytics,e.safe_for_polygon,e.notes,e.evidence,e.reviewed_at
FROM neighborhood_crosswalk_evidence e
JOIN neighborhoods n ON n.id=e.neighborhood_id
JOIN cities c ON c.id=n.city_id;

COMMENT ON TABLE neighborhood_crosswalk_evidence IS
 'Reviewed geography evidence. safe_for_identity may be true even when boundary vintage is insufficient for 2022 demographic aggregation.';
