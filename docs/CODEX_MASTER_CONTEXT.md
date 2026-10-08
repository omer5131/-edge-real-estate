# Edge — Master Product & Engineering Context

**Status:** authoritative  
**Date:** 2026-10-08 (current-priority reconciliation; historical entries retained)

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

### Phase 2 — Deal Room v1 — COMPLETE / LIVE IN PRODUCTION
Overview / Market / Comps / Area + contextual Ask Edge are implemented, merged and deployed.

Delivered:
- Deal Room Overview / Market / Comps / Area
- fair-value range from closed comparable sales
- separate active-market benchmark
- neighborhood intelligence and provisional CBS labeling
- renewal/planning/infrastructure context
- seller signals and listing source link
- contextual Ask Edge using bounded listing/property/building/neighborhood IDs and active tab
- reconstruction-safe frontend injection
- green Phase 2 server/frontend CI

Phase 2 merge:
`a9934f4f9f0635a7f74927cb537e028d8e051c02`

Production deployment that first carried Phase 2:
`5bff900322b6f6072ef25cacc1f7533f8dbdc78f`

### Phase 2.1 — Evidence stabilization — COMPLETE
Authoritative completion record:
`docs/phase2.1-complete.md`

Delivered:
- one confidence scale: 0–1
- active-market hard eligibility and stricter evidence thresholds
- rejected active candidates with reasons
- lifecycle-aware DOM / seller evidence
- truthful exact-item vs search-page source provenance
- Deal Room evidence messaging
- regression coverage and green production build

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

## 17. Completed delivery through Phase 2.1

Phase 0: COMPLETE  
Phase 1: COMPLETE  
Phase 2: COMPLETE and deployed  
Phase 2.1: COMPLETE in code and CI; production release follows the normal merge/deploy gate.

Completion records:
- `docs/phase0-complete.md`
- `docs/phase1-complete.md`
- `docs/phase2-release.md`
- `docs/phase2.1-complete.md`

Current property research stack:
1. listing-first asset identity
2. deterministic closed-sale valuation v2
3. active-market comparison v2.1
4. neighborhood intelligence
5. planning/renewal/infrastructure
6. Deal Room Overview / Market / Comps / Area
7. contextual Ask Edge

Evidence rules after Phase 2.1:
- all confidence values are 0–1
- missing evidence is never zero
- small active inventory remains provisional
- active candidates must pass hard size/room eligibility before similarity scoring
- rejected active candidates keep reasons
- one listing observation does not imply DOM=0
- source/search pages are not labeled as exact listing pages
- provisional CBS metrics remain display-only and are not score-safe

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


## 19. Phase 2.1 stabilized application state — 2026-10-03

Phase 2 is live in production and Phase 2.1 closes the evidence-quality gaps found during the first Deal Room review.

### Stabilized evidence contract
- `EvidenceMeta.confidence` is normalized to 0–1.
- Active-market `supported` requires at least 5 eligible listings and average similarity >= 0.70.
- Active candidate hard eligibility: area ±25%, rooms ±1, valid ask, then similarity >= 0.55.
- Rejected active candidates remain explainable.
- DOM is null until at least two observations span one or more days.
- Seller price-reduction evidence remains unverified until lifecycle support exists.
- Listing source URLs carry `item | search | unknown` provenance.

### Real-data behavior
For the 115m² / 4-room Drayfus 25 validation asset, the previously returned 52m², 80m² and 85m² active listings are no longer presented as supported comparable inventory. This is intentional: no benchmark is better than a misleading benchmark.

### Remaining non-blocking enrichment
- canonical property/building/street/parcel coverage
- stronger coordinates and distance-based matching
- more listing snapshots over time
- exact item URLs for legacy Yad2 records where recoverable
- official CBS crosswalk validation
- broader rental coverage

These do not reopen Phase 0–2 architecture.



## 21. Phase 3 implementation status — IN PROGRESS

Branch:
`phase3-investment-workflow`

### Implemented so far

#### Deterministic Deal Engine
Module:
`server/dealEngine.ts`

Supports:
- acquisition cost
- equity required
- debt service
- gross / net yield
- cash flow
- cash-on-cash
- exit value / equity / projected profit
- IRR
- break-even monthly rent
- max purchase price for target return

No LLM calculation path is used.

