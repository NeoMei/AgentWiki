# Legacy v3 Space-list hotfix implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox syntax for tracking.

**Goal:** Make public v3 discovery accept valid legacy root/nested folders without changing or publishing their revisions.

**Architecture:** Correct Prisma-row to canonical-folder projection in the existing list service. Keep the real v3 writer inspection and public schemas strict; do not add a plugin fallback or change the protocol.

**Tech Stack:** NestJS, Prisma, TypeScript, Jest, published sync-v3 schemas.

**Spec:** The already approved contract and public reproduction are recorded in `/Users/neomei/项目/codexprojects/AgentWiki-Obsidian/.worktrees/referenced-image-sync-v3/docs/verification/local-first-image-upgrade.md` (Blocking public list defect). User authorized independent server repair, validation and deployment on 2026-09-06.

## Global Constraints

- `GET /api/sync/v3/spaces` must remain a read-only operation: no Revision, Page, Folder, Attachment or membership mutation.
- Preserve root `parentFolderId: null`, nested parent IDs, and RFC3339 `updatedAt` strings in canonical folder inputs.
- Preserve `native_v3`, `legacy_v2`, `bootstrap_required` mode selection, current revision and permission rules; do not convert a list error to a downgrade.
- No schema migration, package bump, unrelated refactor, secret extraction, main Vault modification or worker-initiated production write.
- Only controller deploys after frozen code review and fresh tests, verified rollback backups and actual production target checks.

### Task 1: Fix legacy/live folder canonical projection and regress mixed discovery

**Files:**
- Modify: `apps/server/src/integrations/obsidian/sync-v3-revision.service.ts`
- Test: `apps/server/src/integrations/obsidian/sync-v3-revision.service.spec.ts`
- Test when required for real database route coverage: `scripts/sync-v3-http-db.test.mjs`

**Interfaces:** Consume existing `SyncV3RevisionService.listSpaces(principal)` and real `SyncV3RevisionWriterService.inspectCandidate`; produce the unchanged strict `TreeSyncSpaceListResponseV3Schema` contract.

- [ ] Run the existing focused service test as baseline, then write regression coverage that uses the real writer inspection (not an inspectCandidate stub that accepts invalid folders). Include persisted legacy root and nested folders with Prisma Date timestamps, no-revision live root/nested folders, strictly empty Space, and native-v3 Space in mixed discovery. Assert exact modes, revisions, counts, role/read/publish bindings, schema-valid output, preserved parent IDs and timestamps, and no writes. Use the existing test harness rather than a parallel implementation.
- [ ] Run `pnpm --filter @agentwiki/server test -- --runTestsByPath src/integrations/obsidian/sync-v3-revision.service.spec.ts` (adjust only Jest forwarding if required). Record the actual RED canonical validation failure before production edits, not an import/setup failure.
- [ ] Apply the smallest projection fix. Select source shape explicitly, preserve null, and convert Date to ISO text:

```ts
parentFolderId: latest ? folder.parentFolderId : folder.parentId,
updatedAt: folder.updatedAt.toISOString(),
```

Validate source types first; if both Date and ISO are legitimate inputs, preserve valid ISO without weakening schema validation. Do not change Page handling unless a real failing case demonstrates that it shares the defect.

- [ ] Run focused GREEN, affected writer/controller tests, server typecheck/lint, and full server test once. Do not migrate or use shared/production databases; request a dedicated test DB context from controller if needed. Controller separately owns production/public gate and broad build validation.
- [ ] Self-review and commit only exact product/test paths. Write detailed ignored report with RED/GREEN commands/output and remaining environment gaps. No push/deploy by worker.

## Controller release and downstream gate

- Independently review immutable patch; fresh server build and application module-composition checks.
- Inspect actual production identity, code, DB target and migration parity without exposing credentials. Take verified PostgreSQL/application backups; coordinate attachment backup if any writer stop/schema operation is required.
- Deploy only the reviewed candidate using established staging and rollback procedure; no broad runtime-hardening changes.
- Use fresh isolated populated/empty legacy Spaces for the plugin U1 verifier; require all four tests including pre-upgrade strict mode list. Preserve previous fixtures and user data.
- Only after U1 is fully green resume the existing plugin U2–U7 plan, including actual Android and final release gates.
