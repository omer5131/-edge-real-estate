// Runs the deployed bounded importer repeatedly; credentials stay in environment variables.
const base = process.env.EDGE_BASE_URL ?? 'https://edge-real-estate.vercel.app';
const secret = process.env.CRON_SECRET;
if (!secret) throw new Error('Set CRON_SECRET in your environment before starting the backfill');
const maxRuns = Number(process.env.EDGE_BACKFILL_MAX_RUNS ?? 1000);
const datasetId = process.env.OVER_DATASET_ID;
for (let i=0; i<maxRuns; i++) {
  const response = await fetch(new URL('/api/over-datasets',base), {
    method: 'POST', headers: { Authorization: `Bearer ${secret}`,'Content-Type':'application/json' },
    body: JSON.stringify({ action: 'sync',datasetId }),signal: AbortSignal.timeout(310000)
  });
  const report = await response.json();
  console.log(JSON.stringify({ run: i+1, ...report }));
  if (!response.ok || !report.ok) throw new Error(`Import failed (${response.status}); saved checkpoints are retained`);
  if (report.skipped) throw new Error('Another import holds the lease; retry after it finishes');
  if (!report.pending) { console.log('Backfill and reconciliation complete. Daily cron will maintain these datasets.'); process.exit(0); }
  await new Promise(resolve=>setTimeout(resolve,1000));
}
throw new Error('Run limit reached; rerun this command to continue from the saved checkpoint');
