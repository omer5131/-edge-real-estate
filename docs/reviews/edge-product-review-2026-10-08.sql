-- Edge product review, 2026-10-08. SELECT-only; no refresh or mutation.
-- Production schema inspected via information_schema.columns first.

-- coverageSql
WITH latest AS (SELECT DISTINCT ON(listing_id) * FROM listing_snapshots ORDER BY listing_id,observed_at DESC), life AS (SELECT listing_id,count(*) n,extract(epoch from(max(observed_at)-min(observed_at)))/86400 span FROM listing_snapshots GROUP BY listing_id) SELECT now() audit_at,
(SELECT count(*) FROM listings) sale_total,(SELECT count(*) FROM listings WHERE status='active') sale_active,
(SELECT count(*) FROM listing_snapshots) sale_snapshots,
(SELECT count(*) FROM listings l JOIN latest s ON s.listing_id=l.id WHERE l.status='active' AND s.asking_price_nis>0 AND s.area_sqm>0 AND s.rooms>0) active_complete_price_size_rooms,
(SELECT count(*) FROM listings WHERE status='active' AND neighborhood_id IS NOT NULL) active_canonical_neighborhood,
(SELECT count(*) FROM listings WHERE status='active' AND property_id IS NOT NULL) active_property_link,
(SELECT count(*) FROM listings WHERE status='active' AND building_id IS NOT NULL) active_building_link,
(SELECT count(*) FROM listings WHERE status='active' AND canonical_address ~ '[0-9]') active_address_with_number,
(SELECT count(*) FROM listings WHERE status='active' AND url ~ '/item/') active_item_url,
(SELECT count(*) FROM listings l JOIN life ON life.listing_id=l.id WHERE status='active' AND life.n>=2 AND life.span>=1) active_lifecycle_supported,
(SELECT count(*) FROM rental_listings) rental_total,
(SELECT count(*) FROM rental_listings WHERE status='active') rental_active,
(SELECT count(*) FROM transactions) transactions_total,
(SELECT count(*) FROM transactions WHERE is_comparable) transactions_flag_eligible,
(SELECT count(*) FROM transactions WHERE is_comparable AND deal_date>=current_date-interval '5 years' AND amount_nis>0 AND coalesce(normalized_pp_sqm,pp_sqm)>0) transactions_service_eligible_5y,
(SELECT count(*) FROM transactions WHERE neighborhood_id IS NOT NULL) transactions_neighborhood,
(SELECT count(*) FROM transactions WHERE nullif(trim(address_text),'') IS NOT NULL) transactions_address,
(SELECT count(*) FROM transactions WHERE street_id IS NOT NULL) transactions_street,
(SELECT count(*) FROM transactions WHERE property_id IS NOT NULL) transactions_property,
(SELECT count(*) FROM transactions WHERE parcel_id IS NOT NULL) transactions_parcel,
(SELECT count(*) FROM transactions WHERE deal_date>=current_date-interval '12 months') transactions_12m,
(SELECT min(deal_date) FROM transactions) transaction_min_date,(SELECT max(deal_date) FROM transactions) transaction_max_date,
(SELECT count(*) FROM neighborhoods) neighborhoods,(SELECT count(*) FROM neighborhoods WHERE is_focus) focus_neighborhoods,
(SELECT count(*) FROM properties) properties,(SELECT count(*) FROM buildings) buildings,
(SELECT count(*) FROM neighborhood_cbs_profiles) cbs_profile_rows,
(SELECT count(*) FROM neighborhood_cbs_profiles WHERE safe_for_score) safe_cbs_profiles,
(SELECT count(*) FROM cbs_neighborhood_stat_area_key) official_crosswalk_rows,
(SELECT count(*) FROM neighborhood_stat_area_map) curated_mapping_rows,
(SELECT count(*) FROM statistical_areas) statistical_areas,
(SELECT count(*) FROM statistical_areas WHERE population IS NOT NULL) stat_area_population,
(SELECT count(*) FROM deals) deals,(SELECT count(*) FROM deal_scenarios) scenarios,
(SELECT count(*) FROM due_diligence_items) dd,(SELECT count(*) FROM deal_tasks) tasks,
(SELECT count(*) FROM renewal_projects) renewal_projects,
(SELECT count(*) FROM renewal_project_parcels) renewal_parcel_links,
(SELECT count(*) FROM renewal_project_addresses) renewal_address_rows,
(SELECT count(*) FROM renewal_project_addresses WHERE membership='verified') renewal_verified_addresses;

