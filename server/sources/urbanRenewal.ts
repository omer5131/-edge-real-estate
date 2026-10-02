import { sql } from '../db.js';
import { sha256,pick,text,int,isoDate } from '../normalize.js';
const RESOURCE='f65a0daf-f737-49c5-9424-d378d52104f5';
async function get(url:string){const r=await fetch(url,{headers:{'user-agent':'EdgeRealEstate/1.0'}});if(!r.ok)throw new Error(`data.gov.il ${r.status}`);return r.json();}
export async function ingestUrbanRenewalOfficial(runId:string){
 const u=new URL('https://data.gov.il/api/3/action/datastore_search');u.searchParams.set('resource_id',RESOURCE);u.searchParams.set('limit','2000');
 const payload=await get(u.toString());const rows=(payload?.result?.records||[]) as Record<string,unknown>[];let inserted=0,updated=0,errors=0;
 for(const r of rows){try{
  const cityName=text(pick(r,['Yeshuv','יישוב'])); if(!cityName||!['חיפה','נתניה','פתח תקווה'].includes(cityName))continue;
  const c=await sql`SELECT id FROM cities WHERE name_he=${cityName} LIMIT 1`;if(!c.length)continue;
  const external=text(pick(r,['MisparMitham','_id']))||sha256(r);const hash=sha256(r);
  const raw=await sql`INSERT INTO raw_records(source_id,external_id,entity_hint,payload_hash,payload,ingestion_run_id) VALUES('urban_renewal_gov',${external},'renewal_project',${hash},${JSON.stringify(r)}::jsonb,${runId}::uuid) ON CONFLICT(source_id,external_id,payload_hash) DO UPDATE SET observed_at=now() RETURNING id`;
  const name=text(pick(r,['ShemMitcham']))||`מתחם ${external}`;const normalized=name.replace(/["״׳']/g,' ').replace(/\s+/g,' ').toLowerCase();
  const nbh=await sql`SELECT n.id FROM neighborhoods n WHERE n.city_id=${String(c[0].id)}::uuid AND (position(lower(n.name_he) in ${normalized})>0 OR EXISTS(SELECT 1 FROM neighborhood_street_rules sr WHERE sr.neighborhood_id=n.id AND position(sr.normalized_street in ${normalized})>0)) ORDER BY n.is_focus DESC LIMIT 1`;
  const existed=await sql`SELECT 1 FROM renewal_projects WHERE source_id='urban_renewal_gov' AND source_project_id=${external}`;
  await sql`INSERT INTO renewal_projects(source_id,source_project_id,city_id,neighborhood_id,project_name,plan_number,route,status,existing_units,planned_units,additional_units,permits_count,declared_at,effective_year,in_execution,source_url,map_url,raw_record_id) VALUES('urban_renewal_gov',${external},${String(c[0].id)}::uuid,${nbh[0]?.id?String(nbh[0].id):null}::uuid,${name},${text(pick(r,['MisparTochnit']))},${text(pick(r,['Maslul']))},${text(pick(r,['Status']))},${int(pick(r,['YachadKayam']))},${int(pick(r,['YachadMutza']))},${int(pick(r,['YachadTosafti']))},${int(pick(r,['SachHeterim']))},${isoDate(pick(r,['TaarichHachraza']))}::date,${int(pick(r,['ShnatMatanTokef']))},CASE WHEN lower(coalesce(${text(pick(r,['Bebitzua']))},'')) IN('כן','true','1','yes') THEN true ELSE false END,${text(pick(r,['KishurLatar']))},${text(pick(r,['KishurLaMapa']))},${Number(raw[0].id)}) ON CONFLICT(source_id,source_project_id) DO UPDATE SET neighborhood_id=COALESCE(EXCLUDED.neighborhood_id,renewal_projects.neighborhood_id),project_name=EXCLUDED.project_name,plan_number=EXCLUDED.plan_number,route=EXCLUDED.route,status=EXCLUDED.status,existing_units=EXCLUDED.existing_units,planned_units=EXCLUDED.planned_units,additional_units=EXCLUDED.additional_units,permits_count=EXCLUDED.permits_count,in_execution=EXCLUDED.in_execution,source_url=EXCLUDED.source_url,map_url=EXCLUDED.map_url,raw_record_id=EXCLUDED.raw_record_id,observed_at=now()`;
  existed.length?updated++:inserted++;
 }catch(e){errors++;console.error('renewal row',e);}}
 return {fetched:rows.length,inserted,updated,errors};
}
