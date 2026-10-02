
import { sql } from '../db.js';
import { sha256 } from '../normalize.js';

const TARGETS=[
  {slug:'kiryat-eliezer-haifa',path:'coastal-north',area:'5',city:'4000',neighborhood:'599'},
  {slug:'kiryat-sprinzak-haifa',path:'coastal-north',area:'5',city:'4000',neighborhood:'604'},
  {slug:'kiryat-nordau-netanya',path:'center-and-sharon',area:'17',city:'7400',neighborhood:'164'},
  {slug:'yoseftal-petah-tikva',path:'center-and-sharon',area:'4',city:'7900',neighborhood:'751'},
];

function clean(s:string){return s.replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim()}
function htmlRows(html:string){
  const text=clean(html.replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' '));
  const out:any[]=[];
  const patterns=[
    /₪\s?([\d,]{6,9})\s+([^₪]{3,100}?)\s+(\d+(?:\.\d+)?)\s*חדרים[^•]{0,60}•\s*קומה\s*([^•]{1,20})\s*•\s*(\d{2,3})\s*מ״ר/g,
    /([^₪]{3,100}?)\s+₪\s?([\d,]{6,9})[^\d]{0,40}(\d+(?:\.\d+)?)\s*חדרים[^\d]{0,40}(\d{2,3})\s*מ״ר/g
  ];
  let m:any;
  while((m=patterns[0].exec(text))!==null){
    out.push({price:Number(m[1].replace(/,/g,'')),address:clean(m[2]),rooms:Number(m[3]),floor:clean(m[4]),sqm:Number(m[5])});
  }
  while((m=patterns[1].exec(text))!==null){
    out.push({price:Number(m[2].replace(/,/g,'')),address:clean(m[1]),rooms:Number(m[3]),floor:null,sqm:Number(m[4])});
  }
  const seen=new Set<string>();
  return out.filter(x=>x.price>=300000&&x.price<=15000000&&x.sqm>=15&&x.sqm<=400)
    .filter(x=>{const k=[x.address,x.rooms,x.sqm,x.price].join('|');if(seen.has(k))return false;seen.add(k);return true});
}

export async function ingestYad2Sale(){
  let fetched=0,inserted=0,updated=0,errors=0;
  for(const t of TARGETS){
    try{
      const n=await sql`SELECT id,city_id FROM neighborhoods WHERE slug=${t.slug} LIMIT 1`;if(!n.length)continue;
      const url=`https://www.yad2.co.il/realestate/forsale/${t.path}?area=${t.area}&city=${t.city}&neighborhood=${t.neighborhood}&propertyGroup=apartments`;
      const c=new AbortController();const timer=setTimeout(()=>c.abort(),20000);
      let response:Response;
      try{
        response=await fetch(url,{headers:{'user-agent':'Mozilla/5.0 EdgeRealEstate/1.0','accept-language':'he-IL,he;q=0.9'},signal:c.signal});
      }finally{clearTimeout(timer)}
      if(!response.ok)throw new Error('Yad2 sale '+response.status);
      const rows=htmlRows(await response.text());fetched+=rows.length;
      for(const row of rows){
        const ext=sha256({slug:t.slug,address:row.address,rooms:row.rooms,sqm:row.sqm});
        const existed=await sql`SELECT id FROM listings WHERE source_id='yad2_sale' AND source_listing_id=${ext}`;
        const listing=await sql`
          INSERT INTO listings(source_id,source_listing_id,city_id,neighborhood_id,canonical_address,url,first_seen_at,last_seen_at,status)
          VALUES('yad2_sale',${ext},${String(n[0].city_id)}::uuid,${String(n[0].id)}::uuid,${row.address},${url},now(),now(),'active')
          ON CONFLICT(source_id,source_listing_id) DO UPDATE SET last_seen_at=now(),status='active',canonical_address=EXCLUDED.canonical_address,url=EXCLUDED.url
          RETURNING id`;
        await sql`
          INSERT INTO listing_snapshots(listing_id,observed_at,asking_price_nis,area_sqm,rooms,floor,payload)
          VALUES(${String(listing[0].id)}::uuid,date_trunc('day',now()),${row.price},${row.sqm},${row.rooms},${row.floor==null?null:Number(String(row.floor).match(/\d+/)?.[0]||null)},${JSON.stringify(row)}::jsonb)
          ON CONFLICT(listing_id,observed_at) DO UPDATE SET asking_price_nis=EXCLUDED.asking_price_nis,area_sqm=EXCLUDED.area_sqm,
            rooms=EXCLUDED.rooms,floor=COALESCE(EXCLUDED.floor,listing_snapshots.floor),payload=EXCLUDED.payload`;
        existed.length?updated++:inserted++;
      }
      await sql`UPDATE listings SET status='inactive' WHERE source_id='yad2_sale' AND neighborhood_id=${String(n[0].id)}::uuid AND last_seen_at<now()-interval '2 days'`;
    }catch(e){errors++;console.error('yad2 sale',t.slug,e)}
  }
  return {fetched,inserted,updated,errors};
}
