# AgentWiki 0.3.1 Third-Party Test Execution Report

## Gates
- Entry gate: **ENTRY GATE: PASS** — 2026-08-11 22:09:05 CST; approver: project-owner-codex-thread. No production request was made during Task 2.

| Spec §5.1 condition | Result | Sanitized evidence source | Confirmer | Confirmation time |
|---|---|---|---|---|
| Production homepage is reachable through HTTPS | PASS | Owner confirmation in Codex thread for the approved window; Task 2 made no production request | project-owner-codex-thread | 2026-08-11 22:09:05 CST |
| Test lead confirms controlled write testing is allowed | PASS | Owner authorization in Codex thread: approved window, tester scope, dedicated Admin D, and `3PT-20260811-CODEX-` prefix | project-owner-codex-thread | 2026-08-11 22:09:05 CST |
| Four A/B/C/D test accounts are available | PASS | README sanitized Test Identities inventory | Codex controller | 2026-08-11 22:09:05 CST |
| Three isolated client environments are ready | PASS | Cleanup checklist local-home inventory and `0600` root-marker validation | Codex controller | 2026-08-11 22:09:05 CST |
| Defect log and screenshot storage have been established | PASS | `defects.md` and six Task 1 evidence directories | Codex controller | 2026-08-11 22:09:05 CST |
| Production has no serious incident in progress | PASS | Owner confirmation in Codex thread for the approved window; Task 2 made no production request | project-owner-codex-thread | 2026-08-11 22:09:05 CST |
- Baseline gate: **BASELINE GATE: PASS** — 2026-08-11 14:19:59 UTC / 2026-08-11 22:19:59 CST; ENV-001 through ENV-003 passed.
- Pre-cleanup defect gate: NOT_RUN
- Cleanup gate: NOT_RUN


## Production Baseline (Task 3)
| Case | Result | Sanitized evidence | Notes |
|---|---|---|---|
| ENV-001 | PASS | ENV-001-home.png; ENV-001-guide.png; ENV-001-onboard.png | Signed-out Chrome verified HTTPS and rendered public /, /guide, and /onboard; the onboarding page displayed the pinned 0.3.1 command. |
| ENV-002 | PASS | ENV-002-health.json | /api/health returned status=ok, database=ok, redis=ok, and auditPersistence=ok. |
| ENV-003 | PASS | ENV-003-onboard-json.txt | /api/onboard.json returned HTTP 410 and named the pinned 0.3.1 onboarding command; no old dual-MCP installation is present. |

## Batch Results
| Batch | Cases | Pass | Fail | Blocked | Not applicable | Gate |
|---|---:|---:|---:|---:|---:|---|

## Defect Summary
| Severity | Open | Closed | Retested |
|---|---:|---:|---:|

## Deviations and Accepted Risks
- Task 2 performed no production calls, account registration, product/UI test, or credential access. Production availability and incident state are recorded only as owner-confirmed entry conditions for the approved window.
- `STOP-3PT-20260811-001` fired when Admin D's Dashboard automatically rendered production-wide Space link metadata. The production owner selected continuation option 1: this passive global-admin metadata visibility is accepted for the dedicated `super_admin`; testers may not open, inspect, search for, or mutate non-`3PT` resources. A fresh write window was authorized for 2026-08-11 23:34 CST through 2026-08-12 05:34 CST. Any non-test content/personal-data exposure or non-`3PT` write still requires an immediate stop.

## Final Decision
NOT_RUN
