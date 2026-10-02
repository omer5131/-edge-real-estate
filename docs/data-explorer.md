# SQL dataset explorer

Open Data → Dataset explorer. Select a dataset for a 50-row preview, inspect the semantic layer, or run SQL across available datasets. The catalogue is derived from the live public schema and registered OVER datasets; unavailable tables are omitted. An empty table is shown with its columns. Source definitions that have not been verified are marked explicitly.

The catalogue API is `GET /api/ask?mode=data-explorer`; queries use POST to the same endpoint with `{ "sql": "SELECT ..." }`. The response contains ordered column metadata and row arrays, preserving duplicate column names and headers for empty results. Result previews return at most 200 rows, with an explicit truncation flag; the database statement timeout is eight seconds.

SQL is parsed and regenerated before execution. Only SELECT, nonrecursive SELECT CTEs and unions are supported. All referenced tables must belong to the research catalogue; metadata, operational credentials and system tables are unavailable. Functions and casts use an explicit allowlist. Writes, locking reads, multi-statement requests, side-effecting functions and writable CTEs are rejected. Execution additionally uses a PostgreSQL read-only transaction. Existing deployment access and the application's existing data-reading visibility model apply.

Validation: `npm run check:server`, `npx tsc -b`, `npx vite build`, and `npx tsc -p tsconfig.server.json --noEmit false --outDir .server-test && node --test tests/research-sql.test.mjs`.
