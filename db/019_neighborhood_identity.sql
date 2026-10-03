-- Canonical Neighborhood Identity Layer
-- neighborhoods.id remains the permanent Edge neighborhood identity.

ALTER TABLE neighborhood_stat_area_map DROP CONSTRAINT IF EXISTS neighborhood_stat_area_map_mapping_method_check;
ALTER TABLE neighborhood_stat_area_map ADD CONSTRAINT neighborhood_stat_area_map_mapping_method_check
  CHECK(mapping_method IN ('verified','polygon_overlap','configured_crosswalk','derived_address','parcel_evidence','official_crosswalk'));

ALTER TABLE neighborhoods
  ADD COLUMN IF NOT EXISTS canonical_status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS boundary_version text NOT NULL DEFAULT 'edge-neighborhood-v1',
  ADD COLUMN IF NOT EXISTS geometry_confidence numeric CHECK(geometry_confidence IS NULL OR geometry_confidence BETWEEN 0 AND 1),
  ADD COLUMN IF NOT EXISTS geometry_method text,
  ADD COLUMN IF NOT EXISTS geometry_source text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS neighborhood_aliases (
  id bigserial PRIMARY KEY,
  neighborhood_id uuid NOT NULL REFERENCES neighborhoods(id) ON DELETE CASCADE,
  source_id text,
  alias text NOT NULL,
  normalized_alias text NOT NULL,
  language text,
  alias_type text NOT NULL DEFAULT 'name',
  confidence numeric NOT NULL DEFAULT 1 CHECK(confidence BETWEEN 0 AND 1),
  is_primary boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(neighborhood_id,source_id,normalized_alias,alias_type)
);
CREATE INDEX IF NOT EXISTS neighborhood_alias_lookup_idx ON neighborhood_aliases(normalized_alias);
CREATE INDEX IF NOT EXISTS neighborhood_alias_neighborhood_idx ON neighborhood_aliases(neighborhood_id);

CREATE TABLE IF NOT EXISTS neighborhood_geometries (
  id bigserial PRIMARY KEY,
  neighborhood_id uuid NOT NULL REFERENCES neighborhoods(id) ON DELETE CASCADE,
  geometry_version text NOT NULL,
  geom geometry(MultiPolygon,4326) NOT NULL,
  geometry_method text NOT NULL,
  source_id text,
  confidence numeric NOT NULL CHECK(confidence BETWEEN 0 AND 1),
  is_active boolean NOT NULL DEFAULT false,
  valid_from date,
  valid_to date,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(neighborhood_id,geometry_version)
);
CREATE UNIQUE INDEX IF NOT EXISTS neighborhood_geometries_one_active_uq
  ON neighborhood_geometries(neighborhood_id) WHERE is_active;
CREATE INDEX IF NOT EXISTS neighborhood_geometries_geom_gix ON neighborhood_geometries USING gist(geom);

CREATE TABLE IF NOT EXISTS neighborhood_source_mappings (
  id bigserial PRIMARY KEY,
  neighborhood_id uuid NOT NULL REFERENCES neighborhoods(id) ON DELETE CASCADE,
  source_id text NOT NULL,
  source_entity_type text NOT NULL,
  source_entity_id text NOT NULL,
  source_name text,
  mapping_method text NOT NULL,
  mapping_confidence numeric NOT NULL CHECK(mapping_confidence BETWEEN 0 AND 1),
  overlap_pct numeric CHECK(overlap_pct IS NULL OR overlap_pct BETWEEN 0 AND 1),
  valid_from date,
  valid_to date,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  mapped_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(source_id,source_entity_type,source_entity_id,neighborhood_id)
);
CREATE INDEX IF NOT EXISTS neighborhood_source_mappings_neighborhood_idx
  ON neighborhood_source_mappings(neighborhood_id,source_id,source_entity_type);
CREATE INDEX IF NOT EXISTS neighborhood_source_mappings_source_idx
  ON neighborhood_source_mappings(source_id,source_entity_type,source_entity_id);

