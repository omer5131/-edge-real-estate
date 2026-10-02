ALTER TABLE yad2_crawl_scopes ADD COLUMN IF NOT EXISTS backfill_started_at timestamptz;
ALTER TABLE yad2_crawl_scopes ADD COLUMN IF NOT EXISTS backfill_completed_at timestamptz;
ALTER TABLE yad2_crawl_scopes ADD COLUMN IF NOT EXISTS cycle_started_at timestamptz;
COMMENT ON COLUMN yad2_crawl_scopes.backfill_completed_at IS 'One-time original-publication-window backfill completion; later cycles are bounded new-ID discovery only.';
