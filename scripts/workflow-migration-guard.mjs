import assert from 'node:assert/strict';
// ON DELETE is a foreign-key policy in additive DDL, not a DELETE statement.
// Permit only the two reviewed CREATE statements, never standalone mutations.
export function taskMigrationStatements(migration){
 const statements=migration.replace(/--[^\n]*|\/\*[\s\S]*?\*\//g,'').split(';').map(s=>s.trim()).filter(Boolean);
 assert.equal(statements.length,2,'Expected only task table and task index DDL');
 assert.match(statements[0],/^CREATE TABLE IF NOT EXISTS deal_tasks\s*\(/i,'Only additive task table DDL is accepted');
 assert.match(statements[1],/^CREATE INDEX IF NOT EXISTS deal_tasks_deal_idx\s+ON deal_tasks\s*\(deal_id,status,due_date\)$/i,'Only reviewed task index DDL is accepted');
 return statements;
}
