export function yad2Url(value:string, market?:string) {
 const u=new URL(value,'https://www.yad2.co.il');
 if(u.protocol!=='https:' || !['www.yad2.co.il','yad2.co.il'].includes(u.hostname) || u.username || u.password || u.port) throw new Error('Invalid Yad2 URL');
 if(!u.pathname.startsWith('/realestate/')) throw new Error('Expected real estate URL');
 if(market && !u.pathname.includes(market==='sale'?'/forsale':'/rent')) throw new Error('Scope category mismatch');
 u.hash=''; return u.toString();
}
export const listingFields:any={};
for(const field of ['url','price','city','neighborhood','address','rooms','area_sqm','floor','published_at','description','property_type','seller_type','images','features','latitude','longitude','entry_date','building_floors','condition','built_area_sqm','garden_area_sqm','property_details','amenities','source_dates','address_components','source_status','location_source','location_accuracy','location_precision_m','location_metadata']) {
 listingFields[field]=`${field} explicitly shown for this listing. Price is numeric ILS (monthly for rentals), rooms and area_sqm numeric; images and features arrays. Missing values null; preserve Hebrew. Never infer missing facts or dates.`;
}
listingFields.published_at='Original publication date explicitly shown, ISO YYYY-MM-DD. Null if unavailable. Never substitute update/bump dates or observation dates.';
listingFields.location_source='Coordinate provenance: yad2, address_geocoding or verified. Null when unavailable.';
listingFields.location_accuracy='Location accuracy: approximate, street, neighborhood, city, exact or unknown. Never infer exact from a map point or address.';
listingFields.location_precision_m='Explicit location precision/radius in metres. Null unless supplied; never invent a radius.';
listingFields.location_metadata='Property-only map evidence and accuracy classification basis; exclude seller contacts.';
export const pageRules={
 page_valid:{type:'boolean',description:'True only if this is a loaded Yad2 real estate results page, including an explicit no-results page. False for captcha, error, consent or blocked pages.'},
 empty_confirmed:{type:'boolean',description:'True only if the page explicitly states there are zero real estate results.'},
 listings:{type:'list',description:'Every distinct real estate listing on this page, including promoted and agency listings. Do not truncate. Exclude ads unrelated to real estate. Each URL must be the actual /realestate/item/ link.',output:listingFields},
 next_url:'Actual next results page link, absolute or relative. null only if there is no next page. Never invent a link.'
};
export function parseYad2Html(html:string,url:string,isFeed:boolean) {
 const match=html.match(/<script\b[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/);
 if(!match)throw new Error('Missing Yad2 page data; blocked or changed page');
 let props:any;try{props=JSON.parse(match[1]).props.pageProps;}catch{throw new Error('Invalid Yad2 page data');}
 const sourceRow=(item:any,itemUrl:string)=>{
  const a=item.address??{},d=item.additionalDetails??{},m=item.metaData??{};
  return {url:itemUrl,price:item.price??null,city:a.city?.text??null,neighborhood:a.neighborhood?.text??null,
   address:[a.street?.text,a.house?.number].filter(x=>x!==undefined&&x!==null).join(' ')||null,
   rooms:d.roomsCount??null,area_sqm:d.squareMeter??null,floor:a.house?.floor??null,
   published_at:typeof item.dates?.createdAt==='string'?item.dates.createdAt.slice(0,10):null,
   description:m.description??null,property_type:d.property?.text??null,seller_type:item.adType??null,
   images:m.images??null,features:item.inProperty?Object.entries(item.inProperty).filter(([,v])=>v===true).map(([k])=>k):null,
   latitude:a.coords?.lat??null,longitude:a.coords?.lon??null,
   // Treat the public map point conservatively; it does not verify a building.
   location_source:a.coords?.lat!=null&&a.coords?.lon!=null?'yad2':null,
   location_accuracy:a.coords?.lat!=null&&a.coords?.lon!=null?'approximate':null,
   location_precision_m:null,
   location_metadata:a.coords?.lat!=null&&a.coords?.lon!=null?{source_path:'address.coords',accuracy_basis:'conservative_default',source_coordinates:a.coords}:null,
   entry_date:d.entranceDate??null,
   building_floors:a.house?.floors??null,condition:d.propertyCondition?.text??null,
   built_area_sqm:d.squareMeterBuild??null,garden_area_sqm:d.squareMeterGarden??null,
   // Retain public property metadata, excluding customer/contact data.
   property_details:item.additionalDetails??null,address_components:item.address??null,
   amenities:item.inProperty?Object.fromEntries(Object.entries(item.inProperty).filter(([,v])=>typeof v==='boolean')):null,
   source_dates:item.dates??null,source_status:item.statusId??null};
 };
 if(!isFeed) {
  const id=normalizeListing({url}).id;
  const item=props.dehydratedState?.queries?.find((q:any)=>q.queryKey?.[0]==='item'&&q.queryKey?.[1]===id)?.state?.data;
  if(!item||item.token!==id)throw new Error('Listing detail identity mismatch');
  return sourceRow(item,url);
 }
 const feed=props.feed;
 if(!feed || !Array.isArray(feed.private)||!feed.pagination||!Number.isInteger(feed.pagination.totalPages))throw new Error('Missing Yad2 results feed');
 const links=new Map<string,string>();
 for(const m of html.matchAll(/href=["']([^"']*\/realestate\/item\/[^"']+)["']/g)) {
  try {const item=normalizeListing({url:m[1].replaceAll('&amp;','&')});links.set(item.id,item.data.url);}catch{}
 }
 const rows=new Map<string,any>();
 const walk=(v:any)=>{if(!v||typeof v!=='object')return;if(v.token&&v.address&&links.has(v.token))rows.set(v.token,sourceRow(v,links.get(v.token)!));for(const value of Object.values(v))walk(value);};
 for(const [key,value]of Object.entries(feed))if(!['yad1','lookalike','pagination'].includes(key))walk(value);
 const current=Number(props.initialSearchFormInputs?.page??new URL(url).searchParams.get('page')??1);
 const next=new URL(url);next.searchParams.set('page',String(current+1));
 return {page_valid:true,empty_confirmed:feed.pagination.total===0,listings:[...rows.values()],next_url:current<feed.pagination.totalPages?next.toString():null};
}
const number=(v:any,allowNegative=false)=>{if(v===null||v===undefined||v==='')return null;const x=Number(String(v).replace(/[₪,\s]/g,''));if(!Number.isFinite(x)||(!allowNegative&&x<0))throw new Error('Invalid numeric field');return x;};
export function normalizeListing(row:any) {
 const url=yad2Url(row.url);const id=new URL(url).pathname.match(/^\/realestate\/item\/(?:[a-zA-Z0-9_-]+\/)?([a-zA-Z0-9_-]+)\/?$/)?.[1];
 if(!id)throw new Error('Missing stable Yad2 listing ID');
 const data:any={};
 for(const field of Object.keys(listingFields)) data[field]=row[field]??null;
 const canonical=new URL(url);canonical.search='';data.url=canonical.toString();
 for(const f of ['price','rooms','area_sqm','latitude','longitude','building_floors','built_area_sqm','garden_area_sqm','location_precision_m'])data[f]=number(data[f],f==='latitude'||f==='longitude');
 if(data.latitude!==null&&Math.abs(data.latitude)>90)throw new Error('Invalid latitude');
 if(data.longitude!==null&&Math.abs(data.longitude)>180)throw new Error('Invalid longitude');
 if(data.location_source!==null&&!['yad2','address_geocoding','verified'].includes(data.location_source))throw new Error('Invalid location source');
 if(data.location_accuracy!==null&&!['approximate','street','neighborhood','city','exact','unknown'].includes(data.location_accuracy))throw new Error('Invalid location accuracy');
 if((data.location_source!==null||data.location_accuracy!==null||data.location_precision_m!==null)&&(data.latitude===null||data.longitude===null))throw new Error('Location provenance requires coordinate pair');
 for(const f of ['property_details','amenities','source_dates','address_components','location_metadata'])if(data[f]!==null&&(typeof data[f]!=='object'||Array.isArray(data[f])))throw new Error('Invalid structured property field');
 for(const f of ['images','features']) {if(data[f]!==null&&!Array.isArray(data[f]))throw new Error('Invalid array field');if(data[f])data[f]=[...new Set(data[f].map(String))].sort();}
 return {id,data};
}
export function validatePage(page:any) {
 if(page?.page_valid!==true || !Array.isArray(page.listings)) throw new Error('Blocked page or invalid extraction');
 if(!page.listings.length && page.empty_confirmed!==true)throw new Error('Unconfirmed empty results');
 if(page.next_url!==null && page.next_url!==undefined && typeof page.next_url!=='string')throw new Error('Invalid pagination');
 return page;
}

export function partitionListings(rows:any[]) {
 const listings:any[]=[];let excluded=0,invalid=0;
 for(const row of rows) {
  if(typeof row?.url==='string' && /\/yad1\/project\//.test(row.url)){excluded++;continue;}
  try {normalizeListing(row);listings.push(row);}catch {invalid++;}
 }
 return {listings,excluded,invalid};
}

export function recentListing(row:any,config:any,now=new Date()) {
 if(config.city_names && !config.city_names.includes(row.city))return false;
 const days=Number(config.published_within_days??30);
 const value=row.published_at;
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
 const date=new Date(value+'T00:00:00Z');
 if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==value)return false;
 const today=new Date(now.toISOString().slice(0,10)+'T00:00:00Z').getTime();
 return date.getTime()>=today-days*86400000&&date.getTime()<=today;
}
export function requestBudget(limit:number) {
 if(!Number.isInteger(limit)||limit<1)throw new Error('Invalid request budget');
 let used=0;
 return {get used(){return used;},take(){if(used>=limit)throw new Error('Request budget reached; crawl incomplete');used++;}};
}
