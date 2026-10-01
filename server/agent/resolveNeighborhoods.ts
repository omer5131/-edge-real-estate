import { sql } from '../db';
import { pick,text } from '../normalize';
const norm=(v:string)=>v.normalize('NFKD').replace(/["״׳']/g,' ').replace(/[-–—]/g,' ').replace(/\s+/g,' ').trim().toLowerCase();
export async function resolveTransactionNeighborhoods(){
 const rows=await sql`SELECT t.id,t.city_id,t.parcel_id,r.payload FROM transactions t JOIN raw_records r ON r.id=t.raw_record_id WHERE t.neighborhood_id IS NULL ORDER BY t.observed_at DESC LIMIT 5000`;
 let updated=0,errors=0;
 for(const row of rows){try{
   const p=(row.payload||{}) as Record<string,unknown>;
   const street=text(pick(p,['street','street_name','STREET','STREETNAME','רחוב','שם רחוב']));
   const address=text(pick(p,['address','full_address','ADDRESS','כתובת']))||street;
   if(!street)continue; const s=norm(street);
   const match=await sql`SELECT neighborhood_id FROM neighborhood_street_rules WHERE normalized_street=${s} OR ${s} LIKE '%'||normalized_street||'%' OR normalized_street LIKE '%'||${s}||'%' ORDER BY confidence DESC LIMIT 1`;
   if(!match.length)continue;
   const st=await sql`INSERT INTO streets(city_id,name_he,normalized_name) VALUES(${String(row.city_id)}::uuid,${street},${s}) ON CONFLICT(city_id,normalized_name) DO UPDATE SET name_he=EXCLUDED.name_he RETURNING id`;
   await sql`UPDATE transactions SET neighborhood_id=${String(match[0].neighborhood_id)}::uuid,street_id=${String(st[0].id)}::uuid,address_text=${address} WHERE id=${String(row.id)}::uuid`;
   if(row.parcel_id)await sql`UPDATE parcels SET neighborhood_id=COALESCE(neighborhood_id,${String(match[0].neighborhood_id)}::uuid) WHERE id=${String(row.parcel_id)}::uuid`;
   updated++;
 }catch(e){errors++;console.error('resolve tx neighborhood',e);}}
 return {fetched:rows.length,inserted:0,updated,errors};
}
