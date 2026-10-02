# Yad2: one-time backfill, then daily new listings

Enabled city/market scopes are Haifa (4000), Netanya (7400), and Petah Tikva (7900), sale and rental. Nationwide scopes remain disabled. Additional towns need their own city-filtered URL and matching Hebrew `city_names`. Use a new scope ID when changing coverage and disable the old one.

## Collection phases

1. **Initial backfill:** the original-publication window starts 30 days before the scope's first collection. This lower boundary is fixed in `backfill_started_at`, including when the cost budget requires multiple executions. Public pagination is traversed once, checkpointing completed pages. Budget exhaustion does not mark the backfill complete. Original publication dates are read from `dates.createdAt` on detail pages, never from update/bump/observation dates.
2. **Daily incremental discovery:** after `backfill_completed_at` is set, each execution starts at the scope's first results page. Already stored IDs are skipped entirely, including price changes. Cache-only IDs can recover an interrupted insert without another HTTP request. Unknown IDs get one detail/date validation; only newly published ads since the last successful cycle, with a one-day overlap and a maximum age of 30 days, enter the dataset. The overlap catches same-day publications and retries without duplicates. The successful cycle's start time is the watermark, avoiding a gap for ads published during collection.

Daily discovery defaults to at most three results pages per city/market (`daily_max_pages`), stopping earlier after two consecutive pages containing no unknown in-scope IDs (`known_page_stop`). **This is bounded, low-cost discovery, not guaranteed complete coverage.** Yad2's promoted/bumped results are not proven to be ordered by original publication date. Run reports include `coverage` and `discovery_truncated`; unknown ads outside the scanned window can be missed. Do not silently call this complete source coverage.

No repeated historical backfill occurs after the first phase completes. If the first phase needs several budget-limited executions, those are continuations of the same initial backfill, not fresh rolling 30-day imports. Sale and rental identities remain distinct.

## Request controls and extraction

There is a hard default limit of 60 HTTP attempts per run (`YAD2_MAX_REQUESTS`), including retries, and 10 attempts per city/market (`max_requests`). Initial backfill has a per-execution 10-page cap (`max_pages`). Limits are ceilings, not a target; quieter daily runs stop sooner. Budget-limited runs are partial, not extraction failures. Authentication errors abort immediately instead of trying every city with the same rejected credential.

ScrapingBee fetches native Yad2 HTML with JavaScript and stealth proxies. The collector reads `__NEXT_DATA__`; it does not request AI extraction. Region-bearing item URLs supply stable IDs and developer project promotions are excluded. Malformed, blocked or unconfirmed empty pages fail safely. Rendering/proxy credits can vary; a request ceiling is not a credit ceiling.

`details=false` still requires a one-time detail request because feeds lack original publication dates. Migration 013 stores these details, including rejected old/undated ads, so repeat observations do not spend more detail requests. `details=true` can enrich a new feed row if it already carries a publication date; it does not enable refreshing known ads. Unknown dates are never invented.

## Persistence and research

`yad2_dataset` is keyed by `(market,listing_id)`. `yad2_listing_changes` retains prior history, but new-only collection no longer observes later price changes, removals or reactivations. Existing history is not deleted. Incremental discovery never performs disappearance reconciliation: not revisiting a listing is not evidence it disappeared or sold.

The research feed at `/yad2.html` reads the database and shows only original publication dates within the last 30 days and enabled cities. Historical rows remain stored and their history remains queryable. Latest inserted rows are projected into existing Edge sale/rental tables for scores and subscriptions. Asking prices are not completed transaction prices; rent is monthly. Exact city/neighborhood resolution can be missing.

Migration 014 adds persistent phase/checkpoint fields. It does not mistake the prior single-listing validation for a completed backfill. Migrations are idempotent and run through `scripts/migrate-yad2.mjs`.

## Activation and operations

The daily workflow needs GitHub Actions secrets `DATABASE_URL` and `SCRAPINGBEE_API_KEY`. **Its schedule remains paused after the live HTTP 401 authentication errors.** Fix the credential and validate a small run before restoring daily 01:00 UTC scheduling. No secrets appear in the client. Local execution: `npm run sync:yad2` with the same environment.

`/api/yad2-admin` GET exposes scopes and recent reports; authenticated POST accepts `{id,market,url,enabled,config}`. Config supports `max_pages`, `max_requests`, `daily_max_pages`, `known_page_stop`, `details`, `published_within_days` and `city_names`. Phase fields are not overwritten by config updates. Configuring an old scope for a new town is not a substitute for a new backfill scope.

Validation: `npm run test:yad2` uses PostgreSQL-compatible PGlite for migrations/history and full-worker mocks for new-only discovery, cache recovery and price-change skipping. These are not evidence that live authentication or exhaustive source coverage works. Historical listings back to 2022 cannot be recovered from current Yad2 pages; OVER transaction imports remain separate.
