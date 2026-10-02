import type { VercelRequest,VercelResponse } from '@vercel/node';
import { sql } from '../server/db.js';

export default async function handler(req:VercelRequest,res:VercelResponse){
 if(req.method!=='GET')return res.status(405).json({error:'method_not_allowed'});
 const [counts,freshness,quality,targets,checkpoints]=await Promise.all([
  sql`SELECT
    (SELECT count(*)::int FROM transactions) transactions,
    (SELECT count(*)::int FROM comparable_transactions) comparable_transactions,
    (SELECT count(*)::int FROM transactions WHERE NOT is_comparable) excluded_transactions,
    (SELECT count(*)::int FROM renewal_projects) renewal_projects,
    (SELECT count(*)::int FROM parcels) parcels,
    (SELECT count(*)::int FROM target_parcels WHERE is_active) target_parcels,
    (SELECT count(*)::int FROM listings) listings,
    (SELECT count(*)::int FROM rental_listings) rental_listings,
    (SELECT count(*)::int FROM planning_plans) planning_plans,
    (SELECT count(*)::int FROM infrastructure_projects) infrastructure_projects,
    (SELECT count(*)::int FROM raw_records) raw_records`,
  sql`
    SELECT ds.id source_id,ds.name,ds.kind,
      (SELECT max(finished_at) FROM ingestion_runs r WHERE r.source_id=ds.id AND r.status='success') last_success_at,
      (SELECT max(finished_at) FROM ingestion_runs r WHERE r.source_id=ds.id AND r.status='failed') last_error_at,
      (SELECT error_summary FROM ingestion_runs r WHERE r.source_id=ds.id AND r.status='failed' ORDER BY started_at DESC LIMIT 1) last_error,
      CASE
        WHEN EXISTS(SELECT 1 FROM ingestion_runs r WHERE r.source_id=ds.id AND r.status='running') THEN 'running'
        WHEN (SELECT max(finished_at) FROM ingestion_runs r WHERE r.source_id=ds.id AND r.status='success') >= now()-interval '2 days' THEN 'healthy'
        WHEN (SELECT max(finished_at) FROM ingestion_runs r WHERE r.source_id=ds.id AND r.status='failed') IS NOT NULL THEN 'degraded'
        ELSE 'unavailable'
      END health
    FROM data_sources ds ORDER BY ds.id`,
  sql`
    SELECT n.slug,n.name_he,
      coalesce(mc.sample_12m,0)::int sample_12m,
      coalesce(mc.confidence,'insufficient') confidence,
      mc.latest_deal_date,
      count(tp.id)::int target_parcels
    FROM neighborhoods n
    LEFT JOIN neighborhood_market_confidence mc ON mc.neighborhood_id=n.id
    LEFT JOIN target_parcels tp ON tp.neighborhood_id=n.id AND tp.is_active
    WHERE n.is_focus
    GROUP BY n.id,n.slug,n.name_he,mc.sample_12m,mc.confidence,mc.latest_deal_date
    ORDER BY n.slug`,
  sql`
    SELECT n.slug,n.name_he,count(tp.id)::int parcel_count,
      max(tp.last_deals_sync_at) last_deals_sync_at
    FROM neighborhoods n
    LEFT JOIN target_parcels tp ON tp.neighborhood_id=n.id AND tp.is_active
    WHERE n.is_focus
    GROUP BY n.id,n.slug,n.name_he ORDER BY n.slug`,
  sql`SELECT source_id,job_key,cursor,status,last_started_at,last_success_at,last_error_at,last_error
      FROM etl_checkpoints ORDER BY source_id,job_key LIMIT 200`
 ]);
 res.setHeader('Cache-Control','no-store');
 res.status(200).json({ok:true,counts:counts[0],freshness,quality,targets,checkpoints});
}
