# Dataset research and agent queries

Daily collection runs at 02:45 UTC via `/api/over-datasets`, after the existing provider collection at 02:15 UTC. Every curated dataset has its own `over_<uuid>` raw table and a readable `research_<slug>` view. The catalog is maintained in `server/sources/researchCatalog.json`, persisted in `research_semantic_catalog`, and published at `/api/over-datasets?mode=semantics`. The platform browser is `/datasets.html`.

## Agent discovery and execution

1. GET `/api/over-datasets?mode=semantics` (optionally `&dataset=census_2022`). Read field descriptions, source attribution, grain, join restrictions, observation-year policy, and collection status before choosing data.
2. POST `/api/over-datasets?mode=query` with a structured query. Read requests require no collector secret; writes and collection remain protected by the existing CRON_SECRET environment variable.

```json
{"dataset":"municipal_wages","columns":["municipality","observation_year","average_wage"],"filters":[{"field":"municipality","op":"eq","value":"חיפה"},{"field":"observation_year","op":"gte","value":2022}],"orderBy":{"field":"observation_year","direction":"desc"},"limit":50}
```

```json
{"dataset":"election_2022_polling","groupBy":["locality_code"],"metrics":[{"op":"sum","field":"eligible_voters"},{"op":"sum","field":"voters"}],"limit":100}
```

Turnout is the ratio of summed voters to summed eligible voters, not the unweighted average of polling-station percentages. Missing/zero denominators require explicit handling. Municipal finances retain source units: do not assume amounts are NIS rather than thousands of NIS.

The query service selects only registered views/fields, binds filter values, limits results to 200 rows, and applies an 8-second database statement timeout. It supports eq/gte/lte/contains/in, grouping, count/sum/avg/min/max/median, sorting and offset pagination. Arbitrary SQL is not executed. SQL examples are available for agents with a separate database connector.

## Storage and semantics

Original payloads are immutable history and content hashes prevent identical copies. Views use validated natural keys where available and choose the latest loaded correction. Missing entity keys fall back to the source hash, avoiding accidental collapse of all missing-key records. Without a verified entity key, different source versions remain distinct; agents must read that dataset's warning.

Observation cutoff is 2022, applied to annual/date columns or fixed-year datasets. Current reference layers (parcels, street mapping, schools, active plans and infrastructure) remain useful even if their original creation dates precede 2022. Collector timestamps never substitute for observation years. Numeric parsing produces NULL for blanks or invalid numbers. Geographic codes remain text and boundary versions must match. Census income fields distinguish annual medians from source-defined municipal averages.

## Collection adapters and limits

OVER archives use resumable `(first_seen,row_hash)` keysets; small sources receive fair worker slots instead of waiting for national transaction/parcel backfills. Three bounded workers run in parallel; runtime has a 230-second budget and persisted checkpoints. Large imports may require multiple daily batches. The existing authenticated Continue backfill control can run successive batches immediately.

GovMap layers use the public OVER GeoJSON feature API, preserving WGS84 geometry. These are full snapshot scans with offset checkpoints, not incremental change feeds; upstream changes during a scan may require the next full scan to reconcile. Deletions are not inferred from a failed/partial scan. Retained historical rows can include features later removed from the upstream layer; the current semantic layer presents the latest known version, not a guaranteed complete current source snapshot.

Bank of Israel adapters read its SDMX CSV dataflows BR, BIR_MRTG_99, PRI and REAL_ES_DF in annual batches from 2022. Each row keeps official SERIES_CODE, TIME_PERIOD, OBS_VALUE and all dimension/unit metadata. After backfill, daily checks revisit the current and prior year for revisions. Revisions older than that window need a deliberate historical reconciliation. Sentinel first_seen values are internal placeholders when a source exposes no publication cursor; agents use observation_period and _loaded_at appropriately.

Sale/rent listings, XPLAN plans and infrastructure are copied from the existing Edge provider tables into separate research datasets. A healthy copy does not imply a complete successful upstream crawl. Sale and rent prices must be analyzed separately.

National address data and 2024 municipal election results have tables and definitions but remain visibly blocked until a machine-readable source is verified. No fabricated results are inserted. Building-permit coverage is currently Jerusalem; it does not imply permit coverage in Haifa, Netanya or Petah Tikva. School coordinates provide locations, not educational performance scores.

## Validation

`npm run test:research` checks migrations, typed views, missing values, corrected entity deduplication, history retention, parameterized queries, rejected unsafe identifiers/metrics, CSV parsing and GeoJSON normalization. `npm run test:over` validates archive cursor and cutoff behavior. Build-time migrations create all tables/views and start a bounded initial collection when new sources exist.
