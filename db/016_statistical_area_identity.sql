-- Fix canonical statistical-area identity for nationwide coverage.
ALTER TABLE statistical_areas DROP CONSTRAINT IF EXISTS statistical_areas_stat_area_code_year_key;
CREATE UNIQUE INDEX IF NOT EXISTS statistical_areas_city_code_year_uq
  ON statistical_areas(city_id,stat_area_code,year);

COMMENT ON INDEX statistical_areas_city_code_year_uq IS
  'CBS statistical-area codes are only unique within a locality and boundary year.';
