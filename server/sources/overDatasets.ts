import { randomUUID } from 'node:crypto';
import { queryDatabase as query, databaseTransaction as transaction } from '../db.js';
import {researchSchemaStatements,researchCatalog} from './researchSemantics.js';
import {ingestResearchAdapter} from './researchAdapters.js';
import { overSchemaStatements } from './overSchema.js';
import { archiveQuery, archiveRows, datasetTable, filterClause, identifier, literal, overJson, payloadHash, recordYearClause, watermark, type ArchiveSchema, type ArchiveRow, type Watermark } from './overApi.js';

type Cursor = { phase: 'backfill' | 'daily' | 'reconcile'; upper: Watermark; after?: Watermark; lower?: Watermark; since?: string };
type Dataset = { dataset_id: string; table_name: string; source_table: string | null; source_schema: ArchiveSchema; filters: Record<string, unknown>; date_column?: string; min_record_year?: number; cursor: Cursor | null; watermark: Watermark | null; last_reconciled_at: string | null };
let initialization: Promise<unknown> | undefined;
export function ensureOverSchema(): Promise<unknown> {
  initialization ??= (async()=>{
    try {const ready=await query("SELECT version FROM research_schema_versions WHERE version='research-v1'");if(ready.length)return;}catch(error:any){if(error.code!=='42P01')throw error;}
    await transaction([...overSchemaStatements,...researchSchemaStatements()].map(text=>({text})));
  })().catch(error => { initialization = undefined; throw error; });
  return initialization;
}

async function prepareDataset(dataset: Dataset, deadline: number) {
  const id = dataset.dataset_id;
  // Cached schemas avoid repeating hundreds of DDL statements on every daily check.
  if(dataset.source_table && dataset.source_schema?.columns?.length) return dataset;
  const [schema, metadata] = await Promise.all([
    overJson(`/api/append/${id}/schema${dataset.source_table ? '?' + new URLSearchParams({ table: dataset.source_table }) : ''}`, deadline),
    overJson(`/api/v1/datasets/${id}`, deadline)
  ]);
  if (!schema.table || !Array.isArray(schema.columns)) throw new Error('Dataset has no queryable archive table');
  if (schema.multi_table && !dataset.source_table) throw new Error('Multi-resource dataset: select a source_table explicitly before enabling');
  if (schema.first_seen_column !== 'first_seen') throw new Error('Dataset does not expose the supported first_seen archive cursor');
  // Verify the hidden stable hash from the actual SQL response; /schema omits it.
  await archiveRows(id, archiveQuery(schema.table, { newest: true }), deadline);
  const columns = [...new Set<string>([...schema.columns, 'row_hash'])];
  if (columns.some(c => c.startsWith('_edge_'))) throw new Error('Source column conflicts with cache metadata or exceeds PostgreSQL identifier length');
  const table = identifier(datasetTable(id));
  const ddl = [
    `CREATE TABLE IF NOT EXISTS ${table} (
      _edge_hash text PRIMARY KEY, _edge_source_key text NOT NULL,
      _edge_payload jsonb NOT NULL, _edge_loaded_at timestamptz NOT NULL DEFAULT now(),
      _edge_seen_at timestamptz NOT NULL DEFAULT now()
    )`,
    ...columns.filter(c=>Buffer.byteLength(c)<=63).map(c => `ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${identifier(c)} text GENERATED ALWAYS AS (_edge_payload->>${literal(c)}) STORED`),
    `CREATE INDEX IF NOT EXISTS ${identifier(datasetTable(id) + '_source_key')} ON ${table}(_edge_source_key)`
  ];
  await transaction(ddl.map(text => ({ text })));
  await query(`UPDATE over_datasets SET title=$2,source_table=$3,source_schema=$4::jsonb,source_metadata=$5::jsonb WHERE dataset_id=$1::uuid`,
    [id, metadata.title ?? schema.dataset_title ?? id, schema.table, JSON.stringify(schema), JSON.stringify(metadata)]);
  return { ...dataset, source_table: schema.table, source_schema: schema } as Dataset;
}

export async function registerDataset(id: string, options: { sourceTable?: string; filters?: Record<string, unknown>; dateColumn?: string } = {}) {
  const table = datasetTable(id);
  await ensureOverSchema();
  const existing = await query('SELECT * FROM over_datasets WHERE dataset_id=$1::uuid', [id]);
  if (existing.length) throw new Error('Dataset is already registered; disable it before changing its coverage');
  const dataset = { dataset_id: id, table_name: table, source_table: options.sourceTable ?? null, source_schema: {} as ArchiveSchema, filters: options.filters ?? {}, cursor: null, watermark: null, last_reconciled_at: null };
  // Probe before creating registry rows, then build schema on the first run.
  const schema = await overJson(`/api/append/${id}/schema${options.sourceTable ? '?' + new URLSearchParams({ table: options.sourceTable }) : ''}`);
  filterClause(dataset.filters, schema.columns ?? []);
  recordYearClause(options.dateColumn,2022,schema.columns ?? []);
  if (schema.multi_table && !options.sourceTable) throw new Error('Select source_table for a multi-resource dataset');
  const metadata = await overJson(`/api/v1/datasets/${id}`);
  await query(`INSERT INTO over_datasets(dataset_id,title,table_name,source_table,filters,date_column) VALUES($1::uuid,$2,$3,$4,$5::jsonb,$6)`, [id, metadata.title ?? id, table, options.sourceTable ?? null, JSON.stringify(dataset.filters),options.dateColumn ?? null]);
  return { dataset_id: id, table_name: table, status: 'pending' };
}

