-- Residential-only canonical comparable transaction surface.

UPDATE transactions
SET is_comparable=false,
    exclusion_reason=COALESCE(exclusion_reason,'non_residential_nature')
WHERE is_comparable
  AND NOT (
    nature='מגורים'
    OR nature ILIKE '%דירה%'
    OR nature ILIKE '%בית פרטי%'
    OR nature ILIKE '%קוטג%'
    OR nature ILIKE '%וילה%'
  );

DROP VIEW IF EXISTS comparable_transactions;
CREATE VIEW comparable_transactions AS
SELECT
  id,source_id,source_external_id,raw_record_id,city_id,parcel_id,property_id,
  deal_date,amount_nis,area_sqm,rooms,floor,nature,pp_sqm,source_updated_at,observed_at,
  neighborhood_id,street_id,address_text,ownership_fraction,declared_amount_nis,
  normalized_pp_sqm,is_comparable,exclusion_reason
FROM transactions
WHERE is_comparable
  AND deal_date IS NOT NULL
  AND amount_nis>0
  AND area_sqm BETWEEN 15 AND 400
  AND COALESCE(normalized_pp_sqm,pp_sqm) BETWEEN 5000 AND 100000
  AND (ownership_fraction IS NULL OR ownership_fraction>=.9)
  AND (
    nature='מגורים'
    OR nature ILIKE '%דירה%'
    OR nature ILIKE '%בית פרטי%'
    OR nature ILIKE '%קוטג%'
    OR nature ILIKE '%וילה%'
  )
  AND COALESCE(nature,'') NOT ILIKE '%מסחרי%';

COMMENT ON VIEW comparable_transactions IS
 'Canonical residential executed-transaction surface for valuation and neighborhood analytics. Excludes parking, storage, office, commercial and mixed-use nature rows.';
