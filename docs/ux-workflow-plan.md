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
| P2a | Research usability and return context | Core columns by default; secondary detail expansion; accessible filter labels; filters/sort/scroll restored after property return; common Hebrew wording | Planned |
| P2b | Actionable missing information | Gap can become a task with source, owner/date, status and result; do not mark rights verified merely because a task is complete | Planned; requires additive workflow contract review |
| P2c | Deal workspace guidance | Existing stages, next action, DD and scenarios grouped into a clear next-step workflow; explicit assumptions and scenario comparison | Planned |
| P3 | Full acceptance | Real read-only API checks + desktop/mobile fixtures; isolated test-branch create/update persistence; contextual agent tests; failures and empty states; no production QA records | Planned |

## Release gates

Build and 24 renewal/domain regressions must pass. Browser fixtures must pass before production promotion. One production release for this batch. API function count remains 12; no new cron, database schema or collector change. Existing evidence/identity contracts remain authoritative. Browser fixtures do not establish apartment project membership or source correctness.

The production UI review alone did not establish write persistence, agent accuracy or full mobile acceptance. Report these separately from fixture success.

## First batch validation

GitHub Actions run 37344187882 passed the reconstructed build, 24 domain tests and the browser fixture suite on 2026-10-05. Browser acceptance covers delayed directory/detail navigation, project→property→back, refresh, malformed response→retry, evidence/gaps, 390px project layout without page overflow, radar→canonical neighborhood and empty pipeline→Research. The fixture suite performs no production writes. Production smoke follows the release deployment; this does not mark remaining P2/P3 work complete.
