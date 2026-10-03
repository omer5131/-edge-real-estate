-- Official CBS 2022 neighborhood / statistical-area key.

CREATE TABLE IF NOT EXISTS cbs_neighborhood_stat_area_key (
  locality_code text NOT NULL,
  locality_name text NOT NULL,
  statistical_area_code text NOT NULL,
  neighborhood_names_raw text,
  main_streets_raw text,
  neighborhood_names text[] NOT NULL DEFAULT '{}',
  main_streets text[] NOT NULL DEFAULT '{}',
  source_url text NOT NULL,
  source_row integer NOT NULL,
  source_version text NOT NULL DEFAULT 'cbs-2022',
  imported_at timestamptz NOT NULL DEFAULT now(),
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY(locality_code,statistical_area_code,source_version)
);
CREATE INDEX IF NOT EXISTS cbs_neighborhood_key_names_gin
  ON cbs_neighborhood_stat_area_key USING gin(neighborhood_names);
CREATE INDEX IF NOT EXISTS cbs_neighborhood_key_locality_idx
  ON cbs_neighborhood_stat_area_key(locality_code,statistical_area_code);

ALTER TABLE neighborhood_stat_area_map
  ADD COLUMN IF NOT EXISTS source_evidence jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON TABLE cbs_neighborhood_stat_area_key IS
 'Official CBS key: main streets and neighborhood names by 2022 statistical area. Used as preferred neighborhood↔CBS crosswalk evidence.';
