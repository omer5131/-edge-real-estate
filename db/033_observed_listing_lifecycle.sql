-- Reconcile derived lifecycle only. Preserve source listings, snapshots,
-- valuation/benchmark prices, confidence and all user workflow records.
CREATE OR REPLACE VIEW listing_seller_signals AS
WITH ordered AS (
 SELECT ls.*,lag(asking_price_nis) OVER(PARTITION BY listing_id ORDER BY observed_at) previous_price
 FROM listing_snapshots ls
), agg AS (
 SELECT listing_id,count(*)::int snapshot_count,min(observed_at) first_snapshot_at,max(observed_at) last_snapshot_at,
 extract(epoch from(max(observed_at)-min(observed_at)))/86400.0 observed_span_days,
 count(*) FILTER(WHERE previous_price IS NOT NULL AND asking_price_nis<previous_price)::int price_reductions
 FROM ordered GROUP BY listing_id
), first_price AS (
 SELECT DISTINCT ON(listing_id) listing_id,asking_price_nis original_asking_price FROM listing_snapshots ORDER BY listing_id,observed_at
), last_price AS (
 SELECT DISTINCT ON(listing_id) listing_id,asking_price_nis current_asking_price FROM listing_snapshots ORDER BY listing_id,observed_at DESC
)
SELECT l.id listing_id,l.source_id,l.source_listing_id,l.first_seen_at,l.last_seen_at,
 CASE WHEN a.snapshot_count>=2 AND a.observed_span_days>=1 THEN floor(a.observed_span_days)::int END days_on_market,
 CASE WHEN a.snapshot_count>=2 AND a.observed_span_days>=1 THEN a.price_reductions END price_reductions,
 CASE WHEN a.snapshot_count>=2 AND a.observed_span_days>=1 THEN f.original_asking_price END original_asking_price,
 lp.current_asking_price,
 CASE WHEN a.snapshot_count>=2 AND a.observed_span_days>=1 AND f.original_asking_price>0 AND lp.current_asking_price IS NOT NULL
 THEN round(100*(f.original_asking_price-lp.current_asking_price)/f.original_asking_price,2) END total_reduction_pct,
 coalesce(a.snapshot_count,0)::int snapshot_count,a.observed_span_days,
 CASE WHEN a.snapshot_count>=2 AND a.observed_span_days>=1 THEN 'supported' ELSE 'provisional' END lifecycle_evidence
FROM listings l LEFT JOIN agg a ON a.listing_id=l.id LEFT JOIN first_price f ON f.listing_id=l.id LEFT JOIN last_price lp ON lp.listing_id=l.id;

WITH life AS (
 SELECT listing_id,count(*)::int snapshot_count,max(observed_at) last_snapshot_at,
 extract(epoch from(max(observed_at)-min(observed_at)))/86400.0 observed_span_days,
 (array_agg(asking_price_nis ORDER BY observed_at) FILTER(WHERE asking_price_nis>0))[1] first_price,
 (array_agg(asking_price_nis ORDER BY observed_at DESC))[1] latest_price
 FROM listing_snapshots GROUP BY listing_id
), current_lifecycle AS (
 SELECT b.listing_id,coalesce(l.snapshot_count,0) snapshot_count,l.observed_span_days,l.first_price,l.latest_price,l.last_snapshot_at
 FROM listing_market_benchmarks b LEFT JOIN life l ON l.listing_id=b.listing_id
)
UPDATE listing_market_benchmarks b SET
 days_on_market=CASE WHEN l.snapshot_count>=2 AND l.observed_span_days>=1 THEN floor(l.observed_span_days)::int END,
 first_asking_price_nis=CASE WHEN l.snapshot_count>=2 AND l.observed_span_days>=1 THEN l.first_price END,
 price_change_since_first_pct=CASE WHEN l.snapshot_count>=2 AND l.observed_span_days>=1 AND l.first_price>0 THEN 100*(l.latest_price/l.first_price-1) END,
 snapshot_count=l.snapshot_count,
 evidence=coalesce(b.evidence,'{}'::jsonb)||jsonb_build_object('lifecycle_rule','at least two snapshots separated by one day, collection age is not DOM','lifecycle_status',CASE WHEN l.snapshot_count>=2 AND l.observed_span_days>=1 THEN 'supported' ELSE 'provisional' END,'lifecycle_observed_at',l.last_snapshot_at)
FROM current_lifecycle l WHERE b.listing_id=l.listing_id;

UPDATE semantic_metrics SET
 confidence_rule='requires at least two listing snapshots separated by one day, NULL otherwise',
 description=CASE WHEN metric_key='listing_days_on_market' THEN 'Elapsed days between first and last observed snapshots, not collection age or original publication time.' ELSE 'Latest observed asking price relative to first observed asking price, only with supported lifecycle history.' END,
 caveats=ARRAY['NULL means insufficient observed history, it is not zero','Collection dates do not establish original publication time or seller intent']
WHERE metric_key IN ('listing_days_on_market','listing_price_change');
