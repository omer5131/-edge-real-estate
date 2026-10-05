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
**Phase 2 — Deal Room v1.**

Phase 0 architecture reconciliation and Phase 1 market-intelligence services are complete. The authoritative Phase 1 completion record is `docs/phase1-complete.md`.

Deal Room frontend work may now consume the unified asset-context backend. Do not recreate valuation, active-market, neighborhood or planning calculations in React.

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

## Vercel Hobby deployment constraints — user preference

The user requires Edge to stay within the existing Vercel Hobby plan and avoid deployment failures caused by plan limits. Treat this as a persistent engineering constraint. Verified against live official documentation on 2026-10-05; recheck when changing hosting architecture, schedules, or deployment behavior. Never silently upgrade the plan.

Project: edge-real-estate, Vite + direct Node.js API functions.

- Maximum 12 Vercel Functions per deployment for this architecture. Count deployable API entrypoints (including nested routes) before adding one, and verify generated function count when build output is available. Prefer existing consolidated handlers with domain modules outside api/. Rewrites do not eliminate functions for existing entrypoint files.
- Current documented deployment/build rate limits: 100 per 3600 seconds and 100 per 86400 seconds; API burst limit 60 per 300 seconds. These are owner-scoped and shared with other projects. Older documentation listed 32 builds/hour; do not assume that stale value is current. Any actual provider limit/error and reset/retry information overrides the general reference.
- Hobby permits one concurrent deployment. Batch related changes, build and check locally before release, and avoid repeated retry commits or redundant preview/production builds. A failed attempt may consume quota. On rate limiting, stop retrying until the provider's reset window.
- Maximum build step: 45 minutes. CLI source upload: 100 MB and 15,000 source files. Maximum routes: 2,048; environment variables: 1,000 per environment, 64 KB total names/values. Keep dependencies and generated output out of source uploads.
- Node.js function memory: 2 GB. With Fluid Compute, maximum duration: 300 seconds. Verify the actual project compute mode and configured timeout; do not assume the maximum is enabled on every handler.
- Standard Node.js function bundle limit: 250 MB uncompressed. Keep below this instead of depending on optional large-function beta eligibility. Request/response payload limit: 4.5 MB; paginate SQL results and listing exports.
- Vercel Cron: up to 100 jobs per project, each no more frequent than daily, with execution within the scheduled hour. Use the existing external scheduler for six-hour collection; never add a subdaily Vercel cron expression on Hobby.
- Runtime logs are retained for only one hour. Inspect production status and relevant read-only API responses promptly after release.
- Monthly usage allotments are separate from deployment rate limits. Check current team usage and the official Hobby pricing page before increasing collectors, AI traffic, or function usage.

Before a release: build frontend/backend; run relevant checks; inspect function count, cron expressions, timeouts, upload/bundle sizes where applicable, recent owner deployment activity and any provider quota signals; then perform one release and verify READY plus live responses. This is an operating rule, not a claim that an automated preflight gate is already implemented.

Sources:
- https://vercel.com/docs/limits
- https://vercel.com/docs/functions/runtimes
- https://vercel.com/docs/functions/limitations
- https://vercel.com/docs/cron-jobs/usage-and-pricing
- https://vercel.com/docs/plans/hobby
