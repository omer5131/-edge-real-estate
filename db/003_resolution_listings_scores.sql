-- Resolve source facts into Edge target neighborhoods and persist listing/opportunity history.
ALTER TABLE parcels ADD COLUMN IF NOT EXISTS neighborhood_id uuid REFERENCES neighborhoods(id);
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS neighborhood_id uuid REFERENCES neighborhoods(id);
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS street_id uuid REFERENCES streets(id);
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS address_text text;

CREATE TABLE IF NOT EXISTS neighborhood_street_rules (
  neighborhood_id uuid NOT NULL REFERENCES neighborhoods(id) ON DELETE CASCADE,
  normalized_street text NOT NULL,
  source text NOT NULL DEFAULT 'curated',
  confidence numeric NOT NULL DEFAULT 1,
  PRIMARY KEY (neighborhood_id, normalized_street)
);
CREATE INDEX IF NOT EXISTS transactions_neighborhood_date_idx ON transactions(neighborhood_id,deal_date DESC);
CREATE INDEX IF NOT EXISTS listings_neighborhood_status_idx ON listings(neighborhood_id,status,last_seen_at DESC);

INSERT INTO data_sources(id,name,kind,base_url,authority)
VALUES ('over_listing_archive','OVER Listing Archive','archive','https://www.over.org.il/api/append','OVER')
ON CONFLICT(id) DO NOTHING;

WITH rules(city_name,neighborhood_name,street_name) AS (VALUES
 ('חיפה','קריית אליעזר','אלנבי'),
 ('חיפה','קריית אליעזר','צה ל'),
 ('חיפה','קריית אליעזר','יציאת אירופה'),
 ('חיפה','קריית שפרינצק','דקר'),
 ('חיפה','קריית שפרינצק','חביבה רייק'),
 ('חיפה','קריית שפרינצק','שפרינצק'),
 ('נתניה','קריית נורדאו','בן צבי'),
 ('נתניה','קריית נורדאו','הרב קוק'),
 ('נתניה','קריית נורדאו','ניצנים'),
 ('פתח תקווה','יוספטל','יוספטל'),
 ('פתח תקווה','יוספטל','קפלן')
)
INSERT INTO neighborhood_street_rules(neighborhood_id,normalized_street)
SELECT n.id, r.street_name
FROM rules r JOIN cities c ON c.name_he=r.city_name
JOIN neighborhoods n ON n.city_id=c.id AND n.name_he=r.neighborhood_name
ON CONFLICT DO NOTHING;
