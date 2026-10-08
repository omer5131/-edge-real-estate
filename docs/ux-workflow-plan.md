# Edge UX and workflow recovery — 2026-10-05

Goal: Area → project/building → property → evidence/comparables → deal → diligence/scenarios → decision/offer.

## Baseline: observed production acceptance

Directory search worked; directory → Saadia Gaon profile crashed with existing_units undefined. Radar opened legacy area with no property continuation. Main Areas opened the canonical map but defaulted to Abu Gosh. Research → property → back worked. Deal initiation was buried in a tab. Subscription and deal creation were separate without enough explanation. My Deals empty state had instructions without a direct continuation. A prominent valuation was adjacent to an overall insufficient-evidence badge.

## Ordered delivery plan

| Priority | Deliverable | Acceptance | Status |
| --- | --- | --- | --- |
| P0 | Project navigation reliability | Delayed directory→detail request, detail→property→back, refresh, source/gaps and mobile render have no runtime errors; malformed responses show retry; unexpected rendering errors preserve escape route | Implemented; CI browser acceptance passed |
| P1a | Canonical area entry | Radar, primary Areas and legacy area URL reach the same canonical map; radar carries neighborhood ID; remembered area or Haifa default; city and radar-area selectors | Implemented; CI browser acceptance passed |
| P1b | Follow vs deal clarity | Property header has an explicit deal CTA; following is explained separately; empty pipeline links to Research; existing backend create action is unchanged | Implemented; CI browser acceptance passed |
| P1c | Evidence readability | Valuation and active inventory show their own evidence envelopes; domain evidence is never collapsed into one quality label | Labels implemented; build passed; deeper comprehension review pending |
| P2a | Research usability and return context | Core columns by default; secondary detail expansion; accessible filter labels; filters/sort/scroll restored after property return; common Hebrew wording | Implemented; CI 37348584746 passed build, 24 regressions and research/project browser acceptance |
| P2b | Actionable missing information | Gap can become a task with source, owner/date, status and result; do not mark rights verified merely because a task is complete | Implemented locally; additive 032 contract and rollback tests passed; browser/release gate pending |
| P2c | Deal workspace guidance | Existing stages, next action, DD and scenarios grouped into a clear next-step workflow; explicit assumptions and scenario comparison | Implemented locally; build and PostgreSQL persistence tests passed; browser/release gate pending |
| P3 | Full acceptance | Real read-only API checks + desktop/mobile fixtures; isolated test-branch create/update persistence; contextual agent tests; failures and empty states; no production QA records | Planned |

## Release gates

Build and renewal/domain regressions must pass. Browser fixtures must pass before production promotion. Batch changes before production promotion; corrective patches must repeat acceptance. API function count remains 12; no new cron or collector change. The reviewed additive task contract is `db/032_deal_tasks.sql`: one new table/index, no existing record/schema mutation, and completion does not change DD verification. It is applied only on the explicit workflow-release branch after PostgreSQL, agent-safety and browser acceptance plus read-only live contract audit. Existing evidence/identity contracts remain authoritative. Browser fixtures do not establish apartment project membership or source correctness.

The production UI review alone did not establish write persistence, agent accuracy or full mobile acceptance. Report these separately from fixture success.

## First batch validation

GitHub Actions run 37344187882 passed the reconstructed build, 24 domain tests and the browser fixture suite on 2026-10-05. Browser acceptance covers delayed directory/detail navigation, project→property→back, refresh, malformed response→retry, evidence/gaps, 390px project layout without page overflow, radar→canonical neighborhood and empty pipeline→Research. The fixture suite performs no production writes. Production smoke follows the release deployment; this does not mark remaining P2/P3 work complete.

Production smoke found that radar IDs are neighborhood slugs, while map/API IDs are UUIDs. The map now resolves slugs through its canonical neighborhood rows before requests and normalizes the URL. Browser fixtures explicitly use the real slug/UUID distinction; prior all-UUID fixtures were insufficient for that boundary.

