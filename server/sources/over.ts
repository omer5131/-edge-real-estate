import { sql } from '../db.js';
import { sha256, pick, n, int, text, isoDate } from '../normalize.js';

const OVER = 'https://www.over.org.il';
const PAGE_SIZE = 200;

function recordsFrom(payload: any): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload;
  for (const key of ['results','records','items','rows','data']) {
    if (Array.isArray(payload?.[key])) return payload[key];
    if (Array.isArray(payload?.result?.[key])) return payload.result[key];
  }
  return [];
}

async function json(url: string) {
  const response = await fetch(url, { headers: { 'user-agent': 'EdgeRealEstate/1.0' } });
  if (!response.ok) throw new Error(`OVER ${response.status}: ${url}`);
  return response.json();
}

async function raw(
  sourceId: string,
  externalId: string,
  entityHint: string,
  payload: Record<string, unknown>,
  runId: string
) {
  const hash = sha256(payload);
  const rows = await sql`
    INSERT INTO raw_records (source_id,external_id,entity_hint,payload_hash,payload,ingestion_run_id)
    VALUES (${sourceId},${externalId},${entityHint},${hash},${JSON.stringify(payload)}::jsonb,${runId}::uuid)
    ON CONFLICT (source_id,external_id,payload_hash) DO UPDATE SET observed_at=now()
    RETURNING id
  `;
  return Number(rows[0].id);
}

async function cityId(name: string) {
  const rows = await sql`
    INSERT INTO cities(name_he) VALUES (${name})
    ON CONFLICT(name_he) DO UPDATE SET name_he=EXCLUDED.name_he
    RETURNING id
  `;
  return String(rows[0].id);
}

function txExternalId(r: Record<string, unknown>) {
  return text(pick(r,['id','deal_id','transaction_id','ID','מזהה','עסקה'])) ?? sha256(r);
}

export async function ingestDealsForSettlement(
  settlement: string,
  runId: string,
  options: { dateFrom?: string; maxPages?: number } = {}
) {
  const cid = await cityId(settlement);
  let fetched = 0, inserted = 0, updated = 0;
  const maxPages = options.maxPages ?? Number(process.env.EDGE_MAX_DEAL_PAGES ?? 20);
  const dateFrom = options.dateFrom ?? process.env.EDGE_DEALS_DATE_FROM ?? '2023-01-01';

  for (let page=0; page<maxPages; page++) {
    const u = new URL('/api/deals/search', OVER);
    u.searchParams.set('settlement', settlement);
    u.searchParams.set('date_from', dateFrom);
    u.searchParams.set('limit', String(PAGE_SIZE));
    u.searchParams.set('offset', String(page * PAGE_SIZE));
    u.searchParams.set('sort', 'date_desc');
    const payload = await json(u.toString());
    const rows = recordsFrom(payload);
    if (!rows.length) break;
    fetched += rows.length;

    for (const r of rows) {
      const externalId = txExternalId(r);
      const rawId = await raw('over_deals',externalId,'transaction',r,runId);
      const gush = int(pick(r,['gush','GUSH','גוש']));
      const helka = int(pick(r,['helka','HELKA','חלקה']));
      const suffix = text(pick(r,['suffix','sub_gush','תת גוש'])) ?? '';
      let parcelId: string | null = null;
      if (gush !== null && helka !== null) {
        const parcels = await sql`
          INSERT INTO parcels(city_id,gush,helka,suffix,source_id,raw_record_id)
          VALUES (${cid}::uuid,${gush},${helka},${suffix},'over_deals',${rawId})
          ON CONFLICT(gush,helka,suffix) DO UPDATE SET
            city_id=COALESCE(parcels.city_id,EXCLUDED.city_id),
            observed_at=now()
          RETURNING id
        `;
        parcelId = String(parcels[0].id);
      }

      const date = isoDate(pick(r,['deal_date','date','sale_date','DEALDATETIME','תאריך עסקה','תאריך']));
      const amount = n(pick(r,['amount','deal_amount','price','DEALAMOUNT','שווי','מחיר']));
      const area = n(pick(r,['area','area_sqm','asset_area','AREA','שטח']));
      const rooms = n(pick(r,['rooms','room_count','ROOMS','חדרים']));
      const floor = n(pick(r,['floor','FLOOR','קומה']));
      const nature = text(pick(r,['nature','deal_nature','ASSETNATURE','מהות','סוג נכס']));

      const exists = await sql`SELECT 1 FROM transactions WHERE source_id='over_deals' AND source_external_id=${externalId}`;
      await sql`
        INSERT INTO transactions(
          source_id,source_external_id,raw_record_id,city_id,parcel_id,deal_date,
          amount_nis,area_sqm,rooms,floor,nature
        ) VALUES (
          'over_deals',${externalId},${rawId},${cid}::uuid,${parcelId}::uuid,${date}::date,
          ${amount},${area},${rooms},${floor},${nature}
        )
        ON CONFLICT(source_id,source_external_id) DO UPDATE SET
          raw_record_id=EXCLUDED.raw_record_id,
          city_id=EXCLUDED.city_id,
          parcel_id=COALESCE(EXCLUDED.parcel_id,transactions.parcel_id),
          deal_date=COALESCE(EXCLUDED.deal_date,transactions.deal_date),
          amount_nis=COALESCE(EXCLUDED.amount_nis,transactions.amount_nis),
          area_sqm=COALESCE(EXCLUDED.area_sqm,transactions.area_sqm),
          rooms=COALESCE(EXCLUDED.rooms,transactions.rooms),
          floor=COALESCE(EXCLUDED.floor,transactions.floor),
          nature=COALESCE(EXCLUDED.nature,transactions.nature),
          observed_at=now()
      `;
      exists.length ? updated++ : inserted++;
    }
    if (rows.length < PAGE_SIZE) break;
  }
  return { fetched, inserted, updated, errors: 0 };
}

