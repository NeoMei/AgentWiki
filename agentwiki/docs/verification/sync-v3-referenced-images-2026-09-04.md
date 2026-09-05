# Sync v3 referenced-images release-candidate verification — 2026-09-04

## Evidence boundary

This record describes a local-only release candidate on branch `codex/referenced-image-sync-v3`, based on `3ac3437118fc48362759ee9751b31fd01101b653`. The candidate commit is the Git commit containing this document; resolve it locally with `git log -1 --format=%H -- docs/verification/sync-v3-referenced-images-2026-09-04.md`. The exact immutable SHA is also recorded in the adjacent Task 10 implementation report after commit creation.

- Local implementation and isolated test evidence: performed.
- Remote Git: not changed in Task 10; current remote state was not fetched and is therefore unknown.
- npm: occupied 0.5.0/0.7.0 versions were discovered read-only and replaced by local candidates `@neomei/agentwiki-sync-protocol` 0.5.1 and `@neomei/agentwiki-local-sync` 0.8.0. Both were confirmed absent through the explicit-registry fail-closed gate. Neither was published and registry state was not changed. This release plan permits only a future protocol 0.5.1 publication; local-sync 0.8.0 requires separate authorization and planning.
- Production database migration, backup, deployment, and restart: not performed.
- Public endpoint and browser production smoke: not performed.
- Plugin Task 11, real Obsidian Vault, and cross-platform acceptance: not performed.

These boundaries are deliberate. A local green candidate is not release, deployment, or production acceptance evidence.

## Verified candidate behavior

The dedicated HTTP gate uses a random isolated PostgreSQL schema, applies the baseline plus all five forward Sync v3 migrations serially, starts the real Nest application with a unique local attachment root, and removes both schema and files. It covers an isolated human/Space/device credential, authenticated capabilities, web attachment upload, server-returned canonical `assets/` path in a Page save, native v3 head/fixed snapshot, fixed-Revision Blob download, v3 Push/finalize/identical replay, v2 upgrade rejection, referenced-attachment archive guard, port/storage cleanup, and an injected finalize failure proving transaction rollback and non-terminal session recovery.

The deployment contract verifies one explicit persistent attachment root for API and worker, restart persistence, restrictive systemd write scope, read-only container roots, and fail-closed root/content-path symlink and escape handling. The package gate performs a real clean `pnpm pack`, allowlists public artifacts, excludes specs/secrets/server internals, and consumes ESM, CJS, Sync v3 vectors, and declarations.

The production-smoke contract verifies the exact public credential sequence used by `runSmoke`: the web JWT creates an installation, exchange generates a distinct device credential, that device credential activates itself through `credentials/current/activate`, and the same device credential—not the web JWT—authenticates the read-only v3 capabilities request. The production target itself was not contacted.

All fifteen v3 routes were audited for strict query handling. Thirteen routes reject every query key before reaching a read or mutation service. Snapshot and delta accept only their documented scalar fields; unknown and repeated/array values fail with the strict `PAYLOAD_INVALID` v3 envelope and `no-store`. A `revision=current` snapshot returns a real fixed Revision, and its cursor stays pinned to that Revision across continuation.

Two pre-existing Markdown PostgreSQL failures were resolved as fixture drift, not waived:

1. The current migration replaces the obsolete `SpaceAttachment_status_archivedAt_idx` with the three-column `SpaceAttachment_status_archivedAt_id_idx`; the schema gate now requires the latter and proves the former absent.
2. Public Markdown normalization trims a bare target before title/slug lookup. A bare ` Guide.md ` therefore cannot alias the distinct valid path whose first byte is a space; the fixture now explicitly expects unresolved ambiguity instead of changing the resolver.

## Gate record

Exact final command counts and any independently reproduced baseline failures are recorded in `task-10-local-report.md` in the plugin SDD workspace. At candidate preparation time the focused deployment, package/tarball, production-safe v3 smoke, and local-registry unit gates were 42/42; the real read-only registry gate confirmed both candidates absent; the controller/HTTP query gates were 71/71; the real Sync v3 HTTP PostgreSQL gate was 2/2; Local Sync was 877 passed / 1 intentionally skipped; and four-package typecheck plus production build passed. Playwright collected the two touched browser scenarios, but no local browser stack was started and neither scenario was executed; the browser boundary above remains unchanged.
