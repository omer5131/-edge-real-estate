import fs from 'node:fs';
import { neon } from '@neondatabase/serverless';
if (!process.env.DATABASE_URL) {
  console.log('OVER migration skipped: DATABASE_URL is not set in this environment.');
} else {
  const sql = neon(process.env.DATABASE_URL);
  const text = fs.readFileSync(new URL('../db/010_over_datasets.sql',import.meta.url),'utf8');
  const statements = text.split('\n').filter(line=>!line.trimStart().startsWith('--')).join('\n').split(';').map(s=>s.trim()).filter(Boolean);
  await sql.transaction(statements.map(s=>sql.query(s)));
  console.log('OVER dataset registry, ingestion checkpoints, and initial dataset tables are ready.');
  const pending = await sql.query('SELECT count(*)::int count FROM over_datasets WHERE enabled AND last_checked_at IS NULL');
  if (pending[0].count > 0) {
    // Populate a small first batch only once. Runtime cron owns sustained ingestion.
    try {
      const { runOverDatasets } = await import('../.server-build/server/sources/overDatasets.js');
      console.log('OVER first import:',JSON.stringify(await runOverDatasets({ budgetMs: 60000,maxPages: 2 })));
    } catch (error) { console.log('OVER initial import deferred to daily sync:',error.message); }
  }
}
