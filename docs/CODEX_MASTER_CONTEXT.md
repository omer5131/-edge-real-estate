# Edge — Master Product & Engineering Context

**Status:** authoritative  
**Date:** 2026-10-03

## 1. Product
Edge is a personal residential real-estate acquisition operating system, not only an analytics dashboard.

Core workflow:
**Discover → Understand → Investigate → Underwrite → Track → Compare → Decide**

The product should let a user discover an apartment, understand the neighborhood and current market, estimate value from completed comparable sales, compare current competing inventory, model a deal, record research, run due diligence, track changes, negotiate, and make a purchase decision without leaving Edge.

## 2. Evidence domains

### 2.1 Area Intelligence
Primary source: CBS and canonical official datasets.
Purpose: structural market, demographic, socioeconomic, housing, education, population, and trend context.

### 2.2 Closed transactions
Purpose: estimate property value based on executed sales.
Outputs: comp set, adjusted value range, price/m² evidence, similarity, confidence.

### 2.3 Active listings
Purpose: describe the competitive market now.
Outputs: asking benchmark, alternative inventory, listing percentile, DOM, price reductions, seller signals.

### 2.4 Future-change context
Urban renewal, statutory planning, XPLAN, transport/infrastructure.

### 2.5 User workflow evidence
Notes, stages, scenarios, due diligence, timeline, decisions.

These layers must remain semantically distinct in APIs, UI, scoring, and agents.

## 3. Canonical geography
One neighborhood source of truth must connect all datasets.
Target graph:
City → Neighborhood ↔ Statistical Area → Street → Parcel → Building → Property → Listing.

Mappings must carry:
- method
- confidence
- source evidence
- version
- validation date/observed time
- overlap/weight where relevant

## 4. Target primary navigation
- Discover
- Research
- My Deals
- Areas
- Compare

Secondary:
- Data
- Agents
- Admin

The current Opportunities page should eventually be absorbed conceptually into Discover/Research/My Deals. An opportunity is not a separate property universe.

## 5. Deal Room
The Property page becomes the main workspace once a listing is interesting.

Tabs:
- Overview
- Market
- Comps
- Area
- Deal
- Notes
- Due Diligence
- Timeline

Overview should clearly separate:
- seller asking price
- closed-transaction valuation range
- area benchmark
- active-listing benchmark
- why Edge surfaced the asset
- risks / missing evidence

## 6. Area Intelligence service
Target API:
`GET /api/neighborhoods/:id/intelligence`

Logical groups:
- market
- population
- socioeconomic
- education
- housing
- urban renewal
- planning
- infrastructure

Every metric should expose source, observation period, freshness, confidence, and mapping quality where relevant.

## 7. Comparable service
Target API:
`GET /api/properties/:id/comps`

Priority:
1. same building
2. same street
3. nearby
4. same neighborhood
5. broader fallback

Similarity dimensions:
- recency
- size
- rooms
- floor
- property/building type
- location
- building age where known

Return selected and rejected candidates, similarity/weights, reason, valuation range, confidence, and model version.

AI may explain the deterministic output but must not replace it.

## 8. Similar active listing service
Target API:
`GET /api/properties/:id/similar-listings`

Return subject-relative inventory including:
- current/original ask
- ask/m²
- size
- rooms
- floor
- DOM
- price reductions
- source
- distance
- similarity
- listing status

Summary:
- median competing ask
- median competing ask/m²
- subject percentile
- inventory count
- median DOM
- delta vs subject

## 9. Deal Engine
Target deterministic service with stored assumptions and scenarios.

Inputs:
- purchase/offer
- taxes
- legal/broker/appraisal
- renovation/furnishing
- financing
- rent
- vacancy
- maintenance
- exit assumptions

Outputs:
- acquisition cost
- equity
- debt service
- gross/net yield
- cash flow
- cash-on-cash
- projected equity/profit
- IRR
- break-even
- max purchase price for target return

Scenarios:
Conservative / Base / Upside / custom.

## 10. Workflow
Target stages:
Saved → Researching → Contacted → Visit Scheduled → Visited → Negotiating → Due Diligence → Offer → Closed.
Terminal: Rejected, with reason.

Notes are first-class records related to property/building/area/deal with categories and optional evidence.

Due diligence items support:
Unknown / In Progress / Verified / Issue / Not Applicable.

Timeline records discovery, save, price changes, contacts, visits, notes, scenario changes, new comps, planning changes, stage moves, offers, removal/republication.

