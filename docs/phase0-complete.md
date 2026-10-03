# Phase 0 Completion Record

**Status:** COMPLETE  
**Completed:** 2026-10-03  
**Branch:** `phase0-architecture-reconciliation`

## What Phase 0 established

### Product source-of-truth rules
1. CBS + canonical official datasets = structural Area Intelligence.
2. Closed executed transactions = property valuation evidence.
3. Active listings = live competitive/asking-price context.
4. Renewal/planning/infrastructure = future-change context.
5. Notes/scenarios/due diligence/timeline = user workflow evidence.

These evidence domains remain separate in services, UI and agents.

### Canonical investor asset identity
The production system is currently listing-first:
- listings are populated
- canonical properties/buildings are not yet materially populated

Therefore Deal Room identity is:

`listingId` required  
`propertyId` optional  
`buildingId` optional  
`neighborhoodId` optional

Canonical enrichment must never block the user from researching or managing a deal.

### Canonical neighborhood identity
`neighborhoods.id` is the internal canonical key used across:
- listings
- transactions
- CBS
- renewal
- planning
- area analytics
- agents

Neighborhood/statistical-area mappings must carry provenance and confidence.

### Evidence semantics
Derived intelligence uses:
- `supported`
- `provisional`
- `insufficient_evidence`
- `unavailable`

Missing data must never be represented as zero.

### CBS status
The CBS data chain is physically available through:
- Census 2022
- Area Population 2023
- Area Population 2024

Current neighborhood CBS profiles for the four focus neighborhoods remain:
- `profile_quality=provisional`
- `safe_for_score=false`

This is intentional.

The official CBS page and workbook link were verified to exist, but the XLSX could not be downloaded successfully from either this runtime or GitHub Actions during Phase 0. Therefore the crosswalk is NOT falsely promoted to analytics-safe.

Phase 1 may use these metrics for contextual display only when clearly marked provisional. They may not drive deterministic scoring until official crosswalk validation succeeds.

### Valuation v1
Implemented as server domain module:
`server/valuationContext.ts`

Rules:
- only executed comparable transactions
- same canonical neighborhood minimum
- apartment-size similarity
- room similarity
- floor similarity
- recency
- transaction fingerprints are deduplicated before scoring

Current limitation:
same-building/street/distance priority awaits stronger canonical property/building/location coverage.

Outputs:
- selected comps
- similarity
- low/base/high valuation range
- price/m²
- discount to base value
- sample size
- confidence
- model version
- explicit limitation notes

### Active Market v1
Implemented:
`server/activeMarketContext.ts`

Uses active listing inventory separately from executed sales.

Outputs:
- similar listings
- current/original asks
- asking price/m²
- DOM
- price reductions
- inventory count
- median ask
- median ask/m²
- median DOM
- subject asking percentile
- subject delta to median
- evidence quality

Current limitation:
distance-based similarity awaits stronger location coverage.

### Area Context v1
Implemented:
`server/areaContext.ts`

Uses:
- `semantic_neighborhood_summary`
- `semantic_neighborhood_cbs_profile`

Provisional CBS quality propagates into the API response.

### Property context composition
Existing `api/property.ts` remains the serverless entrypoint to avoid Vercel Hobby function proliferation.

Full-tier response now composes:
- listing
- legacy comps
- valuation
- activeMarket
- areaContext
- renewal
- plans
- infrastructure
- history
- seller signals
- rent
- score
- confidence

The entrypoint is intentionally thin; investment logic lives in server modules.

### Vercel architecture constraint
Current plan has a 12 Serverless Function deployment limit.

Do not create a new file in `api/` for every domain operation without first consolidating existing functions or changing hosting plan.

Prefer:
- server domain modules
- existing API routers/modes
- consolidated entrypoints

### Deal workflow schema
Draft additive migration:
`db/028_deal_workflow_normalization.sql`

Validated successfully on isolated Neon branch.

Adds:
- `deal_scenarios`
- `investment_notes`
- `due_diligence_items`
- `deal_events`

It has NOT been applied to production.

### Isolated database validation
Validation branch:
`br-mute-violet-b4ibdibv`

The workflow schema created successfully with constraints and indexes.

Production data was not modified.

## Live baseline found during Phase 0

Approximate production counts at audit:
- transactions: 1,049
- eligible comparable transactions: 900
- listings: 42
- listing snapshots: 42
- rental listings: 1
- neighborhoods: 31
- neighborhood/statistical-area curated mappings: 9
- neighborhood CBS profile rows: 8
- neighborhood market periods: 83
- neighborhood metric snapshots: 108
- properties: 0
- buildings: 0
- deals: 0
- subscriptions: 2

## Verification status

### Verified
- architecture/contracts
- production schema audit
- production data audit
- valuation service module preview build
- active market service module preview build
- area context service module preview build
- normalized workflow schema on isolated Neon branch
- CBS lineage
- CBS provisional-quality propagation

### Environment-limited verification
The final thin `api/property.ts` wiring commit was pushed after Vercel hit its preview build-rate quota. Its imported modules individually built successfully, but the composed entrypoint must be rechecked as the first Phase 1 integration action.

This does not change the domain contract.

## Phase 0 exit decision

Phase 0 is complete because:
- domain semantics are locked
- identity rules are locked
- confidence/provenance behavior is locked
- service boundaries are locked
- deterministic v1 valuation/active-market/area modules exist
- workflow storage design is validated
- known unsafe CBS mappings are explicitly quarantined rather than silently accepted
- the remaining work is implementation/enrichment, not architecture reconciliation

## Phase 1 first actions

1. Reverify consolidated `api/property.ts` preview build.
2. Call it on subscribed real listings and assert valuation / activeMarket / areaContext response contracts.
3. Add deterministic fixtures/regression tests for valuation dedupe and similarity.
4. Continue canonical building/street/location enrichment.
5. Retry official CBS workbook acquisition; only promote exact validated crosswalks to analytics-safe.
6. Apply the workflow normalization migration only when Phase 3 begins, unless an earlier feature needs it.
7. Build the canonical Area Intelligence service/API without duplicating neighborhood logic.
8. Prepare Deal Room v1 frontend after backend acceptance passes.
