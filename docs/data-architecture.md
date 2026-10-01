# Edge data architecture

## Decision

**System of record:** Neon PostgreSQL with PostGIS, deployed alongside Edge on Vercel.

Postgres is the right default because the core domain is relational and spatial: addresses resolve to parcels and buildings; transactions and listings attach to those entities; planning/renewal intersects geography; comparable analysis is naturally SQL-heavy. PostGIS gives us polygon, radius and intersection queries without inventing a separate geospatial store.

## Two-layer ingestion

### Raw layer
Every fetched source row is stored in `raw_records` before normalization.

Key guarantees:
- source provenance is never lost
- payloads are content-hashed
- repeated runs are idempotent
- a changed upstream row is preserved as a new observation
- canonical mapping can be repaired later without re-fetching the source

### Canonical layer
Stable entities are normalized into:
`City → Neighborhood → StatisticalArea → Street → Parcel → Building → Property`

Facts/events around them:
- `Transaction`
- `Listing` + `ListingSnapshot`
- `RenewalProject`
- `PlanningPlan`
- `DemographicSnapshot`
- `InfrastructureProject`

Workflow:
- `Deal`

Derived intelligence:
- `OpportunityScore`
- seller signals views
- comps/valuation outputs

Derived records must carry a model version and input snapshot. They are not presented as source facts.

## Identity and reconciliation

Israeli real-estate data frequently disagrees on spelling and identifiers. Edge treats:
- gush / helka / sub-parcel
- canonical address
- source street code
- statistical-area code
- source-specific IDs

as separate identifiers tied together through `entity_aliases`. A string match alone is never considered authoritative where parcel identity is available.

## Source strategy

### Phase 1 — live now in the collector
1. **OVER Deals REST** — tax transactions.
2. **OVER נדל"ן לעם REST** — parcel/address resolution, coordinates and statistical-area context.
3. **Government urban-renewal dataset via OVER mirror** — project status, plan number, unit counts, permits and source links.

### Phase 2
4. CBS detailed demographic/income/education datasets.
5. Planning Administration / GovMap planning geometries and plan lifecycle.
6. Municipal GIS for permits/building-level planning where useful.
7. Authorized listing feed(s) for active listings and price-history snapshots.

Listing collection must use an authorized feed or connector. The core production agent should not rely on brittle browser scraping.

## Freshness policy

Suggested cadence:
- active listings: every 3–6 hours when feed is available
- tax transactions: daily
- parcel/address identity: on demand + daily enrichment queue
- urban renewal/planning: daily metadata check; ingest only when source changes
- demographics: monthly check (actual releases are less frequent)
- infrastructure: weekly

Every screen should eventually expose source and observation freshness.

## Agent run contract

Each collector:
1. starts an `ingestion_runs` record
2. fetches only its configured scope
3. writes raw payloads
4. normalizes/upserts canonical entities
5. resolves identities where possible
6. records errors without deleting previously valid facts
7. recomputes affected derived intelligence
8. closes the run with counts and status

The scheduled Vercel endpoint is `/api/ingest`; `/api/health` exposes counts and source freshness.
