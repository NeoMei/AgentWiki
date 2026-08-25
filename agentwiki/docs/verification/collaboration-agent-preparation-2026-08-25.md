# Collaboration Agent preparation release verification

## Result

The collaboration run wizard Agent-preparation recovery was released on
2026-08-25 (Asia/Shanghai). The application release commit is
`d843fba620c5cfaf8a1b68d96aa21596f56dad5c`.

The release adds an inline recovery path when a role mapping has no eligible
Agent: select or create an Agent, recover a paused Agent, grant the current
Space an Editor or Publisher role, obtain one-time MCP connection guidance,
observe connection state, and map the current role slot without leaving the
wizard.

## Pre-release gates

- Plan: 36/36 complete.
- Full repository: 2,358 passed, 54 explicit environment skips, 0 failed.
- Lint, four-workspace typecheck, five-workspace production build, and diff
  check passed.
- Isolated PostgreSQL acceptance: collaboration 12/12 and Agent-create
  idempotency/audit rollback 1/1.
- Independent review: Critical 0, Important 0, Minor 0.
- Sealed security review: 36/36 files, nine risk surfaces, zero findings and
  zero deferred items.

## Backups and rollback

- Database: `/root/backups/agentwiki/pre-collaboration-agent-preparation-20260825-105901.dump`
  - SHA-256: `4df40dd68f62f684b4f8347266c0bb3180961bd1d6246852ad18e1fa33ef41f4`
- Application: `/root/backups/agentwiki/pre-collaboration-agent-preparation-20260825-105901-app.tar.gz`
  - SHA-256: `521465232f18eab777ba2f58dc63f3069ab94a7cb5fa34646e11cbb20a967cb5`
- Previous application tree: `/root/agentwiki-previous-20260825110227`

Both archives were listed successfully before deployment. Do not reactivate
the previous application tree without restoring its matching database backup.

## Deployment verification

- The staged production build completed before the existing services stopped.
- Prisma reported 42 migrations and an up-to-date production schema.
- API, Worker, and Frontend are active with `NRestarts=0`.
- Public `/`, `/guide`, and `/onboard` returned HTTP 200.
- Public and local health reported database, Redis, and audit persistence `ok`.
- All 727 version-controlled deployment files matched local SHA-256 hashes.
- The deployment-window service logs contained no error, fatal, unhandled, or
  uncaught entries.
- No `collaboration_test_*` PostgreSQL schema remained.

## Production browser acceptance

An authenticated production Chrome session verified the original empty-Agent
mapping path after a fresh reload:

1. each role slot exposed `准备 Agent`;
2. the empty state exposed `准备第一个 Agent`;
3. the dialog exposed existing-Agent and create-Agent tabs;
4. an existing Reader showed the Editor/Publisher upgrade path;
5. closing restored focus to the triggering button;
6. the page and dialog fit a 390×844 viewport with `scrollWidth=390`;
7. browser console error/warn output was empty.

The final prepare action was deliberately not submitted, so the production
acceptance created no Agent and changed no Space authorization.

## Package surfaces

- `@neomei/agentwiki-local-sync`: `0.6.1`
- `@neomei/agentwiki-sync-protocol`: `0.3.0`

This release did not change package versions or public package artifacts, so no
npm publication was required.
