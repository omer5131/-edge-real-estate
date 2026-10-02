import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { archiveQuery, datasetTable, filterClause, identifier, literal, payloadHash, recordYearClause, watermark, overJson } from '../.server-test/server/sources/overApi.js';
import { overSchemaStatements } from '../.server-test/server/sources/overSchema.js';
import { pageWrite } from '../.server-test/server/sources/overDatasets.js';

const id='fd06f5ae-8a4f-4120-b275-8a514ad23499';
const cursor={phase:'backfill',upper:{seen:'2026-10-02T01:00:00Z',hash:'z'},after:{seen:'2026-10-01T01:00:00Z',hash:'b'}};
const row={first_seen:'2026-10-01T01:00:00Z',row_hash:'b',deal_date:'01/01/2022',settlement:'חיפה',deal_amount:'1000000'};

test('SQL identifiers and literals cannot escape their quoted value',()=>{
  assert.equal(identifier('a"; DROP TABLE cities; --'),'"a""; DROP TABLE cities; --"');
  assert.equal(literal("O'Brien"),"'O''Brien'");
  assert.throws(()=>literal('a\\b'));
  assert.throws(()=>datasetTable('abc; DROP TABLE'));
  assert.throws(()=>filterClause({password:'anything'},['settlement']));
  assert.equal(filterClause({settlement:['חיפה','נתניה']},['settlement']), '"settlement" IN (\'חיפה\',\'נתניה\')');
});
test('keyset includes both timestamp and hash so ties do not lose records',()=>{
  const query=archiveQuery('archive',{after:cursor.after,upper:cursor.upper});
  assert.match(query,/\("first_seen", "row_hash"\) >/);
  assert.match(query,/\("first_seen", "row_hash"\) <=/);
  assert.doesNotMatch(query,/OFFSET/);
  assert.throws(()=>watermark({first_seen:'bad',row_hash:'b'}));
});
test('daily overlap also includes everything beyond the last watermark',()=>{
  const query=archiveQuery('archive',{lower:cursor.after,since:'2026-09-25T00:00:00Z',upper:cursor.upper});
  assert.match(query,/ OR "first_seen" >=/);
});
test('hash ignores JSON key ordering and captures corrections',()=>{
  assert.equal(payloadHash({a:1,b:2}),payloadHash({b:2,a:1}));
  assert.notEqual(payloadHash(row),payloadHash({...row,deal_amount:'1100000'}));
});
test('nonretryable errors do not trigger repeated source requests',async()=>{
  const original=globalThis.fetch;let calls=0;
  globalThis.fetch=async()=>{calls++;return new Response('{}',{status:409})};
  try{await assert.rejects(overJson('/api/append/test/schema'),/409/);assert.equal(calls,1)}finally{globalThis.fetch=original}
});
test('migration, cutoff, deduplication and checkpoint rollback work in PostgreSQL',async()=>{
  const db=new PGlite();
  try {
    await db.exec(overSchemaStatements.join(';\n'));
    await db.exec(overSchemaStatements.join(';\n')); // deployment + runtime initializer are idempotent
    const filters=recordYearClause('deal_date',2022,['deal_date']);
    await db.exec('CREATE TABLE source_test(deal_date text,first_seen timestamptz,row_hash text)');
    for(const [i,date] of ['31/12/2021','01/01/2022','2023-09-30','unknown','2022'].entries())await db.query('INSERT INTO source_test VALUES($1,now(),$2)',[date,String(i)]);
    const recent=await db.query(archiveQuery('source_test',{filters}));
    assert.deepEqual(recent.rows.map(r=>r.deal_date),['01/01/2022','2023-09-30','2022']);
    assert.throws(()=>recordYearClause('wrong',2022,['deal_date']));
    const run=(await db.query('INSERT INTO over_sync_runs(dataset_id) VALUES($1::uuid) RETURNING id',[id])).rows[0].id;
    const ds={dataset_id:id};
    async function save(rows,next=cursor){const q=pageWrite(ds,rows,next,run);return (await db.query(q.text,q.params)).rows[0].inserted}
    assert.equal(await save([row]),1);
    assert.equal(await save([row]),0);
    assert.equal(await save([{...row,deal_amount:'1100000'}]),1);
    const table=datasetTable(id);
    let state=(await db.query('SELECT row_count,cursor FROM over_datasets WHERE dataset_id=$1::uuid',[id])).rows[0];
    assert.equal(Number(state.row_count),2);
    assert.deepEqual(state.cursor,cursor);
    assert.equal((await db.query(`SELECT settlement,deal_date FROM ${table}`)).rows[0].settlement,'חיפה');
    // Force a failure in the checkpoint update and prove the inserted page is rolled back.
    await db.exec('ALTER TABLE over_sync_runs ADD CONSTRAINT test_max_fetched CHECK(fetched_count < 4)');
    await assert.rejects(save([{...row,row_hash:'c'}],{...cursor,after:{...cursor.after,hash:'c'}}));
    assert.equal(Number((await db.query(`SELECT count(*) FROM ${table}`)).rows[0].count),2);
    state=(await db.query('SELECT row_count,cursor FROM over_datasets WHERE dataset_id=$1::uuid',[id])).rows[0];
    assert.equal(Number(state.row_count),2);assert.deepEqual(state.cursor,cursor);
  } finally { await db.close(); }
});
