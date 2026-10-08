# Edge product review — 2026-10-08

**Status: partial live review; code, production API and database verified; fresh visual audit blocked.**
Main coverage query timestamp: 2026-10-08 13:24:39 UTC (16:24:39 Asia/Jerusalem); follow-up API and source probes performed later in this review. Measurements are point-in-time snapshots, not market completeness claims.

## Investor conclusion

Edge can organize research and underwriting, but the evidence currently cannot establish the identity, availability or renewal rights of the Saadia Gaon apartment. Fix two integrity issues before adding another workflow feature: unknown comparable floors become ground-floor values, and the area market cache materially understates current executed-sale coverage. Broad neighborhood valuation and a score must not be treated as purchase approval.

The decision-review and assumption-source continuation has passed CI on PR #14, but remains unmerged and absent from production. Preserve that accepted work. The next batch is evidence integrity and freshness; structured visits follow it.

## Baseline and review scope

| Surface | Exact baseline / evidence |
| --- | --- |
| Repository | `omer5131/-edge-real-estate`; instructions: `AGENTS.md`, authoritative `docs/CODEX_MASTER_CONTEXT.md`, detailed `docs/ux-workflow-plan.md`; architecture and prior investor review read |
| Production + main | Main `60d0e562cf6d7a07120584ae9d48a29bbe22c771`; Vercel production alias resolves to **READY** `dpl_EnFsv76PzFtWrH9pWiEwaStKfBhW`, same SHA. This supersedes the older deployment ID as current state, without changing its historical acceptance |
| Pending code | PR [#14](https://github.com/omer5131/-edge-real-estate/pull/14), `decision-review` head `d5f70623d86772eec3bb9f98a3933f0900c59665`, open/unmerged; CI [37740421333](https://github.com/omer5131/-edge-real-estate/actions/runs/37740421333) completed/success at that SHA |
| Local | `assumption-evidence`, `d849630`; same accepted source tree, alternate local commit. Untracked reconstructed frontend preserved. No application source edit in this review |
| Database | Neon project `small-mode-04805717`, production branch `br-gentle-hat-b4hixvjz`, `neondb`; schema inspected before SELECT-only queries |
| Fresh live GETs | HTTP 200: Saadia property, Drayfus property, research search for גלי הים, empty deals pipeline. No POST, collector, refresh, migration, agent question or production QA record |
| Fresh isolated checks | 46 tests pass: 18 Phase 3/context, 22 workflow/decision/PostgreSQL rollback/agent safety/SQL, 6 renewal. Build/typecheck pass. PGlite persistence is disposable, not user production data |
| Browser/layout | Cloud-browser creation/navigation timed out without usable DOM or screenshot. Fresh desktop 1440×1000, phone 390×844, keyboard/focus/zoom, refresh/back and visual hierarchy checks **not executed**. No conclusion that the site itself is down |
| Prior bounded browser evidence | Accepted CI includes renewal/research/workflow suites, desktop 1440×900 or 1440×1000 and phone 390×844, failed saves/retry, return context, expanded assumption editor overflow. This is exact-commit fixture acceptance, not a fresh live visual review |
| Agent | Read-only SQL safety tests pass; post-lifecycle-fix live paid-model answer remains not executed. Cancelled run 37365808869 was not rerun |

Evidence: [read-only audit queries](edge-product-review-2026-10-08.sql) and [measured results/API excerpts](edge-product-review-2026-10-08-evidence.json). External source documents were not newly researched; project membership below reports stored, attributed evidence.

## Journey matrix

Results describe the stated verification layer, not an overall end-to-end purchase sign-off.

| Journey / goal | Steps and expected contract | Observation / evidence | Result |
| --- | --- | --- | --- |
| Discover → Research | Search outside followed areas without converting absent valuation to zero | Live `/api/opportunities?mode=research&q=גלי הים&limit=25` returns one unfollowed Netanya listing; ask ₪3.15M, comps 0, estimated value NULL, confidence insufficient | verified at API; live UI not executed |
| Research → Area | Canonical identity, accurate 12m executed count/date and median | Saadia context uses canonical UUID and provisional CBS; area cache says 5 sales while identical current aggregation yields 26 | issue: EDGE-REV-20261008-02 |
| Project → Building/Property | Distinguish approved plan from developer forecast; exact membership | Stored Oron project house 8 remains unverified. Sixteen odd-number addresses are verified only for legacy חפ/2278. No project parcel links; no canonical building/property rows | verified data guardrail; live navigation not executed |
| Property identity/source | Address, source, coordinates and availability must remain qualified | Saadia is street-only, search URL, no coordinates/property/building. API identityEvidence nevertheless says supported/confidence 1; Drayfus has a numbered address but the same unresolved links | issue: -03; data gap: -05 |
| Property → Comps | Executed sales, truthful null fields, subject-fit/rejection reasons | Live 12 selected Saadia comps have NULL source floors but output 0; all addressless/same-neighborhood. Recomputed low/base/high matches live exactly | issue: -01, -04 |
| Property → Active market | Hard size/room eligibility; sparse inventory provisional | Saadia one eligible alternative, ₪1.49M median, provisional; Drayfus none, benchmark NULL. Rejected candidates have explicit reasons | verified live API |
| Follow → Deal | Correct deal/listing identity and independent follow/write flow | Live GET pipeline empty (0 deals); accepted isolated tests create/refresh correct deal and test rollback. No fresh live follow/write attempted | verified isolated; live mutation not executed |
| DD → Tasks/Visit | Dated findings, task completion independent of DD | Fresh PostgreSQL tests pass DD/task persistence and rollback. Structured visit form remains future work | verified isolated; visit not applicable to released scope |
| Scenarios → Compare | Zero debt, explicit defaults, selected saved results, dirty drafts, field provenance | 46 tests + accepted CI cover persistence, zero loan, reattachment/staleness, scenario switching/comparison and mobile fixtures | verified isolated/CI; pending release |
| Before offer → Decision | Explicit saved scenario; nonmutating price preview; unresolved checks and model limits | PR #14 accepted at exact SHA; sources bound to value, fixed costs/loan and explicit-exit solver caveat preserved | verified CI; production feature not executed |
| Return → Tracking | URL/back/scroll restoration, precise deal section, observed lifecycle | Prior bounded CI accepts navigation; current seller view and semantic cache contain 0 unsupported lifecycle claims. All listings have single snapshots | verified DB/CI; fresh visual return not executed |
| Layout / language / errors | Readable RTL, clear hierarchy, keyboard/zoom, bounded phone tables | Source and existing test scope reviewed; no current screenshots. Areas contains mixed English/Hebrew labels; usability impact requires observation | not executed live; no invented visual defect |
| Ask Edge | Context isolation, actual queries vs proposed SQL, no fabricated evidence | Fresh safety tests pass. No paid live query or cancelled-run retry | verified tests; live answer not executed |

## Coverage and freshness

Denominators cover the whole stored population, not paginated API samples. Eligible sales require `is_comparable=true`, positive price/price-per-m² and a date within five years, as in the valuation service.

| Domain / usable criterion | Numerator / denominator | Freshness and limitation |
| --- | --- | --- |
| Active sale latest positive ask/area/rooms | 42 / 42 active; 42 / 42 total listings | Every latest snapshot is 2026-10-02; stored active status does not establish current availability |
| Canonical sale neighborhood | 42 / 42 | 28 / 31 neighborhoods have listings; five focus areas contain 16 / 42 |
| Numbered sale address (digit heuristic) | 18 / 42 | House-number syntax is not registry identity; 24 street-only records |
| Exact sale item URL | 0 / 42 | Search pages retained with sourceUrlKind=search; cannot verify individual availability |
| Canonical property / building linkage | 0 / 42 for each | Canonical properties=0; buildings=0. Precise subject coordinates NULL in both sampled full profiles; whole-population coordinate precision not measured |
| Supported observed lifecycle | 0 / 42 | 42 snapshots total; requires ≥2 observations spanning ≥1 day. Seller/cache invalid lifecycle claims=0 |
| Rentals | 1 active / 1 stored rental | Only Ahuza; 0 rental rows in all five focus areas. No defensible automatic focus-area rent estimate |
| Comparable flags | 1,192 / 1,478 transactions | 1,192 satisfy the five-year service-wide validity filter; only 459 / 1,192 also have canonical neighborhood, so are reachable by listing-neighborhood matching |
| Transaction neighborhood | 647 / 1,478 | 831 unmapped overall; 733 / 1,192 eligible unmapped. Parcel IDs 1,478 / 1,478 do not by themselves establish neighborhood/building identity |
| Transaction address / street / property | 6 / 1,478; 6 / 1,478; 0 / 1,478 | 13 extra eligible fingerprint representations (within neighborhood/date/amount/area/rooms/floor) remain in source pool; model collapses fingerprints |
| Transaction recency | 1,067 / 1,478 within 12m | Dates span 2022-01-03–2026-08-23. Latest target-parcel ingestion 2026-10-08 inserted 28; collection success does not prove complete city coverage |
| Neighborhood eligible sales | 15 / 31 neighborhoods | Five focus areas have 315 eligible / 464 total transactions. Outside focus: 144 eligible / 183 total mapped |
| CBS profiles | 8 stored rows / 4 neighborhoods / 31 neighborhoods | 2022 and 2024 rows, all provisional, 0 / 8 safe_for_score; calculated 2026-10-03 |
| Official crosswalk / base CBS population | 0 official key rows; 0 / 3,750 base statistical areas with population | 23 curated stat-area mappings are not an official analytics-safe crosswalk. 0 explicitly CBS/census/population/socioeconomic titled OVER catalog rows; historical lineage documentation retained |
| Renewal | 125 stored projects; 116 / 125 source URL; 0 / 125 geometry; 122 / 125 known planned units | Latest government ingestion 2026-10-08 updated 124. 17 address evidence rows, 16 verified for one legacy plan, one unverified; 0 parcel links |
| Workflow | 0 deals, scenarios, DD items and tasks | Empty production is not a failure; no user write acceptance claimed |

**Scope definition:** outside-focus mapped transactions are **183 / 647 total mapped**, of which **144 / 459 mapped eligible** are outside focus. These are source volumes, not valuation sample sizes. No market-coverage percentage can be inferred without a source acquisition denominator.

City totals: Haifa 1,241 transactions / 1,039 eligible / 410 neighborhood-mapped; Netanya 116 / 50 / 116; Petah Tikva 121 / 103 / 121. All 831 overall unmapped records are in Haifa.

| Focus area | Stored active sale | Transactions total / eligible 5y | Cached 12m count | Current exact service-query 12m count |
| --- | ---: | ---: | ---: | ---: |
| קריית אליעזר | 4 | 97 / 63 | 10 | 26 |
| קריית שפרינצק | 4 | 111 / 84 | 5 | 26 |
| נווה דוד | 1 | 19 / 15 | 0 | 15 |
| קריית נורדאו | 4 | 116 / 50 | 0 | 4 |
| יוספטל | 3 | 121 / 103 | 0 | 19 |

All five cache rows date to 2026-10-03; the current service-query recomputation reproduces the exact joins and filters in `refreshMetrics`, including resolved geography. Row counts equal distinct transaction counts in this sample. Current comparable medians respectively: ₪20,476, ₪17,669.5, ₪23,762, ₪20,880, ₪27,517/m². These current medians are **audit computations**, not a production refresh or a new subject valuation.

Acquisition: six city sale/rent scopes enabled, **0 / 6 completed initial backfill or a completed cycle**. Stored errors include provider authorization, missing stable listing ID and a prior access failure. Raw staging has 51 sale + 57 rent records awaiting detail; these 108 records are not 108 usable listings. The Yad2 workflow schedule is deliberately paused pending the pilot; enabled source flags do not prove collection runs. No collector, credential replacement or paid provider request was triggered.

## Findings and recommended delivery

| ID | Type / priority | Buyer consequence and evidence | Deliverable / objective acceptance |
| --- | --- | --- | --- |
| EDGE-REV-20261008-01 | reproduced_defect / **P0** | `valuationContext.map` uses Number(NULL): source unknown floor becomes 0 in live API for all 12 selected comps in each sampled subject. Synthetic NULL distance becomes 0 and relation nearby; absent distance in current production SELECT remains NULL | Null-safe numeric mapping for all comparable/active outputs; preserve genuine zero; proximity requires measured finite distance and provenance. Regression for NULL/undefined/blank vs zero and live source/API parity |
| EDGE-REV-20261008-02 | reproduced_defect / **P0** | Area summary reads stale neighborhood_map_cache. All 5 focus counts differ from the identical current refresh query; live Saadia says 5 instead of 26. Current cached ₪18,017/m² vs recomputed ₪17,669.5 | Review refresh/invalidation and source-to-derived revision alignment; expose as-of/stale evidence; no silently current label. Isolated ingestion→materialization→API equality at exact window; authorized release separately |
| EDGE-REV-20261008-03 | reproduced_defect / **P1** | Synthetic equal street-only addresses are called same_building in valuation/history; asset identity is supported/confidence 1 merely because neighborhood exists, including live street-only Saadia | Separate neighborhood mapping, listing identity and exact building evidence; same-building requires canonical ID or validated full numbered address; street-only equality never proves building/project membership. UI/API/agent regressions |
| EDGE-REV-20261008-04 | code_risk + reproduced explanation defect / **P1** | Valuation soft similarity selects 60m² and 120m² among Saadia's 12 comps for an85m² subject; median model is not a size-adjusted appraisal. Candidates excluded only by top12 have empty rejection reasons; synthetic170m² may pass. Historical/active services use harder subject bands | Explicit reviewed closed-sale eligibility policy, bounded fallback and model version; reasons for threshold vs rank-limit rejection, identity/fit separated from sample confidence. Compare before/after real candidates; approve policy before changing valuation outputs |
| EDGE-REV-20261008-05 | data_gap / **P1** | Old single-snapshot, search-page inventory cannot establish active availability, seller changes or rent. Six scopes lack completed backfill;108 staging records await detail | Coverage/freshness panel and source-specific pilot recovery plan with stable IDs, exact source links and repeated observations. First deliverable can expose truth without paid recollection. No inferred availability or invented rent/DOM |
| EDGE-REV-20261008-06 | data_gap / **P1** |733 eligible sales cannot match a listing neighborhood; addresses exist on6 transactions;125 renewal projects have no geometry/parcel links. Saadia8 unresolved | Prioritized geography/identity enrichment with source/method/version/confidence and ambiguous quarantine. Resolve representative parcel evidence; never promote proximity into rights. Preserve listing-first workflows |
| EDGE-REV-20261008-07 | data_gap / **P1** | Official CBS key absent;0 score-safe profiles despite physical rows and curated mappings | Continue existing crosswalk/lineage acquisition task; evidence-backed isolated reconciliation before analytics-safe promotion. Existing provisional guardrail stays closed/accepted |
| EDGE-REV-20261008-08 | code_risk (synthetically reproduced) / **P2** | Area service COALESCE(SUM(units),0) can report zero units when no coverage or all values NULL; insufficient-evidence metadata accompanies it. No all-NULL renewal neighborhood currently found | Distinguish stored row count0 from unknown total units; all-unknown sum NULL, partially known sums marked partial. Verify isolated empty/all-NULL/partial/genuine-zero cases; do not claim a current all-NULL live area defect |
| EDGE-REV-20261008-09 | product_extension / **P2** | Visit findings remain freeform notes; no structured visit form ties observed condition to renovation/rent assumptions | After integrity batch: dated visit, listing identity, condition/findings, attributed cost/rent observations and resulting tasks. Visit or task completion never verifies legal DD; assumption source updates explicit |

No completed Phase0–2 work is reopened wholesale. The floor and cache defects are new focused regressions; the previously repaired lifecycle cache is freshly consistent. Exact source, geography, rent and CBS gaps carry forward prior enrichment work rather than duplicating or relabeling it as a new UI bug. Saved searches/documents remain later extensions.

## Plan changes and next batch

Both master context and UX plan append this review and reconcile PR #14 to **CI accepted, not released**. Historical deployment/CI records remain intact.

**Next batch: Evidence integrity and freshness** — -01, -02, -03, -04 policy review, and truthful freshness/coverage messaging from -05. Sequence: numeric/identity contract → focused regression tests → cache refresh dependency design → isolated recomputation/parity → desktop/mobile evidence presentation → approved release gate. Do not run a production refresh from the audit.

DoD: source NULL floors/distances stay NULL, real ground floors stay0; street-only identity cannot yield same-building confidence; stale area outputs cannot appear current; exact query counts/medians agree after isolated refresh; every excluded comp has a reason and subject policy is versioned; source ages/incomplete collection visible; server build and relevant regressions pass; desktop/mobile/keyboard/error states inspected; existing finance formulas, CBS safety, observed lifecycle, task/DD independence,12 functions and paused collection preferences preserved. Release and live smoke are separate statuses.

Then resume structured visits (-09), saved searches and documents/identity enrichment. Crosswalk/acquisition tasks remain dependencies on authoritative analytics, not blockers to keeping provisional research usable.

## Limits and resolution

Fresh visual/keyboard/zoom coverage is blocked by browser infrastructure timeout. Existing CI artifacts were not freshly visually inspected; use the documented suites as bounded acceptance only. A working browser can complete a read-only route/viewport pass without creating production QA records.

No fresh paid-model answer, production writes or external registry/source-document verification occurred. Empty live pipeline limits user-deal inspection; isolated persistence covers mechanics. Numbers describe stored coverage; valid price fields do not establish source truth or representative sample. Recompute counts at the next development start, since scheduled independent ingestion can change them.
