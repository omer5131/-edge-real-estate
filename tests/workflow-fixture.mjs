import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {createWorkflowService} from '../.server-test/server/dealWorkflow.js';
export const listingId='22222222-2222-2222-2222-222222222222',otherListingId='33333333-3333-3333-3333-333333333333';
export const assumptions={purchasePriceNis:1000000,purchaseTaxNis:25000,legalFeesNis:15000,brokerFeesNis:12000,appraisalFeesNis:2500,renovationNis:50000,furnishingNis:10000,otherAcquisitionNis:20000,loanAmountNis:0,annualInterestRatePct:4.5,loanTermYears:25,expectedMonthlyRentNis:4500,vacancyPct:5,annualMaintenanceNis:6000,annualOtherOperatingNis:2400,exitYears:5,annualAppreciationPct:2.5,exitPriceNis:null,saleCostsPct:1.5,saleTaxNis:50000,targetAnnualReturnPct:8,evidence:{notes:'נתוני בדיקה בלבד',sourceUrl:'https://example.com/evidence',observedAt:'2026-10-05'}};
export async function workflowFixture(){
 const db=new PGlite();
 await db.exec(`CREATE TABLE properties(id uuid PRIMARY KEY);CREATE TABLE buildings(id uuid PRIMARY KEY);CREATE TABLE cities(id uuid PRIMARY KEY,name_he text);CREATE TABLE neighborhoods(id uuid PRIMARY KEY,name_he text);
 CREATE TABLE listings(id uuid PRIMARY KEY,property_id uuid REFERENCES properties(id),neighborhood_id uuid REFERENCES neighborhoods(id),city_id uuid REFERENCES cities(id),canonical_address text,url text);
 CREATE TABLE listing_snapshots(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),listing_id uuid REFERENCES listings(id),observed_at timestamptz NOT NULL,asking_price_nis numeric,area_sqm numeric,rooms numeric,floor numeric);
 CREATE TABLE deals(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),property_id uuid REFERENCES properties(id),listing_id uuid REFERENCES listings(id),stage text NOT NULL DEFAULT 'Lead',status text NOT NULL DEFAULT 'open',asking_price_nis numeric,offer_price_nis numeric,last_activity_at timestamptz NOT NULL DEFAULT now(),next_action text,contact jsonb NOT NULL DEFAULT '{}',notes text,due_diligence jsonb NOT NULL DEFAULT '{}',documents jsonb NOT NULL DEFAULT '[]',created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());`);
 for(const file of ['028_deal_workflow_normalization.sql','032_deal_tasks.sql']){const sql=await readFile(new URL('../db/'+file,import.meta.url),'utf8');await db.exec(sql);await db.exec(sql);}
 for(const [id,address,price] of [[listingId,'נכס בדיקה א',1000000],[otherListingId,'נכס בדיקה ב',1250000]]){await db.query('insert into listings(id,canonical_address,url) values($1,$2,$3)',[id,address,'https://example.com/listing/'+id]);await db.query("insert into listing_snapshots(listing_id,observed_at,asking_price_nis,area_sqm,rooms,floor) values($1,'2026-10-05', $2,85,4,3)",[id,price]);}
 const store={queryDatabase:async(text,params=[])=> (await db.query(text,params)).rows,databaseTransaction:async statements=>db.transaction(async tx=>{const results=[];for(const q of statements)results.push((await tx.query(q.text,q.params??[])).rows);return results;})};
 return {db,store,service:createWorkflowService(store)};
}
