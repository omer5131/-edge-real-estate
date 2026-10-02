import type { VercelRequest, VercelResponse } from '@vercel/node';
import { sql } from '../server/db.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
  const rows = await sql`
    WITH tx AS (
      SELECT
        b.neighborhood_id,
        count(t.id)::int AS transaction_count_12m,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY t.pp_sqm)
          FILTER (WHERE t.pp_sqm IS NOT NULL) AS median_pp_sqm,
        max(t.deal_date) AS latest_transaction_date
      FROM transactions t
      LEFT JOIN properties p ON p.id=t.property_id
      LEFT JOIN buildings b ON b.id=p.building_id
      WHERE t.deal_date >= current_date - interval '12 months'
      GROUP BY b.neighborhood_id
    ),
    renewal AS (
      SELECT
        neighborhood_id,
        count(*)::int AS renewal_projects,
        coalesce(sum(existing_units),0)::int AS existing_units,
        coalesce(sum(planned_units),0)::int AS planned_units
      FROM renewal_projects
      GROUP BY neighborhood_id
    ),
    demo AS (
      SELECT DISTINCT ON (neighborhood_id)
        neighborhood_id, period_year, population, avg_household_income_nis,
        academic_pct, socio_economic_cluster, population_growth_pct
      FROM demographic_snapshots
      WHERE neighborhood_id IS NOT NULL
      ORDER BY neighborhood_id, period_year DESC
    )
    SELECT
      n.id,n.slug,n.name_he,n.name_en,c.name_he AS city,
      coalesce(tx.transaction_count_12m,0) AS transaction_count_12m,
      tx.median_pp_sqm,
      tx.latest_transaction_date,
      coalesce(r.renewal_projects,0) AS renewal_projects,
      coalesce(r.existing_units,0) AS existing_units,
      coalesce(r.planned_units,0) AS planned_units,
      d.period_year AS demographic_year,
      d.population,d.avg_household_income_nis,d.academic_pct,
      d.socio_economic_cluster,d.population_growth_pct,
      ST_AsGeoJSON(n.geom)::jsonb AS geometry
    FROM neighborhoods n
    JOIN cities c ON c.id=n.city_id
    LEFT JOIN tx ON tx.neighborhood_id=n.id
    LEFT JOIN renewal r ON r.neighborhood_id=n.id
    LEFT JOIN demo d ON d.neighborhood_id=n.id
    WHERE n.is_focus=true
    ORDER BY c.name_he,n.name_he
  `;
  res.setHeader('Cache-Control','s-maxage=300, stale-while-revalidate=3600');
  res.status(200).json({ data: rows, source: 'edge-postgres' });
}
