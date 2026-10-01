import type { VercelRequest, VercelResponse } from '@vercel/node';
import { sql } from '../server/db';

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  try {
    const sources = await sql`
      SELECT ds.id,ds.name,ds.is_enabled,
        max(ir.finished_at) FILTER (WHERE ir.status='success') AS last_success,
        count(*) FILTER (WHERE ir.status='failed' AND ir.started_at > now()-interval '7 days')::int AS failures_7d
      FROM data_sources ds
      LEFT JOIN ingestion_runs ir ON ir.source_id=ds.id
      GROUP BY ds.id,ds.name,ds.is_enabled
      ORDER BY ds.id
    `;
    const counts = await sql`
      SELECT
        (SELECT count(*) FROM transactions)::int AS transactions,
        (SELECT count(*) FROM parcels)::int AS parcels,
        (SELECT count(*) FROM renewal_projects)::int AS renewal_projects,
        (SELECT count(*) FROM raw_records)::int AS raw_records
    `;
    res.status(200).json({ ok:true, counts:counts[0], sources });
  } catch (error) {
    res.status(500).json({ ok:false, error:String(error) });
  }
}
