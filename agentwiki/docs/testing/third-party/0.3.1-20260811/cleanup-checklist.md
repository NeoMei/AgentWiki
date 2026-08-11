# Cleanup Checklist

Sanitized isolated-root label: `agentwiki-3pt.<ephemeral>` (the full local filesystem path is intentionally not recorded).

| Resource type | Sanitized name | Owning user | Space | Creation case | Deletion method | Deletion time | Verifier | Verification method | Result |
|---|---|---|---|---|---|---|---|---|---|
| Test user | `User A` | User A (dedicated ordinary human test identity) | N/A | Task 2 | Admin D soft-delete after tests | PENDING | Admin D | Confirm denied login and old URL, then verify soft-deleted status in admin controls | PENDING |
| Test user | `User B` | User B (dedicated ordinary human test identity) | N/A | Task 2 | Admin D soft-delete after tests | PENDING | Admin D | Confirm denied login and old URL, then verify soft-deleted status in admin controls | PENDING |
| Test user | `User C` | User C (dedicated ordinary human test identity) | N/A | Task 2 | Admin D soft-delete after tests | PENDING | Admin D | Confirm denied login and old URL, then verify soft-deleted status in admin controls | PENDING |
| Test user | `3PT-20260811-CODEX-AUTH-01` | Disposable AUTH identity 01 | N/A | AUTH-001 | Task 8/controller soft-delete after human decision | PENDING | Admin D | Confirm denied login and soft-deleted status in admin controls | PENDING |
| Test user | `3PT-20260811-CODEX-AUTH-02` | Disposable AUTH identity 02 | N/A | AUTH-001 | Task 8/controller soft-delete after human decision | PENDING | Admin D | Confirm denied login and soft-deleted status in admin controls | PENDING |
| Test user | `3PT-20260811-CODEX-AUTH-03` | Disposable AUTH identity 03 | N/A | AUTH-001 / AUTH-006 | Task 8/controller soft-delete after human decision; AUTH-006 was blocked before deletion | PENDING | Admin D | Confirm denied login, old URL denial, and soft-deleted status | PENDING |
| Space | `3PT-20260811-CODEX-MAIN (sha256-12:903dcb9cd2b1)` | User A | `3PT-20260811-CODEX-MAIN` | SPACE-001 | Task 8/controller delete after human decision; do not continue Task 5 while the stop remains active | PENDING | User A / Admin D | Dashboard absence plus direct Space URL denial and global-search residual check | PENDING |
| Test super_admin | `Admin D` | Admin D (dedicated test super_admin identity) | N/A | Task 2 | Disposition by production owner after A/B/C cleanup | PENDING | project-owner-codex-thread | Production owner confirms Admin D disposition after A/B/C cleanup | PENDING |
| Isolated client home | `agentwiki-3pt.<ephemeral>/codex` | Codex controller | N/A (local) | Task 2 | Remove isolated root after Task 8 | PENDING | NOT_RECORDED | Confirm path is absent and root marker is removed | PENDING |
| Isolated client home | `agentwiki-3pt.<ephemeral>/claude` | Codex controller | N/A (local) | Task 2 | Remove isolated root after Task 8 | PENDING | NOT_RECORDED | Confirm path is absent and root marker is removed | PENDING |
| Isolated client home | `agentwiki-3pt.<ephemeral>/opencode` | Codex controller | N/A (local) | Task 2 | Remove isolated root after Task 8 | PENDING | NOT_RECORDED | Confirm path is absent and root marker is removed | PENDING |
| Synthetic knowledge fixture set | `knowledge-a` (`overview.md`, `setup.md`, `obsolete.md`) | Codex controller | N/A (local) | Task 2 | Remove isolated root after Task 8 | PENDING | NOT_RECORDED | Confirm all three files are absent with isolated root removal | PENDING |
| Synthetic knowledge fixture set | `knowledge-b` (`overview.md`, `setup.md`, `obsolete.md`) | Codex controller | N/A (local) | Task 2 | Remove isolated root after Task 8 | PENDING | NOT_RECORDED | Confirm all three files are absent with isolated root removal | PENDING |
| Local root marker | `agentwiki-3pt-root` (mode `0600`) | Codex controller | N/A (local) | Task 2 | Remove marker after isolated-root removal | PENDING | NOT_RECORDED | Confirm marker is absent and mode was `0600` before removal | PENDING |
| Source | `3PT-20260811-CODEX-SOURCE-TEXT-01` primary (`sha256-12:a419835a316d`) | User A | `3PT-20260811-CODEX-MAIN` | SOURCE-001 | Delete with main test Space during Task 8 | PENDING | User A / Admin D | Scoped Source list and direct resource check within the 3PT Space | PENDING |
| Source | `3PT-20260811-CODEX-SOURCE-URL-INVALID-01` (`sha256-12:cef2fa9871da`) | User A | `3PT-20260811-CODEX-MAIN` | SOURCE-002 | Delete with main test Space during Task 8 | PENDING | User A / Admin D | Scoped Source list and direct resource check within the 3PT Space | PENDING |
| Source | `3PT-20260811-CODEX-SOURCE-TEXT-01` REVIEW-005 fixture (`sha256-12:10aedee3f008`) | User A | `3PT-20260811-CODEX-MAIN` | REVIEW-005 | Delete with main test Space during Task 8 | PENDING | User A / Admin D | Scoped Source list and direct resource check within the 3PT Space | PENDING |
| Run | SOURCE-001 completed Run (`sha256-12:44d4ac85fd62`) | User A | `3PT-20260811-CODEX-MAIN` | SOURCE-001 | Delete with parent Source/Space during Task 8 | PENDING | User A / Admin D | Scoped Run list no longer contains the sanitized handle | PENDING |
| Run | REVIEW-004 completed Run (`sha256-12:93c841b20b95`) | User A | `3PT-20260811-CODEX-MAIN` | REVIEW-004 | Delete with parent Source/Space during Task 8 | PENDING | User A / Admin D | Scoped Run list no longer contains the sanitized handle | PENDING |
| Run | SOURCE-002 bounded failure 1 (`sha256-12:b4fb910a28d5`) | User A | `3PT-20260811-CODEX-MAIN` | SOURCE-002 | Delete with parent Source/Space during Task 8 | PENDING | User A / Admin D | Scoped Run list no longer contains the sanitized handle | PENDING |
| Run | SOURCE-002 controlled retry (`sha256-12:6e86a2b1d33c`) | User A | `3PT-20260811-CODEX-MAIN` | SOURCE-002 | Delete with parent Source/Space during Task 8 | PENDING | User A / Admin D | Scoped Run list no longer contains the sanitized handle | PENDING |
| Run | REVIEW-005 completed pre-lock Run (`sha256-12:10bae73c973a`) | User A | `3PT-20260811-CODEX-MAIN` | REVIEW-005 | Delete with parent Source/Space during Task 8 | PENDING | User A / Admin D | Scoped Run list no longer contains the sanitized handle | PENDING |
| ChangeSet | rejected review fixture (`sha256-12:41c28b7d6b5b`) | User A | `3PT-20260811-CODEX-MAIN` | REVIEW-003 | Delete with main test Space during Task 8 | PENDING | User A / Admin D | Scoped review list no longer contains the sanitized handle | PENDING |
| ChangeSet | published review fixture (`sha256-12:125cc4e303d3`) | User A | `3PT-20260811-CODEX-MAIN` | REVIEW-004 | Delete with main test Space during Task 8 | PENDING | User A / Admin D | Scoped review list no longer contains the sanitized handle | PENDING |
| ChangeSet | stale-authority pending fixture (`sha256-12:03930935c063`) | User A | `3PT-20260811-CODEX-MAIN` | REVIEW-005 | Reject or delete with main test Space during Task 8 | PENDING | User A / Admin D | Scoped review list confirms no pending 3PT ChangeSet remains | PENDING |
| Page | `3PT-20260811-CODEX-SOURCE-TEXT-01` (`sha256-12:af3eeeb0e020`) | User A | `3PT-20260811-CODEX-MAIN` | REVIEW-004 | Delete with main test Space during Task 8 | PENDING | User A / Admin D | Page list, search, graph, and direct page check show no residual | PENDING |
| Agent | `3PT-20260811-CODEX-AGENT-01` (`sha256-12:e5a6aea7e81f`) | User A | `3PT-20260811-CODEX-MAIN` | SPACE-006 | Revoke/delete after Task 6, then verify Agent list and credentials | PENDING | User A / Admin D | Agent list absence/revoked state and credential denial | PENDING |
| Agent Grant | editor Grant (`sha256-12:efc8b3fba4d2`) | User A | `3PT-20260811-CODEX-MAIN` | SPACE-006 | Remove with Agent or Space during Task 8 | PENDING | User A / Admin D | Agent access tab and Space member list show no Grant | PENDING |

