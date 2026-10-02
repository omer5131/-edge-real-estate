# OVER dataset ingestion

Edge caches government datasets in independent PostgreSQL tables. The first two are national real-estate transactions and Haifa street/statistical-area mappings. Transaction coverage begins **1 January 2022**, using the original `deal_date`; collection dates do not determine this cutoff. Undated reference mappings remain available. More queryable archives can be registered from `/datasets.html` using their OVER dataset UUID, an optional source resource table, and an optional record date/year column. Records with missing/unrecognized dates are excluded when a date cutoff is configured.

## Daily workflow

`/api/over-datasets` runs daily at **02:45 UTC** using Vercel cron. The existing collector still runs at 02:15 UTC. Both use the existing `DATABASE_URL` and `CRON_SECRET` environment variables; no credentials are saved in source code or the database. Authenticated GET requests trigger a cron sync. Manual syncs use POST with `action: "sync"`. Both require `Authorization: Bearer <CRON_SECRET>`, including local development; unauthenticated GET requests return read-only dataset status. Use GET `?mode=status` for an authenticated status-only check.

1. Apply the additive dataset migration and acquire a shared lease to prevent overlapping dataset imports.
2. Refresh the archive schema and dataset metadata, preserving original columns as generated text columns alongside JSONB source payloads.
3. Capture an upper `(first_seen,row_hash)` bound for the scan.
4. Fetch pages through OVER's public `datastore_search_sql` endpoint with a stable keyset, avoiding the public API's 100,000-row offset limit.
5. Insert each distinct source payload and save the next checkpoint and counters in the same SQL statement. Retries are idempotent; corrections create another preserved observation.
6. Finish only after an empty page. Partial batches retain their checkpoint for the next invocation.
7. After backfill, import rows beyond the last watermark and rescan the recent seven-day window. Weekly full reconciliation checks for older changes. This uses source archive state rather than relying only on version metadata, because archive rows can change independently of metadata versions.

Successful checks with zero new records are healthy. A dataset-level error remains visible and does not advance its checkpoint. The importer gives datasets fair time slices. The SQL API must expose valid `first_seen` and `row_hash`; unsupported sources fail explicitly rather than silently producing empty data. Multi-resource datasets require an explicit source table. Only that selected resource is imported for that registered dataset.

## Initial backfill

A serverless call has a bounded time budget. A large backfill is **not guaranteed to finish in one invocation**. The daily job resumes unfinished work, and the dataset workspace's **Continue backfill** action repeats bounded calls while that browser page stays open. Closing the page does not lose the checkpoint.

For a sustained initial backfill, run:

```bash
# Set these through your shell/session environment, without committing their values.
export EDGE_BASE_URL=https://edge-real-estate.vercel.app
# CRON_SECRET must already be supplied through your environment.
npm run backfill:over
```

Optional `OVER_DATASET_ID` limits the command to one registered dataset; `EDGE_BACKFILL_MAX_RUNS` limits repeated batches (default 1000). Stop/restart safely: pages already committed are deduplicated. No API key or Google login is required for the endpoints used by this adapter.

## Tables and research

- `over_datasets`: enabled datasets, source schema/metadata, record date cutoff, coverage filters, checkpoints, watermarks, counts and health.
- `over_sync_runs`: individual runs, durable counts, outcome, checkpoint, and errors.
- `over_sync_lock`: short lease used for concurrency control; no credentials.
- `over_<dataset UUID without hyphens>`: one physical table per registered dataset, original columns, source JSONB and ingestion timestamps. `_edge_hash` deduplicates observations; `_edge_source_key` preserves OVER's archive row identity.

`GET /api/over-datasets` returns registered dataset status and recent runs. `GET /api/over-datasets?datasetId=<uuid>&q=<value>` browses the cache independently of opportunity scoring. `GET ...?mode=catalog&offset=0` reads OVER's dataset catalog. Registration and enable/disable operations require the cron credential. Browsing is public, consistent with the existing Edge APIs and the public government data it caches.

This is the source-data research layer. It does not replace existing normalized transaction, parcel, or score ingestion, and it does not delete existing canonical data older than 2022. The new cache and subsequent canonical OVER imports exclude pre-2022 transactions. Corrections are preserved as observations; source deletions are not inferred because the archive exposes historical observations rather than authoritative tombstones. When OVER does not capture source corrections, Edge cannot reconstruct corrections that OVER never published.

## Deployment and validation

The normal build type-checks the API/server code, builds the frontend, then runs `scripts/migrate-over.mjs` when `DATABASE_URL` is available. The migration is additive and idempotent. Newly initialized datasets receive a small bounded first import during deployment; the cron or backfill command continues the remaining history. Without a build-time database URL the migration is deferred to the first authenticated sync.

```bash
npm run test:over
npm run build
```

Tests execute the migration and page writes in PostgreSQL via PGlite, verify the 2022 cutoff, confirm duplicate reruns and corrected payload handling, and force a checkpoint failure to verify full rollback. Other checks cover timestamp ties, SQL quoting and source error handling.

API contract: https://www.over.org.il/api and https://www.over.org.il/openapi.json.
