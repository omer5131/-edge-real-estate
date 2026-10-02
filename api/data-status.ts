import type { VercelRequest, VercelResponse } from '@vercel/node';
import { sql } from '../server/db.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error:'method_not_allowed' });
  const [counts,freshness] = await Promise.all([
    sql`
      SELECT
        (SELECT count(*)::int FROM transactions) transactions,
        (SELECT count(*)::int FROM renewal_projects) renewal_projects,
        (SELECT count(*)::int FROM parcels) parcels,
        (SELECT count(*)::int FROM buildings) buildings,
        (SELECT count(*)::int FROM listings) listings,
        (SELECT count(*)::int FROM raw_records) raw_records
    `,
    sql`SELECT * FROM data_freshness ORDER BY source_id`
  ]);
  res.status(200).json({ ok:true, counts:counts[0], freshness });
}
