import {queryDatabase} from './db.js';

export function normalizeProjectAddress(value:string){return value.normalize('NFKC').replace(/["״׳']/g,'').replace(/[,]/g,' ').replace(/\s+/g,' ').trim();}
export function addressRelation(address:string,addresses:any[]){
 const normalized=normalizeProjectAddress(address||'');
 const match=addresses.find(a=>normalizeProjectAddress(a.street_name+' '+a.house_number)===normalized);
 return match?.membership||'unverified';
}
export function projectEvidence(facts:any[],addresses:any[]){
 return {status:facts.some(f=>f.evidence_status!=='verified')?'provisional':facts.length?'supported':'insufficient_evidence',
 confidence:null,sourceIds:[...new Set(facts.map(f=>f.source_url))],sampleSize:facts.length,
 notes:['Project-level evidence does not establish apartment membership. Developer forecasts are not approved evacuation dates.'],
 verifiedAddressCount:addresses.filter(a=>a.membership==='verified').length};
}
export async function listRenewalProfiles(filters:{city?:string;neighborhoodId?:string;q?:string}={}){
 return queryDatabase(`SELECT r.id::text,r.project_name,r.developer,r.plan_number,r.route,r.status,r.stage,
 r.existing_units,r.planned_units,r.permits_count,r.in_execution,r.observed_at,r.source_id,r.source_url,
 r.city_id::text,r.neighborhood_id::text,c.name_he city,n.name_he neighborhood,
 p.project_type,p.summary,p.planning_stage,p.permit_stage,p.execution_stage,
 (SELECT count(*)::int FROM renewal_project_facts f WHERE f.project_id=r.id) fact_count
 FROM renewal_projects r LEFT JOIN cities c ON c.id=r.city_id LEFT JOIN neighborhoods n ON n.id=r.neighborhood_id
 LEFT JOIN renewal_project_profiles p ON p.project_id=r.id
 WHERE ($1::text IS NULL OR c.name_he=$1) AND ($2::uuid IS NULL OR r.neighborhood_id=$2)
 AND ($3::text IS NULL OR concat_ws(' ',r.project_name,r.developer,r.plan_number,c.name_he,n.name_he) ILIKE '%'||$3||'%')
 ORDER BY (p.project_id IS NOT NULL) DESC,r.observed_at DESC LIMIT 300`,[filters.city||null,filters.neighborhoodId||null,filters.q||null]);
}
export async function getRenewalProfile(id:string,run:typeof queryDatabase=queryDatabase){
 const [project]=await run(`SELECT r.*,r.id::text,c.name_he city,n.name_he neighborhood,
 p.project_type,p.summary,p.planning_stage,p.permit_stage,p.execution_stage,p.gaps,
 ST_AsGeoJSON(r.geom)::jsonb geometry FROM renewal_projects r
 LEFT JOIN cities c ON c.id=r.city_id LEFT JOIN neighborhoods n ON n.id=r.neighborhood_id
 LEFT JOIN renewal_project_profiles p ON p.project_id=r.id WHERE r.id=$1::uuid`,[id]);
 if(!project)return null;
 const [facts,addresses,parcelRows]=await Promise.all([
 run('SELECT * FROM renewal_project_facts WHERE project_id=$1::uuid ORDER BY source_date DESC NULLS LAST,fact_key',[id]),
 run('SELECT * FROM renewal_project_addresses WHERE project_id=$1::uuid ORDER BY street_name,length(house_number),house_number',[id]),
 run('SELECT p.id::text,p.gush,p.helka FROM renewal_project_parcels rp JOIN parcels p ON p.id=rp.parcel_id WHERE rp.project_id=$1::uuid',[id])
 ]);
 // Only exact, documented addresses or explicit parcel links count as project assets.
 // Neighborhood inventory is intentionally not claimed as project membership.
 const [listings,transactions]=await Promise.all([
 run(`SELECT l.id::text,l.canonical_address address,l.status,l.url,l.source_id,
 a.membership,a.note membership_note,s.asking_price_nis::float8 asking_price,s.area_sqm::float8 sqm,s.rooms::float8 rooms,s.floor::float8 floor
 FROM renewal_project_addresses a JOIN listings l ON l.city_id=$2::uuid
 AND regexp_replace(trim(l.canonical_address),'\\s+',' ','g')=a.street_name||' '||a.house_number
 LEFT JOIN LATERAL(SELECT * FROM listing_snapshots WHERE listing_id=l.id ORDER BY observed_at DESC LIMIT 1)s ON true
 WHERE a.project_id=$1::uuid ORDER BY l.last_seen_at DESC LIMIT 100`,[id,project.city_id]),
 run(`SELECT DISTINCT t.id::text,t.address_text address,t.deal_date,t.amount_nis::float8 price,
 t.area_sqm::float8 sqm,t.rooms::float8 rooms,t.floor::float8 floor,t.source_id,t.ownership_fraction,t.is_comparable,
 CASE WHEN rp.parcel_id IS NOT NULL THEN 'verified_parcel' ELSE a.membership END membership
 FROM transactions t LEFT JOIN renewal_project_addresses a ON a.project_id=$1::uuid
 AND regexp_replace(trim(t.address_text),'\\s+',' ','g')=a.street_name||' '||a.house_number
 LEFT JOIN renewal_project_parcels rp ON rp.project_id=$1::uuid AND rp.parcel_id=t.parcel_id
 WHERE t.city_id=$2::uuid AND (a.project_id IS NOT NULL OR rp.parcel_id IS NOT NULL)
 ORDER BY t.deal_date DESC LIMIT 100`,[id,project.city_id])
 ]);
 return {project,facts,addresses,parcels:parcelRows,listings,transactions,evidence:projectEvidence(facts,addresses),
 coverage:{listingRelation:'exact_documented_address',transactionRelation:'exact_documented_address_or_explicit_parcel',
 marketNote:'Address candidates marked unverified/reported are research context, not confirmed project assets. No automatic valuation or future-value premium is calculated.'}};
}