CREATE TABLE IF NOT EXISTS neighborhood_parcel_map (
  neighborhood_id uuid NOT NULL REFERENCES neighborhoods(id) ON DELETE CASCADE,
  parcel_id uuid NOT NULL REFERENCES parcels(id) ON DELETE CASCADE,
  mapping_method text NOT NULL,
  mapping_confidence numeric NOT NULL CHECK(mapping_confidence BETWEEN 0 AND 1),
  overlap_pct numeric CHECK(overlap_pct IS NULL OR overlap_pct BETWEEN 0 AND 1),
  mapping_version text NOT NULL DEFAULT 'edge-neighborhood-v1',
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  mapped_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(neighborhood_id,parcel_id)
);
CREATE INDEX IF NOT EXISTS neighborhood_parcel_parcel_idx ON neighborhood_parcel_map(parcel_id);

CREATE TABLE IF NOT EXISTS geo_relationships (
  parent_type text NOT NULL,
  parent_id uuid NOT NULL,
  child_type text NOT NULL,
  child_id uuid NOT NULL,
  relationship_type text NOT NULL CHECK(relationship_type IN ('contains','part_of','overlaps','same_as','alias_of')),
  confidence numeric NOT NULL DEFAULT 1 CHECK(confidence BETWEEN 0 AND 1),
  source_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(parent_type,parent_id,child_type,child_id,relationship_type)
);

-- Seed canonical aliases from existing names.
INSERT INTO neighborhood_aliases(neighborhood_id,source_id,alias,normalized_alias,language,alias_type,confidence,is_primary)
SELECT id,'edge',name_he,
       lower(regexp_replace(replace(replace(name_he,'״',''),'"',''),'[[:space:][:punct:]]','','g')),
       'he','canonical_name',1,true
FROM neighborhoods
ON CONFLICT(neighborhood_id,source_id,normalized_alias,alias_type) DO NOTHING;

INSERT INTO neighborhood_aliases(neighborhood_id,source_id,alias,normalized_alias,language,alias_type,confidence,is_primary)
SELECT id,'edge',name_en,
       lower(regexp_replace(name_en,'[^a-zA-Z0-9]','','g')),
       'en','canonical_name',1,true
FROM neighborhoods
WHERE name_en IS NOT NULL AND name_en<>''
ON CONFLICT(neighborhood_id,source_id,normalized_alias,alias_type) DO NOTHING;

-- Reuse existing source aliases that explicitly point to neighborhoods.
INSERT INTO neighborhood_aliases(neighborhood_id,source_id,alias,normalized_alias,alias_type,confidence,metadata)
SELECT entity_id,source_id,alias_value,
       lower(regexp_replace(replace(replace(alias_value,'״',''),'"',''),'[[:space:][:punct:]]','','g')),
       alias_type,confidence,metadata
FROM entity_aliases
WHERE entity_type='neighborhood'
ON CONFLICT(neighborhood_id,source_id,normalized_alias,alias_type) DO NOTHING;

-- Existing direct canonical relationships become high-confidence source mappings.
INSERT INTO neighborhood_source_mappings(neighborhood_id,source_id,source_entity_type,source_entity_id,source_name,mapping_method,mapping_confidence,evidence)
SELECT l.neighborhood_id,l.source_id,'listing',l.source_listing_id,l.canonical_address,'direct_canonical',1,
       jsonb_build_object('listing_id',l.id)
FROM listings l WHERE l.neighborhood_id IS NOT NULL
ON CONFLICT(source_id,source_entity_type,source_entity_id,neighborhood_id) DO UPDATE SET
 mapping_confidence=1,mapping_method='direct_canonical',mapped_at=now();

INSERT INTO neighborhood_source_mappings(neighborhood_id,source_id,source_entity_type,source_entity_id,source_name,mapping_method,mapping_confidence,evidence)
SELECT r.neighborhood_id,r.source_id,'renewal_project',r.source_project_id,r.project_name,'direct_canonical',1,
       jsonb_build_object('project_id',r.id,'status',r.status,'stage',r.stage)
FROM renewal_projects r WHERE r.neighborhood_id IS NOT NULL
ON CONFLICT(source_id,source_entity_type,source_entity_id,neighborhood_id) DO UPDATE SET
 mapping_confidence=1,mapping_method='direct_canonical',mapped_at=now();

INSERT INTO neighborhood_source_mappings(neighborhood_id,source_id,source_entity_type,source_entity_id,source_name,mapping_method,mapping_confidence,evidence)
SELECT ct.neighborhood_id,ct.source_id,'transaction',ct.source_external_id,ct.address_text,'direct_canonical',1,
       jsonb_build_object('transaction_id',ct.id,'parcel_id',ct.parcel_id)
