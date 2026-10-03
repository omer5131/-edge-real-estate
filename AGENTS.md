# AGENTS.md — Edge engineering operating rules

This repository builds Edge, a residential real-estate acquisition operating system.

## Product mission
Help the user move end to end from market research to a purchase decision:
Discover → Understand Area → Inspect Property → Compare Evidence → Underwrite → Track → Due Diligence → Negotiate → Decide.

## Authoritative evidence model
Do not collapse these layers:
1. **CBS + canonical official datasets** own structural area/neighborhood analytics and long-term trends.
2. **Closed executed transactions** own property valuation evidence and comparable-sale analysis.
3. **Active listings** own live competitive context: asking prices, inventory, DOM, price reductions, seller signals.
4. **Planning / renewal / infrastructure** own future-change context.
5. **User workflow data** owns notes, stages, scenarios, due diligence, tasks, and decisions.

Missing data is never zero. Show insufficient evidence when coverage is inadequate.

## Geographic identity
Use one canonical neighborhood identity across listings, transactions, CBS, renewal, planning, analytics, dashboards, and agents.
Target graph:
City → Neighborhood ↔ Statistical Area → Street → Parcel → Building → Property → Listing.
Relationships may be spatial/weighted rather than strictly hierarchical. Store mapping method, confidence, provenance, and version.

## Engineering rules
- Neon PostgreSQL + PostGIS is the system of record.
- Preserve raw/canonical separation.
- Derived metrics must be reproducible, versioned, and distinguishable from source facts.
- Do not put deterministic finance or valuation logic in React or LLM prompts.
- Standard product questions should use domain services; exploratory questions may use the read-only SQL agent.
- Do not commit credentials. DEEPSEEK_API_KEY and DATABASE_URL remain server-side.
- Prefer additive migrations and backward-compatible APIs.
- Every domain change requires tests and provenance/confidence handling.

## Current Phase
**Phase 0 — Architecture reconciliation.**
Do not perform a broad UI redesign yet.

Before feature work, inspect actual production schema/data and lock:
- entity identity contracts
- CBS source-of-truth contracts
- neighborhood/statistical-area crosswalk rules
- valuation/comps contract
- similar-listings contract
- Deal/workflow contract
- API response contracts
- confidence/provenance rules
- migration dependency graph

Read `docs/CODEX_MASTER_CONTEXT.md` and `docs/phase0-architecture-reconciliation.md` before making cross-domain changes.

## Parallel-agent ownership
- Orchestrator: contracts, sequencing, integration, acceptance.
- Identity/Geo: canonical identity, crosswalks, spatial mapping.
- CBS/Area: official datasets, aggregation, neighborhood intelligence.
- Transactions/Valuation: comp selection, deterministic valuation, confidence.
- Listings: collection, snapshots, similar inventory, seller signals.
- Planning/Renewal: renewal, XPLAN, infrastructure context.
- Deal Engine: acquisition/financing/return scenarios.
- Workflow: notes, stages, due diligence, timeline.
- Frontend: Discover, Research, Deal Room, Areas, My Deals, Compare.
- AI/Semantic: contextual Ask Edge, domain tools, SQL agent.
- QA/Evals: contracts, data quality, regression, E2E, browser checks.

No agent may independently redefine shared identifiers or metrics such as neighborhood_id, property_id, fair_value, confidence, discount_pct, listing status, or deal stages.

## Definition of done
A feature is done only when relevant schema/API/semantic/UI/tests are all aligned, missing evidence is handled correctly, desktop/mobile states are usable, typecheck/build pass, and the E2E path has been verified.