// A page and its next cursor are committed together. If either write fails, both roll back.
export function pageWrite(dataset: Dataset, rows: ArchiveRow[], cursor: Cursor, runId: string) {
  const table = identifier(datasetTable(dataset.dataset_id));
  const input = rows.map(row => ({ hash: payloadHash(row), key: row.row_hash, payload: row }));
  return { text: `WITH inserted AS (
      INSERT INTO ${table}(_edge_hash,_edge_source_key,_edge_payload)
      SELECT value->>'hash',value->>'key',value->'payload' FROM jsonb_array_elements($1::jsonb)
      ON CONFLICT(_edge_hash) DO NOTHING RETURNING 1
    ), checkpoint AS (
      UPDATE over_datasets SET cursor=$2::jsonb,status=$3,last_checked_at=now(),last_error=NULL,
        row_count=row_count+(SELECT count(*) FROM inserted) WHERE dataset_id=$4::uuid RETURNING dataset_id
    ), run_checkpoint AS (
      UPDATE over_sync_runs SET fetched_count=fetched_count+$5,
        inserted_count=inserted_count+(SELECT count(*) FROM inserted),checkpoint=$2::jsonb
      WHERE id=$6::uuid RETURNING id
    ) SELECT count(*)::int inserted FROM inserted`,
    params: [JSON.stringify(input),JSON.stringify(cursor),cursor.phase === 'backfill' ? 'backfilling' : 'syncing',dataset.dataset_id,rows.length,runId] }; 
}

export function boundedRowBatches(rows:ArchiveRow[],maxBytes=2000000):ArchiveRow[][] {
  const batches:ArchiveRow[][]=[];let batch:ArchiveRow[]=[],bytes=0;
  for(const row of rows){const size=Buffer.byteLength(JSON.stringify(row));if(batch.length && bytes+size>maxBytes){batches.push(batch);batch=[];bytes=0;}batch.push(row);bytes+=size;}
  if(batch.length)batches.push(batch);return batches;
}

export async function savePage(dataset: Dataset, rows: ArchiveRow[], cursor: Cursor, runId: string): Promise<number> {
  const statement = pageWrite(dataset,rows,cursor,runId);
  const results = await query(statement.text,statement.params);
  return Number(results[0].inserted);
}

