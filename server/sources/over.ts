import { sql } from '../db.js';
import { sha256, pick, n, int, text, isoDate } from '../normalize.js';

const OVER='https://www.over.org.il';
const PAGE_SIZE=200;

function recordsFrom(payload:any):Record<string,unknown>[] {
  if(Array.isArray(payload)) return payload;
  for(const key of ['results','records','items','rows','data','deals']){
    if(Array.isArray(payload?.[key])) return payload[key];
    if(Array.isArray(payload?.result?.[key])) return payload.result[key];
  }
  return [];
}

async function json(url:string,retries=3){
  let last:any;
  const origins=['https://www.over.org.il','https://over.org.il'];
  const original=new URL(url);
  for(const origin of origins){
    const candidate=new URL(original.pathname+original.search,origin).toString();
    for(let attempt=0;attempt<=retries;attempt++){
      const controller=new AbortController();
      const timeout=setTimeout(()=>controller.abort(),25000);
      try{
        const response=await fetch(candidate,{headers:{'user-agent':'EdgeRealEstate/1.0','accept':'application/json'},signal:controller.signal});
        if(!response.ok) throw new Error(`OVER ${response.status}: ${candidate}`);
        return await response.json();
      }catch(e){
        last=e;
        if(attempt<retries) await new Promise(r=>setTimeout(r,750*(attempt+1)));
      }finally{clearTimeout(timeout);}
    }
  }
  throw last;
}

async function raw(sourceId:string,externalId:string,entityHint:string,payload:Record<string,unknown>,runId:string){
  const hash=sha256(payload);
  const rows=await sql`
    INSERT INTO raw_records(source_id,external_id,entity_hint,payload_hash,payload,ingestion_run_id)
    VALUES(${sourceId},${externalId},${entityHint},${hash},${JSON.stringify(payload)}::jsonb,${runId}::uuid)
    ON CONFLICT(source_id,external_id,payload_hash) DO UPDATE SET observed_at=now()
    RETURNING id
  `;
  return Number(rows[0].id);
}

function txExternalId(r:Record<string,unknown>){
  return text(pick(r,['id','deal_id','transaction_id','ID','מזהה','עסקה'])) ?? sha256(r);
}

