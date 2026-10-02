ALTER TABLE planning_plans ADD COLUMN IF NOT EXISTS neighborhood_id uuid REFERENCES neighborhoods(id);
ALTER TABLE infrastructure_projects ADD COLUMN IF NOT EXISTS neighborhood_id uuid REFERENCES neighborhoods(id);
ALTER TABLE infrastructure_projects ADD COLUMN IF NOT EXISTS lat double precision;
ALTER TABLE infrastructure_projects ADD COLUMN IF NOT EXISTS lon double precision;
ALTER TABLE infrastructure_projects ADD COLUMN IF NOT EXISTS source_updated_at timestamptz;

CREATE INDEX IF NOT EXISTS planning_plans_neighborhood_idx ON planning_plans(neighborhood_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS infrastructure_projects_neighborhood_idx ON infrastructure_projects(neighborhood_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS infrastructure_projects_geom_gix ON infrastructure_projects USING gist(geom);

INSERT INTO data_sources(id,name,kind,base_url,authority) VALUES
 ('mot_bus_stops','Ministry of Transport Stops','dataset','https://data.gov.il','משרד התחבורה'),
 ('mot_planned_terminals','Ministry of Transport Planned Terminals','dataset','https://data.gov.il','משרד התחבורה'),
 ('mot_transport_plans','National Transport Infrastructure Plans','dataset','https://data.gov.il','משרד התחבורה'),
 ('yad2_sale','Yad2 Sale Listings','public_web','https://www.yad2.co.il/realestate/forsale','Yad2 public listings')
ON CONFLICT(id) DO NOTHING;
