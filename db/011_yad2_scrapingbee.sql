CREATE TABLE IF NOT EXISTS yad2_crawl_scopes (
 id text PRIMARY KEY, market text NOT NULL CHECK(market IN ('sale','rent')),
 url text NOT NULL, enabled boolean NOT NULL DEFAULT true,
 config jsonb NOT NULL DEFAULT '{}'::jsonb,
 last_completed_at timestamptz, last_error text
);
INSERT INTO yad2_crawl_scopes(id,market,url) VALUES
 ('israel-sale','sale','https://www.yad2.co.il/realestate/forsale'),
 ('israel-rent','rent','https://www.yad2.co.il/realestate/rent') ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS yad2_crawls (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), started_at timestamptz DEFAULT now(),
 finished_at timestamptz, status text NOT NULL DEFAULT 'running', report jsonb
);
CREATE TABLE IF NOT EXISTS yad2_scope_membership (
 scope_id text REFERENCES yad2_crawl_scopes(id), market text, listing_id text,
 last_seen_crawl uuid REFERENCES yad2_crawls(id), missing_cycles int NOT NULL DEFAULT 0,
 PRIMARY KEY(scope_id,market,listing_id)
);
CREATE TABLE IF NOT EXISTS yad2_dataset (
 market text NOT NULL CHECK(market IN ('sale','rent')), listing_id text NOT NULL,
 url text NOT NULL, price numeric, city text, neighborhood text, address text,
 rooms numeric, area_sqm numeric, floor text, published_at text,
 data jsonb NOT NULL, first_seen_at timestamptz NOT NULL DEFAULT now(),
 last_seen_at timestamptz NOT NULL DEFAULT now(), changed_at timestamptz NOT NULL DEFAULT now(),
 status text NOT NULL DEFAULT 'active', PRIMARY KEY(market,listing_id)
);
CREATE INDEX IF NOT EXISTS yad2_dataset_research ON yad2_dataset(market,status,city,price);
CREATE INDEX IF NOT EXISTS yad2_dataset_data ON yad2_dataset USING gin(data);
CREATE TABLE IF NOT EXISTS yad2_listing_changes (
 id bigserial PRIMARY KEY, market text NOT NULL, listing_id text NOT NULL,
 observed_at timestamptz NOT NULL DEFAULT now(), event text NOT NULL,
 old_data jsonb, new_data jsonb, old_price numeric, new_price numeric,
 FOREIGN KEY(market,listing_id) REFERENCES yad2_dataset(market,listing_id)
);
CREATE INDEX IF NOT EXISTS yad2_changes_history ON yad2_listing_changes(market,listing_id,observed_at DESC);
CREATE OR REPLACE FUNCTION yad2_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  INSERT INTO yad2_listing_changes(market,listing_id,event,new_data,new_price)
  VALUES(NEW.market,NEW.listing_id,'created',NEW.data,NEW.price);
 ELSIF OLD.data IS DISTINCT FROM NEW.data OR OLD.status IS DISTINCT FROM NEW.status THEN
  NEW.changed_at=now();
  INSERT INTO yad2_listing_changes(market,listing_id,event,old_data,new_data,old_price,new_price)
  VALUES(NEW.market,NEW.listing_id,CASE
   WHEN OLD.status IS DISTINCT FROM NEW.status THEN NEW.status
   WHEN NEW.price<OLD.price THEN 'price_drop'
   WHEN NEW.price>OLD.price THEN 'price_increase' ELSE 'changed' END,
   OLD.data,NEW.data,OLD.price,NEW.price);
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS yad2_audit_trigger ON yad2_dataset;
CREATE TRIGGER yad2_audit_trigger AFTER INSERT OR UPDATE ON yad2_dataset FOR EACH ROW EXECUTE FUNCTION yad2_audit();

CREATE TABLE IF NOT EXISTS yad2_worker_lock(id int PRIMARY KEY,token uuid NOT NULL,expires_at timestamptz NOT NULL);

ALTER TABLE yad2_crawl_scopes ADD COLUMN IF NOT EXISTS cycle_id uuid REFERENCES yad2_crawls(id);
ALTER TABLE yad2_crawl_scopes ADD COLUMN IF NOT EXISTS cursor_url text;
ALTER TABLE yad2_crawl_scopes ADD COLUMN IF NOT EXISTS cycle_pages int NOT NULL DEFAULT 0;
ALTER TABLE yad2_crawl_scopes ADD COLUMN IF NOT EXISTS last_page_ids jsonb;
