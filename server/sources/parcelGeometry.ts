import { queryDatabase as query, databaseTransaction as transaction } from '../db.js';

export const PARCEL_SHAPE_DATASET_ID='ff3176b1-aafc-49c2-976d-ba25571e3564';
export const PARCEL_GEOMETRY_LOCALITIES=['חיפה'];

/**
 * Materialize scoped OVER parcel geometry into the canonical parcels table and
 * assign parcels to canonical neighborhoods when a validated neighborhood
 * polygon exists. Point-on-surface avoids boundary slivers and centroid-outside-
 * polygon edge cases for concave parcels.
 *
 * Idempotent by (gush,helka,suffix); existing rows are updated, never duplicated.
 */
export async function syncScopedParcelGeometry(){
  const source='over_ff3176b1aafc49c2976dba25571e3564';
  const [materialized, mapped, inherited] = await transaction([
    {
      text: `
        WITH src AS (
          SELECT
            NULLIF(regexp_replace(_edge_payload->>'GUSH_NUM','[^0-9]','','g'),'')::int gush,
            NULLIF(regexp_replace(_edge_payload->>'PARCEL','[^0-9]','','g'),'')::int helka,
            CASE WHEN COALESCE(_edge_payload->>'GUSH_SUFFI','0') IN ('','0') THEN '' ELSE _edge_payload->>'GUSH_SUFFI' END suffix,
            _edge_payload->>'LOCALITY_N' locality,
            _edge_payload->>'geometry_wkt' wkt
          FROM ${source}
          WHERE _edge_payload->>'LOCALITY_N'=ANY($1::text[])
            AND COALESCE(_edge_payload->>'geometry_wkt','')<>''
        ), parsed AS (
          SELECT s.*, ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_SetSRID(ST_GeomFromText(wkt),4326)),3)) geom
          FROM src s
          WHERE gush IS NOT NULL AND helka IS NOT NULL
        ), upserted AS (
          INSERT INTO parcels(city_id,gush,helka,suffix,geom,centroid,source_id,observed_at)
          SELECT c.id,p.gush,p.helka,p.suffix,p.geom,ST_PointOnSurface(p.geom),'over_nadlan',now()
          FROM parsed p
          JOIN cities c ON c.name_he=p.locality
          WHERE NOT ST_IsEmpty(p.geom)
          ON CONFLICT(gush,helka,suffix) DO UPDATE SET
            city_id=COALESCE(parcels.city_id,EXCLUDED.city_id),
            geom=EXCLUDED.geom,
            centroid=EXCLUDED.centroid,
            source_id=COALESCE(parcels.source_id,EXCLUDED.source_id),
            observed_at=now()
          RETURNING id
        )
        SELECT count(*)::int affected FROM upserted
      `,
      params:[PARCEL_GEOMETRY_LOCALITIES]
    },
    {
      text: `
        WITH candidates AS (
          SELECT p.id parcel_id,n.id neighborhood_id,
                 row_number() OVER(
                   PARTITION BY p.id
                   ORDER BY COALESCE(n.geometry_confidence,n.geom_confidence,0) DESC,
                            ST_Area(n.geom::geography) ASC,
                            n.id
                 ) rn
          FROM parcels p
          JOIN cities c ON c.id=p.city_id
          JOIN neighborhoods n ON n.city_id=p.city_id
          WHERE c.name_he=ANY($1::text[])
            AND p.geom IS NOT NULL
            AND n.geom IS NOT NULL
            AND n.canonical_status='active'
            AND ST_Covers(n.geom,ST_PointOnSurface(p.geom))
        ), updated AS (
          UPDATE parcels p
          SET neighborhood_id=c.neighborhood_id,observed_at=now()
          FROM candidates c
          WHERE c.rn=1 AND p.id=c.parcel_id
            AND p.neighborhood_id IS DISTINCT FROM c.neighborhood_id
          RETURNING p.id
        )
        SELECT count(*)::int mapped FROM updated
      `,
      params:[PARCEL_GEOMETRY_LOCALITIES]
    },
    {
      text: `
        WITH updated AS (
          UPDATE transactions t
          SET neighborhood_id=p.neighborhood_id,observed_at=now()
          FROM parcels p
          WHERE t.parcel_id=p.id
            AND p.neighborhood_id IS NOT NULL
            AND t.neighborhood_id IS DISTINCT FROM p.neighborhood_id
          RETURNING t.id
        )
        SELECT count(*)::int inherited FROM updated
      `
    }
  ]);
  const coverage=await query(`
    SELECT c.name_he locality,
      count(*)::int parcels,
      count(*) FILTER(WHERE p.geom IS NOT NULL)::int with_geometry,
      count(*) FILTER(WHERE p.neighborhood_id IS NOT NULL)::int with_neighborhood
    FROM parcels p JOIN cities c ON c.id=p.city_id
    WHERE c.name_he=ANY($1::text[])
    GROUP BY c.name_he ORDER BY c.name_he
  `,[PARCEL_GEOMETRY_LOCALITIES]);
  return {
    affected:Number(materialized?.[0]?.affected||0),
    mapped:Number(mapped?.[0]?.mapped||0),
    transactionsInherited:Number(inherited?.[0]?.inherited||0),
    coverage
  };
}