Final canonical-identity acceptance: GitHub Actions run 37345306175 passed build, 24 regressions and the browser suite with radar slug → canonical UUID normalization and an assertion that neighborhood API requests use only the canonical ID. First production smoke already verified the repaired project directory→profile transition without application runtime errors. The identity patch is promoted after this CI; repeat the radar→Sprinzak smoke after deployment.


## Investor review reprioritization

See `docs/investor-workflow-review-2026-10-05.md` for observations, source-code findings and limits. After Research P2a, execute in this order:

1. **R1 / trust:** unify benchmark descriptions and lifecycle null handling across area/research/property; expose identity and subject-fit limitations separately from sample coverage. Domain/API tests before changing metric semantics.
2. **R2 / actionable evidence:** DD notes/evidence editor using existing contract; source and observed date; then task ownership/due date only after additive task contract review. Include listing/contact identity verification. Completed task never proves legal rights.
3. **R3 / underwriting:** all assumptions editable, explicit defaults and evidence links, scenario selection loads the right assumptions, compare persisted outputs, cancel rejection without mutation.
4. **R4 / workspace:** known/missing/next-action summary, pipeline opens the relevant deal section, contextual project links, candidate comparison, delayed/error/empty area states.
5. **R5 / acceptance:** isolated database persistence, stages/notes/DD/scenarios, failure paths, contextual agent and phone flows. Do not claim end-to-end purchase acceptance from UI fixtures.

Research batch additionally preserves notes after failed writes and displays workflow errors in every section. It makes no schema, collection, calculation or new API function changes.


Research acceptance: GitHub Actions 37348584746 passed build, 24 domain regressions, the existing project suite and research fixture tests. Research tests cover draft vs applied filters, omitted numeric filters, URL filter/sort restoration, property→back expanded row and vertical scroll, refresh, preserved notes and visible errors after failed writes, failed follow, malformed response/retry, pagination and 390px viewport overflow. These are bounded fixtures, not production writes. Live research API maxPrice=1500000 returned 14 results, all asking prices ≤1.49M. Production promotion and UI smoke follow this gate.

## Remaining-work implementation batch

R1: observed lifecycle requires >=2 snapshots separated by >=1 day on research, opportunity, area, property and active inventory. Unknown DOM/reductions/original price stay null; display uses words rather than opposite sign conventions, without changing valuation formulas. Sample quality and subject identity are separate.

R2: DD findings and attributed dated sources, listing identity checklist, custom checks, owner/due/source/result tasks and gap-to-task actions. A completed task never verifies a check. 032 is idempotent in disposable PostgreSQL.

R3: all 21 assumptions visible; illustrative defaults require acknowledgement; zero loan stays zero; saved scenario selection loads its assumptions; selected saved outputs and dirty drafts are distinguished; scenario comparison uses server outputs. Primary switch/save/event/activity are atomic; notes/DD/stages/offers/tasks also use atomic persistence where multiple writes occur. Rejection has explicit save/cancel and mandatory reason.

R4: next-step guidance and open-check/task counts; pipeline deep link includes exact deal and section with listing-match validation; compare 2–6 candidates; delayed/error/retry area sections don't masquerade as empty inventory; source links available on basic profiles.

R5: fresh service-level PostgreSQL persistence/rollback tests pass locally, alongside agent safety and SQL allowlist tests. Browser acceptance connects to the same actual service in a disposable PostgreSQL instance, not a JSON persistence mock. Live production remains read-only during acceptance. Release evidence and post-release investor reassessment will be appended after gates pass.


## Next round — before-offer decision review (2026-10-08)

Investor review item 4 is implemented on `decision-review`: selected saved scenario, total acquisition/equity/debt/cash-flow/return summary, model limits, unresolved DD with dated sources, incomplete standard checks, open/overdue tasks and next action. Offer preview is an explicit read-only server operation; it does not update scenarios, offer or timeline. Loan/fees/taxes remain fixed and visibly require review when purchase price changes. Incompatible explicit-exit maximum price is omitted. Dirty drafts and changed preview prices have distinct messages.

Acceptance: local build, 43 domain/SQL/persistence tests pass. Chromium download is blocked locally; CI browser gate is pending. No production migration or writes; 12 API entrypoints. This extends the decision step, and does not mark future saved-search/visit/document features or live paid agent correctness complete.
