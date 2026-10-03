-- Guarantee neighborhood identity handling for every canonical listing write.

CREATE TABLE IF NOT EXISTS neighborhood_resolution_queue (
  entity_type text NOT NULL CHECK(entity_type IN ('listing','rental_listing')),
  entity_id uuid NOT NULL,
  source_id text NOT NULL,
  source_entity_id text NOT NULL,
  source_city text,
  source_neighborhood text,
  source_address text,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','resolved','ambiguous','unmapped')),
  attempts integer NOT NULL DEFAULT 0,
  last_attempt_at timestamptz,
  resolution_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(entity_type,entity_id)
);
CREATE INDEX IF NOT EXISTS neighborhood_resolution_queue_status_idx
  ON neighborhood_resolution_queue(status,updated_at);

CREATE OR REPLACE FUNCTION sync_listing_neighborhood_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  entity_type_value text;
  src_city text;
  src_neighborhood text;
BEGIN
  entity_type_value:=CASE WHEN TG_TABLE_NAME='rental_listings' THEN 'rental_listing' ELSE 'listing' END;

  IF NEW.source_id LIKE 'yad2_%' THEN
    SELECT d.city,d.neighborhood INTO src_city,src_neighborhood
    FROM yad2_dataset d
    WHERE d.listing_id=NEW.source_listing_id
      AND d.market=CASE WHEN TG_TABLE_NAME='rental_listings' THEN 'rent' ELSE 'sale' END
    LIMIT 1;
  END IF;

  IF NEW.neighborhood_id IS NOT NULL THEN
    INSERT INTO neighborhood_source_mappings(
      neighborhood_id,source_id,source_entity_type,source_entity_id,source_name,
      mapping_method,mapping_confidence,evidence,mapped_at
    )
    VALUES(
      NEW.neighborhood_id,NEW.source_id,entity_type_value,NEW.source_listing_id,
      COALESCE(src_neighborhood,NEW.canonical_address),
      'canonical_listing_link',1,
      jsonb_build_object(
        'canonical_entity_id',NEW.id,
        'source_city',src_city,
        'source_neighborhood',src_neighborhood,
        'address',NEW.canonical_address
      ),
      now()
    )
    ON CONFLICT(source_id,source_entity_type,source_entity_id,neighborhood_id) DO UPDATE SET
      source_name=EXCLUDED.source_name,mapping_method=EXCLUDED.mapping_method,
      mapping_confidence=EXCLUDED.mapping_confidence,evidence=EXCLUDED.evidence,mapped_at=now();

    INSERT INTO neighborhood_resolution_queue(
      entity_type,entity_id,source_id,source_entity_id,source_city,source_neighborhood,
      source_address,status,attempts,last_attempt_at,resolution_notes,updated_at
    )
    VALUES(
      entity_type_value,NEW.id,NEW.source_id,NEW.source_listing_id,src_city,src_neighborhood,
      NEW.canonical_address,'resolved',1,now(),'Resolved on canonical listing write.',now()
    )
    ON CONFLICT(entity_type,entity_id) DO UPDATE SET
      source_city=EXCLUDED.source_city,source_neighborhood=EXCLUDED.source_neighborhood,
      source_address=EXCLUDED.source_address,status='resolved',
      attempts=neighborhood_resolution_queue.attempts+1,last_attempt_at=now(),
      resolution_notes='Resolved on canonical listing write.',updated_at=now();

    IF src_neighborhood IS NOT NULL AND src_neighborhood<>'' THEN
      INSERT INTO neighborhood_aliases(
        neighborhood_id,source_id,alias,normalized_alias,language,alias_type,confidence,is_primary
      )
      VALUES(
        NEW.neighborhood_id,NEW.source_id,src_neighborhood,
        lower(regexp_replace(replace(replace(src_neighborhood,'״',''),'"',''),'[[:space:][:punct:]]','','g')),
        'he','source_neighborhood',.95,false
      )
      ON CONFLICT(neighborhood_id,source_id,normalized_alias,alias_type) DO UPDATE SET
        alias=EXCLUDED.alias,confidence=GREATEST(neighborhood_aliases.confidence,EXCLUDED.confidence);
    END IF;
  ELSE
    INSERT INTO neighborhood_resolution_queue(
      entity_type,entity_id,source_id,source_entity_id,source_city,source_neighborhood,
      source_address,status,attempts,last_attempt_at,resolution_notes,updated_at
    )
    VALUES(
      entity_type_value,NEW.id,NEW.source_id,NEW.source_listing_id,src_city,src_neighborhood,
      NEW.canonical_address,'pending',1,now(),'No safe canonical neighborhood match on write.',now()
    )
    ON CONFLICT(entity_type,entity_id) DO UPDATE SET
      source_city=EXCLUDED.source_city,source_neighborhood=EXCLUDED.source_neighborhood,
      source_address=EXCLUDED.source_address,
      status=CASE WHEN neighborhood_resolution_queue.status='resolved' THEN 'resolved' ELSE 'pending' END,
      attempts=neighborhood_resolution_queue.attempts+1,last_attempt_at=now(),
      resolution_notes=CASE WHEN neighborhood_resolution_queue.status='resolved'
        THEN neighborhood_resolution_queue.resolution_notes
        ELSE 'No safe canonical neighborhood match on write.' END,
      updated_at=now();
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS listings_neighborhood_identity_trg ON listings;
CREATE TRIGGER listings_neighborhood_identity_trg
AFTER INSERT OR UPDATE OF neighborhood_id,canonical_address,status ON listings
FOR EACH ROW EXECUTE FUNCTION sync_listing_neighborhood_identity();

DROP TRIGGER IF EXISTS rental_listings_neighborhood_identity_trg ON rental_listings;
CREATE TRIGGER rental_listings_neighborhood_identity_trg
AFTER INSERT OR UPDATE OF neighborhood_id,canonical_address,status ON rental_listings
FOR EACH ROW EXECUTE FUNCTION sync_listing_neighborhood_identity();

-- Backfill resolution status for all current canonical listings.
UPDATE listings SET neighborhood_id=neighborhood_id;
UPDATE rental_listings SET neighborhood_id=neighborhood_id;

CREATE OR REPLACE VIEW semantic_neighborhood_resolution_health AS
SELECT
 status,entity_type,count(*)::int items,
 count(*) FILTER(WHERE source_neighborhood IS NOT NULL)::int with_source_neighborhood,
 max(updated_at) latest_update
FROM neighborhood_resolution_queue
GROUP BY status,entity_type;

COMMENT ON TABLE neighborhood_resolution_queue IS
 'Every canonical listing is either resolved to neighborhood_id or explicitly queued for safe resolution. No silent geography gaps.';
