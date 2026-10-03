# Phase 2.1 — Evidence Stabilization Completion

**Status:** COMPLETE IN CODE / CI GREEN  
**Date:** 2026-10-03  
**Branch:** `phase2.1-stabilization`

## Goal

Stabilize the evidence semantics behind Deal Room before adding stateful investment workflow features.

## Delivered

### 1. Unified confidence scale
All `EvidenceMeta.confidence` values are normalized to 0–1 at service boundaries.

Examples:
- `43.75` → `0.4375`
- `0.88` → `0.88`
- values above 100% clamp to `1`

Aggregate asset confidence now averages normalized values only.

### 2. Active-market eligibility v2.1
Before similarity scoring, candidate active listings must now satisfy:
- same canonical neighborhood
- area within ±25% when area is known
- rooms within ±1 when rooms are known
- valid asking price
- similarity score >= 0.55

Rejected candidates are retained with explicit reasons.

Small inventory remains provisional:
- `supported` requires at least 5 eligible listings
- average similarity must be at least 0.70
- otherwise non-empty evidence is `provisional`

### 3. Lifecycle-aware DOM and seller signals
DOM is no longer treated as zero from one observation.

Rules:
- fewer than 2 snapshots → DOM null
- observed span < 1 day → DOM null
- seller price-reduction signal remains null until lifecycle evidence is supported
- subject-property seller context exposes lifecycle evidence and snapshot count

### 4. Truthful source-link provenance
Source URLs are classified as:
- `item`
- `search`
- `unknown`

Deal Room labels an item-specific URL as the original listing.
Search/result URLs are labeled as source/search pages instead.

### 5. Deal Room messaging
Deal Room now explains:
- provisional lifecycle evidence
- rejected active-market candidates
- exact-listing vs search-page source provenance
- DOM evidence requirement

## Regression coverage

Added tests for:
- confidence normalization to 0–1
- 3 active listings remaining provisional
- material size mismatch rejection
- DOM remaining unknown after one snapshot
- source URL classification
- existing valuation duplicate collapse
- sparse valuation
- missing canonical identity
- provisional CBS guardrails
- planning provenance

Phase 2.1 CI passed:
- server typecheck
- context regression tests
- reconstructed frontend production build

## Real-data validation

Subscribed validation asset:
- דרייפוס 25, קריית שפרינצק
- subject area: 115m²
- rooms: 4

The current same-neighborhood active candidates are:
- 52m² / 2.5 rooms
- 80m² / 3.5 rooms
- 85m² / 4 rooms

All have one snapshot and zero observed lifecycle span.

Under Phase 2.1 they are not presented as supported similar inventory:
- the 52m² unit fails size and room eligibility
- 80/85m² units fall outside the ±25% area band for the 115m² subject
- DOM remains unknown rather than zero

This is the intended conservative behavior.

## Phase 2.1 exit criteria

PASS:
- confidence scale consistent
- sparse active market remains provisional
- hard comparable eligibility exists
- rejected candidates are explainable
- DOM is lifecycle-aware
- source-link provenance is explicit
- tests/build green
- no schema migration required

Production deployment is a release step after merge and does not change the completed domain contract.
