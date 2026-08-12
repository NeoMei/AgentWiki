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

## RETEST3 — public package 0.3.4 focused rerun

- Scope: ONBOARD-003, ONBOARD-004, ONBOARD-007 only.
- Outcome: **1 PASS / 2 FAIL / 0 BLOCKED**.
- ONBOARD-004 passed: all three onboarding previews included `added`, `modified`, `deleted`, and `uploadBytes`.
- ONBOARD-003 and ONBOARD-007 failed: Codex and Claude still returned `mcp-registration=fail` from `doctor`; OpenCode passed all checks.
- Minimal reproduction: use a fresh isolated HOME with one unrelated MCP entry; run the pinned 0.3.4 onboarding command through completion, then run `npx --yes @neomei/agentwiki-local-sync@0.3.4 doctor`. Codex and Claude fail only the MCP registration acceptance relevant to this retest.
- Evidence: `evidence/04-onboarding-sync/RETEST3-ONBOARD-003-007-doctor.json`, `RETEST3-ONBOARD-004-preview.json`, and `RETEST3-CLEANUP-summary.json`.
- Cleanup: all three ChangeSets rejected; all RETEST3 credentials, Grants, and Agents removed; all local gateways/connections uninstalled; isolated root removed; production health green.
- Safety: no Spec section 16 condition triggered; no non-3PT resource was opened, searched, or mutated.

## RETEST4 — public package 0.3.6 focused rerun

- Scope: ONBOARD-003 and ONBOARD-007 (mcp-registration acceptance for Codex, Claude, OpenCode).
- Outcome: **3 PASS / 0 FAIL / 0 BLOCKED** — all three clients' `mcp-registration` doctor check passed.
- Root cause fixed: the Claude gateway was previously written to `~/.claude/settings.json`, which Claude Code does not read. It is now written to `~/.claude.json` (user scope), matching what `claude mcp get` and running sessions load. A legacy-cleanup step removes old entries from `settings.json`.
- Codex root cause (0.3.5): the doctor spawn runner discarded its options, so the isolated HOME env override never reached the real `codex mcp get` subprocess. 0.3.5 forwards spawn options; Codex mcp-registration now passes.
- ONBOARD-004 remains PASS from RETEST3 (preview diff totals).
- Evidence: `evidence/04-onboarding-sync/RETEST4-ONBOARD-003-007-doctor.json`.
- Cleanup: isolated HOMEs removed after verification.
- Safety: no production writes; no real credentials used (placeholder API keys); no Spec section 16 condition triggered.