## 11. Compare
Compare 2–6 candidate properties on:
- property basics
- valuation
- active market
- area
- deal economics
- risk
- data confidence

Do not reduce comparison to a single score.

## 12. Ask Edge
Existing architecture:
Ask Edge → SQL Agent → read-only SQL.

Extend with contextual identifiers and domain tools:
- get_property
- get_comps
- get_similar_listings
- get_area_intelligence
- get_deal
- get_notes
- get_due_diligence

Agent rules:
- separate source facts from derived values
- distinguish sale prices from asks
- surface missing evidence
- state sample/confidence where material
- use deterministic Deal Engine outputs

## 13. Phases

### Phase 0 — Architecture reconciliation — COMPLETE
Phase 0 is complete. The authoritative completion record is `docs/phase0-complete.md`.

Locked decisions:
- listing-first, canonical-property-aware asset identity
- one canonical neighborhood key
- CBS/official data for structural area analytics
- executed transactions for valuation
- active listings for live competitive context
- explicit evidence states: supported / provisional / insufficient_evidence / unavailable
- normalized workflow storage design
- Vercel serverless-function-count constraint and consolidated API pattern

Phase 0 also implemented server modules for:
- `server/valuationContext.ts`
- `server/activeMarketContext.ts`
- `server/areaContext.ts`

The full property response is composed through the existing `api/property.ts` entrypoint.

Important: current CBS neighborhood profiles remain provisional and `safe_for_score=false` until the official 2022 CBS neighborhood/statistical-area workbook can be successfully acquired and validated. Do not override this guardrail.

### Phase 1 — Market Intelligence services — COMPLETE
Identity + CBS/Area + Transactions/Valuation + Listings + Planning.

Acceptance passed: the listing-first property-context backend returns subject identity, deterministic closed-sale comps/valuation, separate active alternatives, neighborhood intelligence, planning/renewal/infrastructure context, and provenance/confidence.

Authoritative completion record: `docs/phase1-complete.md`.

### Phase 2 — Deal Room v1 — READY TO START
Overview / Market / Comps / Area + contextual Ask Edge.

### Phase 3 — Investment workflow
Deal Engine + scenarios + Notes + My Deals + stages + due diligence + timeline.

### Phase 4 — Discover & Research
Top opportunities, explanations, changes since last visit, cards/table/map, saved searches, opportunity consolidation.

### Phase 5 — Decision tools
Compare, advanced due diligence, negotiation support, max purchase price, scenario comparison.

### Phase 6 — Monitoring
Listing changes, new comps, CBS updates, planning/renewal changes, thesis-change events, next-action reminders.

## 14. Source-of-truth override
Some older repository docs refer to OVER deals as the primary market source. Where there is conflict, use this rule:
- **CBS + official canonical datasets:** area structural analytics/trends
- **closed executed transactions:** property valuation
- **active listings:** current competitive context
- **planning/renewal/infrastructure:** future-change context


## 15. Current implementation baseline after Phase 0

### Current system of record
Neon PostgreSQL + PostGIS.

Production branch:
`br-gentle-hat-b4hixvjz`

Phase 0 validation branch:
`br-mute-violet-b4ibdibv`

### Live data baseline observed in Phase 0
Approximate audit counts:
- transactions: 1,049
- eligible comparable transactions: 900
- sale listings: 42
- listing snapshots: 42
- rental listings: 1
- neighborhoods: 31
- curated neighborhood/statistical-area mappings: 9
- neighborhood CBS profile rows: 8
- neighborhood market periods: 83
- neighborhood metric snapshots: 108
- canonical properties: 0
- canonical buildings: 0
- deals: 0
- subscriptions: 2

These numbers are snapshots, not hardcoded business rules.

### Identity state
Current production is listing-first.

Do not assume `property_id` or `building_id` exists.

Minimum investor asset identity:
```ts
{
  listingId: string;
  propertyId?: string | null;
  buildingId?: string | null;
  neighborhoodId?: string | null;
}
```

Deal Room, notes and workflow must function before canonical property/building enrichment is complete.

### CBS state
Available physical research layers include:
- Census 2022
- Area Population 2023
- Area Population 2024

Current focus-neighborhood profiles are deliberately provisional.

Never promote them to deterministic score inputs unless:
1. official crosswalk evidence is acquired,
2. statistical-area membership is reconciled,
3. mapping/version provenance is stored,
4. the profile is explicitly marked analytics-safe.

