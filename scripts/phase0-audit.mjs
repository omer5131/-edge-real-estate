import { neon } from '@neondatabase/serverless';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const sql = neon(process.env.DATABASE_URL);

const checks = [
  ['transactions', 'select count(*)::int n from transactions'],
  ['comparable_transactions', 'select count(*)::int n from comparable_transactions'],
  ['listings', 'select count(*)::int n from listings'],
  ['listing_snapshots', 'select count(*)::int n from listing_snapshots'],
  ['rental_listings', 'select count(*)::int n from rental_listings'],
  ['neighborhoods', 'select count(*)::int n from neighborhoods'],
  ['neighborhood_stat_area_map', 'select count(*)::int n from neighborhood_stat_area_map'],
  ['cbs_neighborhood_stat_area_key', 'select count(*)::int n from cbs_neighborhood_stat_area_key'],
  ['neighborhood_cbs_profiles', 'select count(*)::int n from neighborhood_cbs_profiles'],
  ['properties', 'select count(*)::int n from properties'],
  ['buildings', 'select count(*)::int n from buildings'],
  ['deals', 'select count(*)::int n from deals']
];

const counts = {};
for (const [name, statement] of checks) {
  const rows = await sql.query(statement);
  counts[name] = Number(rows[0]?.n ?? 0);
}

const profileQuality = await sql`
  select profile_quality, safe_for_score, count(*)::int n
  from neighborhood_cbs_profiles
  group by profile_quality, safe_for_score
  order by profile_quality, safe_for_score
`;

const statAreas = await sql`
  select source_id, count(*)::int n,
         min(year)::int min_year, max(year)::int max_year,
         count(*) filter (where population is not null)::int population_rows,
         count(*) filter (where socio_economic_cluster is not null)::int socio_rows
  from statistical_areas
  group by source_id
  order by n desc
`;

const mapping = await sql`
  select n.slug, count(*)::int mappings,
         min(m.mapping_confidence)::numeric min_confidence,
         max(m.mapping_confidence)::numeric max_confidence,
         count(*) filter (where m.overlap_ratio is not null)::int overlap_rows
  from neighborhood_stat_area_map m
  join neighborhoods n on n.id=m.neighborhood_id
  group by n.slug
  order by n.slug
`;

console.log(JSON.stringify({
  generatedAt: new Date().toISOString(),
  counts,
  profileQuality,
  statAreas,
  mapping,
  warnings: [
    counts.cbs_neighborhood_stat_area_key === 0 ? 'Official CBS neighborhood/statistical-area key is empty.' : null,
    counts.properties === 0 ? 'Canonical properties are empty; current workflow is listing-first.' : null,
    counts.buildings === 0 ? 'Canonical buildings are empty.' : null,
    counts.rental_listings < 10 ? 'Rental coverage is insufficient for robust neighborhood rent analytics.' : null
  ].filter(Boolean)
}, null, 2));
