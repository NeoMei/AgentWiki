# AgentWiki v0.12.64 — page notes discovery

## Scope

- Current-page / all-notes views for page notes.
- Cross-Space note discovery within the authenticated user's current access.
- Return to the source page, with an explicit fallback when the source or anchor is unavailable.
- Preserve the Chinese-knot shape and match the main site's blue logo color.

Web/API/Client target: 0.12.64. Local Sync remains 0.13.5; sync protocol remains 0.6.1.

## Evidence status

Implementation and independent whole-diff review are complete. Local real-browser acceptance passes 13/13 with all 27 notes, four pages, three Spaces and two users deleted/read back. See local-browser.json; the first cleanup readback hit a 429 and is preserved separately, with direct local PostgreSQL deletion confirmation.

Paired production app/configuration/database/attachments backup passed, and its dump restored successfully to a fresh isolated database which was then removed. See backup.json and backup-restore.json. Sensitive archives remain server-private; rollback must use matching artifacts and account for writes after backup.

Full-suite and release/source/production acceptance receipts are added only after their actual execution. This source-preparation commit does not establish successful deployment or a published GitHub Release. See release-tools.md for exact tooling and tools-validation.json for local mock/syntax checks.
