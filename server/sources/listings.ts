import { sql } from '../db.js';
import { sha256, pick, n, text, isoDate } from '../normalize.js';

const OVER='https://www.over.org.il';
const ARCHIVE_ID=process.env.OVER_LISTING_ARCHIVE_ID || 'fd06f5ae-8a4f-4120-b275-8a514ad23499';
const TARGETS=[
  {city:'חיפה',streets:['אלנבי','צה״ל','צה ל','יציאת אירופה','דקר','חביבה רייק','שפרינצק']},
  {city:'נתניה',streets:['בן צבי','הרב קוק','ניצנים']},
  {city:'פתח תקווה',streets:['יוספטל','קפלן']},
];

const norm=(v:string)=>v.normalize('NFKD').replace(/["״׳']/g,' ').replace(/[-–—]/g,' ').replace(/\s+/g,' ').trim().toLowerCase();
function rowsFrom(p:any):Record<string,unknown>[]{for(const k of ['rows','records','results','items','data']){if(Array.isArray(p?.[k]))return p[k];if(Array.isArray(p?.result?.[k]))return p.result[k];}return Array.isArray(p)?p:[];}
async function get(url:string){const r=await fetch(url,{headers:{'user-agent':'EdgeRealEstate/1.0'}});if(!r.ok)throw new Error(`OVER archive ${r.status}`);return r.json();}
async function raw(externalId:string,payload:Record<string,unknown>,runId:string){const h=sha256(payload);const r=await sql`INSERT INTO raw_records(source_id,external_id,entity_hint,payload_hash,payload,ingestion_run_id) VALUES('over_listing_archive',${externalId},'listing',${h},${JSON.stringify(payload)}::jsonb,${runId}::uuid) ON CONFLICT(source_id,external_id,payload_hash) DO UPDATE SET observed_at=now() RETURNING id`;return Number(r[0].id);}
async function city(name:string){const r=await sql`SELECT id FROM cities WHERE name_he=${name} LIMIT 1`;return r[0]?.id?String(r[0].id):null;}
async function resolveNeighborhood(cityId:string,street:string){const s=norm(street);const r=await sql`SELECT neighborhood_id FROM neighborhood_street_rules WHERE normalized_street=${s} OR ${s} LIKE '%'||normalized_street||'%' OR normalized_street LIKE '%'||${s}||'%' ORDER BY confidence DESC LIMIT 1`;return r[0]?.neighborhood_id?String(r[0].neighborhood_id):null;}

export async function ingestListingArchive(runId:string){
 let fetched=0,inserted=0,updated=0,errors=0;
 for(const target of TARGETS){
  const cid=await city(target.city); if(!cid) continue;
  for(const streetQuery of target.streets){
   try{
    const u=new URL(`/api/append/${ARCHIVE_ID}/rows`,OVER);u.searchParams.set('latest','true');u.searchParams.set('q',`${target.city} ${streetQuery}`);u.searchParams.set('limit','250');
    const payload=await get(u.toString()); const rows=rowsFrom(payload); fetched+=rows.length;
    for(const row of rows){
      const sourceId=text(pick(row,['id','listing_id','ad_id','item_id','uid','_id']))||sha256(row);
      await raw(sourceId,row,runId);
      const cityName=text(pick(row,['city','settlement','יישוב','עיר']))||target.city;
      if(cityName && !norm(cityName).includes(norm(target.city))) continue;
      const street=text(pick(row,['street','street_name','רחוב']))||streetQuery;
      const number=text(pick(row,['house_number','number','מספר בית','מספר']))||'';
      const address=text(pick(row,['address','full_address','כתובת']))||`${street} ${number}`.trim();
      const price=n(pick(row,['price','asking_price','asking_price_ils','מחיר','price_value']));
      if(!address||!price||price<100000) continue;
      const neighborhoodId=await resolveNeighborhood(cid,street);
      if(!neighborhoodId) continue;
      const first=isoDate(pick(row,['first_seen','first_seen_at','published_at','publish_date','date']))||new Date().toISOString().slice(0,10);
      const last=isoDate(pick(row,['last_seen','last_seen_at','updated_at','date']))||new Date().toISOString().slice(0,10);
      const existed=await sql`SELECT id FROM listings WHERE source_id='over_listing_archive' AND source_listing_id=${sourceId}`;
      const l=await sql`INSERT INTO listings(source_id,source_listing_id,city_id,neighborhood_id,canonical_address,url,first_seen_at,last_seen_at,status) VALUES('over_listing_archive',${sourceId},${cid}::uuid,${neighborhoodId}::uuid,${address},${text(pick(row,['url','link','listing_url']))},${first}::timestamptz,${last}::timestamptz,'active') ON CONFLICT(source_id,source_listing_id) DO UPDATE SET neighborhood_id=COALESCE(EXCLUDED.neighborhood_id,listings.neighborhood_id),canonical_address=COALESCE(EXCLUDED.canonical_address,listings.canonical_address),url=COALESCE(EXCLUDED.url,listings.url),first_seen_at=LEAST(listings.first_seen_at,EXCLUDED.first_seen_at),last_seen_at=GREATEST(listings.last_seen_at,EXCLUDED.last_seen_at) RETURNING id`;
      const observed=text(pick(row,['updated_at','last_seen_at','first_seen_at','first_seen']))||new Date().toISOString();
      await sql`INSERT INTO listing_snapshots(listing_id,observed_at,asking_price_nis,area_sqm,rooms,floor,broker_name,payload) VALUES(${String(l[0].id)}::uuid,${observed}::timestamptz,${price},${n(pick(row,['area','sqm','area_sqm','שטח']))},${n(pick(row,['rooms','room_count','חדרים']))},${n(pick(row,['floor','קומה']))},${text(pick(row,['broker','broker_name','מתווך']))},${JSON.stringify(row)}::jsonb) ON CONFLICT(listing_id,observed_at) DO UPDATE SET asking_price_nis=EXCLUDED.asking_price_nis,area_sqm=COALESCE(EXCLUDED.area_sqm,listing_snapshots.area_sqm),rooms=COALESCE(EXCLUDED.rooms,listing_snapshots.rooms),floor=COALESCE(EXCLUDED.floor,listing_snapshots.floor),payload=EXCLUDED.payload`;
      existed.length?updated++:inserted++;
    }
   }catch(e){errors++;console.error('listing archive',target.city,streetQuery,e);}
  }
 }
 return {fetched,inserted,updated,errors};
}
