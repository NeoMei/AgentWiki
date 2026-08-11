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

## Task 4 Stop Disposition

- Status: `PENDING` — no cleanup attempted after `STOP-3PT-20260811-001`.
- Controller: Task 8 / production owner after the human decision.
- Retained resources: three disposable AUTH users and the main test Space listed above.
- No Task 4 pages, relations, members, Sources, Runs, Agent grants, or additional Spaces were created before the stop.
