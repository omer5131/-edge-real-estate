# Yad2: isolated acquisition and offline processing

Bright Data Web Unlocker replaces ScrapingBee. There is no Apify dependency or automatic paid-provider fallback.

## Service boundary

| Job | Reads | Writes | Credentials |
| --- | --- | --- | --- |
| Collector (`npm run collect:yad2`) | Public Yad2 pages via Web Unlocker, scopes, known IDs | Source pages/records, request counters, acquisition checkpoints | Database + Bright Data API key/zone |
| Processor (`npm run process:yad2`) | Saved ready source records | Normalized dataset/history, processing status, existing Edge projections | Database only |
| Existing research/scoring services | Dataset and Edge tables | Their own derived results | No Bright Data credentials |

Jobs are separate processes with distinct leases. The workflow runs processing even after a partial/failed collector. Downstream retries make no source requests. These are credential/execution boundaries, not separate database-role permissions: both currently use the configured database role. Separate least-privilege roles can be provisioned later.

## Durable handoff

Migration 015 adds `yad2_source_pages`, `yad2_source_records`, and persistent `yad2_request_usage`. Pages retain versioned property-only source JSON plus pagination and collection context, not full HTML or seller contact fields. Immutable saved pages survive interruptions; an unfinished page is replayed from storage rather than downloaded again.

Records use stable `(market, listing_id)` identities. State progresses from `awaiting_detail` to `ready`, then `processed` or `filtered`. One detail fetch resolves original publication dates missing from feeds. Old cached publication records are reused. Rejected records remain saved to prevent repeated detail spending. The collector never writes `yad2_dataset`. The processor validates/normalizes dates, city and numeric fields, inserts new IDs and marks processing status atomically. Unknown dates are filtered, never invented. Only original `dates.createdAt` counts, not bump dates.

The processor uses the record's collection-time context, so delayed processing does not change the original selection boundary. Existing Edge projection is idempotent and is retried on every processor invocation, even with no new records. To re-evaluate filtered records after a parser or rule correction, make an explicit reviewed replay from saved data; do not restart a paid crawl.

## Initial backfill and daily discovery

Default enabled scopes: Haifa (4000), Netanya (7400), Petah Tikva (7900), sale and rental. Nationwide scopes are disabled. Additional towns require a new city-filtered scope URL and matching Hebrew `city_names`. Use a new scope ID when changing coverage, and disable the old scope.

Initial collection traverses public pagination once for ads originally published in the 30 days before the scope first started. Its lower boundary stays fixed across budget-limited continuations. A per-run page/request cap does not mark this backfill complete; it resumes its saved cursor.

After backfill finishes, daily discovery scans up to three front pages per city/market (or stops after two known pages), skips known IDs, and accepts new original publications since the last successful cycle with a one-day overlap and maximum age 30 days. Scope order rotates by last collection attempt to avoid starving later cities on a tight budget. Existing prices/removals are not refreshed. History is retained, and no disappearance reconciliation runs.

Promoted/bumped listings mean bounded daily scans are **not guaranteed complete source coverage**. Reports distinguish initial/backfill state and truncated discovery. Recent research results are restricted to enabled cities and original publication dates in the last 30 days.

## Free-tier safety and activation

Bright Data documents 5,000 monthly shared free credits for eligible accounts; Web Unlocker uses one credit per request. A funded account can automatically continue on paid balance when free credits run out. App counters cannot see other account usage or enforce Bright Data billing settings. Verify account eligibility, no funded balance and no automatic recharge before setting `BRIGHTDATA_FREE_TIER_CONFIRMED=true`. Do not deposit funds to make this pilot work.

Collector defaults to a **three-request pilot**, with hard local ceilings of 60 attempts per run/day and 4,000 per UTC calendar month, persisted before each POST. Limits can be lowered but not raised past these ceilings. Reservations conservatively count ambiguous failures and are not refunded. No automatic retries, TLS bypass or provider fallback. Authentication, account/quota and blocked/malformed responses stop collection safely. Budget exhaustion preserves source data and incomplete checkpoints.

GitHub Actions scheduling remains **paused**, manual dispatch only. Collection receives `DATABASE_URL`, `BRIGHTDATA_API_KEY` and `BRIGHTDATA_UNLOCKER_ZONE`; processing receives only `DATABASE_URL`. The app does not receive the provider key. Add Bright Data values as repository Actions secrets, not committed files or chat messages.

Migration 015 is deliberately opt-in: normal app builds apply only existing migrations 011–014. Before activation, validate migration 015 on a Neon branch of the existing database, then run `YAD2_APPLY_STAGING_MIGRATION=true node scripts/migrate-yad2.mjs` against the intended database. `DATABASE_URL_UNPOOLED` is preferred for migration; otherwise the existing Neon pooled hostname is converted to its direct equivalent. Do not point collection at a different database accidentally. Worker scripts do not run schema migrations.

First manual dispatch: choose `recent-haifa-rent`, max requests `3`, and confirm free-tier settings only after checking the account. A capped pilot will usually leave backfill incomplete; that is expected, not a failed data handoff. Inspect saved records and both job reports before enabling a daily cron. No live Unlocker request has been made during implementation, and Yad2 compatibility still needs a pilot.

Official references:
- https://docs.brightdata.com/products/web-unlocker/send-your-first-request
- https://docs.brightdata.com/general/account/billing-and-pricing/free-tier

## Verification

`npm run test:yad2` covers source parsing, stable IDs, fixed backfill boundaries, offline processing, restart without repeated page requests, persistent caps, auth stop, downstream retries, new-only writes and retained history. Tests use synthetic source pages and local PostgreSQL-compatible PGlite; they make no provider calls. A production-like Neon-branch migration check and live pilot are still required for activation.