#### Normalized workflow service
Module:
`server/dealWorkflow.ts`

Supports:
- create/open deal from listing
- pipeline stage changes
- rejection reason payload
- next action
- offer
- scenarios
- notes
- due diligence
- timeline events

The service is exposed through the existing consolidated `api/opportunities.ts` router so no new Vercel serverless function is added.

#### My Deals
UI component:
`ui/MyDeals.tsx`

Pipeline workspace displays:
- current stage
- property/listing identity
- ask
- primary scenario output
- next action
- last activity
- DD issue count

#### Deal Room workflow tabs
Added:
- Deal
- Notes
- Due Diligence
- Timeline

Scenario UI supports:
- Conservative
- Base
- Upside
- Custom

Rejected stage captures a rejection reason.

#### Historical property context
Requested during Phase 3 and implemented as a first-class property-page layer.

Module:
`server/propertyHistoryContext.ts`

The property page now separates:
1. strict active similar listings;
2. selected valuation comps;
3. broader-but-still-subject-relevant historical executed sales from `transactions`;
4. neighborhood closed-sale trends from `neighborhood_market_periods`.

Historical sale eligibility:
- same canonical neighborhood
- area within ±25% when known
- rooms within ±1 when known
- similarity >= 0.60
- duplicate transaction fingerprints collapsed upstream in valuation logic where applicable

Trend context includes:
- executed transaction count
- median executed price
- median / P25 / P75 price per m²
- active sale inventory
- median asking price per m²
- asking-to-executed premium
- transaction confidence
- 12-month change summary

Trend data is contextual and must not be substituted directly into deterministic subject valuation.

### Validation completed

Phase 3 CI currently passes:
- server typecheck
- Phase 2.1 regression suite
- Deal Engine regression suite
- historical-market regression coverage
- reconstructed production frontend build

The additive workflow migration `db/028_deal_workflow_normalization.sql` passed on the isolated Neon branch.

Real listing persistence validation on the isolated branch:
- listing: דרייפוס 25
- deal created
- stage changed Saved → Researching
- scenario persisted
- note persisted
- DD item persisted as Verified
- timeline events persisted

### Production migration status

The Phase 3 additive workflow migration is now **APPLIED TO PRODUCTION** with explicit user approval.

Production now contains:
- `deal_scenarios`
- `investment_notes`
- `due_diligence_items`
- `deal_events`

Verified production indexes include:
- `deal_scenarios_one_primary_idx`
- `deal_scenarios_deal_idx`
- `investment_notes_deal_idx`
- `investment_notes_listing_idx`
- `investment_notes_neighborhood_idx`
- `due_diligence_deal_status_idx`
- `deal_events_deal_time_idx`
- `deal_events_listing_time_idx`

The migration executed successfully as one transaction against production Neon.

Phase 3 is no longer blocked on schema availability. Continue with integration acceptance, workflow UI, contextual agent support, merge/deploy and production smoke tests.


## 22. Renewal project research and navigation — 2026-10-05

New first-class project directory/profile uses the existing `/api/renewal` function and additive migration `031_renewal_project_profiles.sql`. See `docs/renewal-project-research.md` for prioritized source research, source links, remaining adapters and exact delivery contracts.

Project planning, permits, execution, reported signatures and developer forecasts stay separate. Claims carry source kind/date/URL/locator and evidence status. Missing data and scope conflicts remain visible. Project-address membership is explicit; a neighborhood/project proximity match never grants an apartment renewal rights.

Saadia Gaon Oron developer research is separate from official legacy infill plan חפ/2278. Number 8 remains unverified. Reported developer units are attributed facts and do not overwrite collector/official project counts. Existing street-only candidate listings remain unchanged.

Navigation introduces project directory/details and property URLs with return context, and opens the real Areas map from primary navigation. Project rows link through neighborhood and property screens. Future project sources prioritize official boundary/parcel identity, planning/committee documents, building files, executed sales and registry/contract evidence.

Release note: publication authorized on 2026-10-05. GitHub Actions run 37313873168 passed the build and 24 domain/regression tests, applied the additive production migration and seed, and validated real project/address/market contracts. Production release is promoted through main after these checks. House 8 remains unverified; no listings or subscriptions changed. Local browser fixtures remain unexecuted because Chromium is unavailable; production browser acceptance is checked separately during release.

