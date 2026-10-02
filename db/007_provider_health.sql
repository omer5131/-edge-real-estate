ALTER TABLE data_sources ADD COLUMN IF NOT EXISTS expected_interval_hours integer NOT NULL DEFAULT 24;
ALTER TABLE data_sources ADD COLUMN IF NOT EXISTS min_fetched_per_run integer NOT NULL DEFAULT 1;
ALTER TABLE data_sources ADD COLUMN IF NOT EXISTS min_canonical_rows integer NOT NULL DEFAULT 1;

UPDATE data_sources SET expected_interval_hours=24,min_fetched_per_run=1,min_canonical_rows=1
WHERE id IN ('over_deals','over_nadlan','urban_renewal_gov','xplan','over_listing_archive','yad2_sale','yad2_rent','mot_bus_stops','mot_planned_terminals');

CREATE OR REPLACE VIEW provider_entity_counts AS
SELECT ds.id source_id,
  CASE ds.id
    WHEN 'over_deals' THEN (SELECT count(*) FROM transactions WHERE source_id='over_deals')
    WHEN 'over_nadlan' THEN (SELECT count(*) FROM parcels)
    WHEN 'urban_renewal_gov' THEN (SELECT count(*) FROM renewal_projects WHERE source_id='urban_renewal_gov')
    WHEN 'xplan' THEN (SELECT count(*) FROM planning_plans WHERE source_id='xplan')
    WHEN 'over_listing_archive' THEN (SELECT count(*) FROM listings WHERE source_id='over_listing_archive')
    WHEN 'yad2_sale' THEN (SELECT count(*) FROM listings WHERE source_id='yad2_sale')
    WHEN 'yad2_rent' THEN (SELECT count(*) FROM rental_listings WHERE source_id='yad2_rent')
    WHEN 'mot_bus_stops' THEN (SELECT count(*) FROM infrastructure_projects WHERE source_id='mot_bus_stops')
    WHEN 'mot_planned_terminals' THEN (SELECT count(*) FROM infrastructure_projects WHERE source_id='mot_planned_terminals')
    ELSE (SELECT count(*) FROM raw_records rr WHERE rr.source_id=ds.id)
  END::bigint canonical_rows,
  (SELECT count(*) FROM raw_records rr WHERE rr.source_id=ds.id)::bigint raw_rows,
  (SELECT max(observed_at) FROM raw_records rr WHERE rr.source_id=ds.id) latest_raw_at
FROM data_sources ds;

CREATE OR REPLACE VIEW provider_health AS
WITH last_run AS (
 SELECT DISTINCT ON(source_id) source_id,id run_id,status run_status,started_at,finished_at,
   fetched_count,inserted_count,updated_count,error_count,error_summary
 FROM ingestion_runs
 ORDER BY source_id,started_at DESC
)
SELECT ds.id source_id,ds.name,ds.kind,ds.authority,ds.is_enabled,
 ds.expected_interval_hours,ds.min_fetched_per_run,ds.min_canonical_rows,
 lr.run_id,lr.run_status,lr.started_at last_started_at,lr.finished_at last_finished_at,
 lr.fetched_count,lr.inserted_count,lr.updated_count,lr.error_count,lr.error_summary,
 coalesce(ec.raw_rows,0)::bigint raw_rows,coalesce(ec.canonical_rows,0)::bigint canonical_rows,ec.latest_raw_at,
 CASE
   WHEN NOT ds.is_enabled THEN 'disabled'
   WHEN lr.run_status='running' AND lr.started_at < now()-interval '45 minutes' THEN 'critical'
   WHEN lr.run_status='running' THEN 'running'
   WHEN lr.run_id IS NULL THEN 'never_run'
   WHEN lr.run_status='failed' THEN 'critical'
   WHEN lr.run_status='partial' THEN 'degraded'
   WHEN coalesce(ec.canonical_rows,0) < ds.min_canonical_rows THEN 'critical'
   WHEN coalesce(lr.fetched_count,0) < ds.min_fetched_per_run THEN 'degraded'
   WHEN lr.finished_at < now()-(ds.expected_interval_hours*2 || ' hours')::interval THEN 'critical'
   WHEN lr.finished_at < now()-(ds.expected_interval_hours || ' hours')::interval THEN 'stale'
   ELSE 'healthy'
 END health,
 CASE
   WHEN NOT ds.is_enabled THEN 'Provider disabled'
   WHEN lr.run_status='running' AND lr.started_at < now()-interval '45 minutes' THEN 'Run stuck >45m'
   WHEN lr.run_id IS NULL THEN 'Provider has never completed a run'
   WHEN lr.run_status='failed' THEN coalesce(lr.error_summary,'Latest run failed')
   WHEN lr.run_status='partial' THEN coalesce(lr.error_summary,'Latest run partially failed')
   WHEN coalesce(ec.canonical_rows,0) < ds.min_canonical_rows THEN 'No usable canonical rows'
   WHEN coalesce(lr.fetched_count,0) < ds.min_fetched_per_run THEN 'Latest run fetched below expected minimum'
   WHEN lr.finished_at < now()-(ds.expected_interval_hours*2 || ' hours')::interval THEN 'Data is >2x expected cadence old'
   WHEN lr.finished_at < now()-(ds.expected_interval_hours || ' hours')::interval THEN 'Data is older than expected cadence'
   ELSE 'OK'
 END health_reason
FROM data_sources ds
LEFT JOIN last_run lr ON lr.source_id=ds.id
LEFT JOIN provider_entity_counts ec ON ec.source_id=ds.id;
