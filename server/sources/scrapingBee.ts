export function yad2Url(value:string, market?:string) {
 const u=new URL(value,'https://www.yad2.co.il');
 if(u.protocol!=='https:' || !['www.yad2.co.il','yad2.co.il'].includes(u.hostname) || u.username || u.password || u.port) throw new Error('Invalid Yad2 URL');
 if(!u.pathname.startsWith('/realestate/')) throw new Error('Expected real estate URL');
 if(market && !u.pathname.includes(market==='sale'?'/forsale':'/rent')) throw new Error('Scope category mismatch');
 u.hash=''; return u.toString();
}
export const listingFields:any={};
for(const field of ['url','price','city','neighborhood','address','rooms','area_sqm','floor','published_at','description','property_type','seller_type','images','features','latitude','longitude','entry_date','building_floors','condition']) {
 listingFields[field]=`${field} explicitly shown for this listing. Price is numeric ILS (monthly for rentals), rooms and area_sqm numeric; images and features arrays. Missing values null; preserve Hebrew. Never infer missing facts or dates.`;
}
listingFields.published_at='Original publication date explicitly shown, ISO YYYY-MM-DD. Null if unavailable. Never substitute update/bump dates or observation dates.';
export const pageRules={
 page_valid:{type:'boolean',description:'True only if this is a loaded Yad2 real estate results page, including an explicit no-results page. False for captcha, error, consent or blocked pages.'},
 empty_confirmed:{type:'boolean',description:'True only if the page explicitly states there are zero real estate results.'},
 listings:{type:'list',description:'Every distinct real estate listing on this page, including promoted and agency listings. Do not truncate. Exclude ads unrelated to real estate. Each URL must be the actual /realestate/item/ link.',output:listingFields},
 next_url:'Actual next results page link, absolute or relative. null only if there is no next page. Never invent a link.'
};
export async function scrapeJson(url:string,rules:any,fetcher:typeof fetch=fetch,beforeRequest:()=>void=()=>{}) {
 const key=process.env.SCRAPINGBEE_API_KEY;
 if(!key) throw new Error('SCRAPINGBEE_API_KEY is not configured');
 const endpoint=new URL('https://app.scrapingbee.com/api/v1/');
 endpoint.searchParams.set('url',yad2Url(url));
 endpoint.searchParams.set('render_js','true');
 endpoint.searchParams.set('ai_extract_rules',JSON.stringify(rules));
 if(process.env.SCRAPINGBEE_STEALTH_PROXY==='true') endpoint.searchParams.set('stealth_proxy','true');
 for(let attempt=0;attempt<3;attempt++) {
  beforeRequest();
  let response:Response;
  try { response=await fetcher(endpoint,{headers:{Authorization:`Bearer ${key}`},signal:AbortSignal.timeout(90000)}); }
  catch { if(attempt===2) throw new Error('ScrapingBee request timed out or failed'); continue; }
  if(response.ok) return response.json();
  if(![429,500,502,503,504].includes(response.status)||attempt===2) throw new Error(`ScrapingBee HTTP ${response.status}`);
  await new Promise(resolve=>setTimeout(resolve,1000*2**attempt));
 }
 throw new Error('ScrapingBee retries exhausted');
}
const number=(v:any,allowNegative=false)=>{if(v===null||v===undefined||v==='')return null;const x=Number(String(v).replace(/[₪,\s]/g,''));if(!Number.isFinite(x)||(!allowNegative&&x<0))throw new Error('Invalid numeric field');return x;};
export function normalizeListing(row:any) {
 const url=yad2Url(row.url);const id=new URL(url).pathname.match(/^\/realestate\/item\/([a-zA-Z0-9_-]+)\/?$/)?.[1];
 if(!id)throw new Error('Missing stable Yad2 listing ID');
 const data:any={};
 for(const field of Object.keys(listingFields)) data[field]=row[field]??null;
 data.url=`https://www.yad2.co.il/realestate/item/${id}`;
 for(const f of ['price','rooms','area_sqm','latitude','longitude','building_floors'])data[f]=number(data[f],f==='latitude'||f==='longitude');
 for(const f of ['images','features']) {if(data[f]!==null&&!Array.isArray(data[f]))throw new Error('Invalid array field');if(data[f])data[f]=[...new Set(data[f].map(String))].sort();}
 return {id,data};
}
export function validatePage(page:any) {
 if(page?.page_valid!==true || !Array.isArray(page.listings)) throw new Error('Blocked page or invalid extraction');
 if(!page.listings.length && page.empty_confirmed!==true)throw new Error('Unconfirmed empty results');
 if(page.next_url!==null && page.next_url!==undefined && typeof page.next_url!=='string')throw new Error('Invalid pagination');
 return page;
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
