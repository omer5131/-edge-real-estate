-- Semantic definitions for liquidity and listing lifecycle analytics.

INSERT INTO semantic_metrics(metric_key,label,entity_key,preferred_table,expression_hint,time_field,unit,default_window,aggregation,source_grain,inheritance,confidence_rule,description,caveats,synonyms) VALUES
 ('months_of_sale_inventory','Months of sale inventory','neighborhood','semantic_neighborhood_market_history',
  'period_type=rolling_12m; months_of_sale_inventory','period_start','months','12 months','ratio','neighborhood','direct',
  'requires executed transaction pace and current active listings',
  'Active sale listings divided by the monthly transaction pace implied by the latest 12 months.',
  ARRAY['Sparse transaction neighborhoods can produce unstable inventory months'],ARRAY['months of supply','inventory months','חודשי מלאי']),
 ('transaction_velocity_3m','Three-month transaction velocity','neighborhood','semantic_neighborhood_market_history',
  'period_type=rolling_12m; transaction_count_3m','period_start','count','3 months','count','transaction','direct',
  'direct executed transaction count',
  'Executed comparable transactions in the latest three months.',
  ARRAY['Small counts imply low confidence'],ARRAY['liquidity','transaction velocity','עסקאות 3 חודשים']),
 ('listing_days_on_market','Listing days on market','listing','semantic_listing_market_benchmarks',
  'days_on_market','calculated_at','days','current','difference','listing','direct',
  'based on first_seen_at in canonical listing history',
  'Days since the listing was first observed by Edge.',
  ARRAY['First seen by Edge may be later than original publication date'],ARRAY['DOM','days listed','ימים בשוק']),
 ('listing_price_change','Listing price change since first observation','listing','semantic_listing_market_benchmarks',
  'price_change_since_first_pct','calculated_at','percent','listing lifetime','relative difference','listing','direct',
  'requires more than one observed price to be meaningful',
  'Current asking price relative to the first asking price observed by Edge.',
  ARRAY['Zero may mean no price change or only one observed price'],ARRAY['price cut','price reduction','הורדת מחיר']),
 ('listing_relative_value_signal','Listing relative value signal','listing','semantic_listing_market_benchmarks',
  'relative_value_signal','calculated_at','category','current','rule','listing','direct',
  'insufficient when benchmark_confidence < 0.5',
  'Confidence-gated classification of the listing as discount, neutral, premium, or insufficient evidence.',
  ARRAY['Signal is descriptive relative value, not an appraisal or buy recommendation'],ARRAY['relative value','discount signal','deal signal'])
ON CONFLICT(metric_key) DO UPDATE SET
 label=EXCLUDED.label,preferred_table=EXCLUDED.preferred_table,expression_hint=EXCLUDED.expression_hint,
 time_field=EXCLUDED.time_field,unit=EXCLUDED.unit,default_window=EXCLUDED.default_window,
 aggregation=EXCLUDED.aggregation,source_grain=EXCLUDED.source_grain,inheritance=EXCLUDED.inheritance,
 confidence_rule=EXCLUDED.confidence_rule,description=EXCLUDED.description,caveats=EXCLUDED.caveats,
 synonyms=EXCLUDED.synonyms;
