import { sql } from '../db.js';
import { pick,text } from '../normalize.js';

const norm=(v:string)=>v.normalize('NFKD').replace(/["״׳']/g,' ').replace(/[-–—]/g,' ').replace(/\s+/g,' ').trim().toLowerCase();
const streetFromAddress=(v:string)=>v.replace(/\s+\d+[א-תA-Za-z-]*\s*$/,'').trim();

export async function resolveTransactionNeighborhoods(){
 const rows=await sql`
   SELECT t.id,t.city_id,t.parcel_id,r.payload
   FROM transactions t
   JOIN raw_records r ON r.id=t.raw_record_id
   WHERE t.neighborhood_id IS NULL
   ORDER BY t.observed_at DESC
   LIMIT 5000
 `;

 let updated=0,errors=0;
 for(const row of rows){
  try{
   const p=(row.payload||{}) as Record<string,unknown>;
   const directStreet=text(pick(p,['street','street_name','STREET','STREETNAME','רחוב','שם רחוב']));
   const directAddress=text(pick(p,['address','full_address','ADDRESS','כתובת']));
   const addresses=Array.isArray((p as any).addresses)
     ? (p as any).addresses.map((x:any)=>String(x)).filter(Boolean)
     : [];

   const candidates:string[]=[];
   if(directStreet) candidates.push(directStreet);
   if(directAddress) candidates.push(streetFromAddress(directAddress));
   for(const a of addresses) candidates.push(streetFromAddress(a));

   const unique=[...new Set(candidates.map(norm).filter(Boolean))];
   let chosen:any=null;
   let chosenStreet:string|null=null;

   for(const s of unique){
     const match=await sql`
       SELECT sr.neighborhood_id
       FROM neighborhood_street_rules sr
       JOIN neighborhoods n ON n.id=sr.neighborhood_id
       WHERE n.city_id=${String(row.city_id)}::uuid
         AND (
           sr.normalized_street=${s}
           OR ${s} LIKE '%'||sr.normalized_street||'%'
           OR sr.normalized_street LIKE '%'||${s}||'%'
         )
       ORDER BY sr.confidence DESC
       LIMIT 1
     `;
     if(match.length){ chosen=match[0]; chosenStreet=s; break; }
   }

   if(!chosen || !chosenStreet) continue;

   const displayAddress=directAddress || addresses[0] || chosenStreet;
   const st=await sql`
     INSERT INTO streets(city_id,name_he,normalized_name)
     VALUES(${String(row.city_id)}::uuid,${chosenStreet},${chosenStreet})
     ON CONFLICT(city_id,normalized_name) DO UPDATE SET name_he=EXCLUDED.name_he
     RETURNING id
   `;

   await sql`
     UPDATE transactions
     SET neighborhood_id=${String(chosen.neighborhood_id)}::uuid,
         street_id=${String(st[0].id)}::uuid,
         address_text=${displayAddress}
     WHERE id=${String(row.id)}::uuid
   `;

   if(row.parcel_id){
     await sql`
       UPDATE parcels
       SET neighborhood_id=COALESCE(neighborhood_id,${String(chosen.neighborhood_id)}::uuid)
       WHERE id=${String(row.parcel_id)}::uuid
     `;
   }
   updated++;
  }catch(e){
   errors++;
   console.error('resolve tx neighborhood',e);
  }
 }
 return {fetched:rows.length,inserted:0,updated,errors};
}
