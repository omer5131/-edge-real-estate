import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {overSchemaStatements} from '../.server-test/server/sources/overSchema.js';
import {researchCatalog,researchSchemaStatements,buildResearchQuery,semanticView} from '../.server-test/server/sources/researchSemantics.js';
import {boiRows,featureRows,parseCsv} from '../.server-test/server/sources/researchAdapters.js';
import {boundedRowBatches} from '../.server-test/server/sources/overDatasets.js';
import {datasetTable} from '../.server-test/server/sources/overApi.js';
test('all dataset tables and typed semantic views migrate idempotently; corrections preserve history',async()=>{
 const db=new PGlite();try{
 for(const s of [...overSchemaStatements,...researchSchemaStatements()])await db.exec(s);
 for(const s of researchSchemaStatements())await db.exec(s);
 assert.equal((await db.query('SELECT count(*)::int n FROM research_semantic_catalog')).rows[0].n,researchCatalog.length);
 const d=researchCatalog.find(d=>d.slug==='municipal_wages'),table=datasetTable(d.id);
 for(const [hash,payload] of [['a',{'רשות':'חיפה','שנה':'2022','שכר ממוצע':'10,000',first_seen:'2026-01-01'}],['b',{'רשות':'חיפה','שנה':'2022','שכר ממוצע':'12,000',first_seen:'2026-02-01'}],['c',{'רשות':'נתניה','שנה':'2023','שכר ממוצע':'',first_seen:'2026-02-01'}]])await db.query(`INSERT INTO ${table}(_edge_hash,_edge_source_key,_edge_payload) VALUES($1,$1,$2::jsonb)`,[hash,JSON.stringify(payload)]);
 const q=buildResearchQuery(d,{filters:[{field:'municipality',value:'חיפה'}],columns:['municipality','observation_year','average_wage']});
 const rows=(await db.query(q.text,q.params)).rows;assert.equal(rows.length,1);assert.equal(Number(rows[0].average_wage),12000);assert.equal((await db.query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n,3);
 const result=(await db.query(`SELECT average_wage FROM ${semanticView(d)} WHERE municipality='נתניה'`)).rows;assert.equal(result[0].average_wage,null);
 }finally{await db.close()}
});
test('query builder parameterizes values, rejects SQL identifiers/operators and invalid metrics',()=>{
 const d=researchCatalog.find(d=>d.slug==='municipal_wages');
 const q=buildResearchQuery(d,{filters:[{field:'municipality',value:"x';DROP TABLE t;--"}],groupBy:['observation_year'],metrics:[{op:'avg',field:'average_wage'}]});assert(!q.text.includes('DROP'));assert.equal(q.params[0],"x';DROP TABLE t;--");
 for(const spec of [{columns:['x;DROP']},{filters:[{field:'municipality',op:'sql',value:1}]},{metrics:[{op:'sum',field:'municipality'}]},{limit:1.5}])assert.throws(()=>buildResearchQuery(d,spec));
});
test('SDMX CSV preserves metadata, periods and revisions and excludes pre-2022',()=>{
 const csv='SERIES_CODE,TIME_PERIOD,OBS_VALUE,UNIT_MEASURE\nA,2021-12,4,PT\nA,2022-01,5,PT\n';const r=boiRows(csv);assert.equal(r.length,1);assert.equal(r[0].attributes.UNIT_MEASURE,'PT');assert.equal(r[0].observation_period,'2022-01');assert.equal(r[0].row_hash,'A:2022-01');assert.deepEqual(parseCsv('a,b\n"x,y","hello""there"\n'),[{a:'x,y',b:'hello"there'}]);assert.throws(()=>parseCsv('a\n"oops'));
});
test('GIS feature payload hashes are stable and geometry is retained',()=>{
 const f={properties:{_row_hash:'key',_first_seen:'2026-01-01',name:'A'},geometry:{type:'Point',coordinates:[35,32]}};const a=featureRows([f])[0],b=featureRows([f])[0];assert.deepEqual(a,b);assert.equal(a.geometry.type,'Point');assert.equal(a.row_hash,'key');
});

test('large geometry writes are split without dropping or reordering records',()=>{const rows=Array.from({length:10},(_,i)=>({first_seen:'2026-01-01',row_hash:String(i),geometry_wkt:'x'.repeat(800000)}));const batches=boundedRowBatches(rows);assert.equal(batches.flat().length,10);assert.deepEqual(batches.flat().map(r=>r.row_hash),rows.map(r=>r.row_hash));assert(batches.every(b=>Buffer.byteLength(JSON.stringify(b))<2100000));});
