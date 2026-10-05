# Renewal project profiles and source readiness

Reviewed: 2026-10-05. This is a research and acquisition plan, not a claim that every source is collected.

## Decision-critical sources

| Priority | Source | What it resolves | Acquisition / identity | Current readiness |
|---|---|---|---|---|
| P0 | Haifa engineering GIS | Renewal boundaries, deposited/approved plans, cadastral geometry, zoning and constraints | Public ArcGIS REST service, renewal layer 36 and parcel/plan layers; join geometry/parcel identity, retain layer object ID and source timestamp | Public service and schema verified; collector integration still required |
| P0 | Mavat / XPLAN and municipal committee | Plan number, blue line, statutory decisions, objections, deposited vs approved version | Official plan record and documents, match plan number and geometry; local committee is necessary for local plans | XPLAN collector exists; committee/document enrichment is incomplete |
| P0 | Haifa scanned building files | Permit plans, requests, floor layout, legal area, occupancy forms, building-specific execution evidence | Exact address → building-file number → request and document; record file/request IDs and document dates | Public service documented; no building-file collector yet |
| P0 | Tax Authority executed-sale data | Original transaction attributes, partial ownership, dates, amount and cadastral identifiers | Existing transaction tables plus original source verification by block/parcel/subparcel; keep exclusions and duplicate resolution | Transactions and comp filters exist; exact building attribution remains incomplete |
| P0 | Registry extract and condominium documents | Registered rights, encumbrances, legal apartment identity, registered area and attachments | Official extract/document request after block/parcel/subparcel identification; acquired document is time-specific | Manual acquisition needed; not described as a free bulk API |
| P0 | Signed resident/developer documents | Contractual inclusion, consideration, representation, guarantees, rent, deadlines, financing | Upload signed scope/contract and tag document/date/parties; apartment-specific terms require apartment-specific evidence | Missing for Saadia Gaon; media claims do not replace signed documents |
| P1 | Developer disclosures / MAYA | Project-size changes, reported signatures, forecasts, parties and financial progress | Versioned PDF claim extraction by source/page/date; refresh on new disclosures and preserve old versions | March 2026 Oron presentation researched and attributed; later disclosures need verification |
| P1 | Municipal renewal authority | Local project registry, building lists, public consultation, execution coordination | Versioned official address list / project table; exact city/street/house numbers and plan identity | Municipal list reviewed; old infill and Oron kept separate |
| P1 | Active listings and rentals | Current asks, inventory, observed price changes, investor alternatives | Existing listing pipeline and manual ingestion; link only through verified building/parcel or exact documented addresses | Existing pipeline; approximate coordinates and street-only listings cannot confirm membership |
| P2 | CBS, education, transport and environment | Neighborhood context and long-term investment thesis | Canonical neighborhood/statistical-area mapping with year/version; contextual geography | Existing research layers; provisional CBS mapping stays non-scoring |

Verified source links:

- Haifa public engineering service: https://gisserver.haifa.muni.il/arcgiswebadaptor/rest/services/PublicSite/Haifa_Eng_Public/MapServer
- Renewal layer: https://gisserver.haifa.muni.il/arcgiswebadaptor/rest/services/PublicSite/Haifa_Eng_Public/MapServer/36
- Statutory plan information: https://mavat.iplan.gov.il/SV3?searchEntity=1
- Haifa project registry: https://www.haifa.muni.il/development-and-construction/urban-planning/urban-renewal/planning-activity/
- Haifa planning information: https://www.haifa.muni.il/development-and-construction/urban-planning/information/
- Haifa building-file service instructions: https://www1.haifa.muni.il/apps/handasasys/images/Instructions.pdf
- Executed-sale source: https://www.gov.il/he/departments/targetaudience/taxes-audience-seller-buyer-real-estate
- Registry extract: https://www.gov.il/he/service/land_registration_extract
- Oron March 2026: https://mayafiles.tase.co.il/rpdf/1729001-1730000/P1729033-00.pdf (page 18)

## Delivered contracts

Existing `/api/renewal` collector response remains available. Project research uses the same function:

- `GET /api/renewal?view=profiles` — directory, bounded to 300 rows.
- Optional `city`, `neighborhoodId`, `q` filters.
- `GET /api/renewal?view=profiles&id=<uuid>` — profile, attributed claims, exact address membership, parcels, listings and executed sales.

Schema: `db/031_renewal_project_profiles.sql` adds project research, attributed facts and exact addresses. Existing collector fields remain untouched. Reported Oron unit counts live in attributed facts; canonical official counts are not overwritten with forecasts. SQL Explorer and the SQL agent understand these datasets.

Membership: `verified`, `reported`, `unverified`, `excluded`. Absent is unknown. Street ranges, neighborhood co-location and source marketing never automatically confirm apartment inclusion. City identity is mandatory for address joins. Market rows carry membership, so candidate rows cannot be silently promoted to project comparables. No automatic post-renewal valuation is calculated.

## Saadia Gaon research

Two different projects exist:

1. Oron developer project: reported 133 existing / 536 planned / 403 marketed units; 85% signatures and Q4 2028 permit forecast in the March 2026 presentation. These are developer claims. No approved evacuation date is available. Earlier reporting used different project dimensions and address ranges; conflicting scope is retained.
2. Official legacy infill record: Moradot Carmel Tzarfati, plan חפ/2278, source project 32949. Municipal August 2025 address list names odd-numbered Saadia Gaon groups. Its approval and execution status must not be transferred to Oron.

House 8 is an unverified research address for Oron. No street-only listing is changed to house 8. The actual purchase candidate requires cadastral identity and signed/official project scope before renewal rights are counted in underwriting.

## Navigation

Primary project directory and URL-backed routes `#/renewal`, `#/renewal/<id>` and `#/property/<id>` support sharing, refresh and browser history. The primary Areas entry opens the actual area-intelligence map. Project rows in the neighborhood and property context open profiles. Property back returns to the source screen. Each project separates overview/stages, addresses/parcels, asking listings/executed sales, sources and gaps.

## Remaining collection work

The delivered profile is a research surface with seeded evidence, not completed integration of every source. Next collector tasks: exact GIS boundary and parcel reconciliation, committee/building-file document ingestion, newer developer disclosures, evidence-change notifications and signed-document intake. Validate each adapter and freshness policy before advertising it as connected.

## Release state

Implementation is currently local on branch `renewal-project-profiles`. Frontend/backend build and six project/schema/query/evidence tests pass, along with 18 investment-context regressions. Schema and seed have **not** been applied to production. Public GitHub push was rejected by automatic approval review, which requires explicit user authorization to publish the changed code. The existing production application is unchanged.

Browser navigation fixtures are prepared in `tests/renewal-navigation.test.mjs`. Browser execution is pending: the environment has no Chromium executable and its browser download failed. Do not describe browser acceptance or mobile verification as passed until this test can actually run.

Attributed research projects are excluded from automatic opportunity-scoring evidence and official neighborhood evidence registration. Their planning-context evidence remains provisional. A project profile alone must not give a listing an official renewal bonus.