async function upsertTransaction(r:Record<string,unknown>,runId:string,cityId:string,parcelId:string|null,neighborhoodId:string|null){
  const date=isoDate(pick(r,['deal_date','date','sale_date','DEALDATETIME','תאריך עסקה','תאריך']));
  if(!date || date<'2022-01-01') return 'skipped';
  const externalId=txExternalId(r);
  const rawId=await raw('over_deals',externalId,'transaction',r,runId);
  const amount=n(pick(r,['amount','deal_amount','price','DEALAMOUNT','שווי','מחיר']));
  const declared=n(pick(r,['declared_amount'])) ?? amount;
  const area=n(pick(r,['area','area_sqm','asset_area','AREA','שטח']));
  const rooms=n(pick(r,['rooms','room_count','ROOMS','חדרים']));
  const floor=n(pick(r,['floor','FLOOR','קומה']));
  const nature=text(pick(r,['nature','deal_nature','ASSETNATURE','מהות','סוג נכס']));
  const ownership=n(pick(r,['portion_fraction','portion']));
  const normalizedPpsqm=n(pick(r,['price_per_sqm_normalized','price_per_sqm']));
  const partial=ownership!==null && ownership<0.9;
  const implausible=area===null||area<15||area>400||normalizedPpsqm===null||normalizedPpsqm<5000||normalizedPpsqm>100000;
  const comparable=!partial&&!implausible;
  const exclusion=partial?'partial_ownership':implausible?'invalid_or_implausible_comp':null;
  const addresses=Array.isArray((r as any).addresses)?(r as any).addresses:[];
  const address=text(pick(r,['address','full_address','ADDRESS','כתובת'])) || (addresses[0]?String(addresses[0]):null);

  const existed=await sql`SELECT 1 FROM transactions WHERE source_id='over_deals' AND source_external_id=${externalId}`;
  await sql`
    INSERT INTO transactions(
      source_id,source_external_id,raw_record_id,city_id,parcel_id,neighborhood_id,address_text,
      deal_date,amount_nis,declared_amount_nis,area_sqm,rooms,floor,nature,
      ownership_fraction,normalized_pp_sqm,is_comparable,exclusion_reason
    ) VALUES(
      'over_deals',${externalId},${rawId},${cityId}::uuid,${parcelId}::uuid,${neighborhoodId}::uuid,${address},
      ${date}::date,${amount},${declared},${area},${rooms},${floor},${nature},
      ${ownership},${normalizedPpsqm},${comparable},${exclusion}
    )
    ON CONFLICT(source_id,source_external_id) DO UPDATE SET
      raw_record_id=EXCLUDED.raw_record_id,
      city_id=COALESCE(EXCLUDED.city_id,transactions.city_id),
      parcel_id=COALESCE(EXCLUDED.parcel_id,transactions.parcel_id),
      neighborhood_id=COALESCE(EXCLUDED.neighborhood_id,transactions.neighborhood_id),
      address_text=COALESCE(EXCLUDED.address_text,transactions.address_text),
      deal_date=COALESCE(EXCLUDED.deal_date,transactions.deal_date),
      amount_nis=COALESCE(EXCLUDED.amount_nis,transactions.amount_nis),
      declared_amount_nis=COALESCE(EXCLUDED.declared_amount_nis,transactions.declared_amount_nis),
      area_sqm=COALESCE(EXCLUDED.area_sqm,transactions.area_sqm),
      rooms=COALESCE(EXCLUDED.rooms,transactions.rooms),
      floor=COALESCE(EXCLUDED.floor,transactions.floor),
      nature=COALESCE(EXCLUDED.nature,transactions.nature),
      ownership_fraction=COALESCE(EXCLUDED.ownership_fraction,transactions.ownership_fraction),
      normalized_pp_sqm=COALESCE(EXCLUDED.normalized_pp_sqm,transactions.normalized_pp_sqm),
      is_comparable=EXCLUDED.is_comparable,
      exclusion_reason=EXCLUDED.exclusion_reason,
      observed_at=now()
  `;
  return existed.length?'updated':'inserted';
}

function deepFindNumber(obj:any,names:string[]):number|null{
  if(!obj||typeof obj!=='object') return null;
  for(const k of names){
    const v=obj[k];
    const x=int(v);
    if(x!==null) return x;
  }
  for(const v of Object.values(obj)){
    if(v&&typeof v==='object'){
      const found=deepFindNumber(v,names);
      if(found!==null) return found;
    }
  }
  return null;
}

