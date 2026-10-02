import type { VercelRequest, VercelResponse } from '@vercel/node';
import {researchCatalog,semanticDefinition,buildResearchQuery} from '../server/sources/researchSemantics.js';
import { queryDatabase,databaseTransaction } from '../server/db.js';
import { datasetTable, identifier, overJson } from '../server/sources/overApi.js';
import { ensureOverSchema, registerDataset, runOverDatasets } from '../server/sources/overDatasets.js';

export const config = { maxDuration: 300 };
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control','no-store');
  try {
    const authorized = !!process.env.CRON_SECRET && req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`;
    if(req.query.mode==='semantics') {
      const states=await queryDatabase('SELECT dataset_id,status,row_count,last_checked_at,last_success_at,last_error,enabled,cursor FROM over_datasets');
      const definitions=researchCatalog.filter(d=>!req.query.dataset||d.slug===req.query.dataset||d.id===req.query.dataset);
      return res.json({version:1,minimumObservationYear:2022,agentTools:[{name:'get_dataset_catalog',method:'GET',path:'/api/over-datasets?mode=semantics',description:'Discover datasets, fields, grain, joins, examples and live collection status.'},{name:'query_dataset',method:'POST',path:'/api/over-datasets?mode=query',input:{dataset:'semantic slug',columns:'optional field-name array',filters:'array of {field,op:eq|gte|lte|contains|in,value}',groupBy:'optional field-name array',metrics:'optional array of {op:count|sum|avg|min|max|median,field}',orderBy:'optional {field,direction:asc|desc}',limit:'1..200',offset:'0..100000'},description:'Read local semantic views with parameterized filters and optional aggregations.'}],datasets:definitions.map(d=>({...semanticDefinition(d),collection:states.find(s=>s.dataset_id===d.id)}))});
    }
    if(req.query.mode==='query'||(req.method==='POST'&&req.body?.action==='query')) {
      const input=req.method==='POST'?req.body:JSON.parse(typeof req.query.spec==='string'?req.query.spec:'{}');
      const name=req.query.dataset??input.dataset;
      const d=researchCatalog.find(d=>d.slug===name||d.id===name);
      if(!d)return res.status(404).json({error:'unknown_dataset'});
      const [state]=await queryDatabase('SELECT status,row_count,last_checked_at,last_success_at,last_error FROM over_datasets WHERE dataset_id=$1::uuid',[d.id]);
      if(d.adapter==='unavailable')return res.status(503).json({error:d.blockedReason,dataset:d.slug,collection:state});
      const statement=buildResearchQuery(d,input);
      const results=await databaseTransaction([{text:"SET LOCAL statement_timeout='8s'"},{text:statement.text,params:statement.params}]);
      const rows=results[1];
      return res.json({dataset:d.slug,rows,limit:statement.limit,offset:statement.offset,nextOffset:rows.length===statement.limit?statement.offset+rows.length:null,collection:state,grain:d.grain,caveats:d.caveats});
    }
    // Vercel cron uses authenticated GET; ordinary GET requests remain read-only.
    if (req.method === 'GET' && authorized && (!req.query.mode || req.query.mode === 'sync')) {
      const report = await runOverDatasets();
      return res.status(report.ok ? 200 : 502).json(report);
    }
    if (req.method === 'POST') {
      if (!process.env.CRON_SECRET || req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) return res.status(401).json({ error: 'unauthorized' });
      const { action, datasetId, sourceTable, filters, dateColumn } = req.body ?? {};
      if (action === 'sync') {
        const report = await runOverDatasets({ datasetId });
        return res.status(report.ok ? 200 : 502).json(report);
      }
      datasetTable(String(datasetId));
      await ensureOverSchema();
      if (action === 'register') return res.status(201).json(await registerDataset(datasetId,{ sourceTable,filters,dateColumn }));
      if (!['enable','disable'].includes(action)) return res.status(400).json({ error: 'unsupported_action' });
      const rows = await queryDatabase(`UPDATE over_datasets SET enabled=$2,status=CASE WHEN $2 THEN CASE WHEN cursor IS NULL AND watermark IS NOT NULL THEN 'healthy' ELSE 'pending' END ELSE 'disabled' END WHERE dataset_id=$1::uuid RETURNING dataset_id,status`,[datasetId,action === 'enable']);
      return res.status(rows.length ? 200 : 404).json({ dataset: rows[0] ?? null });
    }
    if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
    if (req.query.mode === 'catalog') {
      const offset = Math.max(0,Math.min(100000,Number(req.query.offset) || 0));
      return res.status(200).json(await overJson(`/api/v1/datasets?${new URLSearchParams({ limit: '500',offset: String(offset) })}`));
    }
    if (typeof req.query.datasetId === 'string') {
      const table = datasetTable(req.query.datasetId);
      const ds = await queryDatabase('SELECT * FROM over_datasets WHERE dataset_id=$1::uuid',[req.query.datasetId]);
      if (!ds.length) return res.status(404).json({ error: 'dataset_not_registered' });
      if (!ds[0].source_table) return res.status(200).json({ dataset: ds[0],rows: [],ready: false });
      const limit = Math.max(1,Math.min(100,Number(req.query.limit) || 50));
      const after = typeof req.query.after === 'string' ? req.query.after : '';
      const search = typeof req.query.q === 'string' ? req.query.q.slice(0,200) : '';
      const rows = await queryDatabase(`SELECT _edge_hash,_edge_payload,_edge_loaded_at FROM ${identifier(table)}
        WHERE _edge_hash>$1 AND ($2='' OR _edge_payload::text ILIKE '%'||$2||'%') ORDER BY _edge_hash LIMIT $3`,[after,search,limit]);
      return res.status(200).json({ dataset: ds[0],rows,next: rows.length === limit ? rows[rows.length-1]._edge_hash : null });
    }
    const [datasets,runs] = await Promise.all([
      queryDatabase(`SELECT *,CASE WHEN NOT enabled THEN 'disabled' WHEN last_checked_at IS NULL THEN 'never_run' WHEN status='failed' THEN 'failed' WHEN last_checked_at<now()-interval '48 hours' THEN 'stale' WHEN cursor IS NOT NULL THEN 'backfilling_or_syncing' ELSE 'healthy' END health FROM over_datasets ORDER BY title`),
      queryDatabase('SELECT * FROM over_sync_runs ORDER BY started_at DESC LIMIT 30')
    ]);
    return res.status(200).json({ ok: true,initialized: true,datasets,runs });
  } catch (error: any) {
    if (req.method === 'GET' && error?.code === '42P01') return res.status(200).json({ ok: true,initialized: false,datasets: [],runs: [],message: 'Tables initialize on the first authenticated sync or daily cron.' });
    return res.status(req.method === 'POST' || req.query.mode === 'query' ? 400 : 500).json({ ok: false,error: error?.message ?? String(error) });
  }
}