## 23. UX recovery plan — 2026-10-05

See `docs/ux-workflow-plan.md` for observed live UX defects, ordered work and acceptance gates. First batch fixes project list/detail state isolation and render recovery, unifies radar area entry with the canonical map, adds city/radar selectors and remembered Haifa context, and makes follow vs deal initiation explicit. Valuation and active-market evidence labels are shown separately. No new API function or schema is needed. Remaining work includes research filter/scroll restoration, column simplification, actionable evidence-gap tasks and isolated write/agent acceptance. Status must follow actual CI and production acceptance; implementation alone is not completion.

UX first-batch validation: GitHub Actions 37344187882 passed build, 24 domain regressions and desktop/mobile project navigation fixtures, including delayed/malformed API responses and radar→canonical area. Main promotion follows this acceptance; production smoke is a separate release check. Remaining P2/P3 plan work stays open.

Production radar IDs were found to be slugs. The map resolves them through canonical neighborhood rows before requests and normalizes its URL. Final browser acceptance run 37345306175 verifies the real slug/UUID boundary, not an all-UUID fixture. Initial live profile smoke passed; canonical radar smoke follows the corrective release.


## 24. Research UX and investor workflow review — 2026-10-05

Research P2a now uses six core columns, expandable detail, explicit Hebrew filters and draft/applied status, URL-backed filters/sort/paging, session-backed return position, and HTTP/shape errors separate from empty results. Unset numeric filters are omitted because the existing endpoint parses an empty string as zero. Research benchmark labels explicitly describe the 18-month neighborhood median rather than subject-specific valuation. Failed note saves preserve the draft; errors are visible in each workflow section. No schema, finance/valuation calculation, collector or API function changes; 12 entrypoints remain.

GitHub Actions 37348584746 passed build, 24 domain regressions and project/research desktop/mobile fixture suites. Initial fixture contract/label failures and the genuine mobile table-margin overflow were corrected before promotion. Live read-only research API price filtering returned 14 valid rows. Production release and smoke follow the gate; no production QA deal was created.

See `docs/investor-workflow-review-2026-10-05.md`. Live Saadia listing review found a search-page source, missing house/building identity, neighborhood-only comparables with mostly missing addresses, and inconsistent lifecycle values across neighborhood list and Deal Room. Prior Phase 3 isolated database persistence is documented above; it is not a fresh full UI acceptance. Remaining priorities: benchmark/lifecycle evidence consistency, actionable DD evidence and identity tasks, complete explicit underwriting assumptions/scenario switching, stage guidance/workspace, then isolated full-flow and agent acceptance.

## 25. Actionable deal workspace and acceptance — 2026-10-05

Implemented maintained `ui/DealWorkspace.tsx`, copied through injection to the reconstructed UI: source/findings DD editor, identity check, independent owner/due/source/result tasks, complete explicit underwriting fields, loaded saved assumptions (including zero loan), selected outputs vs dirty draft, scenario comparison, stage save/cancel and next-action guidance. Pipeline carries exact deal ID/section and validates listing/deal match; candidates can be compared. Area sections have abort-safe delayed/loading/error/retry states. Benchmark gaps use below/above wording without changing valuation formulas; observed lifecycle >=2 snapshots separated by >=1 day is consistent across area/research/property/active inventory/dashboard/opportunities.

`createWorkflowService` accepts injected database adapters for actual PostgreSQL tests. Creation and multi-write scenario/notes/DD/stage/offer/task operations are transactional; induced SQL failure tests preserve prior saved state. New task schema `032_deal_tasks.sql` is additive and idempotent; task completion does not modify DD verification. It is gated behind explicit workflow-release branch acceptance and existing configured DATABASE_URL, not preview credentials or QA writes to production. No new function or cron; function count 12.

Initial acceptance 37359456259 passed build, 37 domain/persistence/agent-safety/SQL regressions and project/research/workflow desktop/mobile suites. The workflow browser drives the real service on disposable PGlite PostgreSQL. Production schema audit verified existing contracts and taskSchemaReady=false. Preview lacks DATABASE_URL; do not extract/copy production credentials to it. Subsequent acceptance adds actual read-only GET handlers against the configured CI database and isolates assistant conversations by property identity. Final release/run evidence must be appended after it passes; do not infer real deal truth or paid-agent correctness from fixtures.


