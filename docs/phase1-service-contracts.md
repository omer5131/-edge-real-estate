# Phase 1 Service Contracts — Draft v1

These contracts are established during Phase 0 so parallel Phase 1 agents can implement independently without redefining domain semantics.

Runtime/type definitions live in `server/contracts/investmentContext.ts`.

## Asset identity
Current production is listing-first because `properties` and `buildings` are empty.

Therefore every investor workflow must accept a listing as the minimum stable asset reference.

```
listingId required
propertyId optional
buildingId optional
neighborhoodId optional
```

Canonical property/building linkage can be enriched later without blocking Deal Room creation.

## Evidence envelope
Every derived response must state whether it is:
- supported
- provisional
- insufficient_evidence
- unavailable

The response should also carry confidence, sample size, freshness, model version, source IDs, and explanatory notes where relevant.

## Asset context
Target:
`GET /api/assets/:listingId/context`

Combines but does not conflate:
- subject listing
- deterministic closed-sale valuation
- active-listing competitive context
- neighborhood intelligence
- planning/renewal/infrastructure context

## Valuation
Target:
`GET /api/assets/:listingId/valuation`
`GET /api/assets/:listingId/comps`

Current production behavior is NOT the target model:
- Research estimates value from subject area × neighborhood median comparable ₪/m².
- Property API selects recent transactions in the same neighborhood with subject area ±20%.

Phase 1 must replace this with a deterministic similarity model that prefers same-building, same-street, nearby, then neighborhood evidence and records selected/rejected reasons.

The current approximation may remain as a fallback only if explicitly labeled and versioned.

## Similar active listings
Target:
`GET /api/assets/:listingId/similar-listings`

This is separate from valuation.
It compares current asking inventory and returns asking-price distributions, DOM, price changes, inventory count, and subject position.

Never feed asking prices into closed-sale valuation without explicit model semantics.

## Neighborhood intelligence
Target:
`GET /api/neighborhoods/:id/intelligence`

CBS/official canonical data owns structural area analytics.

Current CBS neighborhood profiles are provisional because the official neighborhood/statistical-area key has not been populated in production. These metrics must retain provisional status until the crosswalk validation is complete.

## Compatibility
Existing routes such as `/api/property?id=...` and `/api/opportunities` may remain during migration.

New domain services should be introduced behind stable contracts, then old UI consumers can migrate incrementally.

## Contract invariants
1. Missing evidence is not zero.
2. Asking price is not sale price.
3. Neighborhood trend is not property valuation.
4. LLM explanation is not deterministic calculation.
5. A user can open/manage a Deal Room before property/building resolution is complete.
