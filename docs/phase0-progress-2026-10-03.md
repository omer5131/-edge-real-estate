# Phase 0 Progress — 2026-10-03

## Status
IN PROGRESS

## Completed
- Authoritative product context added.
- Multi-agent engineering rules added.
- Live production schema/data audit completed.
- Listing-first / canonical-property-aware identity contract locked.
- Evidence/confidence contract locked.
- Phase 1 service contracts drafted.
- Official CBS key importer hardened.
- CBS crosswalk validation report added.
- Isolated Neon validation branch created.
- Property API extended on the Phase 0 branch with:
  - deterministic valuation v1
  - similar active-listing context v1
  - preserved legacy property response fields

## Important implementation constraint discovered
Vercel Hobby allows no more than 12 Serverless Functions per deployment.

Creating separate `api/valuation.ts` and `api/similar-listings.ts` exceeded the function limit.
Those files were removed and the new logic was consolidated into the existing `api/property.ts` function.

This should guide future architecture: prefer mode/domain composition inside existing API entrypoints or consolidate routes before adding new function files.

## Live valuation validation
Test subject:
- listing: `7f68a88a-7b91-4d43-9a0b-ca40cece67ad`
- address: דרייפוס 25
- neighborhood: קריית שפרינצק
- ask: ₪1,780,000
- area: 115m²
- rooms: 4
- floor: 3

The current comparable pool contains duplicate representations of some executed sales. Example fingerprints repeated with the same deal date, amount, area and rooms.

This is a material confidence issue:
- duplicates must be collapsed before weighting/quantiles
- prefer the duplicate row with stronger address/provenance when available

Expected deduped central comp level from the inspected sample is about ₪17.7K/m², implying a rough base value near ₪2.03M for 115m².
This is validation evidence only, not a committed production valuation.

## Active-market validation
For the same subject, current collected similar active inventory in קריית שפרינצק is sparse:
- approximately 3 similar active listings met the initial similarity logic
- this is sufficient for context but should remain provisional/low-confidence
- distance cannot yet be used because canonical property/building/point coverage is incomplete

## Current blockers
### CBS official crosswalk
The official CBS neighborhood/statistical-area key remains empty in production and in the cloned validation branch.
The runtime used by this session could not retrieve the external CBS workbook directly.
Importer/workflow code has been hardened, but analytics-safe promotion remains blocked until the official key is successfully imported and compared to curated mappings.

### Valuation dedupe patch
The duplicate-fingerprint issue is identified and the intended fix is specified.
The connected GitHub contents write path intermittently blocks the specific source rewrite, so this patch is not yet committed.
Do not mark valuation v1 complete until the dedupe is present in code and preview-tested.

### Preview verification
The first standalone valuation endpoint failed because of the Vercel function-count limit.
After consolidation, the latest branch commit is temporarily affected by Vercel build-rate limiting.
Use direct Neon validation meanwhile; preview verification remains required before merge.

## Next actions
1. Land comparable-sale dedupe in `api/property.ts`.
2. Verify consolidated property API on Vercel preview.
3. Add neighborhood Area Intelligence summary to the same property response without adding a new serverless function.
4. Trace and document CBS physical source lineage:
   - Census 2022 view comes from an OVER-backed physical table.
   - Population 2023 and Population 2024 views come from separate OVER-backed physical tables.
5. Validate official CBS key import.
6. Design additive workflow migrations for scenarios, notes, due diligence and timeline.
