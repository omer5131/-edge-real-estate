# Focused Yad2 collection (October 2026)

Current defaults: Haifa (4000), Netanya (7400), Petah Tikva (7900), both sale and rental. Migration 012 disables prior scopes once and creates six configurable city scopes. Additional towns require a city-filtered URL and matching Hebrew city_names in scope config.

Only explicitly verified original publication dates within the last 30 days enter the dataset; unknown dates, older ads, future dates and city mismatches are filtered. first_seen and bump dates are not substitutes. Results pages may still contain older ads: filtering limits stored rows, not the provider requests needed to read pages. Missing publication dates can reduce coverage. No assumption that pagination is ordered by original publication date.

Default details=false: one request per results page plus a one-time detail request for each unknown listing to verify its original publication date. Yad2's feed omits this date. Migration 013 adds a date/detail cache, including rejected older ads, so replay and subsequent price updates do not refetch known details. Explicit details=true additionally refreshes details each observation. Each run has a hard default budget of 60 HTTP attempts including retries (YAD2_MAX_REQUESTS), 10 attempts per city/market scope (config.max_requests), and 10 pages per scope per run. Initial coverage is partial: these are cost ceilings, not a promise to collect every recent ad. Budget/page exhaustion leaves the scope incomplete and checkpointed; it never proves disappearance. Publication-window scopes do not reconcile disappearance, because aging out is not removal. History remains in the database.

# Yad2 nationwide research dataset

ScrapingBee fetches public Yad2 HTML using JavaScript rendering and optional stealth proxies. The collector reads native __NEXT_DATA__ JSON without AI extraction charges, preserves regional item URLs, excludes developer promotions, and validates responses before writing. Missing or changed native data fails safely.

## Activation

The `Yad2 daily sale and rental dataset` GitHub Actions workflow runs daily at 01:00 UTC. It needs **GitHub repository Actions secrets** `DATABASE_URL` (the existing Edge PostgreSQL database) and `SCRAPINGBEE_API_KEY`. Keys stay in environment variables. Optionally set the Actions variable `SCRAPINGBEE_STEALTH_PROXY=true`. The deployed app needs its existing `DATABASE_URL`, and `CRON_SECRET` for authenticated scope administration. No API key is exposed to the client.

The workflow is committed but cannot successfully collect until those secrets are set. Run workflow_dispatch for the first import, or set the environment locally and run `npm run sync:yad2`. Build applies the idempotent migration when DATABASE_URL is present; the worker also applies it. Existing Edge schema must already exist for legacy projections. Do not point it at a different database.

## Scope and coverage

Previous implementation defaults were nationwide `/realestate/forsale` and `/realestate/rent`, without neighborhood or apartment-only filters. `yad2_crawl_scopes` supports additional city, region and property-type search URLs. It is independent of followed areas. Scope changes are made via authenticated POST `/api/yad2-admin` with `{id,market,url,enabled,config}`. Config supports `max_pages`, `details` (default false), `published_within_days` and `city_names`. Use a new scope ID when changing coverage, and disable the old scope.

Every scope follows actual next-page links until exhausted. If Yad2 limits broad searches, divide them into exhaustive smaller scopes (city/region/property type); a finished root pagination chain is not proof that Yad2 exposes every live listing. Reported coverage means the public pages actually traversed. A cap, blocked page, repeated page, malformed extraction or a failed listing detail marks the scope failed, retaining collected rows but skipping removal reconciliation. Completed pages are checkpointed. A failed run resumes from the last unfinished page in the same reconciliation cycle; upserts make replay safe. The missing-listing count advances only after the entire cycle completes. Requests are sequential, bounded by a default 10,000-page per-scope cap and the workflow's 350-minute timeout. Inspect scope completion and runtime before assuming daily nationwide coverage.

With details enabled, discovered details are refreshed each observation. Default cached-detail mode captures current feed prices but cannot capture every later detail change. Unknown fields remain null and dates are never invented. Only dates.createdAt is treated as original publication; updatedAt and rebouncedAt are not. Prices are asking prices, not completed deals, and rental prices are monthly.

## Persistence and history

`yad2_dataset` stores the latest normalized listing, keyed by `(market, listing_id)` from the real item URL. A price change cannot create a duplicate listing. `yad2_listing_changes` is append-only history created atomically by a database trigger for creation, price drops/increases, all other changed fields, disappearance and reactivation. Old/new values and observation times remain available even if there are multiple changes in a day. Unchanged observations refresh last_seen without adding history events. first_seen is our observation date; published_at is the date explicitly shown by Yad2.

Removal requires three *successful complete* cycles missing from every enabled scope that previously saw that listing. No inference of sold/rented is made from disappearance. Failed or partial runs never increment missing cycles. A worker lease prevents concurrent collection. Inactive rows and their history are retained.

Latest listings and changed snapshots are also projected into existing Edge sale/rental tables for scores, subscriptions and neighborhood metrics. City and neighborhood resolution uses exact names and may be missing; all unresolved listings still exist in the nationwide dataset. Older synthetic IDs from the previous scraper are retained and are not automatically merged with true Yad2 IDs.

## Research and operations

`/yad2.html` is linked from Research and provides sale/rent rows, database filters, price-drop filtering and a full change history. `/api/yad2-research` supports market, city, neighborhood, status, search, min/max price/rooms/area, limit/offset and `history=<listing_id>&market=...`. `/api/yad2-admin` GET reports scopes and recent runs; POST configures scopes with bearer CRON_SECRET.

For changing pagination structure or the provider, update the ScrapingBee adapter without changing dataset identity/history. The old direct HTML parsers are no longer scheduled. Generic ingestion scores the projected listings; the dedicated worker owns collection.

Historical listing backfill to 2022 cannot be recovered from today's live pages. This source starts observing at activation; OVER historical transaction imports remain separate.

ScrapingBee charges for rendering/proxies; this collector no longer requests AI extraction. A request ceiling is not a credit ceiling, since proxy settings affect cost. Validate small samples and check account consumption before raising the budget. Native feed and original detail dates were verified against live HTML; local tests do not substitute for production-run coverage.

Validation: `npm run test:yad2` tests stable IDs, blocked/empty pages, retry behavior and real PostgreSQL-compatible trigger/upsert history with PGlite. `npm run build` checks frontend and server compilation; `npm run test:over` protects existing ingestion.
