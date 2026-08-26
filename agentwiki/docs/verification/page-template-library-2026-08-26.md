# Page template library release verification

Date: 2026-08-26 (Asia/Shanghai)

## Result

The page template library was released through GitHub and production. The
application release commit is
`574f25402e83abcaf66a2d5d490ec67269b0b962`.

The release provides seven bilingual system templates, two-step page creation,
versioned Space templates, Owner/Admin management, editor usage, immutable page
provenance, conflict recovery, bounded pagination, and desktop/390px UI support.

## Pre-release gates

- The implementation plan was complete with no unchecked item.
- Runtime contracts: 104 passed / 51 explicit environment skips.
- Server Jest: 1,213 passed / 4 explicit environment skips.
- Client Vitest: 732/732 passed.
- Sync protocol: 42/42 passed.
- Local Sync: 748/748 passed.
- Typecheck, lint, production build, and diff checks passed.
- A fresh PostgreSQL 16 acceptance stack passed the dedicated database gate 2/2,
  real Chrome 10/10, and 20 rounds containing 160 ordered concurrency pairs.

## Package boundary

The release range contained no change under `packages/local-sync` or
`packages/sync-protocol`. Local and registry versions remained aligned:

- `@neomei/agentwiki-local-sync`: `0.6.1`
- `@neomei/agentwiki-sync-protocol`: `0.3.0`

No npm publication was required or performed.

## Backups and rollback

- PostgreSQL custom-format backup:
  `/root/backups/agentwiki/pre-page-template-library-20260826-102112.dump`
  - size: 4,586,249 bytes
  - 409 listed restore objects
  - SHA-256: `8e52a48c362612dab0cf92cd9116b375d20068c29b7dc4e1b00d9dc3e60199fa`
- Application rollback archive:
  `/root/backups/agentwiki/pre-page-template-library-20260826-102112-app.tar.gz`
  - size: 290,431,185 bytes
  - `.env`, server build, and client build entries verified
  - SHA-256: `0434df0633f404f7a8dcef9a3794eb21ad6c8e8ce8ec3860efb90b3cfc3d9e85`
- Previous application tree: `/root/agentwiki-previous-20260826102439`

Rollback requires the matching database backup and application archive/tree;
the old application must not be started against the migrated database.

## Deployment verification

- The staged release installed with the lockfile, regenerated Prisma Client,
  and built shared, sync-protocol, server, and client targets before downtime.
- Migration `20260825150000_add_page_templates` was applied successfully; Prisma
  reported 43 migrations and an up-to-date production schema.
- API, Worker, and Frontend are active with `NRestarts=0`.
- Local and public health report application, database, Redis, and audit
  persistence `ok`; public root and guide routes return HTTP 200.
- All 762 version-controlled deployment files match the local release SHA-256
  manifest.
- The production `index-BoSZrgl4.js` and `index-4ZxVqeME.css` resource
  fingerprints match the exact local build.
- The deployment window contained zero HTTP 5xx and zero Fatal, unhandled,
  uncaught, or Prisma known-request failures.
- Seven system templates are present. Active test users, Spaces, Agents, visible
  test Space templates, and page-template/collaboration test schemas are zero.

## Production acceptance

- Public HTTP/API/MCP business smoke passed 31/31 checks and cleaned its active
  fixtures.
- Real production Chrome passed the page-template suite 10/10, including
  immutable versions, metadata conflict recovery, injected 500 retry on the
  failed pagination offset, Owner/Admin/Editor/Viewer boundaries, bilingual
  system templates, blank provenance, 390px layout, and focus restoration.
- The general production UI route verifier passed 5 public routes, 15
  authenticated routes, and 6 mobile routes with no browser error, server 5xx,
  or horizontal overflow.

The feature is released. A documentation-only follow-up commit may update this
verification record without requiring another application deployment.
