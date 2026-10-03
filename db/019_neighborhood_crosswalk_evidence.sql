-- Evidence-derived neighborhood/statistical-area crosswalk.
ALTER TABLE neighborhood_stat_area_map DROP CONSTRAINT IF EXISTS neighborhood_stat_area_map_mapping_method_check;
ALTER TABLE neighborhood_stat_area_map ADD CONSTRAINT neighborhood_stat_area_map_mapping_method_check
 CHECK(mapping_method IN ('verified','polygon_overlap','configured_crosswalk','derived_address','evidence_inference'));

ALTER TABLE neighborhood_stat_area_map ADD COLUMN IF NOT EXISTS evidence_count integer NOT NULL DEFAULT 0;
ALTER TABLE neighborhood_stat_area_map ADD COLUMN IF NOT EXISTS evidence_share numeric;
ALTER TABLE neighborhood_stat_area_map ADD COLUMN IF NOT EXISTS evidence jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN neighborhood_stat_area_map.evidence_share IS
 'Share of direct labeled evidence within this statistical area supporting the selected neighborhood.';

CREATE TABLE IF NOT EXISTS neighborhood_resolution_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 started_at timestamptz NOT NULL DEFAULT now(),
 finished_at timestamptz,
 status text NOT NULL DEFAULT 'running',
 candidate_pairs integer NOT NULL DEFAULT 0,
 accepted_pairs integer NOT NULL DEFAULT 0,
 ambiguous_stat_areas integer NOT NULL DEFAULT 0,
 metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE neighborhoods ADD COLUMN IF NOT EXISTS geom_source text;
ALTER TABLE neighborhoods ADD COLUMN IF NOT EXISTS geom_confidence numeric CHECK(geom_confidence IS NULL OR geom_confidence BETWEEN 0 AND 1);
ALTER TABLE neighborhoods ADD COLUMN IF NOT EXISTS geom_updated_at timestamptz;

COMMENT ON COLUMN neighborhoods.geom_source IS
 'Provenance for neighborhood geometry. evidence_stat_area_union means a derived analytical boundary, not an official neighborhood boundary.';