## Task 4 Stop Disposition

- Status: `RESOLVED FOR CONTINUATION` — the production owner approved Admin D's passive visibility of global administrative metadata while preserving the prohibition on opening or mutating non-3PT resources.
- Continuation window: `2026-08-11 23:34 CST` through `2026-08-12 05:34 CST`.
- Controller: Task 8 / production owner for final cleanup.
- Retained resources: three disposable AUTH users, the main test Space, and the Task 5 resources inventoried above.
- During Task 5, Admin D was used only for narrowly scoped 3PT administration; no non-3PT resource was opened, searched, or modified.

## Task 6 Inventory and Cleanup State

Every individual sanitized handle is listed in `evidence/04-onboarding-sync/TASK6-resource-inventory.json`; raw identifiers remain only in the mode-0600 secure temporary inventory.

| Resource type | Sanitized name | Owning user | Space | Creation case | Deletion method | Deletion time | Verifier | Verification method | Result |
|---|---|---|---|---|---|---|---|---|---|
| Device Request set (5) | Task 6 Device Request handles | User A | N/A | ONBOARD-001 / ONBOARD-006 / ONBOARD-007 | Terminal approved-consumed, denied, or expired state; no deletion required | 2026-08-12T01:18:00+08:00 | Codex controller | Sanitized terminal events plus no denied/expired Agent in scoped Agent list | PASS |
| Agent set (3) | Task 6 onboarding Agent handles | User A | `3PT-20260811-CODEX-MAIN` | ONBOARD-001 / ONBOARD-007 | Revoke credentials and grants, then delete/revoke Agents during Task 8 | PENDING | User A / Admin D | Scoped Agent list and old credential denial | PENDING |
| Agent Grant binding set (3) | Task 6 Agent-to-Space binding handles | User A | `3PT-20260811-CODEX-MAIN` | ONBOARD-002 / ONBOARD-007 | Remove with Agent or Space during Task 8 | PENDING | User A / Admin D | Agent access view and scoped Space membership | PENDING |
| Agent credential set (3) | Task 6 credential handles | User A | `3PT-20260811-CODEX-MAIN` | ONBOARD-003 / ONBOARD-007 | Revoke through normal product Agent controls during Task 8 | PENDING | User A / Admin D | Old gateway credential returns denied after revocation | PENDING |
| Local connection set (3) | Task 6 isolated connection handles | Codex controller | N/A (local) | ONBOARD-003 / ONBOARD-007 | Product uninstall; retain credentials and sync state until Task 8 | 2026-08-12T01:19:00+08:00 | Codex controller | Compare connection store and private before snapshot | FAIL — two retained; OpenCode connection removed |
| Isolated gateway config set (3) | `agentwiki` gateway in Codex, Claude, OpenCode test homes | Codex controller | N/A (local) | ONBOARD-003 / ONBOARD-007 | Product `uninstall --agent <client>` | 2026-08-12T01:19:00+08:00 | Codex controller | Byte comparison plus entry-name inventory | FAIL — all three gateway entries remain |
| Unrelated MCP control set (3) | `3pt-control` fixture entry in each isolated config | Codex controller | N/A (local) | SYNC-006 precondition | Preserve exactly through uninstall and Task 8 cleanup | 2026-08-12T01:19:00+08:00 | Codex controller | Entry-name and content comparison | PASS — entry present; full config restore failed because gateway remains |
| Local knowledge job set (11) | Task 6 job handles | Codex controller | `3PT-20260811-CODEX-MAIN` | ONBOARD-004 / SYNC-001..005 | Remove with isolated root during Task 8 | PENDING | Codex controller | Job-handle inventory and isolated-root absence | PENDING |
| Local preview set (11) | Task 6 preview handles | Codex controller | `3PT-20260811-CODEX-MAIN` | ONBOARD-004 / SYNC-001..005 | Remove with isolated root during Task 8 | PENDING | Codex controller | Preview-handle inventory and isolated-root absence | PENDING |
| Knowledge submission set (7) | Task 6 submission handles | User A | `3PT-20260811-CODEX-MAIN` | ONBOARD-004 / SYNC-001 / SYNC-003 | Remove with parent ChangeSet/Space during Task 8 | PENDING | User A / Admin D | Scoped Review list and unique-marker search | PENDING |
| ChangeSet set (7) | Task 6 ChangeSet handles | User A | `3PT-20260811-CODEX-MAIN` | ONBOARD-004 / SYNC-001 / SYNC-003 | Remove with main test Space during Task 8 | PENDING | User A / Admin D | Scoped Review list contains no Task 6 handle | PENDING |
| Page set (4) | `overview`, `setup`, `obsolete`, `troubleshooting` handles | User A | `3PT-20260811-CODEX-MAIN` | ONBOARD-004 / SYNC-001 / SYNC-003 | Delete with main test Space during Task 8 | PENDING | User A / Admin D | Page list, direct URL, search, and graph residual checks | PENDING |
| Page version set (3) | Task 6 page-version handles | User A | `3PT-20260811-CODEX-MAIN` | ONBOARD-004 / SYNC-001 / SYNC-003 | Remove with parent pages/Space during Task 8 | PENDING | User A / Admin D | Version history and direct old resource checks | PENDING |
| Authoritative Revision set (5) | Task 6 Revision handles | User A | `3PT-20260811-CODEX-MAIN` | ONBOARD-004 / SYNC-001..005 | Remove with main test Space during Task 8 | PENDING | User A / Admin D | Knowledge-sync state and Space deletion verification | PENDING |

### Task 6 stop disposition

- Status: `WRITE TESTING STOPPED` — Spec section 16.8 triggered because normal product uninstall did not remove the three isolated test gateways.
- No uncontrolled duplicate, silent overwrite, non-3PT write, or production health regression was observed.
- The isolated root, gateway configs, credentials, and server-side 3PT resources remain retained for owner-authorized Task 8 remediation and independent cleanup verification.