export async function discoverTargetParcels(runId:string){
  const rules=await sql`
    SELECT sr.id,sr.normalized_street,n.id neighborhood_id,n.city_id,c.name_he city,
           coalesce((cp.cursor->>'next_number')::int,1) next_number
    FROM neighborhood_street_rules sr
    JOIN neighborhoods n ON n.id=sr.neighborhood_id
    JOIN cities c ON c.id=n.city_id
    LEFT JOIN etl_checkpoints cp ON cp.source_id='over_nadlan' AND cp.job_key='street:'||sr.id::text
    WHERE n.is_focus
    ORDER BY coalesce(cp.last_success_at,'1970-01-01'::timestamptz),sr.id
  `;

  let fetched=0,inserted=0,errors=0;
  const maxLookups=Number(process.env.EDGE_STREET_PROBES_PER_RUN ?? 30);
  let used=0;

  for(const rule of rules){
    if(used>=maxLookups) break;
    let next=Number(rule.next_number||1);
    const attempts=Math.min(3,maxLookups-used);
    for(let i=0;i<attempts;i++,next++,used++){
      try{
        const u=new URL('/api/nadlan/address',OVER);
        u.searchParams.set('city',String(rule.city));
        u.searchParams.set('street',String(rule.normalized_street));
        u.searchParams.set('number',String(next));
        u.searchParams.set('fields','identity,addresses,point,stat_area');
        const payload=await json(u.toString(),1);
        fetched++;
        const record=(payload?.result??payload) as Record<string,unknown>;
        await raw('over_nadlan',`address:${rule.city}:${rule.normalized_street}:${next}`,'address_lookup',record,runId);
        const gush=deepFindNumber(record,['gush','GUSH','גוש']);
        const helka=deepFindNumber(record,['helka','HELKA','חלקה']);
        if(gush!==null&&helka!==null){
          const p=await sql`
            INSERT INTO parcels(city_id,neighborhood_id,gush,helka,suffix,source_id)
            VALUES(${String(rule.city_id)}::uuid,${String(rule.neighborhood_id)}::uuid,${gush},${helka},'','over_nadlan')
            ON CONFLICT(gush,helka,suffix) DO UPDATE SET
              city_id=COALESCE(parcels.city_id,EXCLUDED.city_id),
              neighborhood_id=COALESCE(parcels.neighborhood_id,EXCLUDED.neighborhood_id),
              observed_at=now()
            RETURNING id
          `;
          const before=await sql`SELECT 1 FROM target_parcels WHERE neighborhood_id=${String(rule.neighborhood_id)}::uuid AND parcel_id=${String(p[0].id)}::uuid`;
          await sql`
            INSERT INTO target_parcels(neighborhood_id,parcel_id,discovery_source)
            VALUES(${String(rule.neighborhood_id)}::uuid,${String(p[0].id)}::uuid,'street_probe')
            ON CONFLICT(neighborhood_id,parcel_id) DO NOTHING
          `;
          if(!before.length) inserted++;
        }
      }catch(e){errors++;}
    }
    await sql`
      INSERT INTO etl_checkpoints(source_id,job_key,cursor,status,last_started_at,last_success_at,last_error,updated_at)
      VALUES('over_nadlan',${'street:'+String(rule.id)},${JSON.stringify({next_number:next})}::jsonb,'idle',now(),now(),NULL,now())
      ON CONFLICT(source_id,job_key) DO UPDATE SET cursor=EXCLUDED.cursor,status='idle',last_started_at=now(),last_success_at=now(),last_error=NULL,updated_at=now()
    `;
  }
  return {fetched,inserted,updated:0,errors};
}

export async function ingestTargetParcelDeals(runId:string){
  const targets=await sql`
    SELECT tp.id target_id,tp.neighborhood_id,p.id parcel_id,p.city_id,p.gush,p.helka,
           tp.last_deals_sync_at
    FROM target_parcels tp
    JOIN parcels p ON p.id=tp.parcel_id
    WHERE tp.is_active
    ORDER BY tp.last_deals_sync_at NULLS FIRST,tp.id
    LIMIT ${Number(process.env.EDGE_TARGET_PARCELS_PER_RUN ?? 40)}
  `;
  let fetched=0,inserted=0,updated=0,errors=0;

  for(const t of targets){
    try{
      for(let offset=0;offset<1000;offset+=PAGE_SIZE){
        const u=new URL(`/api/nadlan/parcel/${t.gush}/${t.helka}/deals`,OVER);
        u.searchParams.set('limit',String(PAGE_SIZE));
        u.searchParams.set('offset',String(offset));
        const payload=await json(u.toString(),2);
        const rows=recordsFrom(payload);
        if(!rows.length) break;
        fetched+=rows.length;
        for(const row of rows){
          const state=await upsertTransaction(row,runId,String(t.city_id),String(t.parcel_id),String(t.neighborhood_id));
          if(state==='inserted')inserted++;else if(state==='updated')updated++;
        }
        if(rows.length<PAGE_SIZE) break;
      }
      await sql`UPDATE target_parcels SET last_deals_sync_at=now() WHERE id=${Number(t.target_id)}`;
    }catch(e){
      errors++;
      console.error('target parcel deals failed',t.gush,t.helka,e);
    }
  }
  return {fetched,inserted,updated,errors};
}

