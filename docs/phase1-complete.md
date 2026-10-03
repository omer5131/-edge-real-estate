# Phase 1 — Market Intelligence Services — Complete

**Status:** COMPLETE  
**Date:** 2026-10-03  
**Branch:** `phase1-market-intelligence`

## Definition of done

Phase 1 is complete when a listing-first asset context can return the subject listing plus:
- deterministic closed-sale valuation and comparable evidence,
- separate active-listing competitive context,
- canonical neighborhood intelligence,
- renewal / statutory planning / infrastructure context,
- provenance, evidence status, confidence, sample size, freshness and model versions,
while preserving missing-evidence semantics and the Vercel function limit.

## Delivered

### Unified asset context
`server/assetContext.ts` composes the Phase 1 market-intelligence domains behind the existing consolidated `api/property.ts?id=<listing-id>` entrypoint.

The full response now exposes:
- `asset`
- `listing`
- `valuation`
- `activeMarket`
- `neighborhood`
- `planning`
- aggregate `evidence`

Legacy top-level fields remain during migration.

### Identity
The contract remains listing-first:
- listing ID required,
- property/building IDs optional,
- neighborhood identity used when available.

Missing building/property identity does not block the asset context. Evidence notes make the limitation explicit.

### Closed-sale valuation v2
`server/valuationContext.ts`:
- uses executed transactions only,
- collapses duplicate sale fingerprints,
- prioritizes exact-address / street evidence before neighborhood fallback with current production identity coverage,
- weights apartment similarity and recency,
- returns selected and rejected candidates,
- returns low/base/high valuation, price/m² and discount-to-base,
- degrades to provisional / insufficient evidence rather than false precision.

Model version: `valuation-v2`.

### Active market v2
`server/activeMarketContext.ts` remains separate from valuation and uses current asking inventory only.

Outputs include comparable active listings, asking-price distributions, DOM, price reductions, percentile and subject delta.

Model version: `similar-listings-v2`.

### Neighborhood intelligence
`server/areaContext.ts` now implements the Phase 1 neighborhood intelligence contract with grouped market, population, socioeconomic, education, housing, renewal, planning and infrastructure metrics.

CBS guardrail remains locked:
- current focus-neighborhood CBS profiles are provisional,
- `safe_for_score=false` is respected,
- they are not promoted into deterministic scoring until official crosswalk validation is complete.

### Planning context
`server/planningContext.ts` exposes mapped:
- renewal projects,
- statutory plans,
- infrastructure projects,
with source provenance and evidence metadata.

### Regression and build gate
Added `tests/phase1-context.test.mjs` covering:
- duplicate sale fingerprints,
- sparse comparable evidence,
- sparse active inventory,
- missing building identity,
- missing neighborhood identity,
- provisional CBS profiles,
- planning provenance.

Added `.github/workflows/phase1-ci.yml`.

Final Phase 1 CI passed:
- Phase 1 regression tests,
- server TypeScript check,
- frontend TypeScript check,
- production Vite build.

GitHub Actions run:
https://github.com/omer5131/-edge-real-estate/actions/runs/37142250721

## Production-data validation

Validated read-only against Neon production branch `br-gentle-hat-b4hixvjz`.

Subscribed examples:
- `7f68a88a-7b91-4d43-9a0b-ca40cece67ad` — דרייפוס 25
- `b01a4c71-a496-4db1-bf3c-b84af4181fed` — ז'אן ז'ורס

For their canonical neighborhood at validation time:
- 10 eligible comparable transactions in the last 5 years,
- 6 in the last 18 months,
- 3 alternative active listings,
- 2 mapped renewal projects,
- 97 mapped planning-plan records,
- no currently mapped infrastructure project,
- CBS 2024 profile remained provisional with `safe_for_score=false`.

These are validation snapshots, not product constants.

## Serverless constraint

The branch still contains exactly 12 files under `api/`, matching the current Vercel plan limit. No Phase 1 domain was added as a separate serverless function.

## Deployment note

Vercel Git preview creation became rate-limited during Phase 1 verification. The final code was therefore gated independently through GitHub Actions plus direct read-only production-data validation. This is an infrastructure quota condition, not a failing code/build check.

## Phase 1 acceptance

**PASS.**

The backend contract required for Deal Room v1 is ready. Phase 2 may begin from the unified asset-context response without weakening any Phase 0 evidence or identity guardrails.


## Production deployment retry

After Phase 1 merged to `main`, the initial automatic Vercel production build was skipped by the provider's temporary build-rate limit. This documentation-only commit intentionally retriggers the normal Git-integrated production deployment without changing Phase 1 runtime semantics.
