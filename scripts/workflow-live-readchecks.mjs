// Execute actual GET handlers against the configured DB; no writes or inference.
import assert from 'node:assert/strict';
import opportunities from '../.server-test/api/opportunities.js';
import property from '../.server-test/api/property.js';
import edgeData from '../.server-test/api/edge-data.js';
import neighborhood from '../.server-test/server/http/neighborhood-intelligence.js';
import {queryDatabase} from '../.server-test/server/db.js';
const listingId='6fadc597-6c65-4aef-a088-13261d5fd7cc';
const [listing]=await queryDatabase('select id,neighborhood_id from listings where id=$1::uuid',[listingId]);assert(listing,'Investor-review listing must be present');
async function get(handler,query){let body,code=200;const res={setHeader(){return this;},status(n){code=n;return this;},json(x){body=x;return this;}};await handler({method:'GET',query,headers:{}},res);assert.equal(code,200,'GET contract failed: '+JSON.stringify(query)+' '+(body?.error||''));return body;}
const research=await get(opportunities,{mode:'research',q:'סעדיה גאון',limit:'25'});assert(Array.isArray(research.assets));const subject=research.assets.find(x=>x.id===listingId);assert(subject);
const area=await get(neighborhood,{mode:'neighborhood-dashboard',neighborhoodId:String(listing.neighborhood_id),section:'listings'});const areaSubject=area.data.find(x=>x.id===listingId);assert(areaSubject);
const profile=await get(property,{id:listingId});assert.equal(profile.listing.id,listingId);
const dashboard=await get(edgeData,{});assert.equal(dashboard.mode,'live');const candidate=dashboard.opportunities.find(x=>x.id===listingId);
const [history]=await queryDatabase('select count(*)::int snapshot_count,extract(epoch from(max(observed_at)-min(observed_at)))/86400.0 span from listing_snapshots where listing_id=$1::uuid',[listingId]);
const dom=history.snapshot_count>=2&&Number(history.span)>=1?Math.floor(Number(history.span)):null;
assert.equal(subject.days_on_market,dom);assert.equal(areaSubject.days_on_market,dom);if(profile.seller)assert.equal(profile.seller.days_on_market,dom);if(candidate)assert.equal(candidate.days_on_market,dom);
if(dom===null){assert.equal(subject.price_reductions,null);assert.equal(areaSubject.price_change_since_first_pct,null);if(profile.seller){assert.equal(profile.seller.price_reductions,null);assert.equal(profile.seller.original_asking_price,null);}}
const pipeline=await get(opportunities,{mode:'deals'});assert(Array.isArray(pipeline.deals));for(const deal of pipeline.deals.slice(0,3)){const bundle=await get(opportunities,{mode:'deal',deal_id:String(deal.id),listing_id:String(deal.listing_id)});assert.equal(bundle.deal.id,deal.id);assert(Array.isArray(bundle.dueDiligence));assert(Array.isArray(bundle.tasks));}
console.log(JSON.stringify({actualGetHandlers:['research','area-listings','property','edge-data','deals',...(pipeline.deals.length?['deal-bundles']:[])],liveDealBundlesChecked:Math.min(3,pipeline.deals.length),observedLifecycleConsistent:true,snapshotCount:history.snapshot_count,daysObserved:dom,productionQARecords:0,paidModelRequests:0}));
