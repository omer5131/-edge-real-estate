CREATE TABLE IF NOT EXISTS yad2_source_pages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 scope_id text NOT NULL REFERENCES yad2_crawl_scopes(id),
 crawl_id uuid NOT NULL REFERENCES yad2_crawls(id),
 url text NOT NULL, provider text NOT NULL DEFAULT 'brightdata',
 parser_version int NOT NULL DEFAULT 1, payload jsonb NOT NULL,
 context jsonb NOT NULL, collected_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS yad2_source_pages_pending ON yad2_source_pages(scope_id) WHERE completed_at IS NULL;
CREATE TABLE IF NOT EXISTS yad2_source_records (
 market text NOT NULL CHECK(market IN ('sale','rent')), listing_id text NOT NULL,
 scope_id text NOT NULL REFERENCES yad2_crawl_scopes(id),
 crawl_id uuid NOT NULL REFERENCES yad2_crawls(id),
 page_id uuid NOT NULL REFERENCES yad2_source_pages(id),
 provider text NOT NULL DEFAULT 'brightdata', parser_version int NOT NULL DEFAULT 1,
 payload jsonb NOT NULL, context jsonb NOT NULL,
 state text NOT NULL CHECK(state IN ('awaiting_detail','ready','processed','filtered','error')),
 reason text, collected_at timestamptz NOT NULL DEFAULT now(), processed_at timestamptz,
 PRIMARY KEY(market,listing_id)
);
CREATE INDEX IF NOT EXISTS yad2_source_records_ready ON yad2_source_records(collected_at) WHERE state='ready';
CREATE TABLE IF NOT EXISTS yad2_request_usage (
 provider text NOT NULL, period text NOT NULL, attempts int NOT NULL DEFAULT 0 CHECK(attempts>=0), PRIMARY KEY(provider,period)
);
CREATE OR REPLACE FUNCTION yad2_reserve_unlocker(day_key text,month_key text,day_cap int,month_cap int)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE d int; m int;
BEGIN
 IF day_cap<1 OR month_cap<1 THEN RAISE EXCEPTION 'Invalid request cap'; END IF;
 INSERT INTO yad2_request_usage(provider,period) VALUES('brightdata',day_key),('brightdata',month_key) ON CONFLICT DO NOTHING;
 SELECT attempts INTO m FROM yad2_request_usage WHERE provider='brightdata' AND period=month_key FOR UPDATE;
 SELECT attempts INTO d FROM yad2_request_usage WHERE provider='brightdata' AND period=day_key FOR UPDATE;
 IF d>=day_cap OR m>=month_cap THEN RETURN false; END IF;
 UPDATE yad2_request_usage SET attempts=attempts+1 WHERE provider='brightdata' AND period IN(day_key,month_key);
 RETURN true;
END $$;
ALTER TABLE yad2_crawl_scopes ADD COLUMN IF NOT EXISTS collector_attempted_at timestamptz;
ALTER TABLE yad2_crawl_scopes ADD COLUMN IF NOT EXISTS known_pages int NOT NULL DEFAULT 0;
