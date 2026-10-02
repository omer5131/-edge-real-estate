import test from 'node:test';
import assert from 'node:assert/strict';
import {validateResearchSql} from '../.server-test/server/researchSql.js';
const tables=['yad2_dataset','yad2_listing_changes'];
test('accepts joins, CTEs, filters and aggregations',()=>{
 for(const q of ["SELECT market, count(*) FROM yad2_dataset GROUP BY market", "WITH active AS (SELECT * FROM yad2_dataset WHERE status='active') SELECT * FROM active",'SELECT d.city,c.event FROM yad2_dataset d JOIN yad2_listing_changes c ON c.market=d.market AND c.listing_id=d.listing_id',"SELECT NULLIF(price::text, '')::numeric FROM yad2_dataset",'SELECT * FROM yad2_dataset WHERE false'])assert.ok(validateResearchSql(q,tables));
});
test('rejects mutations, hidden CTE writes and multiple statements',()=>{
 for(const q of ['DELETE FROM yad2_dataset','SELECT * FROM yad2_dataset; DELETE FROM yad2_dataset','WITH x AS (DELETE FROM yad2_dataset RETURNING *) SELECT * FROM x','SELECT * INTO temp_copy FROM yad2_dataset','SELECT * FROM yad2_dataset FOR UPDATE'])assert.throws(()=>validateResearchSql(q,tables));
});
test('rejects private tables, system tables, side-effecting functions and unsafe casts',()=>{
 for(const q of ['SELECT * FROM manual_run_tokens','SELECT * FROM pg_catalog.pg_authid','SELECT pg_sleep(10)','SELECT pg_catalog.count(*) FROM yad2_dataset',"SELECT set_config('statement_timeout','0',true)",'SELECT * FROM generate_series(1,100000)','SELECT price::regclass FROM yad2_dataset','SELECT * FROM yad2_dataset UNION SELECT * FROM manual_run_tokens','WITH secret AS (SELECT * FROM manual_run_tokens) SELECT * FROM secret'])assert.throws(()=>validateResearchSql(q,tables),q);
});
test('canonicalization handles semicolons and comments without concatenation bypass',()=>{
 assert.ok(validateResearchSql("SELECT '; DROP TABLE yad2_dataset' AS text -- harmless comment\n;",tables));
 assert.throws(()=>validateResearchSql('SELECT 1; /* comment */ SELECT 2',tables));
});
