# Phase 0 — Architecture Reconciliation

**Branch:** phase0-architecture-reconciliation  
**Audit date:** 2026-10-03  
**Live environment:** Neon project `small-mode-04805717`, production branch `br-gentle-hat-b4hixvjz`, database `neondb`.

## Objective
Lock domain contracts using the real production state before changing the investor workflow or introducing parallel feature agents.

## Live findings

### Canonical volume
Observed live counts:
- transactions: **1,049**
- eligible comparable transactions: **900**
- listings: **42**
- listing snapshots: **42**
- rental listings: **1**
- rental snapshots: **1**
- neighborhoods: **31**
- neighborhood↔statistical-area mappings: **9**
- neighborhood CBS profiles: **8**
- neighborhood market periods: **83**
- neighborhood metric snapshots: **108**
- properties: **0**
- buildings: **0**
- deals: **0**
- asset subscriptions: **2**
- demographic_snapshots: **0**
- area_metric_snapshots: **0**
- cbs_neighborhood_stat_area_key: **0**

### CBS/statistical areas
`statistical_areas` contains **3,750** 2022 rows with source_id=`cbs` and geometries, but the base table currently has no populated `population` or `socio_economic_cluster` values.

The repo contains an importer:
`scripts/import-cbs-neighborhood-key.mjs`
which is intended to populate `cbs_neighborhood_stat_area_key` from the CBS 2022 neighborhood/statistical-area workbook.

Production currently has **0** rows in that key table, so the official CBS crosswalk is not yet present.

### Current neighborhood CBS profiles
There are eight profile rows: 2022 and 2024 for four target neighborhoods:
- קריית אליעזר
- קריית שפרינצק
- קריית נורדאו
- יוספטל

The profiles include population, employment, academic certificate rate, wage, household size, tenure, and median age.

However every current profile is:
- `profile_quality = provisional`
- `safe_for_score = false`

The source evidence explicitly states that the current curated crosswalk is **not safe for analytics** until confirmed against the official CBS 2022 key.

Therefore these profiles may be displayed only with provisional/mapping-risk labeling; they must not be treated as authoritative scoring inputs.

### Neighborhood/statistical-area mapping
Nine mappings currently exist using `configured_crosswalk`, with mapping confidence around 0.88–0.92.

The current mappings have no overlap ratio and are evidence-backed curated mappings. Their evidence marks them safe for identity/polygon work but not yet safe for analytics.

### Transactions
Transaction coverage is materially ahead of the rest of the product and should remain the valuation evidence layer.

Next contract work:
- deterministic comp selection hierarchy
- selected/rejected comp reasons
- similarity score/weights
- valuation range rather than a single point
- comp confidence
- model version

### Listings
Listings are currently the practical asset entity in production:
- 42 listings
- 42 snapshots
- properties=0
- buildings=0

This means the next architecture decision must avoid assuming all listings already resolve to canonical `property_id` / `building_id`.

Recommended transition:
1. allow listing-first Deal Room identity now
2. add optional canonical property/building linkage
3. enrich/reconcile asynchronously
4. never block user workflow because building identity is missing

Target API routes may use listing IDs initially while exposing canonical IDs when available.

### Deals/workflow
A `deals` table exists but has zero rows.
It already contains listing_id/property_id, stage/status, asking/offer price, next action, contact, notes, due_diligence, documents.

Do not expand this table directly into a JSON dumping ground.
Target normalization should separate:
- deal core record
- deal scenarios
- deal assumptions
- notes
- due-diligence items
- timeline/activity events

The existing columns can remain for backward compatibility during migration.

## Contract decisions to lock

### C1 — User-facing asset identity
**Recommendation:** listing-first, canonical-property-aware.

A Deal Room must work for every valid listing even when building/property resolution is incomplete.

Conceptual identifier contract:
```ts
type AssetRef = {
  listingId: string;
  propertyId?: string | null;
  buildingId?: string | null;
  neighborhoodId?: string | null;
};
```

### C2 — Neighborhood identity
`neighborhoods.id` is the canonical internal neighborhood key.
Slug is a stable human/debug identifier, not the foreign-key contract.

### C3 — CBS analytics
A CBS-derived neighborhood metric is authoritative only when:
- source dataset is explicitly identified
- neighborhood/statistical-area mapping is analytics-safe
- mapping version is recorded
- aggregation method is defined
- observation year is explicit

Until the official crosswalk is populated/validated, current profiles remain provisional.

### C4 — Market analytics vs valuation
Area trends and property valuation must be separate service outputs.
A property valuation cannot silently use active asking prices as executed-sale evidence.

### C5 — Similar listings
Similar active inventory is a separate deterministic matcher with its own similarity and confidence.

### C6 — Missing evidence
Null/empty coverage must propagate as `insufficient_evidence`, never as zero.

### C7 — Derived output envelope
All important derived service outputs should converge on:
```ts
type EvidenceMeta = {
  status: 'supported' | 'provisional' | 'insufficient_evidence' | 'unavailable';
  confidence?: number | null;
  sampleSize?: number | null;
  observedAt?: string | null;
  modelVersion?: string | null;
  sourceIds: string[];
  notes?: string[];
};
```

## Proposed Phase 1 service boundaries

### Asset Context
`GET /api/assets/:listingId/context`
Returns identity, listing, neighborhood summary, valuation summary, active-market summary, planning summary, and evidence state.

### Neighborhood Intelligence
`GET /api/neighborhoods/:id/intelligence`

### Valuation
`GET /api/assets/:listingId/comps`
`GET /api/assets/:listingId/valuation`

### Similar Listings
`GET /api/assets/:listingId/similar-listings`

The route name can later move from `assets` to `properties` once property identity has adequate coverage without breaking current users.

## Phase 0 blocking items

### P0.1 Populate/validate official CBS neighborhood key
Run and validate `scripts/import-cbs-neighborhood-key.mjs` against a safe branch first.
Do not mark mappings analytics-safe automatically. Compare the imported key to the existing curated evidence.

### P0.2 Build a mapping-quality report
For each followed/target neighborhood:
- expected statistical areas
- official-key match
- curated match
- conflicts
- coverage
- analytics_safe
- reasons

### P0.3 Audit CBS source datasets
The current `over_datasets` catalog contains no rows explicitly titled CBS/census/population/socioeconomic even though research views and derived profiles exist.
Trace each profile metric to its physical source table and document the chain.

### P0.4 Lock valuation contract
Inspect current comparable view and scoring logic. Produce deterministic v1 matcher contract and fixtures.

### P0.5 Lock listing lifecycle contract
Current snapshots equal listing count, so DOM/price-reduction intelligence has little history. Ensure lifecycle logic distinguishes “no change observed yet” from “seller never changed price.”

### P0.6 Normalize workflow plan
Design additive migrations for deal scenarios, notes, DD items, and timeline. Do not apply to production until reviewed.

## Exit criteria for Phase 0
- official CBS key import validated on a non-production branch
- crosswalk quality report exists for target neighborhoods
- source lineage for every CBS-profile metric is documented
- listing-first/canonical-property identity contract is accepted
- valuation/comps v1 contract is documented
- similar-listings v1 contract is documented
- workflow migration design is documented
- API response envelopes are defined
- test fixtures exist or are specified
- no broad UI redesign has started