export async function enrichRecentParcels(runId: string) {
  const limit = Number(process.env.EDGE_PARCEL_ENRICH_LIMIT ?? 100);
  const parcels = await sql`
    SELECT p.id,p.gush,p.helka
    FROM parcels p
    WHERE p.centroid IS NULL OR p.stat_area_id IS NULL
    ORDER BY p.observed_at DESC
    LIMIT ${limit}
  `;
  let fetched=0, updated=0, errors=0;

  for (const p of parcels) {
    try {
      const payload = await json(`${OVER}/api/nadlan/parcel/${p.gush}/${p.helka}?geometry=true`);
      const record = (payload?.result ?? payload) as Record<string,unknown>;
      const rawId = await raw('over_nadlan',`${p.gush}/${p.helka}`,'parcel',record,runId);
      fetched++;

      const point = (record.point ?? (record as any).centroid) as any;
      const lat = n(point?.lat ?? point?.latitude);
      const lon = n(point?.lon ?? point?.lng ?? point?.longitude);
      const stat = ((record.stat_area ?? (record as any).statistical_area) || {}) as Record<string,unknown>;
      const statCode = text(pick(stat,['code','stat_area_code','id','area_code']));
      let statId: string | null = null;
      if (statCode) {
        const s = await sql`
          INSERT INTO statistical_areas(
            city_id,stat_area_code,year,population,socio_economic_cluster,source_id,raw_record_id
          )
          SELECT city_id,${statCode},${int(pick(stat,['year','period_year']))},
            ${int(pick(stat,['population','pop']))},
            ${n(pick(stat,['socio_economic_cluster','cluster','socioeconomic_cluster']))},
            'over_nadlan',${rawId}
          FROM parcels WHERE id=${String(p.id)}::uuid
          ON CONFLICT(stat_area_code,year) DO UPDATE SET
            population=COALESCE(EXCLUDED.population,statistical_areas.population),
            socio_economic_cluster=COALESCE(EXCLUDED.socio_economic_cluster,statistical_areas.socio_economic_cluster),
            observed_at=now()
          RETURNING id
        `;
        statId = String(s[0].id);
      }

      if (lat !== null && lon !== null) {
        await sql`
          UPDATE parcels SET centroid=ST_SetSRID(ST_MakePoint(${lon},${lat}),4326),
            stat_area_id=${statId}::uuid, source_id='over_nadlan', raw_record_id=${rawId}, observed_at=now()
          WHERE id=${String(p.id)}::uuid
        `;
      } else if (statId) {
        await sql`UPDATE parcels SET stat_area_id=${statId}::uuid,raw_record_id=${rawId},observed_at=now() WHERE id=${String(p.id)}::uuid`;
      }
      updated++;
    } catch (e) {
      errors++;
      console.error('parcel enrichment failed', p.gush, p.helka, e);
    }
  }
  return { fetched, inserted: 0, updated, errors };
}