Until then:
- display is allowed with provisional labeling
- explanatory agent use is allowed with caveat
- deterministic opportunity scoring should not depend on the provisional profile

### Valuation v1 implementation
Module:
`server/valuationContext.ts`

Executed-sale evidence only.

Current similarity dimensions:
- canonical neighborhood
- apartment area
- rooms
- floor
- transaction recency

Duplicate sale representations are collapsed by a fingerprint consisting of:
- deal date
- sale price
- area
- rooms
- floor

Outputs:
- selected comparable sales
- similarity and weight
- low/base/high valuation
- base price/m²
- discount to base valuation
- evidence sample size
- confidence
- model version
- limitation notes

Next enrichment:
same building → same street → nearby/distance → neighborhood fallback once identity/location coverage supports it.

### Active-market v1 implementation
Module:
`server/activeMarketContext.ts`

Active listings remain separate from valuation.

Current matching dimensions:
- neighborhood
- area
- rooms
- floor

Outputs:
- similar active inventory
- median ask
- median ask/m²
- median DOM
- subject asking percentile
- subject delta to median
- price reduction/seller context
- evidence status/confidence

Sparse inventory must remain provisional rather than producing false precision.

### Area Context v1 implementation
Module:
`server/areaContext.ts`

Uses:
- `semantic_neighborhood_summary`
- `semantic_neighborhood_cbs_profile`

It propagates CBS mapping quality into the API response.

### Property context entrypoint
Use the existing:
`api/property.ts?id=<listing-id>`

For subscribed/full assets, the target response composition is:
- listing
- legacy comps
- valuation
- activeMarket
- areaContext
- renewal
- plans
- infrastructure
- listing history
- seller signals
- rental evidence
- opportunity score
- confidence

Do not create separate serverless API files merely to mirror these sections.

### Vercel constraint
The current Vercel plan has a maximum of 12 Serverless Functions per deployment.

Architecture rule:
- domain logic belongs in `server/`
- use consolidated API entrypoints/routers
- count functions before adding files under `api/`

A Phase 0 attempt to add standalone valuation and similar-listing endpoints exceeded this limit and was reverted/consolidated.

### Deal workflow storage
Draft additive migration:
`db/028_deal_workflow_normalization.sql`

Validated on the isolated Neon branch.

Defines:
- `deal_scenarios`
- `investment_notes`
- `due_diligence_items`
- `deal_events`

Do not apply to production automatically.
Apply when the corresponding workflow phase begins and after migration review.

## 16. Codex execution model

Codex should use one main orchestrator and bounded specialist agents.

The orchestrator owns:
- contracts
- dependency ordering
- integration
- migration review
- acceptance
- regression prevention

Parallel agents should not redefine shared concepts.

Recommended Phase 1 tracks:
1. Identity/Geo enrichment
2. CBS/Area Intelligence
3. Transactions/Valuation
4. Listings/Active Market
5. Planning/Renewal
6. API integration
7. QA/Evals

Frontend Deal Room work begins only after the property-context backend contract passes integration verification.

## 17. Phase 1 completion and Phase 2 handoff

Phase 1 status: COMPLETE.

Completion record: `docs/phase1-complete.md`.

Phase 2 status: READY TO START.

Phase 1 delivered:
1. Unified asset context composed in `server/assetContext.ts` and exposed through the existing consolidated `api/property.ts`.
2. Closed-sale valuation v2 with duplicate collapse, selected/rejected candidates, explicit fallback semantics and evidence metadata.
3. Active-market v2 kept semantically separate from valuation.
4. Neighborhood intelligence contract with CBS provisional/safe-for-score guardrails.
5. Planning context for renewal, statutory plans and infrastructure.
6. Deterministic regression coverage plus green CI typecheck/build gate.
7. Read-only production-data validation on subscribed real listings.

Phase 2 should consume these domain contracts rather than recreate calculations in React.

CBS official crosswalk acquisition remains an enrichment task, not permission to weaken the evidence guardrail.

## 18. Phase 0 references

Codex must read these before Phase 1 changes:
- `AGENTS.md`
- `docs/CODEX_MASTER_CONTEXT.md`
- `docs/phase0-complete.md`
- `docs/phase0-architecture-reconciliation.md`
- `docs/phase0-data-lineage.md`
- `docs/phase1-service-contracts.md`
- `server/contracts/investmentContext.ts`

If an older document conflicts with these files, this master context plus `phase0-complete.md` are authoritative.
