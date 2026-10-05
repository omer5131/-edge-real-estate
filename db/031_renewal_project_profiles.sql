-- Additive project research: keep collector facts and attributed research distinct.
CREATE TABLE IF NOT EXISTS renewal_project_profiles (
 project_id uuid PRIMARY KEY REFERENCES renewal_projects(id) ON DELETE CASCADE,
 project_type text CHECK(project_type IN ('pinui_binui','tama_38_1','tama_38_2','infill','building_renewal','unknown')),
 summary text,
 planning_stage text,
 permit_stage text,
 execution_stage text,
 gaps jsonb NOT NULL DEFAULT '[]'::jsonb,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS renewal_project_facts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 project_id uuid NOT NULL REFERENCES renewal_projects(id) ON DELETE CASCADE,
 fact_key text NOT NULL,
 value jsonb NOT NULL,
 source_kind text NOT NULL CHECK(source_kind IN ('official','developer','secondary','manual')),
 source_url text NOT NULL CHECK(source_url ~ '^https://'),
 source_title text NOT NULL,
 source_date date,
 locator text,
 evidence_status text NOT NULL CHECK(evidence_status IN ('verified','reported','conflicting')),
 checked_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(project_id,fact_key,source_url)
);
CREATE INDEX IF NOT EXISTS renewal_project_facts_project_idx ON renewal_project_facts(project_id,fact_key);
CREATE TABLE IF NOT EXISTS renewal_project_addresses (
 project_id uuid NOT NULL REFERENCES renewal_projects(id) ON DELETE CASCADE,
 street_name text NOT NULL,
 house_number text NOT NULL,
 membership text NOT NULL CHECK(membership IN ('verified','reported','unverified','excluded')),
 source_url text NOT NULL CHECK(source_url ~ '^https://'),
 note text,
 checked_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(project_id,street_name,house_number)
);
CREATE OR REPLACE VIEW semantic_renewal_project_profiles AS
 SELECT r.id project_id,r.city_id,r.neighborhood_id,r.project_name,r.plan_number,r.route,
 r.status source_status,r.source_id,r.source_url,r.observed_at,
 p.project_type,p.planning_stage,p.permit_stage,p.execution_stage,p.summary,p.gaps,p.updated_at,
 (SELECT count(*) FROM renewal_project_facts f WHERE f.project_id=r.id) fact_count,
 (SELECT count(*) FROM renewal_project_addresses a WHERE a.project_id=r.id AND a.membership='verified') verified_address_count
 FROM renewal_projects r LEFT JOIN renewal_project_profiles p ON p.project_id=r.id;
COMMENT ON VIEW semantic_renewal_project_profiles IS 'One project, including research completeness. Planning approval, permit and execution are separate. Join project_id to renewal_projects.id. Never infer asset membership from neighborhood, street ranges or marketing. Developer timelines are forecasts.';
COMMENT ON TABLE renewal_project_facts IS 'One attributed claim per project/fact/source. Conflicting claims coexist. source_date is publication reference, checked_at is observation. Developer values are reported claims, not official approvals.';
COMMENT ON COLUMN renewal_project_facts.value IS 'Attributed JSON claim. Read source_kind, evidence_status, source_date and locator before using. Do not combine competing versions into a confirmed fact.';
COMMENT ON TABLE renewal_project_addresses IS 'Exact address evidence in project city. Only membership=verified confirms inclusion, reported/unverified do not. An absent address is unknown, not excluded.';