-- detailSql0
WITH latest AS (SELECT DISTINCT ON(listing_id) * FROM listing_snapshots ORDER BY listing_id,observed_at DESC) SELECT c.name_he city,n.name_he neighborhood,n.is_focus, count(DISTINCT l.id) active_sale,(SELECT count(*) FROM transactions t WHERE t.neighborhood_id=n.id) transactions,(SELECT count(*) FROM transactions t WHERE t.neighborhood_id=n.id AND t.is_comparable AND t.deal_date>=current_date-interval '5 years') eligible_5y,(SELECT count(*) FROM rental_listings r WHERE r.neighborhood_id=n.id AND r.status='active') active_rent,(SELECT count(*) FROM neighborhood_cbs_profiles p WHERE p.neighborhood_id=n.id AND p.safe_for_score) safe_cbs,min(s.observed_at) oldest_listing_observation,max(s.observed_at) newest_listing_observation FROM neighborhoods n JOIN cities c ON c.id=n.city_id LEFT JOIN listings l ON l.neighborhood_id=n.id AND l.status='active' LEFT JOIN latest s ON s.listing_id=l.id GROUP BY c.name_he,n.id,n.name_he,n.is_focus ORDER BY c.name_he,n.is_focus DESC,n.name_he;

-- detailSql2
SELECT 'seller_lifecycle_invalid' metric,count(*) value FROM listing_seller_signals WHERE (snapshot_count<2 OR observed_span_days<1 OR observed_span_days IS NULL) AND (days_on_market IS NOT NULL OR price_reductions IS NOT NULL OR original_asking_price IS NOT NULL) UNION ALL SELECT 'cached_lifecycle_invalid',count(*) FROM semantic_listing_market_benchmarks WHERE snapshot_count<2 AND(days_on_market IS NOT NULL OR first_asking_price_nis IS NOT NULL OR price_change_since_first_pct IS NOT NULL) UNION ALL SELECT 'duplicate_fingerprint_extra',coalesce(sum(n-1),0)::bigint FROM (SELECT count(*) n FROM transactions WHERE is_comparable GROUP BY neighborhood_id,deal_date,amount_nis,area_sqm,rooms,floor HAVING count(*)>1)x UNION ALL SELECT 'eligible_unmapped_neighborhood',count(*) FROM transactions WHERE is_comparable AND neighborhood_id IS NULL UNION ALL SELECT 'cbs_catalog_explicit',count(*) FROM over_datasets WHERE title ~* 'cbs|census|population|socioeconomic';

-- pipelineSql
SELECT 'sources' kind,jsonb_agg(x) rows FROM(SELECT id,kind,is_enabled,expected_interval_hours FROM data_sources ORDER BY id)x UNION ALL SELECT 'scopes',jsonb_agg(x) FROM(SELECT id,market,enabled,url,last_completed_at,backfill_started_at,backfill_completed_at,collector_attempted_at,left(last_error,180) last_error,config FROM yad2_crawl_scopes ORDER BY id)x UNION ALL SELECT 'latest_ingestion',jsonb_agg(x) FROM(SELECT DISTINCT ON(source_id,job_type)source_id,job_type,status,started_at,finished_at,fetched_count,inserted_count,updated_count,error_count FROM ingestion_runs ORDER BY source_id,job_type,started_at DESC)x UNION ALL SELECT 'checkpoint',jsonb_agg(x) FROM(SELECT source_id,job_key,status,last_success_at,last_error_at FROM etl_checkpoints)x UNION ALL SELECT 'source_records',jsonb_agg(x) FROM(SELECT market,state,count(*) records FROM yad2_source_records GROUP BY market,state)x UNION ALL SELECT 'saadia_membership',jsonb_agg(x) FROM(SELECT p.project_name,p.plan_number,a.street_name,a.house_number,a.membership,a.note,a.source_url,a.checked_at FROM renewal_projects p JOIN renewal_project_addresses a ON a.project_id=p.id WHERE a.street_name LIKE '%סעדיה%')x;

