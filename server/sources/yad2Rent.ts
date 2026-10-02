import { sql } from '../db.js';
import { sha256 } from '../normalize.js';

const TARGETS = [
  { slug:'kiryat-eliezer-haifa', path:'coastal-north', area:'5', city:'4000', neighborhood:'599' },
  { slug:'kiryat-sprinzak-haifa', path:'coastal-north', area:'5', city:'4000', neighborhood:'604' },
  { slug:'kiryat-nordau-netanya', path:'center-and-sharon', area:'17', city:'7400', neighborhood:'164' },
  { slug:'yoseftal-petah-tikva', path:'center-and-sharon', area:'4', city:'7900', neighborhood:'751' },
];

function clean(s:string){return s.replace(/&nbsp;|&#160;|\u00a0/g,' ').replace(/[‎‏]/g,'').replace(/\s+/g,' ').trim();}
function listingsFromHtml(html:string){
  const text=clean(html.replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' '));
  const pattern=/₪\s*([\d,]{4,7})\s+(.{2,120}?)\s+(\d+(?:\.\d+)?)\s*חדרים\s*[•·]?\s*קומה\s*([^•·]{1,20})\s*[•·]\s*(\d{2,3})\s*מ[״"]?ר/g;
  const out:any[]=[]; let m;
  while((m=pattern.exec(text))!==null){
    const before=clean(m[2]);const address=clean(before.replace(/(?:דירה|דירת גן|גג\/פנטהאוז|בית פרטי|דו משפחתי).*$/,'').split(/(?:בלעדי|נדל"ן|נכסים)/).pop()||before);out.push({rent:Number(m[1].replace(/,/g,'')),address,rooms:Number(m[3]),floor:clean(m[4]),sqm:Number(m[5])});
  }
  return out.filter(x=>x.rent>=1500&&x.rent<=30000&&x.sqm>=15&&x.sqm<=400);
}
export async function ingestYad2Rent(){
 let fetched=0,inserted=0,updated=0,errors=0;
 for(const t of TARGETS){
  try{
   const n=await sql`SELECT n.id,n.city_id FROM neighborhoods n WHERE n.slug=${t.slug} LIMIT 1`; if(!n.length)continue;
   const url=`https://www.yad2.co.il/realestate/rent/${t.path}?area=${t.area}&city=${t.city}&neighborhood=${t.neighborhood}&propertyGroup=apartments`;
   const r=await fetch(url,{headers:{'user-agent':'Mozilla/5.0 EdgeRealEstate/1.0','accept-language':'he-IL,he;q=0.9'}}); if(!r.ok)throw new Error(`Yad2 ${r.status}`);
   const html=await r.text(); const rows=listingsFromHtml(html); fetched+=rows.length;if(!rows.length){errors++;console.error('yad2 rent zero parsed',t.slug,'html',html.length,'type',r.headers.get('content-type'))}
   const seen:string[]=[];
   for(const row of rows){
    const ext=sha256({slug:t.slug,address:row.address,rooms:row.rooms,sqm:row.sqm}); seen.push(ext);
    const existed=await sql`SELECT id FROM rental_listings WHERE source_id='yad2_rent' AND source_listing_id=${ext}`;
    const l=await sql`INSERT INTO rental_listings(source_id,source_listing_id,city_id,neighborhood_id,canonical_address,url,first_seen_at,last_seen_at,status) VALUES('yad2_rent',${ext},${String(n[0].city_id)}::uuid,${String(n[0].id)}::uuid,${row.address},${url},now(),now(),'active') ON CONFLICT(source_id,source_listing_id) DO UPDATE SET last_seen_at=now(),status='active',canonical_address=EXCLUDED.canonical_address,url=EXCLUDED.url RETURNING id`;
    await sql`INSERT INTO rental_listing_snapshots(rental_listing_id,observed_at,asking_rent_nis,area_sqm,rooms,floor,payload) VALUES(${String(l[0].id)}::uuid,date_trunc('day',now()),${row.rent},${row.sqm},${row.rooms},${row.floor},${JSON.stringify(row)}::jsonb) ON CONFLICT(rental_listing_id,observed_at) DO UPDATE SET asking_rent_nis=EXCLUDED.asking_rent_nis,area_sqm=EXCLUDED.area_sqm,rooms=EXCLUDED.rooms,floor=EXCLUDED.floor,payload=EXCLUDED.payload`;
    existed.length?updated++:inserted++;
   }
   await sql`UPDATE rental_listings SET status='inactive' WHERE source_id='yad2_rent' AND neighborhood_id=${String(n[0].id)}::uuid AND last_seen_at < now()-interval '2 days'`;
  }catch(e){errors++;console.error('yad2 rent',t.slug,e);}
 }
 return {fetched,inserted,updated,errors};
}
