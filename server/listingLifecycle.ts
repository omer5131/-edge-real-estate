// Collection age is not time on market. Only observed history establishes DOM.
export function listingLifecycle(count:unknown, spanDays:unknown){
 const span=spanDays==null?null:Number(spanDays);
 const supported=Number(count)>=2&&span!=null&&Number.isFinite(span)&&span>=1;
 return {supported,daysOnMarket:supported?Math.floor(span!):null,status:supported?'supported':'provisional',snapshotCount:Number(count)||0};
}
export const lifecycleCte=`lifecycle AS (
 SELECT listing_id,count(*)::int snapshot_count,
 extract(epoch from (max(observed_at)-min(observed_at)))/86400.0 observed_span_days
 FROM listing_snapshots GROUP BY listing_id
)`;
