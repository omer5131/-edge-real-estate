-- Distinguish validated vs provisional CBS neighborhood rollups.

ALTER TABLE neighborhood_cbs_profiles
  ADD COLUMN IF NOT EXISTS profile_quality text NOT NULL DEFAULT 'provisional'
    CHECK(profile_quality IN ('validated','provisional')),
  ADD COLUMN IF NOT EXISTS safe_for_score boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS crosswalk_method text;

CREATE INDEX IF NOT EXISTS neighborhood_cbs_profiles_quality_idx
  ON neighborhood_cbs_profiles(neighborhood_id,profile_quality,observation_year DESC);

DROP VIEW IF EXISTS semantic_neighborhood_cbs_profile;
CREATE VIEW semantic_neighborhood_cbs_profile AS
SELECT
  p.neighborhood_id,n.slug,n.name_he neighborhood_name,c.name_he city_name,p.observation_year,
  p.population,p.population_growth_from_2022_pct,p.employment_pct,p.academic_certificate_pct,
  p.median_annual_employee_wage,p.average_household_size,p.owner_households_pct,p.renter_households_pct,
  p.median_age,p.statistical_area_count,p.mapping_confidence,p.profile_quality,p.safe_for_score,p.crosswalk_method,
  p.source_evidence,p.calculated_at
FROM neighborhood_cbs_profiles p
JOIN neighborhoods n ON n.id=p.neighborhood_id
JOIN cities c ON c.id=n.city_id;

COMMENT ON COLUMN neighborhood_cbs_profiles.profile_quality IS
 'validated = safe official 2022-compatible neighborhood crosswalk; provisional = useful contextual rollup from reviewed mapping but not score-safe.';
COMMENT ON COLUMN neighborhood_cbs_profiles.safe_for_score IS
 'Only true when CBS neighborhood mapping is sufficiently verified for investment-score input.';