async function discoverUrbanRenewalDataset() {
  const payload = await json(`${OVER}/api/v1/datasets?ckan_id=urban_renewal&status=active&limit=20`);
  const rows = recordsFrom(payload);
  return rows[0] as any;
}

export async function ingestUrbanRenewal(runId: string) {
  const ds = await discoverUrbanRenewalDataset();
  if (!ds?.id) throw new Error('Could not discover OVER urban_renewal dataset');
  let payload: any;
  try {
    payload = await json(`${OVER}/api/append/${ds.id}/datastore_search?limit=500`);
  } catch {
    payload = await json(`${OVER}/api/append/${ds.id}/rows?limit=500&latest=true`);
  }
  const rows = recordsFrom(payload);
  let inserted=0, updated=0;

  for (const r of rows) {
    const projectId = text(pick(r,['MisparMitham','mispar_mitham','project_id','id'])) ?? sha256(r);
    const rawId = await raw('urban_renewal_gov',projectId,'renewal_project',r,runId);
    const city = text(pick(r,['Yeshuv','yeshuv','city','יישוב']));
    let cid: string | null = null;
    if (city) cid = await cityId(city);
    const exists = await sql`SELECT 1 FROM renewal_projects WHERE source_id='urban_renewal_gov' AND source_project_id=${projectId}`;

    await sql`
      INSERT INTO renewal_projects(
        source_id,source_project_id,city_id,project_name,plan_number,route,status,
        existing_units,planned_units,additional_units,permits_count,declared_at,effective_year,
        in_execution,source_url,map_url,raw_record_id
      ) VALUES (
        'urban_renewal_gov',${projectId},${cid}::uuid,
        ${text(pick(r,['ShemMitcham','project_name','name']))},
        ${text(pick(r,['MisparTochnit','plan_number']))},
        ${text(pick(r,['Maslul','route']))},
        ${text(pick(r,['Status','status']))},
        ${int(pick(r,['YachadKayam','existing_units']))},
        ${int(pick(r,['YachadMutza','planned_units']))},
        ${int(pick(r,['YachadTosafti','additional_units']))},
        ${int(pick(r,['SachHeterim','permits_count']))},
        ${isoDate(pick(r,['TaarichHachraza','declared_at']))}::date,
        ${int(pick(r,['ShnatMatanTokef','effective_year']))},
        CASE WHEN lower(coalesce(${text(pick(r,['Bebitzua','in_execution']))},'')) IN ('כן','true','1','yes') THEN true ELSE false END,
        ${text(pick(r,['KishurLatar','source_url']))},
        ${text(pick(r,['KishurLaMapa','map_url']))},
        ${rawId}
      )
      ON CONFLICT(source_id,source_project_id) DO UPDATE SET
        city_id=COALESCE(EXCLUDED.city_id,renewal_projects.city_id),
        project_name=COALESCE(EXCLUDED.project_name,renewal_projects.project_name),
        plan_number=COALESCE(EXCLUDED.plan_number,renewal_projects.plan_number),
        route=COALESCE(EXCLUDED.route,renewal_projects.route),
        status=COALESCE(EXCLUDED.status,renewal_projects.status),
        existing_units=COALESCE(EXCLUDED.existing_units,renewal_projects.existing_units),
        planned_units=COALESCE(EXCLUDED.planned_units,renewal_projects.planned_units),
        additional_units=COALESCE(EXCLUDED.additional_units,renewal_projects.additional_units),
        permits_count=COALESCE(EXCLUDED.permits_count,renewal_projects.permits_count),
        in_execution=EXCLUDED.in_execution,
        source_url=COALESCE(EXCLUDED.source_url,renewal_projects.source_url),
        map_url=COALESCE(EXCLUDED.map_url,renewal_projects.map_url),
        raw_record_id=EXCLUDED.raw_record_id,
        observed_at=now()
    `;
    exists.length ? updated++ : inserted++;
  }
  return { fetched: rows.length, inserted, updated, errors: 0 };
}
