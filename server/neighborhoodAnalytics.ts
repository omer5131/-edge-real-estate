import {queryDatabase} from './db.js';

const confidence=(n:number,target:number)=>Math.max(0,Math.min(1,n/target));

export async function refreshNeighborhoodMarketAnalytics(){
  const result={monthlyPeriods:0,rollingPeriods:0,cbsProfiles:0,listingBenchmarks:0};

  await queryDatabase(`DELETE FROM neighborhood_market_periods WHERE period_type IN ('month','rolling_12m')`);

  const monthly=await queryDatabase(`
    WITH months AS(
      SELECT generate_series(date '2022-01-01',date_trunc('month',current_date)::date,interval '1 month')::date period_start
    ), n AS(
      SELECT id neighborhood_id FROM neighborhoods WHERE canonical_status='active'
    ), tx AS(
      SELECT ct.neighborhood_id,date_trunc('month',ct.deal_date)::date period_start,
        count(*)::int n,
        percentile_cont(.5) WITHIN GROUP(ORDER BY ct.amount_nis) median_price,
        percentile_cont(.5) WITHIN GROUP(ORDER BY COALESCE(ct.normalized_pp_sqm,ct.pp_sqm)) FILTER(WHERE COALESCE(ct.normalized_pp_sqm,ct.pp_sqm)>0) median_ppsqm,
        percentile_cont(.25) WITHIN GROUP(ORDER BY COALESCE(ct.normalized_pp_sqm,ct.pp_sqm)) FILTER(WHERE COALESCE(ct.normalized_pp_sqm,ct.pp_sqm)>0) p25_ppsqm,
        percentile_cont(.75) WITHIN GROUP(ORDER BY COALESCE(ct.normalized_pp_sqm,ct.pp_sqm)) FILTER(WHERE COALESCE(ct.normalized_pp_sqm,ct.pp_sqm)>0) p75_ppsqm,
        percentile_cont(.5) WITHIN GROUP(ORDER BY ct.area_sqm) FILTER(WHERE ct.area_sqm>0) median_area,
        percentile_cont(.5) WITHIN GROUP(ORDER BY ct.rooms) FILTER(WHERE ct.rooms>0) median_rooms
      FROM comparable_transactions ct
      WHERE ct.neighborhood_id IS NOT NULL AND ct.deal_date>=date '2022-01-01'
        AND COALESCE(ct.is_comparable,true)
      GROUP BY ct.neighborhood_id,date_trunc('month',ct.deal_date)
    ), sale_month AS(
      SELECT l.neighborhood_id,date_trunc('month',x.observed_at)::date period_start,
        count(*)::int listing_count,
        percentile_cont(.5) WITHIN GROUP(ORDER BY x.asking_price_nis) FILTER(WHERE x.asking_price_nis>0) median_asking,
        percentile_cont(.5) WITHIN GROUP(ORDER BY x.asking_price_nis/x.area_sqm) FILTER(WHERE x.asking_price_nis>0 AND x.area_sqm>0) median_asking_ppsqm
      FROM listings l
      JOIN LATERAL(
        SELECT DISTINCT ON(date_trunc('month',s.observed_at)) s.observed_at,s.asking_price_nis,s.area_sqm
        FROM listing_snapshots s WHERE s.listing_id=l.id
        ORDER BY date_trunc('month',s.observed_at),s.observed_at DESC
      ) x ON true
      WHERE l.neighborhood_id IS NOT NULL
      GROUP BY l.neighborhood_id,date_trunc('month',x.observed_at)
    ), rent_month AS(
      SELECT l.neighborhood_id,date_trunc('month',x.observed_at)::date period_start,
        count(*)::int listing_count,
        percentile_cont(.5) WITHIN GROUP(ORDER BY x.asking_rent_nis) FILTER(WHERE x.asking_rent_nis>0) median_rent,
        percentile_cont(.5) WITHIN GROUP(ORDER BY x.asking_rent_nis/x.area_sqm) FILTER(WHERE x.asking_rent_nis>0 AND x.area_sqm>0) median_rent_sqm
      FROM rental_listings l
      JOIN LATERAL(
        SELECT DISTINCT ON(date_trunc('month',s.observed_at)) s.observed_at,s.asking_rent_nis,s.area_sqm
        FROM rental_listing_snapshots s WHERE s.rental_listing_id=l.id
        ORDER BY date_trunc('month',s.observed_at),s.observed_at DESC
      ) x ON true
      WHERE l.neighborhood_id IS NOT NULL
      GROUP BY l.neighborhood_id,date_trunc('month',x.observed_at)
    )
    INSERT INTO neighborhood_market_periods(
      neighborhood_id,period_type,period_start,executed_transaction_count,
      median_executed_price_nis,median_executed_price_sqm,p25_executed_price_sqm,p75_executed_price_sqm,
      median_area_sqm,median_rooms,active_sale_listing_count,median_asking_price_nis,median_asking_price_sqm,
      active_rent_listing_count,median_asking_rent_nis,median_rent_sqm,asking_to_executed_premium_pct,
      transaction_confidence,listing_confidence,calculated_at
    )
    SELECT n.neighborhood_id,'month',m.period_start,COALESCE(tx.n,0),
      tx.median_price,tx.median_ppsqm,tx.p25_ppsqm,tx.p75_ppsqm,tx.median_area,tx.median_rooms,
      COALESCE(sm.listing_count,0),sm.median_asking,sm.median_asking_ppsqm,
      COALESCE(rm.listing_count,0),rm.median_rent,rm.median_rent_sqm,
      CASE WHEN tx.median_ppsqm>0 AND sm.median_asking_ppsqm>0 THEN 100*(sm.median_asking_ppsqm/tx.median_ppsqm-1) END,
      LEAST(1,COALESCE(tx.n,0)::numeric/15),
      LEAST(1,COALESCE(sm.listing_count,0)::numeric/10),
      now()
    FROM n CROSS JOIN months m
    LEFT JOIN tx ON tx.neighborhood_id=n.neighborhood_id AND tx.period_start=m.period_start
    LEFT JOIN sale_month sm ON sm.neighborhood_id=n.neighborhood_id AND sm.period_start=m.period_start
    LEFT JOIN rent_month rm ON rm.neighborhood_id=n.neighborhood_id AND rm.period_start=m.period_start
    WHERE tx.n IS NOT NULL OR sm.listing_count IS NOT NULL OR rm.listing_count IS NOT NULL
    RETURNING neighborhood_id
  `);
  result.monthlyPeriods=monthly.length;

  const rolling=await queryDatabase(`
    WITH n AS(SELECT id neighborhood_id FROM neighborhoods WHERE canonical_status='active'),
    tx AS(
      SELECT neighborhood_id,count(*)::int n,
        percentile_cont(.5) WITHIN GROUP(ORDER BY amount_nis) median_price,
        percentile_cont(.5) WITHIN GROUP(ORDER BY COALESCE(normalized_pp_sqm,pp_sqm)) FILTER(WHERE COALESCE(normalized_pp_sqm,pp_sqm)>0) median_ppsqm,
        percentile_cont(.25) WITHIN GROUP(ORDER BY COALESCE(normalized_pp_sqm,pp_sqm)) FILTER(WHERE COALESCE(normalized_pp_sqm,pp_sqm)>0) p25_ppsqm,
        percentile_cont(.75) WITHIN GROUP(ORDER BY COALESCE(normalized_pp_sqm,pp_sqm)) FILTER(WHERE COALESCE(normalized_pp_sqm,pp_sqm)>0) p75_ppsqm,
        percentile_cont(.5) WITHIN GROUP(ORDER BY area_sqm) FILTER(WHERE area_sqm>0) median_area,
        percentile_cont(.5) WITHIN GROUP(ORDER BY rooms) FILTER(WHERE rooms>0) median_rooms
      FROM comparable_transactions
      WHERE neighborhood_id IS NOT NULL AND deal_date>=current_date-interval '12 months' AND COALESCE(is_comparable,true)
      GROUP BY neighborhood_id
    ), sale AS(
      SELECT l.neighborhood_id,count(*)::int n,
        percentile_cont(.5) WITHIN GROUP(ORDER BY s.asking_price_nis) FILTER(WHERE s.asking_price_nis>0) median_asking,
        percentile_cont(.5) WITHIN GROUP(ORDER BY s.asking_price_nis/s.area_sqm) FILTER(WHERE s.asking_price_nis>0 AND s.area_sqm>0) median_ppsqm
      FROM listings l JOIN LATERAL(
        SELECT asking_price_nis,area_sqm FROM listing_snapshots x WHERE x.listing_id=l.id ORDER BY observed_at DESC LIMIT 1
      ) s ON true
      WHERE l.neighborhood_id IS NOT NULL AND l.status='active'
      GROUP BY l.neighborhood_id
    ), rent AS(
      SELECT l.neighborhood_id,count(*)::int n,
        percentile_cont(.5) WITHIN GROUP(ORDER BY s.asking_rent_nis) FILTER(WHERE s.asking_rent_nis>0) median_rent,
        percentile_cont(.5) WITHIN GROUP(ORDER BY s.asking_rent_nis/s.area_sqm) FILTER(WHERE s.asking_rent_nis>0 AND s.area_sqm>0) median_rent_sqm
      FROM rental_listings l JOIN LATERAL(
        SELECT asking_rent_nis,area_sqm FROM rental_listing_snapshots x WHERE x.rental_listing_id=l.id ORDER BY observed_at DESC LIMIT 1
      ) s ON true
      WHERE l.neighborhood_id IS NOT NULL AND l.status='active'
      GROUP BY l.neighborhood_id
    )
    INSERT INTO neighborhood_market_periods(
      neighborhood_id,period_type,period_start,executed_transaction_count,median_executed_price_nis,
      median_executed_price_sqm,p25_executed_price_sqm,p75_executed_price_sqm,median_area_sqm,median_rooms,
      active_sale_listing_count,median_asking_price_nis,median_asking_price_sqm,active_rent_listing_count,
      median_asking_rent_nis,median_rent_sqm,asking_to_executed_premium_pct,transaction_confidence,listing_confidence,calculated_at
    )
    SELECT n.neighborhood_id,'rolling_12m',(current_date-interval '12 months')::date,COALESCE(tx.n,0),
      tx.median_price,tx.median_ppsqm,tx.p25_ppsqm,tx.p75_ppsqm,tx.median_area,tx.median_rooms,
      COALESCE(sale.n,0),sale.median_asking,sale.median_ppsqm,COALESCE(rent.n,0),rent.median_rent,rent.median_rent_sqm,
      CASE WHEN tx.median_ppsqm>0 AND sale.median_ppsqm>0 THEN 100*(sale.median_ppsqm/tx.median_ppsqm-1) END,
      LEAST(1,COALESCE(tx.n,0)::numeric/20),LEAST(1,COALESCE(sale.n,0)::numeric/10),now()
    FROM n LEFT JOIN tx ON tx.neighborhood_id=n.neighborhood_id
    LEFT JOIN sale ON sale.neighborhood_id=n.neighborhood_id
    LEFT JOIN rent ON rent.neighborhood_id=n.neighborhood_id
    WHERE tx.n IS NOT NULL OR sale.n IS NOT NULL OR rent.n IS NOT NULL
    RETURNING neighborhood_id
  `);
  result.rollingPeriods=rolling.length;

  await queryDatabase(`DELETE FROM neighborhood_cbs_profiles`);
  const cbs=await queryDatabase(`
    WITH safe_map AS(
      SELECT m.neighborhood_id,m.stat_area_id,m.mapping_confidence
      FROM neighborhood_stat_area_map m
      WHERE m.overlap_ratio=1
         OR (m.mapping_method='polygon_overlap' AND m.overlap_ratio>=.8)
         OR COALESCE((m.source_evidence->>'exclusive')::boolean,false)
    ), c22 AS(
      SELECT sm.neighborhood_id,
        count(*)::int stat_count,
        sum(c.population)::numeric population_2022,
        sum(c.population*NULLIF(c.employment_pct,0))/NULLIF(sum(c.population) FILTER(WHERE c.employment_pct IS NOT NULL),0) employment_pct,
        sum(c.population*NULLIF(to_jsonb(c)->>'AcadmCert_pcnt','')::numeric)/NULLIF(sum(c.population) FILTER(WHERE NULLIF(to_jsonb(c)->>'AcadmCert_pcnt','') IS NOT NULL),0) academic_pct,
        sum(c.population*c.median_annual_employee_wage)/NULLIF(sum(c.population) FILTER(WHERE c.median_annual_employee_wage IS NOT NULL),0) wage,
        sum(c.population*c.average_household_size)/NULLIF(sum(c.population) FILTER(WHERE c.average_household_size IS NOT NULL),0) hh_size,
        sum(c.population*c.owner_households_pct)/NULLIF(sum(c.population) FILTER(WHERE c.owner_households_pct IS NOT NULL),0) owner_pct,
        sum(c.population*c.renter_households_pct)/NULLIF(sum(c.population) FILTER(WHERE c.renter_households_pct IS NOT NULL),0) renter_pct,
        sum(c.population*c.median_age)/NULLIF(sum(c.population) FILTER(WHERE c.median_age IS NOT NULL),0) median_age,
        avg(sm.mapping_confidence)::numeric mapping_confidence
      FROM safe_map sm
      JOIN statistical_areas s ON s.id=sm.stat_area_id
      JOIN cities city ON city.id=s.city_id
      JOIN research_census_2022 c ON c.locality_code=city.settlement_code AND c.statistical_area_code=s.stat_area_code
      GROUP BY sm.neighborhood_id
    ), p24 AS(
      SELECT sm.neighborhood_id,sum(p.population)::numeric population_2024
      FROM safe_map sm
      JOIN statistical_areas s ON s.id=sm.stat_area_id
      JOIN cities city ON city.id=s.city_id
      JOIN research_area_population_2024 p ON p.locality_code=city.settlement_code AND p.statistical_area_code=s.stat_area_code
      GROUP BY sm.neighborhood_id
    )
    INSERT INTO neighborhood_cbs_profiles(
      neighborhood_id,observation_year,population,population_growth_from_2022_pct,employment_pct,
      academic_certificate_pct,median_annual_employee_wage,average_household_size,owner_households_pct,
      renter_households_pct,median_age,statistical_area_count,mapping_confidence,source_evidence,calculated_at
    )
    SELECT c22.neighborhood_id,2022,c22.population_2022,NULL,c22.employment_pct,c22.academic_pct,c22.wage,
      c22.hh_size,c22.owner_pct,c22.renter_pct,c22.median_age,c22.stat_count,c22.mapping_confidence,
      jsonb_build_object('source','CBS Census 2022','grain','statistical_area','aggregation','population_weighted'),now()
    FROM c22
    UNION ALL
    SELECT c22.neighborhood_id,2024,p24.population_2024,
      CASE WHEN c22.population_2022>0 THEN 100*(p24.population_2024/c22.population_2022-1) END,
      c22.employment_pct,c22.academic_pct,c22.wage,c22.hh_size,c22.owner_pct,c22.renter_pct,c22.median_age,
      c22.stat_count,c22.mapping_confidence,
      jsonb_build_object('sources',jsonb_build_array('CBS Census 2022','CBS Area Population 2024'),
                         'demographics_reference_year',2022,'population_reference_year',2024),now()
    FROM c22 JOIN p24 ON p24.neighborhood_id=c22.neighborhood_id
    RETURNING neighborhood_id
  `);
  result.cbsProfiles=cbs.length;

  await queryDatabase(`
    UPDATE neighborhood_cbs_profiles
    SET profile_quality='validated',safe_for_score=true,crosswalk_method='safe_stat_area_crosswalk'
  `);

  const provisional=await queryDatabase(`
    WITH candidate_map AS(
      SELECT m.neighborhood_id,m.stat_area_id,m.mapping_confidence,m.mapping_method,m.source_evidence
      FROM neighborhood_stat_area_map m
      WHERE m.mapping_confidence>=.85
        AND (
          COALESCE((m.source_evidence->>'safe_for_identity')::boolean,false)
          OR COALESCE((m.source_evidence->>'safe_for_polygon')::boolean,false)
          OR m.mapping_method IN ('configured_crosswalk','official_crosswalk')
        )
        AND NOT EXISTS(
          SELECT 1 FROM neighborhood_cbs_profiles p WHERE p.neighborhood_id=m.neighborhood_id
        )
    ), c22 AS(
      SELECT cm.neighborhood_id,
        count(*)::int stat_count,
        sum(c.population)::numeric population_2022,
        sum(c.population*c.employment_pct)/NULLIF(sum(c.population) FILTER(WHERE c.employment_pct IS NOT NULL),0) employment_pct,
        sum(c.population*CASE WHEN NULLIF(to_jsonb(c)->>'AcadmCert_pcnt','') ~ '^-?[0-9]+([.][0-9]+)?
  const benchmarks=await queryDatabase(`
    WITH latest AS(
      SELECT l.id listing_id,l.neighborhood_id,l.status,s.observed_at,s.asking_price_nis,s.area_sqm,s.rooms,
        CASE WHEN s.area_sqm>0 THEN s.asking_price_nis/s.area_sqm END asking_ppsqm
      FROM listings l
      JOIN LATERAL(
        SELECT observed_at,asking_price_nis,area_sqm,rooms FROM listing_snapshots x
        WHERE x.listing_id=l.id ORDER BY observed_at DESC LIMIT 1
      ) s ON true
      WHERE l.status='active' AND l.neighborhood_id IS NOT NULL AND s.asking_price_nis>0
    ), hist AS(
      SELECT x.listing_id,
        count(ct.*)::int historical_n,
        percentile_cont(.5) WITHIN GROUP(ORDER BY COALESCE(ct.normalized_pp_sqm,ct.pp_sqm))
          FILTER(WHERE COALESCE(ct.normalized_pp_sqm,ct.pp_sqm)>0) historical_median,
        count(ct.*) FILTER(
          WHERE (x.rooms IS NULL OR ct.rooms BETWEEN x.rooms-.5 AND x.rooms+.5)
            AND (x.area_sqm IS NULL OR ct.area_sqm BETWEEN x.area_sqm*.8 AND x.area_sqm*1.2)
        )::int matched_n,
        percentile_cont(.5) WITHIN GROUP(ORDER BY COALESCE(ct.normalized_pp_sqm,ct.pp_sqm))
          FILTER(WHERE COALESCE(ct.normalized_pp_sqm,ct.pp_sqm)>0
            AND (x.rooms IS NULL OR ct.rooms BETWEEN x.rooms-.5 AND x.rooms+.5)
            AND (x.area_sqm IS NULL OR ct.area_sqm BETWEEN x.area_sqm*.8 AND x.area_sqm*1.2)) matched_median,
        percentile_cont(.5) WITHIN GROUP(ORDER BY COALESCE(ct.normalized_pp_sqm,ct.pp_sqm))
          FILTER(WHERE COALESCE(ct.normalized_pp_sqm,ct.pp_sqm)>0 AND ct.deal_date>=current_date-interval '6 months') recent6_median
      FROM latest x
      LEFT JOIN comparable_transactions ct ON ct.neighborhood_id=x.neighborhood_id
        AND ct.deal_date>=current_date-interval '12 months' AND COALESCE(ct.is_comparable,true)
      GROUP BY x.listing_id
    ), current_ask AS(
      SELECT x.listing_id,count(o.*)::int n,
        percentile_cont(.5) WITHIN GROUP(ORDER BY o.asking_ppsqm) FILTER(WHERE o.asking_ppsqm>0) median_ppsqm
      FROM latest x
      LEFT JOIN latest o ON o.neighborhood_id=x.neighborhood_id AND o.listing_id<>x.listing_id
      GROUP BY x.listing_id
    ), trend AS(
      SELECT neighborhood_id,numeric_value
      FROM neighborhood_metric_snapshots m
      WHERE metric_key='price_change_1y'
        AND as_of_date=(SELECT max(as_of_date) FROM neighborhood_metric_snapshots x WHERE x.neighborhood_id=m.neighborhood_id AND x.metric_key='price_change_1y')
    )
    INSERT INTO listing_market_benchmarks(
      listing_id,neighborhood_id,listing_observed_at,asking_price_nis,area_sqm,rooms,asking_price_sqm,
      historical_window_months,historical_sample_count,matched_historical_sample_count,historical_median_price_sqm,
      matched_historical_median_price_sqm,current_listing_sample_count,current_listing_median_price_sqm,
      executed_discount_pct,matched_executed_discount_pct,current_asking_discount_pct,neighborhood_price_change_1y_pct,
      trend_adjusted_executed_price_sqm,trend_adjusted_discount_pct,benchmark_confidence,benchmark_method,evidence
    )
    SELECT x.listing_id,x.neighborhood_id,x.observed_at,x.asking_price_nis,x.area_sqm,x.rooms,x.asking_ppsqm,
      12,h.historical_n,h.matched_n,h.historical_median,h.matched_median,ca.n,ca.median_ppsqm,
      CASE WHEN h.historical_median>0 AND x.asking_ppsqm>0 THEN 100*(x.asking_ppsqm/h.historical_median-1) END,
      CASE WHEN h.matched_median>0 AND x.asking_ppsqm>0 THEN 100*(x.asking_ppsqm/h.matched_median-1) END,
      CASE WHEN ca.median_ppsqm>0 AND x.asking_ppsqm>0 THEN 100*(x.asking_ppsqm/ca.median_ppsqm-1) END,
      t.numeric_value,
      COALESCE(h.recent6_median,h.matched_median,h.historical_median),
      CASE WHEN COALESCE(h.recent6_median,h.matched_median,h.historical_median)>0 AND x.asking_ppsqm>0
           THEN 100*(x.asking_ppsqm/COALESCE(h.recent6_median,h.matched_median,h.historical_median)-1) END,
      LEAST(1,
        (CASE WHEN h.matched_n>=5 THEN .55 WHEN h.historical_n>=8 THEN .35 ELSE .15 END)
        +(CASE WHEN ca.n>=5 THEN .25 WHEN ca.n>=2 THEN .15 ELSE 0 END)
        +(CASE WHEN x.area_sqm>0 AND x.asking_ppsqm>0 THEN .20 ELSE 0 END)
      ),
      CASE WHEN h.matched_n>=5 THEN 'matched_rooms_area_12m'
           WHEN h.historical_n>=8 THEN 'neighborhood_12m'
           ELSE 'limited_neighborhood_evidence' END,
      jsonb_build_object(
        'historical_source','comparable_transactions',
        'historical_window','12 months',
        'recent_executed_window','6 months',
        'current_market_source','active listing latest snapshots',
        'matched_rule','rooms ±0.5 and area ±20%',
        'historical_sample',h.historical_n,'matched_sample',h.matched_n,'current_listing_sample',ca.n
      )
    FROM latest x
    JOIN hist h ON h.listing_id=x.listing_id
    JOIN current_ask ca ON ca.listing_id=x.listing_id
    LEFT JOIN trend t ON t.neighborhood_id=x.neighborhood_id
    RETURNING listing_id
  `);
  result.listingBenchmarks=benchmarks.length;

  return result;
}

                              THEN (to_jsonb(c)->>'AcadmCert_pcnt')::numeric END)
          /NULLIF(sum(c.population) FILTER(WHERE NULLIF(to_jsonb(c)->>'AcadmCert_pcnt','') ~ '^-?[0-9]+([.][0-9]+)?
  const benchmarks=await queryDatabase(`
    WITH latest AS(
      SELECT l.id listing_id,l.neighborhood_id,l.status,s.observed_at,s.asking_price_nis,s.area_sqm,s.rooms,
        CASE WHEN s.area_sqm>0 THEN s.asking_price_nis/s.area_sqm END asking_ppsqm
      FROM listings l
      JOIN LATERAL(
        SELECT observed_at,asking_price_nis,area_sqm,rooms FROM listing_snapshots x
        WHERE x.listing_id=l.id ORDER BY observed_at DESC LIMIT 1
      ) s ON true
      WHERE l.status='active' AND l.neighborhood_id IS NOT NULL AND s.asking_price_nis>0
    ), hist AS(
      SELECT x.listing_id,
        count(ct.*)::int historical_n,
        percentile_cont(.5) WITHIN GROUP(ORDER BY COALESCE(ct.normalized_pp_sqm,ct.pp_sqm))
          FILTER(WHERE COALESCE(ct.normalized_pp_sqm,ct.pp_sqm)>0) historical_median,
        count(ct.*) FILTER(
          WHERE (x.rooms IS NULL OR ct.rooms BETWEEN x.rooms-.5 AND x.rooms+.5)
            AND (x.area_sqm IS NULL OR ct.area_sqm BETWEEN x.area_sqm*.8 AND x.area_sqm*1.2)
        )::int matched_n,
        percentile_cont(.5) WITHIN GROUP(ORDER BY COALESCE(ct.normalized_pp_sqm,ct.pp_sqm))
          FILTER(WHERE COALESCE(ct.normalized_pp_sqm,ct.pp_sqm)>0
            AND (x.rooms IS NULL OR ct.rooms BETWEEN x.rooms-.5 AND x.rooms+.5)
            AND (x.area_sqm IS NULL OR ct.area_sqm BETWEEN x.area_sqm*.8 AND x.area_sqm*1.2)) matched_median,
        percentile_cont(.5) WITHIN GROUP(ORDER BY COALESCE(ct.normalized_pp_sqm,ct.pp_sqm))
          FILTER(WHERE COALESCE(ct.normalized_pp_sqm,ct.pp_sqm)>0 AND ct.deal_date>=current_date-interval '6 months') recent6_median
      FROM latest x
      LEFT JOIN comparable_transactions ct ON ct.neighborhood_id=x.neighborhood_id
        AND ct.deal_date>=current_date-interval '12 months' AND COALESCE(ct.is_comparable,true)
      GROUP BY x.listing_id
    ), current_ask AS(
      SELECT x.listing_id,count(o.*)::int n,
        percentile_cont(.5) WITHIN GROUP(ORDER BY o.asking_ppsqm) FILTER(WHERE o.asking_ppsqm>0) median_ppsqm
      FROM latest x
      LEFT JOIN latest o ON o.neighborhood_id=x.neighborhood_id AND o.listing_id<>x.listing_id
      GROUP BY x.listing_id
    ), trend AS(
      SELECT neighborhood_id,numeric_value
      FROM neighborhood_metric_snapshots m
      WHERE metric_key='price_change_1y'
        AND as_of_date=(SELECT max(as_of_date) FROM neighborhood_metric_snapshots x WHERE x.neighborhood_id=m.neighborhood_id AND x.metric_key='price_change_1y')
    )
    INSERT INTO listing_market_benchmarks(
      listing_id,neighborhood_id,listing_observed_at,asking_price_nis,area_sqm,rooms,asking_price_sqm,
      historical_window_months,historical_sample_count,matched_historical_sample_count,historical_median_price_sqm,
      matched_historical_median_price_sqm,current_listing_sample_count,current_listing_median_price_sqm,
      executed_discount_pct,matched_executed_discount_pct,current_asking_discount_pct,neighborhood_price_change_1y_pct,
      trend_adjusted_executed_price_sqm,trend_adjusted_discount_pct,benchmark_confidence,benchmark_method,evidence
    )
    SELECT x.listing_id,x.neighborhood_id,x.observed_at,x.asking_price_nis,x.area_sqm,x.rooms,x.asking_ppsqm,
      12,h.historical_n,h.matched_n,h.historical_median,h.matched_median,ca.n,ca.median_ppsqm,
      CASE WHEN h.historical_median>0 AND x.asking_ppsqm>0 THEN 100*(x.asking_ppsqm/h.historical_median-1) END,
      CASE WHEN h.matched_median>0 AND x.asking_ppsqm>0 THEN 100*(x.asking_ppsqm/h.matched_median-1) END,
      CASE WHEN ca.median_ppsqm>0 AND x.asking_ppsqm>0 THEN 100*(x.asking_ppsqm/ca.median_ppsqm-1) END,
      t.numeric_value,
      COALESCE(h.recent6_median,h.matched_median,h.historical_median),
      CASE WHEN COALESCE(h.recent6_median,h.matched_median,h.historical_median)>0 AND x.asking_ppsqm>0
           THEN 100*(x.asking_ppsqm/COALESCE(h.recent6_median,h.matched_median,h.historical_median)-1) END,
      LEAST(1,
        (CASE WHEN h.matched_n>=5 THEN .55 WHEN h.historical_n>=8 THEN .35 ELSE .15 END)
        +(CASE WHEN ca.n>=5 THEN .25 WHEN ca.n>=2 THEN .15 ELSE 0 END)
        +(CASE WHEN x.area_sqm>0 AND x.asking_ppsqm>0 THEN .20 ELSE 0 END)
      ),
      CASE WHEN h.matched_n>=5 THEN 'matched_rooms_area_12m'
           WHEN h.historical_n>=8 THEN 'neighborhood_12m'
           ELSE 'limited_neighborhood_evidence' END,
      jsonb_build_object(
        'historical_source','comparable_transactions',
        'historical_window','12 months',
        'recent_executed_window','6 months',
        'current_market_source','active listing latest snapshots',
        'matched_rule','rooms ±0.5 and area ±20%',
        'historical_sample',h.historical_n,'matched_sample',h.matched_n,'current_listing_sample',ca.n
      )
    FROM latest x
    JOIN hist h ON h.listing_id=x.listing_id
    JOIN current_ask ca ON ca.listing_id=x.listing_id
    LEFT JOIN trend t ON t.neighborhood_id=x.neighborhood_id
    RETURNING listing_id
  `);
  result.listingBenchmarks=benchmarks.length;

  return result;
}
),0) academic_pct,
        sum(c.population*c.median_annual_employee_wage)/NULLIF(sum(c.population) FILTER(WHERE c.median_annual_employee_wage IS NOT NULL),0) wage,
        sum(c.population*c.average_household_size)/NULLIF(sum(c.population) FILTER(WHERE c.average_household_size IS NOT NULL),0) hh_size,
        sum(c.population*c.owner_households_pct)/NULLIF(sum(c.population) FILTER(WHERE c.owner_households_pct IS NOT NULL),0) owner_pct,
        sum(c.population*c.renter_households_pct)/NULLIF(sum(c.population) FILTER(WHERE c.renter_households_pct IS NOT NULL),0) renter_pct,
        sum(c.population*c.median_age)/NULLIF(sum(c.population) FILTER(WHERE c.median_age IS NOT NULL),0) median_age,
        avg(cm.mapping_confidence)::numeric mapping_confidence,
        jsonb_agg(DISTINCT jsonb_build_object(
          'mapping_method',cm.mapping_method,
          'mapping_confidence',cm.mapping_confidence,
          'source_evidence',cm.source_evidence
        )) crosswalk_evidence
      FROM candidate_map cm
      JOIN statistical_areas s ON s.id=cm.stat_area_id
      JOIN cities city ON city.id=s.city_id
      JOIN research_census_2022 c ON c.locality_code=city.settlement_code AND c.statistical_area_code=s.stat_area_code
      GROUP BY cm.neighborhood_id
    ), p24 AS(
      SELECT cm.neighborhood_id,sum(p.population)::numeric population_2024
      FROM candidate_map cm
      JOIN statistical_areas s ON s.id=cm.stat_area_id
      JOIN cities city ON city.id=s.city_id
      JOIN research_area_population_2024 p ON p.locality_code=city.settlement_code AND p.statistical_area_code=s.stat_area_code
      GROUP BY cm.neighborhood_id
    )
    INSERT INTO neighborhood_cbs_profiles(
      neighborhood_id,observation_year,population,population_growth_from_2022_pct,employment_pct,
      academic_certificate_pct,median_annual_employee_wage,average_household_size,owner_households_pct,
      renter_households_pct,median_age,statistical_area_count,mapping_confidence,profile_quality,safe_for_score,
      crosswalk_method,source_evidence,calculated_at
    )
    SELECT c22.neighborhood_id,2022,c22.population_2022,NULL,c22.employment_pct,c22.academic_pct,c22.wage,
      c22.hh_size,c22.owner_pct,c22.renter_pct,c22.median_age,c22.stat_count,c22.mapping_confidence,
      'provisional',false,'reviewed_crosswalk',
      jsonb_build_object(
        'source','CBS Census 2022',
        'grain','statistical_area',
        'aggregation','population_weighted',
        'quality','provisional',
        'crosswalk_evidence',c22.crosswalk_evidence
      ),now()
    FROM c22
    UNION ALL
    SELECT c22.neighborhood_id,2024,p24.population_2024,
      CASE WHEN c22.population_2022>0 THEN 100*(p24.population_2024/c22.population_2022-1) END,
      c22.employment_pct,c22.academic_pct,c22.wage,c22.hh_size,c22.owner_pct,c22.renter_pct,c22.median_age,
      c22.stat_count,c22.mapping_confidence,'provisional',false,'reviewed_crosswalk',
      jsonb_build_object(
        'sources',jsonb_build_array('CBS Census 2022','CBS Area Population 2024'),
        'quality','provisional',
        'demographics_reference_year',2022,
        'population_reference_year',2024,
        'crosswalk_evidence',c22.crosswalk_evidence
      ),now()
    FROM c22 JOIN p24 ON p24.neighborhood_id=c22.neighborhood_id
    RETURNING neighborhood_id
  `);
  result.cbsProfiles+=provisional.length;

  await queryDatabase(`DELETE FROM listing_market_benchmarks`);
  const benchmarks=await queryDatabase(`
    WITH latest AS(
      SELECT l.id listing_id,l.neighborhood_id,l.status,s.observed_at,s.asking_price_nis,s.area_sqm,s.rooms,
        CASE WHEN s.area_sqm>0 THEN s.asking_price_nis/s.area_sqm END asking_ppsqm
      FROM listings l
      JOIN LATERAL(
        SELECT observed_at,asking_price_nis,area_sqm,rooms FROM listing_snapshots x
        WHERE x.listing_id=l.id ORDER BY observed_at DESC LIMIT 1
      ) s ON true
      WHERE l.status='active' AND l.neighborhood_id IS NOT NULL AND s.asking_price_nis>0
    ), hist AS(
      SELECT x.listing_id,
        count(ct.*)::int historical_n,
        percentile_cont(.5) WITHIN GROUP(ORDER BY COALESCE(ct.normalized_pp_sqm,ct.pp_sqm))
          FILTER(WHERE COALESCE(ct.normalized_pp_sqm,ct.pp_sqm)>0) historical_median,
        count(ct.*) FILTER(
          WHERE (x.rooms IS NULL OR ct.rooms BETWEEN x.rooms-.5 AND x.rooms+.5)
            AND (x.area_sqm IS NULL OR ct.area_sqm BETWEEN x.area_sqm*.8 AND x.area_sqm*1.2)
        )::int matched_n,
        percentile_cont(.5) WITHIN GROUP(ORDER BY COALESCE(ct.normalized_pp_sqm,ct.pp_sqm))
          FILTER(WHERE COALESCE(ct.normalized_pp_sqm,ct.pp_sqm)>0
            AND (x.rooms IS NULL OR ct.rooms BETWEEN x.rooms-.5 AND x.rooms+.5)
            AND (x.area_sqm IS NULL OR ct.area_sqm BETWEEN x.area_sqm*.8 AND x.area_sqm*1.2)) matched_median,
        percentile_cont(.5) WITHIN GROUP(ORDER BY COALESCE(ct.normalized_pp_sqm,ct.pp_sqm))
          FILTER(WHERE COALESCE(ct.normalized_pp_sqm,ct.pp_sqm)>0 AND ct.deal_date>=current_date-interval '6 months') recent6_median
      FROM latest x
      LEFT JOIN comparable_transactions ct ON ct.neighborhood_id=x.neighborhood_id
        AND ct.deal_date>=current_date-interval '12 months' AND COALESCE(ct.is_comparable,true)
      GROUP BY x.listing_id
    ), current_ask AS(
      SELECT x.listing_id,count(o.*)::int n,
        percentile_cont(.5) WITHIN GROUP(ORDER BY o.asking_ppsqm) FILTER(WHERE o.asking_ppsqm>0) median_ppsqm
      FROM latest x
      LEFT JOIN latest o ON o.neighborhood_id=x.neighborhood_id AND o.listing_id<>x.listing_id
      GROUP BY x.listing_id
    ), trend AS(
      SELECT neighborhood_id,numeric_value
      FROM neighborhood_metric_snapshots m
      WHERE metric_key='price_change_1y'
        AND as_of_date=(SELECT max(as_of_date) FROM neighborhood_metric_snapshots x WHERE x.neighborhood_id=m.neighborhood_id AND x.metric_key='price_change_1y')
    )
    INSERT INTO listing_market_benchmarks(
      listing_id,neighborhood_id,listing_observed_at,asking_price_nis,area_sqm,rooms,asking_price_sqm,
      historical_window_months,historical_sample_count,matched_historical_sample_count,historical_median_price_sqm,
      matched_historical_median_price_sqm,current_listing_sample_count,current_listing_median_price_sqm,
      executed_discount_pct,matched_executed_discount_pct,current_asking_discount_pct,neighborhood_price_change_1y_pct,
      trend_adjusted_executed_price_sqm,trend_adjusted_discount_pct,benchmark_confidence,benchmark_method,evidence
    )
    SELECT x.listing_id,x.neighborhood_id,x.observed_at,x.asking_price_nis,x.area_sqm,x.rooms,x.asking_ppsqm,
      12,h.historical_n,h.matched_n,h.historical_median,h.matched_median,ca.n,ca.median_ppsqm,
      CASE WHEN h.historical_median>0 AND x.asking_ppsqm>0 THEN 100*(x.asking_ppsqm/h.historical_median-1) END,
      CASE WHEN h.matched_median>0 AND x.asking_ppsqm>0 THEN 100*(x.asking_ppsqm/h.matched_median-1) END,
      CASE WHEN ca.median_ppsqm>0 AND x.asking_ppsqm>0 THEN 100*(x.asking_ppsqm/ca.median_ppsqm-1) END,
      t.numeric_value,
      COALESCE(h.recent6_median,h.matched_median,h.historical_median),
      CASE WHEN COALESCE(h.recent6_median,h.matched_median,h.historical_median)>0 AND x.asking_ppsqm>0
           THEN 100*(x.asking_ppsqm/COALESCE(h.recent6_median,h.matched_median,h.historical_median)-1) END,
      LEAST(1,
        (CASE WHEN h.matched_n>=5 THEN .55 WHEN h.historical_n>=8 THEN .35 ELSE .15 END)
        +(CASE WHEN ca.n>=5 THEN .25 WHEN ca.n>=2 THEN .15 ELSE 0 END)
        +(CASE WHEN x.area_sqm>0 AND x.asking_ppsqm>0 THEN .20 ELSE 0 END)
      ),
      CASE WHEN h.matched_n>=5 THEN 'matched_rooms_area_12m'
           WHEN h.historical_n>=8 THEN 'neighborhood_12m'
           ELSE 'limited_neighborhood_evidence' END,
      jsonb_build_object(
        'historical_source','comparable_transactions',
        'historical_window','12 months',
        'recent_executed_window','6 months',
        'current_market_source','active listing latest snapshots',
        'matched_rule','rooms ±0.5 and area ±20%',
        'historical_sample',h.historical_n,'matched_sample',h.matched_n,'current_listing_sample',ca.n
      )
    FROM latest x
    JOIN hist h ON h.listing_id=x.listing_id
    JOIN current_ask ca ON ca.listing_id=x.listing_id
    LEFT JOIN trend t ON t.neighborhood_id=x.neighborhood_id
    RETURNING listing_id
  `);
  result.listingBenchmarks=benchmarks.length;

  return result;
}
