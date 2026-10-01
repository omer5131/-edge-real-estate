import type { VercelRequest, VercelResponse } from '@vercel/node';
import { sql } from '../server/db';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error:'method_not_allowed' });
  const city = typeof req.query.city === 'string' ? req.query.city : null;
  const rows = await sql`
    SELECT
      rp.id,rp.source_project_id,rp.project_name,rp.developer,rp.plan_number,rp.route,
      rp.status,rp.stage,rp.existing_units,rp.planned_units,rp.additional_units,
      rp.permits_count,rp.declared_at,rp.effective_year,rp.in_execution,
      rp.planning_certainty,rp.source_url,rp.map_url,rp.observed_at,
      c.name_he AS city,n.name_he AS neighborhood,
      ST_AsGeoJSON(rp.geom)::jsonb AS geometry
    FROM renewal_projects rp
    LEFT JOIN cities c ON c.id=rp.city_id
    LEFT JOIN neighborhoods n ON n.id=rp.neighborhood_id
    WHERE (${city}::text IS NULL OR c.name_he=${city})
    ORDER BY rp.in_execution DESC,rp.observed_at DESC
    LIMIT 1000
  `;
  res.setHeader('Cache-Control','s-maxage=900, stale-while-revalidate=86400');
  res.status(200).json({ data:rows, source:'urban_renewal_gov' });
}
