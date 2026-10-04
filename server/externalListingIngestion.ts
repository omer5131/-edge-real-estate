import {createHash} from 'node:crypto';
import {queryDatabase as query} from './db.js';
import {recomputeOpportunityScores} from './agent/scoring.js';

export type ExternalListingInput={
 intakeMode:'url'|'manual';listingType:'sale'|'rent';url?:string|null;sourceListingId?:string|null;
 city?:string|null;neighborhood?:string|null;address?:string|null;askingPrice?:number|null;askingRent?:number|null;
 areaSqm?:number|null;rooms?:number|null;floor?:number|string|null;propertyType?:string|null;brokerName?:string|null;
 description?:string|null;publishedAt?:string|null;contactPhone?:string|null;lat?:number|null;lon?:number|null;
 gush?:number|null;helka?:number|null;notes?:string|null;
};
const clean=(v:any)=>String(v??'').replace(/\s+/g,' ').trim()||null;
const n=(v:any)=>{const x=Number(String(v??'').replace(/[^0-9.-]/g,''));return Number.isFinite(x)?x:null};
const hash=(s:string)=>createHash('sha256').update(s).digest('hex').slice(0,40);
function normUrl(raw:string){const u=new URL(raw);for(const k of [...u.searchParams.keys()])if(/^utm_|^(fbclid|gclid)$/i.test(k))u.searchParams.delete(k);u.hash='';return u.toString()}
function meta(html:string,key:string){
 const re=/<meta[^>]+(?:property|name)=["']([^"']+)["'][^>]+content=["']([^"']*)["']/gi;
 for(const m of html.matchAll(re))if(String(m[1]).toLowerCase()===key.toLowerCase())return clean(m[2]);
 return null;
}
function ld(html:string){
 const out:any[]=[];
 const re=/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
 for(const m of html.matchAll(re)){try{const x=JSON.parse(m[1]);out.push(...(Array.isArray(x)?x:[x]))}catch{}}
 return out;
}
function walk(x:any,out:any[]=[]):any[]{if(!x||typeof x!=='object')return out;out.push(x);for(const v of Object.values(x))if(v&&typeof v==='object')walk(v,out);return out}
async function collectUrl(url:string){
 const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),15000);
 try{
  const r=await fetch(url,{redirect:'follow',signal:ctl.signal,headers:{'user-agent':'Mozilla/5.0 (compatible; EdgeRealEstate/1.0)','accept':'text/html,application/xhtml+xml'}});
  if(!r.ok)throw new Error('HTTP '+r.status);
  const html=await r.text(),nodes=ld(html).flatMap(x=>walk(x));
  const offer=nodes.find(x=>x['@type']==='Offer'||x.price||x.priceSpecification)||{};
  const item=nodes.find(x=>['Apartment','House','Residence','Product','Accommodation'].includes(x['@type']))||nodes.find(x=>x.address)||{};
  const a=typeof item.address==='string'?{streetAddress:item.address}:item.address||{};
  const body=clean(html.replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' '))||'';
  const price=offer.price??offer.priceSpecification?.price??meta(html,'product:price:amount')??/(?:₪|ש["״']?ח)\s*([0-9][0-9,.]{2,})/.exec(body)?.[1];
  return {title:clean(item.name||meta(html,'og:title')),description:clean(item.description||meta(html,'og:description')),
   address:clean(a.streetAddress),city:clean(a.addressLocality||a.addressRegion),askingPrice:n(price),
   rooms:n(item.numberOfRooms??/([0-9]+(?:\.[05])?)\s*חדרים/.exec(body)?.[1]),
   areaSqm:n(item.floorSize?.value??/([0-9]{2,4})\s*(?:מ["״']?ר|מטר רבוע)/.exec(body)?.[1]),canonicalUrl:normUrl(url)};
 }finally{clearTimeout(timer)}
}
function keyFor(i:ExternalListingInput,url:string|null){return i.sourceListingId?'source:'+hash(i.sourceListingId):url?'url:'+hash(url):'manual:'+hash([i.listingType,clean(i.city),clean(i.address),i.rooms??'',i.floor??'',i.areaSqm??'',i.gush??'',i.helka??''].join('|'))}
async function geo(i:any){
 let city:any=null,neighborhood:any=null,parcel:any=null;
 if(i.gush&&i.helka)[parcel]=await query("SELECT p.id::text,p.city_id::text,p.neighborhood_id::text,c.name_he city,n.name_he neighborhood FROM parcels p LEFT JOIN cities c ON c.id=p.city_id LEFT JOIN neighborhoods n ON n.id=p.neighborhood_id WHERE p.gush=$1 AND p.helka=$2 ORDER BY p.observed_at DESC LIMIT 1",[i.gush,i.helka]);
 if(parcel?.city_id)city={id:parcel.city_id,name_he:parcel.city};if(parcel?.neighborhood_id)neighborhood={id:parcel.neighborhood_id,name_he:parcel.neighborhood};
 if(!city&&i.city)[city]=await query("SELECT id::text,name_he FROM cities WHERE lower(regexp_replace(name_he,'\\s','','g'))=lower(regexp_replace($1,'\\s','','g')) OR name_en ILIKE $1 ORDER BY (name_he=$1) DESC LIMIT 1",[i.city]);
 if(!neighborhood&&i.lat!=null&&i.lon!=null)[neighborhood]=await query("SELECT id::text,name_he FROM neighborhoods WHERE geom IS NOT NULL AND ($3::uuid IS NULL OR city_id=$3::uuid) AND ST_Covers(geom,ST_SetSRID(ST_Point($1,$2),4326)) ORDER BY COALESCE(geometry_confidence,geom_confidence,0) DESC LIMIT 1",[i.lon,i.lat,city?.id??null]);
 if(!neighborhood&&i.neighborhood)[neighborhood]=await query("SELECT n.id::text,n.name_he FROM neighborhoods n LEFT JOIN neighborhood_aliases a ON a.neighborhood_id=n.id WHERE ($2::uuid IS NULL OR n.city_id=$2::uuid) AND (lower(regexp_replace(n.name_he,'[[:space:][:punct:]]','','g'))=lower(regexp_replace($1,'[[:space:][:punct:]]','','g')) OR a.normalized_alias=lower(regexp_replace($1,'[[:space:][:punct:]]','','g'))) ORDER BY (n.name_he=$1) DESC,COALESCE(a.confidence,0) DESC LIMIT 1",[i.neighborhood,city?.id??null]);
 return {city,neighborhood,parcel};
}
async function canonical(i:ExternalListingInput,e:any,k:string,url:string|null){
 const m={...e,...Object.fromEntries(Object.entries(i).filter(([,v])=>v!==undefined&&v!==null&&v!==''))},g=await geo(m),address=clean(m.address||m.title),payload={...e,...i,normalized_url:url,ingestion:'external_manual'},at=new Date().toISOString();
 if(i.listingType==='sale'){
  const price=n(m.askingPrice??e.askingPrice);
  const [l]=await query("INSERT INTO listings(source_id,source_listing_id,city_id,neighborhood_id,canonical_address,url,first_seen_at,last_seen_at,status) VALUES('external_manual',$1,$2::uuid,$3::uuid,$4,$5,now(),now(),'active') ON CONFLICT(source_id,source_listing_id) DO UPDATE SET city_id=COALESCE(EXCLUDED.city_id,listings.city_id),neighborhood_id=COALESCE(EXCLUDED.neighborhood_id,listings.neighborhood_id),canonical_address=COALESCE(EXCLUDED.canonical_address,listings.canonical_address),url=COALESCE(EXCLUDED.url,listings.url),last_seen_at=now(),status='active' RETURNING id::text",[k,g.city?.id??null,g.neighborhood?.id??null,address,url]);
  const [x]=await query("SELECT asking_price_nis::float8,area_sqm::float8,rooms::float8,floor::float8,payload FROM listing_snapshots WHERE listing_id=$1::uuid ORDER BY observed_at DESC LIMIT 1",[l.id]);
  const v={price,area:n(m.areaSqm),rooms:n(m.rooms),floor:n(m.floor),broker:clean(m.brokerName)},changed=!x||Number(x.asking_price_nis)!==Number(v.price)||Number(x.area_sqm)!==Number(v.area)||Number(x.rooms)!==Number(v.rooms)||Number(x.floor)!==Number(v.floor)||JSON.stringify(x.payload||{})!==JSON.stringify(payload);
  if(changed)await query("INSERT INTO listing_snapshots(listing_id,observed_at,asking_price_nis,area_sqm,rooms,floor,broker_name,payload) VALUES($1::uuid,$2,$3,$4,$5,$6,$7,$8::jsonb)",[l.id,at,v.price,v.area,v.rooms,v.floor,v.broker,JSON.stringify(payload)]);
  return {kind:'sale',id:l.id,geo:g,snapshotInserted:changed,price};
 }
 const rent=n(m.askingRent??m.askingPrice??e.askingPrice);if(rent==null||rent<=0)throw new Error('asking_rent_required');
 const [l]=await query("INSERT INTO rental_listings(source_id,source_listing_id,city_id,neighborhood_id,canonical_address,url,first_seen_at,last_seen_at,status) VALUES('external_manual',$1,$2::uuid,$3::uuid,$4,$5,now(),now(),'active') ON CONFLICT(source_id,source_listing_id) DO UPDATE SET city_id=COALESCE(EXCLUDED.city_id,rental_listings.city_id),neighborhood_id=COALESCE(EXCLUDED.neighborhood_id,rental_listings.neighborhood_id),canonical_address=COALESCE(EXCLUDED.canonical_address,rental_listings.canonical_address),url=COALESCE(EXCLUDED.url,rental_listings.url),last_seen_at=now(),status='active' RETURNING id::text",[k,g.city?.id??null,g.neighborhood?.id??null,address,url]);
 const [x]=await query("SELECT asking_rent_nis::float8,area_sqm::float8,rooms::float8,floor,payload FROM rental_listing_snapshots WHERE rental_listing_id=$1::uuid ORDER BY observed_at DESC LIMIT 1",[l.id]);
 const v={rent,area:n(m.areaSqm),rooms:n(m.rooms),floor:clean(m.floor)},changed=!x||Number(x.asking_rent_nis)!==Number(v.rent)||Number(x.area_sqm)!==Number(v.area)||Number(x.rooms)!==Number(v.rooms)||String(x.floor??'')!==String(v.floor??'')||JSON.stringify(x.payload||{})!==JSON.stringify(payload);
 if(changed)await query("INSERT INTO rental_listing_snapshots(rental_listing_id,observed_at,asking_rent_nis,area_sqm,rooms,floor,payload) VALUES($1::uuid,$2,$3,$4,$5,$6,$7::jsonb)",[l.id,at,v.rent,v.area,v.rooms,v.floor,JSON.stringify(payload)]);
 return {kind:'rent',id:l.id,geo:g,snapshotInserted:changed,rent};
}
export async function ingestExternalListing(i:ExternalListingInput){
 if(!['url','manual'].includes(i.intakeMode)||!['sale','rent'].includes(i.listingType))throw new Error('invalid_request');
 const url=i.url?normUrl(i.url):null,k=keyFor(i,url);let e:any={};
 if(i.intakeMode==='url'){if(!url)throw new Error('url_required');try{e=await collectUrl(url)}catch(err:any){const [row]=await query("INSERT INTO external_listing_intake(intake_mode,listing_type,url,source_listing_key,status,submitted_payload,error) VALUES('url',$1,$2,$3,'needs_input',$4::jsonb,$5) ON CONFLICT(listing_type,source_listing_key) DO UPDATE SET submitted_payload=EXCLUDED.submitted_payload,status='needs_input',error=EXCLUDED.error,created_at=now() RETURNING id::text,status,error",[i.listingType,url,k,JSON.stringify(i),String(err?.message||err)]);return {ok:false,needsInput:true,intake:row,extracted:{}}}}
 const m={...e,...i},price=i.listingType==='rent'?n(m.askingRent??m.askingPrice??e.askingPrice):n(m.askingPrice??e.askingPrice),address=clean(m.address||e.address||e.title);
 if(i.intakeMode==='url'&&(price==null||!address)){const [row]=await query("INSERT INTO external_listing_intake(intake_mode,listing_type,url,source_listing_key,status,submitted_payload,extracted_payload,error) VALUES('url',$1,$2,$3,'needs_input',$4::jsonb,$5::jsonb,'Could not extract required price/address') ON CONFLICT(listing_type,source_listing_key) DO UPDATE SET extracted_payload=EXCLUDED.extracted_payload,submitted_payload=EXCLUDED.submitted_payload,status='needs_input',error=EXCLUDED.error,created_at=now() RETURNING id::text,status,error",[i.listingType,url,k,JSON.stringify(i),JSON.stringify(e)]);return {ok:false,needsInput:true,intake:row,extracted:e}}
 if(i.intakeMode==='manual'&&(!address||price==null||price<=0))throw new Error(!address?'address_required':i.listingType==='rent'?'asking_rent_required':'asking_price_required');
 const [intake]=await query("INSERT INTO external_listing_intake(intake_mode,listing_type,url,source_listing_key,status,submitted_payload,extracted_payload) VALUES($1,$2,$3,$4,'pending',$5::jsonb,$6::jsonb) ON CONFLICT(listing_type,source_listing_key) DO UPDATE SET intake_mode=EXCLUDED.intake_mode,url=COALESCE(EXCLUDED.url,external_listing_intake.url),submitted_payload=EXCLUDED.submitted_payload,extracted_payload=EXCLUDED.extracted_payload,status='pending',error=NULL RETURNING id::text",[i.intakeMode,i.listingType,url,k,JSON.stringify(i),JSON.stringify(e)]);
 try{const result=await canonical(i,e,k,url);await query("UPDATE external_listing_intake SET status='processed',processed_at=now(),error=NULL,canonical_listing_id=CASE WHEN $2='sale' THEN $3::uuid ELSE NULL END,canonical_rental_listing_id=CASE WHEN $2='rent' THEN $3::uuid ELSE NULL END WHERE id=$1::uuid",[intake.id,i.listingType,result.id]);if(i.listingType==='sale')await recomputeOpportunityScores();return {ok:true,intakeId:intake.id,canonical:result,extracted:e}}
 catch(err:any){await query("UPDATE external_listing_intake SET status='failed',error=$2,processed_at=now() WHERE id=$1::uuid",[intake.id,String(err?.message||err)]);throw err}
}
export async function recentExternalIntakes(limit=30){return query("SELECT id::text,intake_mode,listing_type,url,status,submitted_payload,extracted_payload,canonical_listing_id::text,canonical_rental_listing_id::text,error,created_at,processed_at FROM external_listing_intake ORDER BY created_at DESC LIMIT $1",[Math.max(1,Math.min(limit,100))])}