## 26. Final workflow release and source lifecycle repair — 2026-10-05

Accepted executable code on main (later commits only update documentation): 8d16b994ac920a3a2e063f0555e20e436c4f8627. CI 37364958208 passed build, 40 tests, all three desktop/mobile browser suites, actual live read-only handlers, additive 032 task schema and reviewed 033 lifecycle reconciliation. Production dpl_84ckfRFVyjGT6kM6gcLEGjTfqR26 is READY at https://edge-real-estate.vercel.app (Vite, build 36.2s). Actual post-deploy property/research/deals/edge-data GETs returned 200. No production QA deals; live pipeline remains empty, so isolated PostgreSQL persistence tests are not evidence of a user's existing live deal.

First paid public agent inspection exposed stale DOM=1 in semantic_listing_market_benchmarks despite UI lifecycle NULL. 033 now reconciles derived benchmark lifecycle plus listing_seller_signals and semantic dictionary; future neighborhoodAnalytics uses >=2 snapshots and >=1 observed day. Fingerprint verified asking/valuation/confidence unchanged; listings/snapshots/user workflow untouched. Actual benchmark/seller DOM for reviewed Saadia subject is NULL. SQL failures now retain safe failed-query evidence and schema retry guidance without raw errors. Live agent focused follow-up run 37365808869 was cancelled before any steps ran. It sent zero model questions; cancellation reason is unknown. Do not auto-rerun a cancelled workflow. Post-fix live model response verification remains NOT EXECUTED, distinct from accepted code and actual derived DB checks. The initial pre-fix public agent question ran and exposed the corrected cache inconsistency. Do not infer live paid model correctness from unit mocks.

Public agent readiness: configured true,31 neighborhoods, direct transaction/scored coverage2, listing coverage28, census coverage0. Collection coverage is not comprehensive market truth. Reviewed Saadia still lacks house/building identity and a precise listing source; comps mostly neighborhood-only/missing addresses. Saved search, structured visit form and document repository are future product extensions, not implemented in this repair.

Main local execution and browser disconnected (environment_offline); corrective code persisted through authorized GitHub connector. Local corrective files are not verified synced. On recovery inspect git status first and preserve user edits in docs/renewal-project-research.md, do not reset. Accepted corrective files and final notes are durable in repository. Preview has no DATABASE_URL; never extract prod credentials to it. Existing CI secret was used only for reviewed operations. Runtime scan found known DEP0169 warnings on HTTP200 only; Drains list empty; point-in-time monitoring only.


## 27. Next development round — decision review (2026-10-08)

Previous workflow repair is released; the next investor priority is the step before an offer (investor review item 4). Branch `decision-review` adds a server-composed decision review to the Deal workspace. It combines the explicitly selected saved scenario, acquisition cost, required equity, loan/debt service, cash flow, IRR/target, model maximum price, recorded DD sources, unresolved/missing checks, task owners/dates and next action. This is provisional user-workflow evidence, never a legal or purchase approval. Dated sources and findings are required before a recorded verified check can count as complete in the review; completing tasks does not verify checks. Missing task availability is NULL.

`GET /api/opportunities?mode=decision_review&deal_id=...&listing_id=...&scenario_id=...` uses existing identity contracts. Optional positive `offer_price_nis` computes a read-only preview on the server. Preview changes purchase price only; loan, taxes and fees remain fixed explicit assumptions. Saving an offer remains a separate action. Dirty assumptions and changed preview prices are clearly distinguished from saved results. No schema/migration, new API function, collector or schedule; 12 functions remain.

Explicit exit price suppresses the existing maximum-price output because that solver uses appreciation rather than the explicit exit value. Existing finance formulas and persisted scenarios are unchanged. Available equity and a separate confirmed reserve remain unknown. Model maximum price assumes a proportional loan and fixed costs, not an approved financing ceiling.

Local build and 43 domain/persistence/safety regressions passed (18 Phase 3 + 19 workflow/decision/safety + 6 renewal). Initial concurrent dependency installation caused a transient agent-test import failure; after installation, all 19 tests passed together. Local Chromium download failed; updated CI browser acceptance covers saved scenario selection, offer preview with database non-mutation, stale price invalidation, retry and mobile. CI status and release must be recorded separately; no production user/QA records were created.

