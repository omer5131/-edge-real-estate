# Phase 0 Data Lineage and Validation

## CBS / official area analytics lineage

The current semantic neighborhood profile is built from three official-data research views:

### Census 2022
View: `research_census_2022`

Physical source:
`over_381705652f084634b057182076833c4b`

Key grain:
`locality_code + statistical_area_code`

Used fields include:
- population
- median age
- academic certificate rate
- employment rate
- median employee wage
- average household size
- owner household share
- renter household share

### Area Population 2023
View: `research_area_population_2023`

Physical source:
`over_257656ba4b4b40209f9ae35c49f41f9a`

Key grain:
`locality_code + statistical_area_code`

Primary use:
- population by 2022 statistical area for observation year 2023

### Area Population 2024
View: `research_area_population_2024`

Physical source:
`over_a13c151c4d364e9e8587587ef4da9389`

Key grain:
`locality_code + statistical_area_code`

Primary use:
- population by 2022 statistical area for observation year 2024

### Semantic projection
View:
`semantic_neighborhood_cbs_profile`

Backed by:
`neighborhood_cbs_profiles`

Important:
the physical data is present, but neighborhood aggregation remains provisional until the official CBS neighborhood/statistical-area key is imported and reconciled with current curated mappings.

Current profile rule:
- `profile_quality = provisional`
- `safe_for_score = false`

This must remain true until crosswalk validation passes.

## Property context implementation status

The Phase 0 branch extends the existing `api/property.ts` response rather than adding new serverless functions.

Reason:
Vercel Hobby enforces a 12 Serverless Function deployment limit.

New full-tier fields:
- `valuation`
- `activeMarket`
- `areaContext`

The existing response fields are preserved for backward compatibility.

### Valuation v1
Current model dimensions:
- canonical neighborhood
- area similarity
- room similarity
- floor similarity
- transaction recency

Known limitation:
building/street/distance identity is not yet available for current listings.

Known data-quality issue:
duplicate representations of the same executed sale exist in the transaction pool and must be collapsed by transaction fingerprint before final confidence/quantiles are considered complete.

### Active Market v1
Current model dimensions:
- canonical neighborhood
- area similarity
- room similarity
- floor similarity

Outputs:
- similar active inventory
- median asking price
- median asking price/m²
- median DOM
- subject asking percentile
- subject delta to median

Because current listing coverage is sparse, evidence status must remain provisional when sample size is small.

### Area Context
Uses:
- `semantic_neighborhood_summary`
- latest `semantic_neighborhood_cbs_profile`

CBS status is surfaced as provisional when `safe_for_score=false`.

## Deal workflow schema validation

Draft migration:
`db/028_deal_workflow_normalization.sql`

Validated successfully on isolated Neon branch:
`br-mute-violet-b4ibdibv`

Created successfully:
- `deal_scenarios`
- `investment_notes`
- `due_diligence_items`
- `deal_events`

No production schema changes were made.

## Current gates before Phase 1 is considered stable

1. Land comparable-sale fingerprint deduplication in property valuation.
2. Verify consolidated `api/property.ts` on Vercel preview once build-rate capacity is available.
3. Import official CBS neighborhood key on isolated branch.
4. Compare official key against the nine curated target-neighborhood mappings.
5. Only then promote matching CBS profiles from provisional to analytics-safe.