export async function enrichRecentParcels(runId:string){
  const parcels=await sql`
    SELECT p.id,p.gush,p.helka
    FROM parcels p
    JOIN target_parcels tp ON tp.parcel_id=p.id AND tp.is_active
    WHERE p.centroid IS NULL OR p.stat_area_id IS NULL
    ORDER BY p.observed_at DESC
    LIMIT ${Number(process.env.EDGE_PARCEL_ENRICH_LIMIT ?? 50)}
  `;
  let fetched=0,updated=0,errors=0;
  for(const p of parcels){
    try{
      const payload=await json(`${OVER}/api/nadlan/parcel/${p.gush}/${p.helka}?geometry=true`,1);
      const record=(payload?.result??payload) as Record<string,unknown>;
      const rawId=await raw('over_nadlan',`${p.gush}/${p.helka}`,'parcel',record,runId);
      fetched++;
      const point=(record.point??(record as any).centroid) as any;
      const lat=n(point?.lat??point?.latitude),lon=n(point?.lon??point?.lng??point?.longitude);
      const stat=((record.stat_area??(record as any).statistical_area)||{}) as Record<string,unknown>;
      const statCode=text(pick(stat,['code','stat_area_code','id','area_code']));
      let statId:string|null=null;
      if(statCode){
        const s=await sql`
          INSERT INTO statistical_areas(city_id,stat_area_code,year,population,socio_economic_cluster,source_id,raw_record_id)
          SELECT city_id,${statCode},${int(pick(stat,['year','period_year']))},${int(pick(stat,['population','pop']))},
                 ${n(pick(stat,['socio_economic_cluster','cluster','socioeconomic_cluster']))},'over_nadlan',${rawId}
          FROM parcels WHERE id=${String(p.id)}::uuid
          ON CONFLICT(stat_area_code,year) DO UPDATE SET population=COALESCE(EXCLUDED.population,statistical_areas.population),
            socio_economic_cluster=COALESCE(EXCLUDED.socio_economic_cluster,statistical_areas.socio_economic_cluster),observed_at=now()
          RETURNING id
        `;
        statId=String(s[0].id);
      }
      if(lat!==null&&lon!==null){
        await sql`UPDATE parcels SET centroid=ST_SetSRID(ST_MakePoint(${lon},${lat}),4326),stat_area_id=${statId}::uuid,source_id='over_nadlan',raw_record_id=${rawId},observed_at=now() WHERE id=${String(p.id)}::uuid`;
      }else if(statId){
        await sql`UPDATE parcels SET stat_area_id=${statId}::uuid,raw_record_id=${rawId},observed_at=now() WHERE id=${String(p.id)}::uuid`;
      }
      updated++;
    }catch(e){errors++;console.error('parcel enrichment failed',p.gush,p.helka,e);}
  }
  return {fetched,inserted:0,updated,errors};
}

// Kept only for explicit backfill/debug use. Production agent uses target-parcel ETL.
export async function ingestDealsForSettlement(settlement:string,runId:string,options:{dateFrom?:string;maxPages?:number}={}){
  const c=await sql`SELECT id FROM cities WHERE name_he=${settlement} LIMIT 1`;
  if(!c.length) return {fetched:0,inserted:0,updated:0,errors:1};
  let fetched=0,inserted=0,updated=0;
  const maxPages=options.maxPages??1;
  for(let page=0;page<maxPages;page++){
    const u=new URL('/api/deals/search',OVER);
    u.searchParams.set('settlement',settlement);
    u.searchParams.set('nature','דירה בבית קומות');
    u.searchParams.set('date_from',options.dateFrom??'2022-01-01');
    u.searchParams.set('limit',String(PAGE_SIZE));
    u.searchParams.set('offset',String(page*PAGE_SIZE));
    const rows=recordsFrom(await json(u.toString(),1));
    fetched+=rows.length;
    for(const row of rows){
      const state=await upsertTransaction(row,runId,String(c[0].id),null,null);
      if(state==='inserted')inserted++;else if(state==='updated')updated++;
    }
    if(rows.length<PAGE_SIZE) break;
  }
  return {fetched,inserted,updated,errors:0};
}