async function ingestDataset(dataset: Dataset, deadline: number, maxPages: number) {
  const runs = await query('INSERT INTO over_sync_runs(dataset_id) VALUES($1::uuid) RETURNING id', [dataset.dataset_id]);
  const runId = String(runs[0].id);
  let fetched = 0, inserted = 0;
  try {
    const definition=researchCatalog.find(d=>d.id===dataset.dataset_id);
    if(definition && definition.adapter!=='archive')return await ingestResearchAdapter(definition,dataset,runId,deadline,maxPages);
    const d = await prepareDataset(dataset, deadline);
    const filters = [filterClause(d.filters, d.source_schema.columns),recordYearClause(d.date_column,d.min_record_year ?? 2022,d.source_schema.columns)].filter(Boolean).join(' AND ');
    let cursor = d.cursor;
    if (!cursor) {
      const newest = await archiveRows(d.dataset_id, archiveQuery(d.source_table!, { filters, newest: true }), deadline);
      if (!newest.length) {
        await transaction([
          { text: `UPDATE over_datasets SET status='healthy',last_success_at=now(),last_checked_at=now(),last_error=NULL WHERE dataset_id=$1::uuid`, params: [d.dataset_id] },
          { text: `UPDATE over_sync_runs SET status='success',finished_at=now() WHERE id=$1::uuid`, params: [runId] }
        ]);
        return { datasetId: d.dataset_id, fetched, inserted, complete: true, empty: true };
      }
      const reconcile = d.watermark && (!d.last_reconciled_at || Date.parse(d.last_reconciled_at) < Date.now() - 7 * 86400000);
      const phase: Cursor['phase'] = !d.watermark ? 'backfill' : reconcile ? 'reconcile' : 'daily';
      cursor = { phase, upper: watermark(newest[0]) };
      if (phase === 'daily') { cursor.lower = d.watermark!; cursor.since = new Date(Date.now() - 7 * 86400000).toISOString(); }
      // Persist the upper bound before fetching so retries keep the same range.
      await query(`UPDATE over_datasets SET cursor=$2::jsonb,status=$3,last_checked_at=now() WHERE dataset_id=$1::uuid`, [d.dataset_id, JSON.stringify(cursor), phase === 'backfill' ? 'backfilling' : 'syncing']);
    }
    for (let page = 0; page < maxPages && Date.now() < deadline - 10000; page++) {
      const geometry=d.source_schema.columns.includes('geometry_wkt');
      const rows = await archiveRows(d.dataset_id, archiveQuery(d.source_table!, { columns:d.source_schema.columns.filter(c=>c!=='geom'),filters, ...cursor, limit: geometry?100:1000 }), deadline - 5000);
      if (!rows.length) {
        // Exhaustion, rather than a short response, signals completion: OVER may cap SQL responses.
        await transaction([
          { text: `UPDATE over_datasets SET cursor=NULL,watermark=$2::jsonb,status='healthy',last_checked_at=now(),last_success_at=now(),last_error=NULL,
            last_reconciled_at=CASE WHEN $3 IN ('backfill','reconcile') THEN now() ELSE last_reconciled_at END WHERE dataset_id=$1::uuid`, params: [d.dataset_id, JSON.stringify(cursor.upper), cursor.phase] },
          { text: `UPDATE over_sync_runs SET status='success',finished_at=now() WHERE id=$1::uuid`, params: [runId] }
        ]);
        return { datasetId: d.dataset_id, phase: cursor.phase, fetched, inserted, complete: true };
      }
      for(const batch of boundedRowBatches(rows)) {
        const next:Cursor={...cursor,after:watermark(batch[batch.length-1])};
        if(cursor.after && next.after!.seen===cursor.after.seen && next.after!.hash===cursor.after.hash)throw new Error('Archive cursor did not advance');
        inserted+=await savePage(d,batch,next,runId);fetched+=batch.length;cursor=next;
        if(Date.now()>deadline-3000)break;
      }
      const end=watermark(rows[rows.length-1]);
      if(cursor.after?.seen!==end.seen || cursor.after?.hash!==end.hash)break;
    }
    await query(`UPDATE over_sync_runs SET status='checkpointed',finished_at=now() WHERE id=$1::uuid`, [runId]);
    return { datasetId: d.dataset_id, phase: cursor.phase, fetched, inserted, complete: false };
  } catch (error: any) {
    const message = String(error?.message ?? error).slice(0,2000);
    await transaction([
      { text: `UPDATE over_datasets SET status='failed',last_checked_at=now(),last_error=$2 WHERE dataset_id=$1::uuid`, params: [dataset.dataset_id,message] },
      { text: `UPDATE over_sync_runs SET status='failed',finished_at=now(),error=$2 WHERE id=$1::uuid`, params: [runId,message] }
    ]);
    return { datasetId: dataset.dataset_id, fetched, inserted, complete: false, error: message };
  }
}

export async function runOverDatasets(options: { datasetId?: string; budgetMs?: number; maxPages?: number } = {}) {
  await ensureOverSchema();
  if (options.datasetId) datasetTable(options.datasetId);
  const owner = randomUUID();
  const lease = await query(`INSERT INTO over_sync_lock(name,owner,expires_at) VALUES('daily',$1::uuid,now()+interval '10 minutes')
    ON CONFLICT(name) DO UPDATE SET owner=EXCLUDED.owner,expires_at=EXCLUDED.expires_at
    WHERE over_sync_lock.expires_at<now() RETURNING owner`, [owner]);
  if (!lease.length) return { ok: true, skipped: true, reason: 'A dataset import is already running', datasets: [] };
  const deadline = Date.now() + Math.max(15000,Math.min(240000,options.budgetMs ?? 230000));
  try {
    const datasets = await query(`SELECT * FROM over_datasets WHERE enabled AND ($1::uuid IS NULL OR dataset_id=$1::uuid)
      ORDER BY last_checked_at NULLS FIRST,created_at,dataset_id`, [options.datasetId ?? null]);
    const results: any[] = [];
    // Three bounded workers keep every small dataset eligible each day, while checkpoints
    // limit large imports. A failure in one dataset cannot stop the other workers.
    let index=0;
    const worker=async()=>{while(index<datasets.length && Date.now()<deadline-15000){
      const dataset=datasets[index++];
      const slice=Math.min(deadline,Date.now()+60000);
      results.push(await ingestDataset(dataset as Dataset,slice,Math.max(1,Math.min(100,options.maxPages??60))));
    }};
    await Promise.all(Array.from({length:Math.min(3,datasets.length)},worker));
    return { ok: results.every(r=>!r.error), pending: results.some(r=>!r.complete) || results.length<datasets.length, datasets: results };
  } finally {
    await query('DELETE FROM over_sync_lock WHERE name=$1 AND owner=$2::uuid', ['daily',owner]);
  }
}
