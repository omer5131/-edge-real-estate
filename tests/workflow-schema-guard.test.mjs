import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {taskMigrationStatements} from '../scripts/workflow-migration-guard.mjs';
test('Reviewed additive DDL permits foreign-key ON DELETE but no mutation statement',async()=>{
 const ddl=await readFile(new URL('../db/032_deal_tasks.sql',import.meta.url),'utf8');assert.equal(taskMigrationStatements(ddl).length,2);
 for(const mutation of ['DELETE FROM deals','DROP TABLE deals','UPDATE deals SET status=\'closed\'','ALTER TABLE deals ADD COLUMN x text','TRUNCATE deals','SELECT 1'])assert.throws(()=>taskMigrationStatements(ddl+';'+mutation));
 assert.throws(()=>taskMigrationStatements(ddl.replace('CREATE TABLE IF NOT EXISTS deal_tasks','CREATE TABLE IF NOT EXISTS deals')));
});
