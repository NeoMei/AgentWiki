# AgentWiki v0.12.64 — page notes discovery

## Scope

- Current-page / all-notes views for page notes.
- Cross-Space note discovery within the authenticated user's current access.
- Return to the source page, with an explicit fallback when the source or anchor is unavailable.
- Preserve the Chinese-knot shape and match the main site's blue logo color.

Web/API/Client target: 0.12.64. Local Sync remains 0.13.5; sync protocol remains 0.6.1.

## Evidence status

This directory initially contains release preparation tools and draft notes. It does not establish that implementation gates, a GitHub Release, backups, deployment, or production browser acceptance have passed. Record the actual frozen commit and final gate counts after they complete; keep host/public checks separate from changed-flow browser acceptance.

The release tools reuse the v0.12.63 safety controls. See release-tools.md for exact commands and tools-validation.json for local mock/syntax checks. Source manifests must come from the frozen Git commit. Deployment must run from a clean detached checkout because deploy.sh packages working-tree files.

Application/configuration/database/attachment backups remain server-private. A temporary restore validates dump recoverability; rollback must use the matching application, configuration, database and attachments and account for post-backup writes.