Remaining ordered product work: (1) acceptance of this decision-review flow; (2) evidence attributed to individual underwriting assumptions; (3) structured visit capture linked to DD and renovation/rent assumptions; (4) saved searches; (5) document repository and verified property/building/project identity enrichment. Live post-lifecycle-fix paid-agent acceptance remains not executed; do not rerun the cancelled workflow automatically.


## 28. Assumption-level evidence — 2026-10-08

Decision review acceptance completed in CI `37734456784`: 43 tests, three desktop/mobile browser suites, build and actual read-only production contract/GET checks passed. PR #14 remains open and unmerged; production promotion has not occurred.

The next priority is implemented as an extension of the same PR: `assumptions.fieldEvidence` maps the 21 existing assumption keys to `{value, sourceUrl, observedAt, notes}` in the existing JSONB contract. The source remains bound to its recorded numeric value (including zero and optional NULL exit price). Server review classifies each field as missing, assumption, documented, stale or not_used. A documented record requires a safe URL, observation date and finding; this is user attribution, not an automatic truth or legal verification. Changing a value, including purchase price in an offer preview, never silently transfers the old source to the new value. Unused interest/loan term for zero debt, unused explicit exit price and unused appreciation are explicitly excluded from the review count. Legacy scenario-wide evidence does not establish field-level provenance.

The Deal workspace has a compact per-assumption source editor with value/source/date/finding, explicit reattachment after research, draft removal, and scenario-scoped save. The before-offer review shows counts and evidence for each assumption alongside DD/tasks. Existing older clients that omit fieldEvidence retain existing records when updating a scenario; an explicit empty map removes them. Financial formulas and outputs are unchanged. No migration, API entrypoint, collector or cron change; 12 functions remain.

Local build and 46 tests passed (18 Phase 3, 22 workflow/decision/persistence/safety, 6 renewal). New regressions cover value binding, preview staleness, legacy attribution, unused assumptions, unsafe/partial source rejection without DB mutation, retained records on older-client updates and explicit reattachment. Browser CI extends persisted scenario switching, failed-save draft retention, stale-value messages and expanded mobile layout. The CI result is recorded in PR #14 after completion; local Chromium remains unavailable.

Next ordered work: structured visit capture linked to DD and renovation/rent assumptions; saved searches; document repository and verified identity enrichment. Live paid-agent post-lifecycle-fix acceptance remains separately not executed.


## 29. Product review and current priority override — 2026-10-08

Authoritative review: [Edge product review](reviews/edge-product-review-2026-10-08.md), with SELECT-only queries and measured evidence beside it. This section supersedes the earlier **next-work order**, preserving historic completion/release records and user research.

Current release reconciliation: production alias is READY deployment `dpl_EnFsv76PzFtWrH9pWiEwaStKfBhW` at main `60d0e562cf6d7a07120584ae9d48a29bbe22c771`. Earlier executable release/acceptance remains valid history. PR #14 head `d5f70623d86772eec3bb9f98a3933f0900c59665` passed CI37740421333 (46 tests, build, three bounded desktop/mobile suites and actual read-only production checks); **CI accepted, open/unmerged, not released**. Sections27/28's initial pending checks are historical, not current blockers. Fresh review repeats all46 tests/build successfully.

Fresh stored baseline:1478 transactions,1192 flagged/service-valid comparable,459 comparable neighborhood-mapped;42 active sale listings/42 snapshots,0 exact-item URLs,0 lifecycle-supported listings,1 rental,0 canonical buildings/properties,31 neighborhoods,23 curated stat-area mappings,8 provisional CBS rows/0 score-safe/0 official key. Six enabled city collection scopes have no completed cycle/backfill. These are stored sample volumes, not comprehensive market coverage.

Investor conclusion: workflows can support organized research; current identity/availability/rights evidence does not establish the Saadia apartment. Two new integrity defects take precedence: NULL comparable floor→0 and stale area summary (current exact counts26/26/15/4/19 vs cached10/5/0/0/0 across the five focus areas). Existing lifecycle repair remains freshly consistent. No production writes, refresh, collector, paid agent, migration, merge or deployment in the audit.

