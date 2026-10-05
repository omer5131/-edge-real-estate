import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {addressRelation,projectEvidence} from '../.server-test/server/renewalProfiles.js';
const seed=JSON.parse(fs.readFileSync('server/research/renewal-saadia-gaon.json','utf8'));
test('exact address membership never expands a street range or defaults to exclusion',()=>{
 const addresses=[{street_name:'סעדיה גאון',house_number:'1',membership:'verified'},{street_name:'סעדיה גאון',house_number:'8',membership:'unverified'}];
 assert.equal(addressRelation('סעדיה   גאון 1',addresses),'verified');
 assert.equal(addressRelation('סעדיה גאון 8',addresses),'unverified');
 assert.equal(addressRelation('סעדיה גאון 10',addresses),'unverified');
 assert.equal(addressRelation('סעדיה גאון',addresses),'unverified');
 assert.equal(addressRelation('סעדיה גאון 18',addresses),'unverified');
});
test('developer claims and conflicts stay provisional; missing evidence is unknown',()=>{
 assert.equal(projectEvidence(seed.facts,[]).status,'provisional');
 assert.equal(projectEvidence([{source_url:'https://example.com',evidence_status:'reported'}],[]).status,'provisional');
 assert.equal(projectEvidence([],[]).status,'insufficient_evidence');
 assert.equal(projectEvidence([],[]).confidence,null);
});
test('research keeps Oron forecast separate from old infill approval',()=>{
 assert.equal(seed.project.project_type,'pinui_binui');
 assert.equal(seed.facts.find(f=>f.fact_key==='planned_units').value,536);
 assert(seed.facts.find(f=>f.fact_key==='permit_forecast').value.includes('תחזית יזם'));
 assert(seed.project.gaps.some(x=>x.includes('סעדיה גאון 8')));
 for(const f of seed.facts){assert(f.source_url.startsWith('https://'));assert(f.source_title);assert(f.locator);}
});
test('additive schema is idempotent and rejects unsupported membership/status',async()=>{
 const db=new PGlite();await db.exec('CREATE TABLE renewal_projects(id uuid PRIMARY KEY,city_id uuid,neighborhood_id uuid,project_name text,plan_number text,route text,status text,source_id text,source_url text,observed_at timestamptz);');
 const migration=fs.readFileSync('db/031_renewal_project_profiles.sql','utf8');await db.exec(migration);await db.exec(migration);
 const id='11111111-1111-1111-1111-111111111111';await db.query('INSERT INTO renewal_projects(id) VALUES($1)',[id]);
 await assert.rejects(db.query("INSERT INTO renewal_project_addresses(project_id,street_name,house_number,membership,source_url) VALUES($1,'street','8','assumed','https://example.com')",[id]));
 await db.query("INSERT INTO renewal_project_addresses(project_id,street_name,house_number,membership,source_url) VALUES($1,'street','8','unverified','https://example.com')",[id]);
 assert.equal((await db.query('SELECT verified_address_count FROM semantic_renewal_project_profiles')).rows[0].verified_address_count,0);
 await db.close();
});

test('profile market joins use exact city/address and retain uncertain membership',async()=>{
 const {getRenewalProfile}=await import('../.server-test/server/renewalProfiles.js');
 const db=new PGlite();
 await db.exec(`
 CREATE FUNCTION ST_AsGeoJSON(jsonb) RETURNS text LANGUAGE sql AS 'SELECT $1::text';
 CREATE TABLE cities(id uuid PRIMARY KEY,name_he text);
 CREATE TABLE neighborhoods(id uuid PRIMARY KEY,name_he text);
 CREATE TABLE renewal_projects(id uuid PRIMARY KEY,city_id uuid,neighborhood_id uuid,project_name text,plan_number text,route text,status text,source_id text,source_url text,observed_at timestamptz,geom jsonb);
 CREATE TABLE parcels(id uuid PRIMARY KEY,gush integer,helka integer);
 CREATE TABLE renewal_project_parcels(project_id uuid,parcel_id uuid);
 CREATE TABLE listings(id uuid,city_id uuid,canonical_address text,status text,url text,source_id text,last_seen_at timestamptz);
 CREATE TABLE listing_snapshots(id bigint,listing_id uuid,observed_at timestamptz,asking_price_nis numeric,area_sqm numeric,rooms numeric,floor numeric);
 CREATE TABLE transactions(id uuid,city_id uuid,parcel_id uuid,address_text text,deal_date date,amount_nis numeric,area_sqm numeric,rooms numeric,floor numeric,source_id text,ownership_fraction numeric,is_comparable boolean);
 `);
 await db.exec(fs.readFileSync('db/031_renewal_project_profiles.sql','utf8'));
 const project='11111111-1111-1111-1111-111111111111',city='22222222-2222-2222-2222-222222222222',other='33333333-3333-3333-3333-333333333333',listing='44444444-4444-4444-4444-444444444444',foreign='55555555-5555-5555-5555-555555555555';
 await db.query("INSERT INTO renewal_projects(id,city_id) VALUES($1,$2)",[project,city]);
 await db.query("INSERT INTO renewal_project_addresses(project_id,street_name,house_number,membership,source_url) VALUES($1,'סעדיה גאון','8','unverified','https://example.com')",[project]);
 await db.query("INSERT INTO listings(id,city_id,canonical_address,last_seen_at) VALUES($1,$2,'סעדיה גאון 8',now()),($3,$4,'סעדיה גאון 8',now())",[listing,city,foreign,other]);
 await db.query("INSERT INTO transactions(id,city_id,address_text,deal_date,amount_nis) VALUES($1,$2,'סעדיה גאון 8','2026-01-01',1000000),($3,$4,'סעדיה גאון 8','2026-01-01',2000000)",[listing,city,foreign,other]);
 const profile=await getRenewalProfile(project,async(statement,params)=>(await db.query(statement,params)).rows);
 assert.equal(profile.listings.length,1);assert.equal(profile.listings[0].id,listing);assert.equal(profile.listings[0].membership,'unverified');
 assert.equal(profile.transactions.length,1);assert.equal(profile.transactions[0].price,1000000);assert.equal(profile.transactions[0].membership,'unverified');
 assert.equal(await getRenewalProfile(other,async(s,p)=>(await db.query(s,p)).rows),null);
 await db.close();
});

test('attributed research cannot become official neighborhood scoring evidence',async()=>{
 const {buildPlanningContext}=await import('../.server-test/server/planningContext.js');
 const context=buildPlanningContext([{source_id:'renewal_research'}],[],[]);
 assert.equal(context.evidence.status,'provisional');assert.equal(context.evidence.confidence,null);
});
