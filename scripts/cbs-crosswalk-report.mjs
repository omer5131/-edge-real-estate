import { neon } from '@neondatabase/serverless';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const sql = neon(process.env.DATABASE_URL);

const rows = await sql`
with targets as (
  select n.id,n.slug,n.name_he,c.settlement_code,c.name_he city_name
  from neighborhoods n
  join cities c on c.id=n.city_id
  where n.is_focus
     or exists (select 1 from followed_areas f where f.neighborhood_id=n.id and f.is_active)
),
names as (
  select t.id,t.slug,t.name_he,t.settlement_code,t.city_name,
         lower(regexp_replace(t.name_he,'[^[:alnum:]א-ת]+','','g')) normalized_name
  from targets t
  union
  select t.id,t.slug,t.name_he,t.settlement_code,t.city_name,
         lower(regexp_replace(a.alias,'[^[:alnum:]א-ת]+','','g')) normalized_name
  from targets t
  join neighborhood_aliases a on a.neighborhood_id=t.id
),
official as (
  select distinct nm.id neighborhood_id,k.statistical_area_code
  from names nm
  join cbs_neighborhood_stat_area_key k on k.locality_code=nm.settlement_code
  where exists (
    select 1
    from unnest(k.neighborhood_names) x(name)
    where lower(regexp_replace(x.name,'[^[:alnum:]א-ת]+','','g'))=nm.normalized_name
  )
),
curated as (
  select m.neighborhood_id,s.stat_area_code,m.mapping_method,m.mapping_confidence,
         m.overlap_ratio,m.source_evidence
  from neighborhood_stat_area_map m
  join statistical_areas s on s.id=m.stat_area_id
)
select t.slug,t.name_he,t.city_name,t.settlement_code,
       coalesce((select jsonb_agg(o.statistical_area_code order by o.statistical_area_code)
                 from official o where o.neighborhood_id=t.id),'[]'::jsonb) official_codes,
       coalesce((select jsonb_agg(jsonb_build_object(
          'code',c.stat_area_code,
          'method',c.mapping_method,
          'confidence',c.mapping_confidence,
          'overlap_ratio',c.overlap_ratio,
          'source_evidence',c.source_evidence
        ) order by c.stat_area_code)
        from curated c where c.neighborhood_id=t.id),'[]'::jsonb) current_mappings,
       (select count(*)::int from official o where o.neighborhood_id=t.id) official_count,
       (select count(*)::int from curated c where c.neighborhood_id=t.id) current_count,
       (select count(*)::int
        from curated c
        where c.neighborhood_id=t.id
          and exists(select 1 from official o where o.neighborhood_id=t.id and o.statistical_area_code=c.stat_area_code)) matched_count,
       case
         when not exists(select 1 from cbs_neighborhood_stat_area_key) then 'official_key_missing'
         when not exists(select 1 from official o where o.neighborhood_id=t.id) then 'no_official_name_match'
         when not exists(
           (select o.statistical_area_code from official o where o.neighborhood_id=t.id
            except select c.stat_area_code from curated c where c.neighborhood_id=t.id)
         ) and not exists(
           (select c.stat_area_code from curated c where c.neighborhood_id=t.id
            except select o.statistical_area_code from official o where o.neighborhood_id=t.id)
         ) then 'exact_match'
         else 'conflict'
       end validation_status
from targets t
order by t.city_name,t.name_he
`;

const keyStatus = await sql`
  select count(*)::int rows, max(imported_at) latest_import,
         count(distinct locality_code)::int localities
  from cbs_neighborhood_stat_area_key
`;

console.log(JSON.stringify({
  generatedAt: new Date().toISOString(),
  officialKey: keyStatus[0],
  neighborhoods: rows
}, null, 2));
