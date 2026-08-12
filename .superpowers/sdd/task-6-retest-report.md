# Task 6 Retest Report — 0.3.2 production acceptance

## Outcome

RETEST2 completed against the production-fixed Device Start endpoint with an overall **FAIL** result: **5 PASS / 3 FAIL / 0 BLOCKED**.

The package is now accepted by production, all three clients completed Device Auth and onboarding, and the prior URL, process-exit, deletion, secret-safety, and uninstall defects were confirmed fixed. Codex/Claude doctor registration and onboarding-preview totals still fail their required acceptance criteria.

## Scope and safety

- Branch/base: `codex/third-party-test-spec` on `04fb970`.
- Package: exact `@neomei/agentwiki-local-sync@0.3.2`.
- Execution occurred within the approved production write window.
- Three fresh isolated homes were used; daily client configurations were not accessed.
- Production writes were limited to prefixed `3PT-20260811-CODEX-RETEST2-*` resources in the existing main 3PT Space.
- User A approved or denied only RETEST2 Device Requests. No Admin D or non-3PT resource was opened, searched, or mutated.
- No SSH or database operation was used.
- Product uninstall restored all three isolated configs exactly; the isolated root and marker were removed.
- Raw identifiers required for Task 8 cleanup remain only in the mode-0600 secure inventory.
- Production health remained green after execution and cleanup.
- Spec §16 stop conditions triggered: none.

## Case results

| Case | Result | Evidence-based conclusion |
|---|---|---|
| ONBOARD-001 | PASS | All three URLs used canonical HTTPS `/onboard/device`; Chrome loaded the AgentWiki top-level page without a client-side block. |
| ONBOARD-003 | FAIL | Config shapes used `cmd+args` / `command+args`, but Codex and Claude still failed doctor `mcp-registration`; OpenCode passed. |
| ONBOARD-004 | FAIL | Each onboarding first-sync preview still exposed only `filesProcessed/filesSkipped`, omitting `added/modified/deleted/uploadBytes`. |
| ONBOARD-006 | PASS | Three completed processes and one denied process exited naturally 0.017–0.029 seconds after terminal events; no SIGTERM was used. |
| ONBOARD-007 | FAIL | All three completed authorization, plan/sync confirmation, and one gateway install, but Codex/Claude doctor registration failed. |
| SYNC-001 | PASS | Preview returned added=1, modified=2, deleted=1 and uploadBytes; the scoped ChangeSet contained create, update, and archive candidates. |
| SYNC-004 | PASS | The fake-marker artifact was skipped with one credential warning; the complete marker was absent from preview state and was never uploaded. |
| SYNC-006 | PASS | All uninstall commands exited zero, removed gateway and connection state, preserved unrelated entries, and restored configs byte-for-byte. |

## Defect confirmations

| Defect | Status | Confirmation |
|---|---|---|
| DEF-3PT-20260812-001 | PASS | Canonical HTTPS Device Auth URL and Chrome reachability confirmed for all three clients. |
| DEF-3PT-20260812-002 | FAIL | Generated shapes changed as expected, but Codex/Claude doctor registration still fails. |
| DEF-3PT-20260812-003 | FAIL | Gateway `knowledge_prepare` reports the diff, but onboarding preview still omits required totals. |
| DEF-3PT-20260812-004 | PASS | Removing `obsolete.md` produced deleted=1 and an `archive_page` candidate. |
| DEF-3PT-20260812-005 | PASS | Fake marker was flagged/skipped; complete marker occurrence count in preview state was zero. |
| DEF-3PT-20260812-006 | PASS | Completed and failed NDJSON processes exited promptly without SIGTERM. |
| STOP-3PT-20260812-002 | PASS | Normal product uninstall fully restored all three isolated configurations. |

## Resource and cleanup summary

- 5 Device Requests: 3 approved, 1 denied, and 1 unapproved preflight probe that expires normally.
- 3 prefixed Agents, 3 credentials, and 3 Agent-to-Space Grants.
- 4 ChangeSets/submissions covered by the secure Task 8 inventory.
- Local fake-token fixture and unconfirmed preview removed.
- Three local gateways and connections removed by normal product uninstall.
- Fresh isolated root removed after exact before/after verification.

## Evidence

Ten new sanitized `RETEST2-*.json` files record preflight, URL/Chrome behavior, config/doctor checks, onboarding previews, terminal exit timing, sync deletion, fake-marker safety, uninstall restoration, resource inventory, and aggregate results. Prior `RETEST-*` BLOCKED evidence is preserved unchanged.