| Finding ID | Priority | Buyer impact / deliverable | Dependencies | DoD / acceptance | Verification | Status |
| --- | --- | --- | --- | --- | --- | --- |
| EDGE-REV-20261008-01 | P0 | Preserve unknown comparable floors/distances; measured proximity only | Numeric and coordinate evidence contract | NULL/blank/absent stay NULL, genuine0 retained; UI/API/agent parity | Live API vs source floors reproduced; synthetic distance probe | Proposed repair |
| EDGE-REV-20261008-02 | P0 | Align area cache with latest source revision; expose stale as-of | Exact aggregation contract and refresh/invalidation dependency | Isolated ingestion→derived refresh→API equals source counts/medians; stale never silently current | All5 focus areas differ; exact current service-query reproduced | Proposed repair; no audit refresh |
| EDGE-REV-20261008-03 | P1 | Separate neighborhood and listing/building identity | Validated numbered-address/canonical-ID rules | Street-only equality cannot imply same building; no automatic project rights; qualified confidence | Synthetic same-building failure; live identity confidence1 with missing house | Proposed repair |
| EDGE-REV-20261008-04 | P1 | Reviewed closed-sale eligibility and ranked rejection reasons | Approved subject-fit policy; model version | Threshold/rank reasons, bounded fallback, real before/after selection comparison | Live selected60/120m² vs85m²; empty rank reasons; model-policy risk | Proposed policy review/repair |
| EDGE-REV-20261008-05 | P1 | Visible inventory freshness/coverage; source pilot recovery plan | Stable IDs, source access/preferences; no automatic paid collection | Exact sources/repeated observations; staged records separate; absent rent/DOM remain unknown |0/42 exact URLs/lifecycle;0/6 completed scopes;108 awaiting detail | Existing acquisition gap, carried forward |
| EDGE-REV-20261008-06 | P1 | Evidence-backed parcel/neighborhood/building/project enrichment | Provenance/method/version; ambiguity quarantine | Representative mapped identity validated; unresolved membership explicit |733/1192 eligible unmapped; Saadia8 unverified; no canonical buildings | Existing identity gap, carried forward |
| EDGE-REV-20261008-07 | P1 | Official CBS crosswalk and source lineage | Official workbook acquisition + isolated reconciliation | Only supported mappings explicitly promoted; provisional profiles never score-safe by default |0 official-key rows;0/8 safe profiles | Existing enrichment task; guardrail accepted |
| EDGE-REV-20261008-08 | P2 | NULL total units when unknown; partial evidence labeled | Coverage/count vs value contract | Empty/all-NULL/partial/genuine0 unit fixtures; missing/error UI | Synthetic service output0; no current all-NULL renewal neighborhood | Proposed focused hardening |
| EDGE-REV-20261008-09 | P2 | Structured visit findings tied to DD/tasks and assumption evidence | Integrity batch; listing-first workflow, additive contract review | Dated findings/source; explicit assumption reattachment; no automatic legal verification; isolated persistence/mobile | Freeform notes implemented; structured visits absent | Proposed product extension |

### Next coherent implementation batch: Evidence integrity and freshness

Sequence: -01 numeric contracts and -03 identity rules → focused regressions → -02 materialization/invalidation design and isolated equality → -04 policy review and exclusion explanations → -05 truthful coverage/freshness presentation. Do not add a production refresh or paid collection as part of reviewing the plan.

DoD: source NULL floors/distances stay NULL and genuine0 stays0; proximity/building relations require measured/validated evidence; cache source revision and as-of are explicit and exact isolated count/median recomputation matches API; every excluded comp has a reason and selection policy/version is explicit; inventory freshness/incomplete coverage visible; deterministic finance, provisional CBS guardrail, observed lifecycle, independent task/DD status and12 API functions preserved. Build/relevant regression gates plus observed desktop/mobile/keyboard/error acceptance must pass. Production release/live smoke remain separate gates.

After this batch, resume structured visits (-09), then saved searches and documents; identity/source/CBS acquisition remains evidence-dependent work. Future extensions do not reopen accepted phases.

### Review limits

Fresh cloud browser timed out; no new live screenshots, keyboard/zoom/phone/back/refresh acceptance. Prior exact-commit CI proves bounded fixture behavior only. Production deals remain empty; fresh isolated PostgreSQL tests prove mechanics, not a user's deal or professional verification. Live paid-agent post-lifecycle-fix evaluation remains not executed; cancelled run37365808869 is not automatically rerun. External registry/source documents were not newly verified.