FROM comparable_transactions ct WHERE ct.neighborhood_id IS NOT NULL
ON CONFLICT(source_id,source_entity_type,source_entity_id,neighborhood_id) DO UPDATE SET
 mapping_confidence=1,mapping_method='direct_canonical',mapped_at=now();

-- Keep source stat-area relationships in the general mapping registry.
INSERT INTO neighborhood_source_mappings(neighborhood_id,source_id,source_entity_type,source_entity_id,source_name,mapping_method,mapping_confidence,overlap_pct,evidence)
SELECT m.neighborhood_id,'cbs','statistical_area',s.id::text,s.stat_area_code,m.mapping_method,m.mapping_confidence,m.overlap_ratio,
       jsonb_build_object('stat_area_code',s.stat_area_code,'boundary_year',s."year")
FROM neighborhood_stat_area_map m JOIN statistical_areas s ON s.id=m.stat_area_id
ON CONFLICT(source_id,source_entity_type,source_entity_id,neighborhood_id) DO UPDATE SET
 mapping_method=EXCLUDED.mapping_method,mapping_confidence=EXCLUDED.mapping_confidence,
 overlap_pct=EXCLUDED.overlap_pct,evidence=EXCLUDED.evidence,mapped_at=now();

-- Parcel mappings inherit only explicit/canonical neighborhood evidence for now.
INSERT INTO neighborhood_parcel_map(neighborhood_id,parcel_id,mapping_method,mapping_confidence,evidence)
SELECT DISTINCT ct.neighborhood_id,ct.parcel_id,'direct_transaction',1,
 jsonb_build_object('source','comparable_transactions')
FROM comparable_transactions ct
WHERE ct.neighborhood_id IS NOT NULL AND ct.parcel_id IS NOT NULL
ON CONFLICT(neighborhood_id,parcel_id) DO UPDATE SET
 mapping_confidence=GREATEST(neighborhood_parcel_map.mapping_confidence,EXCLUDED.mapping_confidence),mapped_at=now();

-- Active canonical geometry history from any already-defined neighborhood polygon.
INSERT INTO neighborhood_geometries(neighborhood_id,geometry_version,geom,geometry_method,source_id,confidence,is_active,evidence)
SELECT id,boundary_version,geom,COALESCE(geometry_method,'legacy_canonical'),COALESCE(geometry_source,'edge'),
       COALESCE(geometry_confidence,.8),true,jsonb_build_object('seeded_from','neighborhoods.geom')
FROM neighborhoods WHERE geom IS NOT NULL
ON CONFLICT(neighborhood_id,geometry_version) DO NOTHING;

CREATE OR REPLACE VIEW semantic_neighborhoods AS
SELECT
 n.id neighborhood_id,n.slug,n.name_he,n.name_en,n.city_id,c.name_he city_name,c.settlement_code,
 n.canonical_status,n.boundary_version,n.geometry_method,n.geometry_source,n.geometry_confidence,
 CASE WHEN n.geom IS NULL THEN false ELSE true END has_geometry,
 COALESCE((SELECT count(*) FROM neighborhood_aliases a WHERE a.neighborhood_id=n.id),0)::int alias_count,
 COALESCE((SELECT count(*) FROM neighborhood_source_mappings sm WHERE sm.neighborhood_id=n.id),0)::int source_mapping_count,
 COALESCE((SELECT count(*) FROM neighborhood_stat_area_map m WHERE m.neighborhood_id=n.id),0)::int statistical_area_count,
 COALESCE((SELECT count(*) FROM neighborhood_parcel_map p WHERE p.neighborhood_id=n.id),0)::int parcel_count,
 COALESCE((SELECT round(avg(sm.mapping_confidence)::numeric,3) FROM neighborhood_source_mappings sm WHERE sm.neighborhood_id=n.id),0)::numeric mapping_confidence_avg,
 n.geom
FROM neighborhoods n JOIN cities c ON c.id=n.city_id;

COMMENT ON VIEW semantic_neighborhoods IS
 'Canonical source of truth for neighborhood identity. All agent/dashboard neighborhood joins must resolve to neighborhood_id here. Source-specific names and geometries are evidence, not alternate identities.';
