import type { VercelRequest,VercelResponse } from '@vercel/node';
import { neon } from '@neondatabase/serverless';
import { queryDatabase } from '../db.js';
import { validateResearchSql } from '../researchSql.js';
const definitions:Record<string,[string,string,string]>={
 transactions:['Transactions','One recorded real-estate transaction.','Amounts are NIS; area is m². Partial ownership and excluded records remain here. Use comparable_transactions for valuation.'],
 comparable_transactions:['Comparable transactions','One transaction passing the comparable quality filters.','Includes dated, positive-price transactions, area 15–400 m², price/m² 5,000–100,000, and ownership ≥90% or unknown. Unknown ownership is not confirmed full ownership.'],
 yad2_dataset:['Yad2 sale & rent','One listing per (market, listing_id).','Sale prices are asking NIS; rent prices are asking monthly NIS. These are not completed deals. first_seen_at is collection time, not publication time.'],
 yad2_listing_changes:['Yad2 change history','One detected listing change.','Join on market AND listing_id. History starts when collection starts; observed_at is detection time.'],
 listings:['Sale listings','One normalized sale listing.','Prices and property attributes are in listing_snapshots. Join listing_snapshots.listing_id to listings.id; select the latest observed_at for current asking price.'],
 listing_snapshots:['Sale price snapshots','One observed sale-listing snapshot.','Multiple observations per listing. Asking price is NIS; area is m².'],
 rental_listings:['Rental listings','One normalized rental listing.','Join rental_listing_snapshots.rental_listing_id to rental_listings.id. Asking rent is monthly NIS.'],
 rental_listing_snapshots:['Rental snapshots','One observed rental-listing snapshot.','Multiple observations per rental listing; use latest observed_at for current asking rent.'],
 neighborhood_rent_metrics:['Neighborhood rent metrics','One neighborhood aggregate of latest rental observations.','Active supply and median asking monthly rent. This is listing-based, not signed lease data.'],
 planning_plans:['Planning plans','One ingested plan record.','Plan status reflects the source observation; housing_units is not necessarily approved or delivered units.'],
 renewal_projects:['Urban renewal projects','One renewal project.','Existing and planned units are distinct. Source status must be checked before treating a project as approved.'],
 infrastructure_projects:['Infrastructure','One ingested infrastructure project.','Source status and observed_at describe the evidence available; do not assume completion.'],
 demographic_snapshots:['Demographics','One demographic observation for a geographic area and year.','Join by geographic IDs and compare the same reporting year and area.'],
 neighborhoods:['Neighborhoods','One neighborhood.','Join city_id to cities.id. is_focus controls follow-up priority, not the research universe.'],
 cities:['Cities','One city.','Use city IDs for joins rather than free-text city names.'],
 parcels:['Parcels','One cadastral parcel.','Gush and parcel numbers identify land, not necessarily a single apartment.'],
 buildings:['Buildings','One resolved building.','Resolved identity may be incomplete; inspect source evidence.'],
 properties:['Properties','One resolved property.','Property IDs are resolved system entities; missing links do not prove missing source records.'],
 statistical_areas:['Statistical areas','One statistical geography.','Use geographic IDs and matching area definitions for demographic joins.'],
 streets:['Streets','One street.','Street names alone can repeat across cities; use city_id where available.'],
 research_assets:['Research assets','One normalized research asset from the research view.','Broader than followed areas; manual and system flags indicate follow-up.'],
 neighborhood_market_confidence:['Market confidence','One neighborhood quality aggregate.','Confidence is based on available comparable samples; inspect sample size and date coverage.'],
 listing_seller_signals:['Seller signals','One listing history aggregate.','Signals describe observed price changes and collection history, not verified seller intent.'],
};
const fields:Record<string,string>={price:'Asking price in NIS; monthly for rent, total for sale.',market:'sale or rent.',listing_id:'Source listing identifier; combine with market for Yad2 joins.',area_sqm:'Area in square meters.',rooms:'Room count; fractional values may occur.',amount_nis:'Recorded transaction amount in NIS.',asking_price_nis:'Sale asking price in NIS.',asking_rent_nis:'Monthly asking rent in NIS.',pp_sqm:'Amount divided by area; NIS/m².',normalized_pp_sqm:'Normalized transaction price/m²; inspect ownership_fraction.',ownership_fraction:'Reported share of ownership; NULL means unknown.',deal_date:'Transaction date, not ingestion date.',published_at:'Source publication value; may be missing or unverified.',first_seen_at:'First collection observation; not necessarily publication.',last_seen_at:'Last collection observation.',observed_at:'Time the record was observed.',_edge_payload:'Original source row as JSONB.',_edge_hash:'Unique payload observation hash.',_edge_source_key:'Source archive row identity; corrections can have multiple hashes.',_edge_loaded_at:'Time the observation was imported.',_edge_seen_at:'Time the observation was last seen.'};
async function catalog(){
 const columns=await queryDatabase(`SELECT c.table_name,c.column_name,c.data_type,c.is_nullable,col_description(pc.oid,c.ordinal_position::int) description FROM information_schema.columns c JOIN pg_class pc ON pc.relname=c.table_name JOIN pg_namespace pn ON pn.oid=pc.relnamespace AND pn.nspname=c.table_schema WHERE c.table_schema='public' ORDER BY c.table_name,c.ordinal_position`);
 let over:any[]=[];if(columns.some(c=>c.table_name==='over_datasets'))over=await queryDatabase('SELECT dataset_id,title,table_name,source_schema,date_column,min_record_year,row_count,status,last_success_at,last_error FROM over_datasets ORDER BY title');
 let semantics:any[]=[];if(columns.some(c=>c.table_name==='research_semantic_catalog'))semantics=await queryDatabase('SELECT view_name,definition FROM research_semantic_catalog');
 const datasets:any[]=[];
 for(const table of new Set<string>(columns.map(c=>c.table_name))){
  const semantic=semantics.find(x=>x.view_name===table)?.definition;const source=over.find(x=>x.table_name===table)|| (semantic ? over.find(x=>x.dataset_id===semantic.id):undefined);if(!definitions[table]&&!source&&!semantic)continue;
  const d=semantic?[semantic.title,semantic.grain,(semantic.caveats||[]).join(' ')]:definitions[table]||[source.title,'One distinct source payload observation.','Corrections can create multiple observations of the same source row. Original source values are text; use NULLIF before numeric casts.'];
  datasets.push({table,title:semantic ? `${semantic.title} · Semantic view` :source?.title||d[0],grain:d[1],notes:d[2],source:source?'OVER':table.startsWith('yad2')?'Yad2':'Edge',status:source?.status||'available',lastSuccessAt:source?.last_success_at,rowCount:source?.row_count,coverage:source?`Record-year cutoff: ${source.min_record_year}; date field: ${source.date_column||'not configured (reference data)'}.`:null,columns:columns.filter(c=>c.table_name===table).map(c=>({...c,meaning:c.description||semantic?.fields?.find((f:any)=>f.name===c.column_name)?.description||fields[c.column_name]||'Source field; business definition has not been verified.',verified:!!(c.description||semantic?.fields?.find((f:any)=>f.name===c.column_name)?.description||fields[c.column_name])&&!/unmapped|must be verified/i.test(c.description||'')})),examples:[`SELECT ${columns.filter(c=>c.table_name===table&&!['_source_payload','_edge_payload','geometry','geometry_wkt','geom'].includes(c.column_name)).map(c=>'"'+c.column_name.replaceAll('"','""')+'"').join(',')} FROM public."${table}" LIMIT 50`,...(table==='yad2_dataset'?[`SELECT market, city, count(*) AS listings, round(avg(price), 0) AS average_asking_price\nFROM yad2_dataset WHERE status = 'active'\nGROUP BY market, city ORDER BY listings DESC LIMIT 50`]:[])]});
 }
 return datasets.sort((a,b)=>a.title.localeCompare(b.title));
}
export default async function handler(req:VercelRequest,res:VercelResponse){
 res.setHeader('Cache-Control','no-store');
 if(!['GET','POST'].includes(req.method||''))return res.status(405).json({error:'Method not allowed.'});
 try{
  const datasets=await catalog();if(req.method==='GET')return res.json({datasets});
  const body=typeof req.body==='string'?JSON.parse(req.body):req.body;
  let canonical:string;try{canonical=validateResearchSql(body?.sql,datasets.map(d=>d.table));}catch(e:any){return res.status(400).json({error:e.message});}
  if(!process.env.DATABASE_URL)throw new Error('Database connection is not configured.');
  const client=neon(process.env.DATABASE_URL,{fullResults:true,arrayMode:true}),start=Date.now();
  const results:any=await client.transaction([
   client.query("SET LOCAL statement_timeout = '8000'"),client.query("SET LOCAL search_path = pg_catalog, public"),
   client.query(`SELECT * FROM (${canonical}) AS edge_result LIMIT 201`,[],{fullResults:true,arrayMode:true})
  ],{readOnly:true});
  const result=results[2];return res.json({columns:result.fields.map((f:any)=>({name:f.name,typeId:f.dataTypeID})),rows:result.rows.slice(0,200),rowCount:Math.min(result.rows.length,200),truncated:result.rows.length>200,elapsedMs:Date.now()-start,limit:200});
 }catch(e:any){const message=e?.code==='57014'?'Query timed out after 8 seconds. Add a filter or simplify the query.':e?.code==='42P01'?'A dataset is not yet initialized.':e?.code==='42703'?'Column not found. Check the dataset schema.':e?.code==='22P02'?'A value could not be converted. Use NULLIF or filter invalid values before casting.':'Query could not be completed. Check SQL syntax and dataset availability.';console.error('Data explorer',e?.code);return res.status(400).json({error:message});}
}
