import type { VercelRequest, VercelResponse } from '@vercel/node';
import { sql } from '../server/db';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error:'method_not_allowed' });
  const neighborhood = typeof req.query.neighborhood === 'string' ? req.query.neighborhood : null;
  const city = typeof req.query.city === 'string' ? req.query.city : null;
  const limit = Math.min(Math.max(Number(req.query.limit ?? 100),1),500);

  const rows = await sql`
    SELECT
      t.id,t.deal_date,t.amount_nis,t.area_sqm,t.rooms,t.floor,t.nature,t.pp_sqm,
      c.name_he AS city,n.name_he AS neighborhood,
      b.canonical_address,b.lat,b.lon,p.gush,p.helka,
      t.source_id,t.source_external_id,t.observed_at
    FROM transactions t
    LEFT JOIN cities c ON c.id=t.city_id
    LEFT JOIN parcels p ON p.id=t.parcel_id
    LEFT JOIN properties pr ON pr.id=t.property_id
    LEFT JOIN buildings b ON b.id=pr.building_id
    LEFT JOIN neighborhoods n ON n.id=b.neighborhood_id
    WHERE (${city}::text IS NULL OR c.name_he=${city})
      AND (${neighborhood}::text IS NULL OR n.slug=${neighborhood} OR n.name_he=${neighborhood})
    ORDER BY t.deal_date DESC NULLS LAST,t.observed_at DESC
    LIMIT ${limit}
  `;
  res.setHeader('Cache-Control','s-maxage=300, stale-while-revalidate=3600');
  res.status(200).json({ data:rows, source:'over_deals' });
}
