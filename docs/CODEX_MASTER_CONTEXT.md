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

### Phase 0 — Architecture reconciliation
Audit live schema/data and lock contracts before broad feature work.

### Phase 1 — Market Intelligence services
Identity + CBS/Area + Transactions/Valuation + Listings + Planning.
Acceptance: a property-context API can return subject, area intelligence, comps/valuation, active alternatives, planning context, provenance/confidence.

### Phase 2 — Deal Room v1
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