-- supplementSql
SELECT 'city_coverage' kind,jsonb_agg(x) rows FROM(SELECT c.name_he city,count(*) transactions,count(*) FILTER(WHERE t.is_comparable) eligible,count(*) FILTER(WHERE t.neighborhood_id IS NOT NULL) mapped FROM transactions t LEFT JOIN cities c ON c.id=t.city_id GROUP BY c.name_he)x UNION ALL SELECT 'cbs_lineage',jsonb_agg(x) FROM(SELECT observation_year,profile_quality,safe_for_score,count(*) profiles,min(calculated_at) calculated_at_min,max(calculated_at) calculated_at_max FROM neighborhood_cbs_profiles GROUP BY observation_year,profile_quality,safe_for_score)x UNION ALL SELECT 'renewal_missing_units',jsonb_agg(x) FROM(SELECT count(*) projects,count(*) FILTER(WHERE planned_units IS NULL) planned_units_unknown,count(*) FILTER(WHERE geom IS NOT NULL) geometry_present,count(*) FILTER(WHERE source_url IS NOT NULL) url_present FROM renewal_projects)x UNION ALL SELECT 'all_unknown_renewal_unit_neighborhoods',jsonb_agg(x) FROM(SELECT n.name_he neighborhood,count(*) projects,count(p.planned_units) known_planned_units FROM renewal_projects p JOIN neighborhoods n ON n.id=p.neighborhood_id GROUP BY n.name_he HAVING count(p.planned_units)=0)x UNION ALL SELECT 'focus_population',jsonb_agg(x) FROM(SELECT (SELECT count(*) FROM listings l JOIN neighborhoods n ON n.id=l.neighborhood_id WHERE n.is_focus AND l.status='active') active_sale,(SELECT count(*) FROM transactions t JOIN neighborhoods n ON n.id=t.neighborhood_id WHERE n.is_focus) transactions,(SELECT count(*) FROM transactions t JOIN neighborhoods n ON n.id=t.neighborhood_id WHERE n.is_focus AND t.is_comparable) eligible,(SELECT count(DISTINCT neighborhood_id) FROM listings WHERE status='active') listing_neighborhoods,(SELECT count(DISTINCT neighborhood_id) FROM transactions WHERE is_comparable) eligible_neighborhoods,(SELECT count(*) FROM asset_subscriptions WHERE status='active') active_subscriptions)x;

-- compsSql
SELECT id::text transaction_id,source_id,neighborhood_id::text,address_text,deal_date::text,amount_nis::float8 sale_price_nis,area_sqm::float8,rooms::float8,floor::float8,coalesce(normalized_pp_sqm,pp_sqm)::float8 price_per_sqm FROM transactions WHERE is_comparable=true AND neighborhood_id='03b2522f-3f71-4e92-bfc3-34b8492779d9' AND deal_date>=current_date-interval '5 years' AND coalesce(normalized_pp_sqm,pp_sqm)>0 AND amount_nis>0 ORDER BY deal_date DESC LIMIT 300;

-- cacheSql
SELECT n.name_he neighborhood,s.transaction_count_12m cached_count,s.median_price_sqm_12m cached_median,s.updated_at cached_at,count(t.id) FILTER(WHERE t.deal_date>=current_date-interval '12 months') actual_all_12m,count(t.id) FILTER(WHERE t.deal_date>=current_date-interval '12 months' AND t.is_comparable) actual_comparable_12m,percentile_cont(.5) WITHIN GROUP(ORDER BY coalesce(t.normalized_pp_sqm,t.pp_sqm)) FILTER(WHERE t.deal_date>=current_date-interval '12 months' AND t.is_comparable AND coalesce(t.normalized_pp_sqm,t.pp_sqm)>0) actual_comparable_median_12m FROM neighborhoods n LEFT JOIN semantic_neighborhood_summary s ON s.neighborhood_id=n.id LEFT JOIN transactions t ON t.neighborhood_id=n.id WHERE n.is_focus GROUP BY n.id,n.name_he,s.transaction_count_12m,s.median_price_sqm_12m,s.updated_at ORDER BY n.name_he;

-- exactCacheSql
WITH q AS (SELECT ct.*,COALESCE(ct.neighborhood_id,b.neighborhood_id,nsm.neighborhood_id) resolved_neighborhood_id FROM comparable_transactions ct LEFT JOIN properties p ON p.id=ct.property_id LEFT JOIN buildings b ON b.id=p.building_id LEFT JOIN parcels par ON par.id=ct.parcel_id LEFT JOIN neighborhood_stat_area_map nsm ON nsm.stat_area_id=par.stat_area_id) SELECT n.name_he neighborhood,s.transaction_count_12m cached_count,count(q.id) actual_service_count_12m,count(DISTINCT q.id) distinct_transactions_12m,percentile_cont(.5) WITHIN GROUP(ORDER BY COALESCE(q.normalized_pp_sqm,q.pp_sqm)) FILTER(WHERE COALESCE(q.normalized_pp_sqm,q.pp_sqm)>0) actual_service_median_12m,s.updated_at FROM neighborhoods n JOIN semantic_neighborhood_summary s ON s.neighborhood_id=n.id LEFT JOIN q ON q.resolved_neighborhood_id=n.id AND q.deal_date>=current_date-interval '12 months' WHERE n.is_focus GROUP BY n.id,n.name_he,s.transaction_count_12m,s.updated_at ORDER BY n.name_he;
