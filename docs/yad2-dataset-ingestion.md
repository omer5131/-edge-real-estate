# Yad2 nationwide research dataset

ScrapingBee is the HTTP and extraction provider. It takes public Yad2 URLs; the Yad2 marketing page is not a bulk export endpoint. `ai_extract_rules` generates structured JSON, using JavaScript rendering and optional stealth proxies. The collector validates responses before writing.

## Activation

The `Yad2 daily sale and rental dataset` GitHub Actions workflow runs daily at 01:00 UTC. It needs **GitHub repository Actions secrets** `DATABASE_URL` (the existing Edge PostgreSQL database) and `SCRAPINGBEE_API_KEY`. Keys stay in environment variables. Optionally set the Actions variable `SCRAPINGBEE_STEALTH_PROXY=true`. The deployed app needs its existing `DATABASE_URL`, and `CRON_SECRET` for authenticated scope administration. No API key is exposed to the client.

The workflow is committed but cannot successfully collect until those secrets are set. Run workflow_dispatch for the first import, or set the environment locally and run `npm run sync:yad2`. Build applies the idempotent migration when DATABASE_URL is present; the worker also applies it. Existing Edge schema must already exist for legacy projections. Do not point it at a different database.

## Scope and coverage

Default scopes are nationwide `/realestate/forsale` and `/realestate/rent`, without neighborhood or apartment-only filters. `yad2_crawl_scopes` supports additional city, region and property-type search URLs. It is independent of followed areas. Scope changes are made via authenticated POST `/api/yad2-admin` with `{id,market,url,enabled,config}`. Config supports `max_pages` and `details` (default true). Use a new scope ID when changing coverage, and disable the old scope.

Every scope follows actual next-page links until exhausted. If Yad2 limits broad searches, divide them into exhaustive smaller scopes (city/region/property type); a finished root pagination chain is not proof that Yad2 exposes every live listing. Reported coverage means the public pages actually traversed. A cap, blocked page, repeated page, malformed extraction or a failed listing detail marks the scope failed, retaining collected rows but skipping removal reconciliation. Completed pages are checkpointed. A failed run resumes from the last unfinished page in the same reconciliation cycle; upserts make replay safe. The missing-listing count advances only after the entire cycle completes. Requests are sequential, bounded by a default 10,000-page per-scope cap and the workflow's 350-minute timeout. Inspect scope completion and runtime before assuming daily nationwide coverage.

With details enabled, each discovered listing detail page is fetched once per scope cycle for descriptions, images, features, entry dates and other available property facts. Listing-summary-only mode is cheaper but cannot capture all detail changes. AI extraction can vary and needs live sampling; all unknowns remain null and unknown dates are never invented. Prices are asking prices, not completed deals, and rental prices are monthly.

## Persistence and history

`yad2_dataset` stores the latest normalized listing, keyed by `(market, listing_id)` from the real item URL. A price change cannot create a duplicate listing. `yad2_listing_changes` is append-only history created atomically by a database trigger for creation, price drops/increases, all other changed fields, disappearance and reactivation. Old/new values and observation times remain available even if there are multiple changes in a day. Unchanged observations refresh last_seen without adding history events. first_seen is our observation date; published_at is the date explicitly shown by Yad2.

Removal requires three *successful complete* cycles missing from every enabled scope that previously saw that listing. No inference of sold/rented is made from disappearance. Failed or partial runs never increment missing cycles. A worker lease prevents concurrent collection. Inactive rows and their history are retained.

Latest listings and changed snapshots are also projected into existing Edge sale/rental tables for scores, subscriptions and neighborhood metrics. City and neighborhood resolution uses exact names and may be missing; all unresolved listings still exist in the nationwide dataset. Older synthetic IDs from the previous scraper are retained and are not automatically merged with true Yad2 IDs.

## Research and operations

`/yad2.html` is linked from Research and provides sale/rent rows, database filters, price-drop filtering and a full change history. `/api/yad2-research` supports market, city, neighborhood, status, search, min/max price/rooms/area, limit/offset and `history=<listing_id>&market=...`. `/api/yad2-admin` GET reports scopes and recent runs; POST configures scopes with bearer CRON_SECRET.

For changing pagination structure or the provider, update the ScrapingBee adapter without changing dataset identity/history. The old direct HTML parsers are no longer scheduled. Generic ingestion scores the projected listings; the dedicated worker owns collection.

Historical listing backfill to 2022 cannot be recovered from today's live pages. This source starts observing at activation; OVER historical transaction imports remain separate.

ScrapingBee charges for rendering/proxies and adds credits for AI extraction. Detail mode adds a request per listing, per scope. Validate a small scope with a real key, check output and credit consumption, then scale. No successful real API request or production DB migration has been claimed by the local tests.

Validation: `npm run test:yad2` tests stable IDs, blocked/empty pages, retry behavior and real PostgreSQL-compatible trigger/upsert history with PGlite. `npm run build` checks frontend and server compilation; `npm run test:over` protects existing ingestion.
