# Space Folder Hierarchy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add first-class, permission-inheriting Folder trees to each Space so humans, authorized Agents, Local Sync, and the Obsidian plugin can create and maintain hierarchical document sets without treating Pages as folders.

**Architecture:** PostgreSQL owns Folder identity, Page placement, paths, aliases, deletion batches, and a monotonic Space tree revision. A single `ContentTreeService` performs every structural mutation under the existing Space advisory lock and advances both content-tree and sync revisions atomically. Sync Protocol v2 transfers Folder and Page leaves; web and Obsidian clients lazily render or safely apply that same tree. Release A expands and backfills the schema while preserving legacy readers; Release B removes `Page.parentId` only after all writers and clients are verified on Folder semantics.

**Tech Stack:** NestJS 11, Prisma 5/PostgreSQL recursive CTEs and advisory locks, Zod 4, React 18, Axios, Tailwind CSS, Jest 30, Vitest 3, Playwright 1.62, Node test runner, Obsidian 1.11 plugin APIs.

**Spec:** `docs/superpowers/specs/2026-08-28-space-folder-hierarchy-design.md`

## Global Constraints

- `Folder` is the only container type. Pages are leaves and new code must never assign another Page as a parent.
- Folder permissions inherit from Space membership/grants; this release adds no per-Folder ACL.
- The managed filesystem root is exactly `AgentWiki/pages/`; no Folder operation may escape it or follow a symlink/reparse point.
- Allow sibling `项目.md` and `项目/`; reject duplicate active Folder names under one parent using NFC plus portable case-folding.
- Enforce depth 32, 255 UTF-8 bytes per segment, 1024 UTF-8 bytes per path, 10,000 active Folders per Space, and 10,000 affected nodes per recursive operation.
- Every structural write requires `expectedTreeRevision` and the target's `expectedUpdatedAt` where a target already exists. Stale writes fail atomically with `CONTENT_TREE_CONFLICT`.
- Folder/Page path changes write Page aliases before the current path changes. Keep at most 20 recent aliases per Page unless an active relation still references one.
- Recursive delete and restore are batch operations. Never silently overwrite, merge, or auto-rename on restore.
- Sync v1 remains readable only for Spaces without active Folder structure. It must return `SYNC_PROTOCOL_UPGRADE_REQUIRED` for Folder-enabled Spaces instead of flattening data.
- Agent Folder mutations use live grant scopes, ChangeSets, publisher/approval rules, and audit records. Existing grants do not silently gain the new Folder scopes.
- The plugin's private Folder identity map stays outside Markdown and outside synced visible files.
- Database tests require a dedicated URL whose database name contains `test`; generated schemas use `folder_test_*`. Never migrate or clean `public` in tests.
- Do not push, publish npm packages, tag, migrate production, install a plugin bundle, or deploy production without a later explicit release instruction.

---

## File Structure

### AgentWiki repository

- Modify `packages/sync-protocol/src/normalize.ts`, `normalize.spec.ts`, `index.ts`, and Agent access-role files: preserve v1 while adding shared portable path primitives and Folder scopes.
- Create `packages/sync-protocol/src/sync-v2.ts` and `sync-v2.spec.ts`: v2 discriminated operations, manifests, parsing, hashing, limits, and fixtures.
- Modify `apps/server/prisma/schema.prisma`: `Folder`, `PagePathAlias`, `ContentDeletionBatch`, Folder revision rows, `Space.contentTreeRevision`, and Page Folder/deletion fields.
- Create `apps/server/prisma/migrations/20260828120000_expand_space_folders/migration.sql`: additive Release A schema and constraints.
- Create `apps/server/prisma/migrations/20260828190000_cutover_space_folders/migration.sql`: Release B constraints and legacy `Page.parentId` removal.
- Create `scripts/folder-test-database.mjs`, `folder-schema-db.test.mjs`, `space-folder-migration.mjs`, `space-folder-migration.test.mjs`, and `space-folder-migration-db.test.mjs`.
- Create `apps/server/src/content-tree/content-tree.types.ts`, `content-tree.dto.ts`, `folder-name.ts`, `content-tree.service.ts`, `content-tree.controller.ts`, `content-tree.module.ts`, and matching specs.
- Modify `apps/server/src/core/page/page.service.ts`, `page.controller.ts`, `page.module.ts`, `core/dto/page.dto.ts`, and specs: replace structural `parentId` writes with `folderId`.
- Modify `apps/server/src/core/sync/readable-sync-path.service.ts`, `space-revision-writer.service.ts`, and specs: Folder-aware allocation and revision advancement.
- Create `apps/server/src/integrations/obsidian/sync-v2.controller.ts`, `sync-v2.http.integration.spec.ts`, and `sync-v2-revision.service.ts`.
- Modify `apps/server/src/integrations/obsidian/push-session.service.ts`, `sync-capabilities.service.ts`, `sync-v1.controller.ts`, and specs: v2 operations and fail-closed v1 compatibility.
- Modify `apps/server/src/core/authorization/authorization.service.ts`, `packages/sync-protocol/src/agent-access-role.ts`, MCP, Review, audit, and their specs: Folder scopes and ChangeSet publishing.
- Modify `packages/local-sync/src/agentwiki-client.ts`, `sync/sync-engine.ts`, `sync/merge.ts`, `workspace/manifest.ts`, `workspace/state.ts`, and specs: Folder identity mapping, scan/apply order, conflicts, and secure empty-Folder handling.
- Create `apps/client/src/features/content-tree/contentTreeTypes.ts`, `contentTreeApi.ts`, `contentTreeState.ts`, `ContentTree.tsx`, `FolderDialog.tsx`, `FolderDeleteDialog.tsx`, `ContentBreadcrumbs.tsx`, and matching specs.
- Modify `apps/client/src/features/space/SpaceView.tsx`, page-template `NewPageDialog.tsx`, Page editor/preview, Markdown resource resolution, API types, i18n, and E2E specs.
- Create `apps/client/e2e/space-folders.spec.ts` and `scripts/sync-v2-folder-db.test.mjs`.
- Modify `docs/contracts/agentwiki-obsidian-sync-api-v1.md` and create `docs/contracts/agentwiki-obsidian-sync-api-v2.md` plus `docs/operations/space-folder-migration.md`.

### AgentWiki-Obsidian repository

- Modify `/Users/neomei/项目/codexprojects/AgentWiki-Obsidian/src/agentwiki/protocol/{types,schemas,batching,canonical,hash,index}.ts`, `src/agentwiki/client.ts`, `src/agentwiki/push-remote.ts`, application runtime/coordinator/settings, and remote ports/adapters: negotiate and consume Sync v2.
- Create `/Users/neomei/项目/codexprojects/AgentWiki-Obsidian/src/core/folder-identity.ts` and tests: private Folder ID/path map.
- Modify `/Users/neomei/项目/codexprojects/AgentWiki-Obsidian/src/obsidian/adapters.ts`, preview logic/modal, Sync Center, and tests: secure Folder create/move/delete/restore previews.
- Modify `/Users/neomei/项目/codexprojects/AgentWiki-Obsidian/src/storage/baseline.ts` and integration/E2E tests: persist v2 baselines without visible marker files.

---

### Task 1: Add portable directory validation and Sync Protocol v2 contracts

**Files:**
- Modify: `packages/sync-protocol/src/normalize.ts`
- Modify: `packages/sync-protocol/src/normalize.spec.ts`
- Create: `packages/sync-protocol/src/sync-v2.ts`
- Create: `packages/sync-protocol/src/sync-v2.spec.ts`
- Modify: `packages/sync-protocol/src/index.ts`
- Modify: `packages/sync-protocol/src/agent-access-role.ts`
- Modify: `packages/sync-protocol/src/agent-access-role.spec.ts`

**Interfaces:**
- Produces: `validatePortableDirectoryPath`, `validatePortableMarkdownPath`, `SyncFolderV2`, `SyncPageV2`, `TreeDeltaItemV2`, v2 request/response schemas, and Folder scope constants.
- Consumers: server Sync v2, Local Sync, Agent authorization, and Obsidian plugin.

- [ ] **Step 1: Write failing path-contract tests**

Cover NFC normalization, Unicode case-folding, Windows reserved names, controls, `.`/`..`, slash and backslash, trailing dot/space, 255-byte segments, 1024-byte paths, `.md` required only for Pages, and the allowed pair `pages/项目` plus `pages/项目.md`.

- [ ] **Step 2: Run the focused protocol tests and verify RED**

```bash
pnpm --filter @neomei/agentwiki-sync-protocol test -- src/normalize.spec.ts src/sync-v2.spec.ts
```

Expected: FAIL because directory validation and v2 schemas do not exist.

- [ ] **Step 3: Split the existing validator without changing v1 behavior**

Implement these exact signatures and keep `validatePortablePath` as a deprecated alias for the Markdown validator until Release B:

```ts
export interface PortablePath { path: string; key: string }
export function validatePortableDirectoryPath(input: string): PortablePath;
export function validatePortableMarkdownPath(input: string): PortablePath;
/** @deprecated Use validatePortableMarkdownPath. */
export const validatePortablePath = validatePortableMarkdownPath;
```

Both validators call one private segment validator; only `validatePortableMarkdownPath` requires the final `.md` suffix.

- [ ] **Step 4: Define strict v2 entities and operations**

```ts
export interface SyncFolderV2 {
  folderId: string;
  parentFolderId: string | null;
  name: string;
  path: string;
  sortOrder: number;
  updatedAt: string;
}

export interface SyncPageV2 {
  pageId: string;
  folderId: string | null;
  path: string;
  title: string;
  body: string;
  contentHash: string;
  updatedAt: string;
}

export type TreeDeltaItemV2 =
  | { operation: 'upsert_folder'; folder: SyncFolderV2 }
  | { operation: 'archive_folder'; folderId: string; previousPath: string }
  | { operation: 'upsert_page'; page: SyncPageV2 }
  | { operation: 'archive_page'; pageId: string; previousPath: string };
```

All v2 envelopes use `protocolVersion: '2'`; schemas are `.strict()`. Canonical manifest order is Folder parents before children, then Pages by `pathKey` and ID. Push limits remain 100 changes per batch and 2 MiB for `propose_document_tree` payloads.

- [ ] **Step 5: Add explicit Folder scopes without expanding existing roles**

Add `folders:read`, `folders:write`, and `folders:delete` to the scope vocabulary. Keep existing persisted grants unchanged. Newly created or explicitly reconfigured grants use the new role defaults; tests must prove an old editor grant without those strings receives `AUTH_SCOPE_REQUIRED`.

- [ ] **Step 6: Run protocol gates and commit**

```bash
pnpm --filter @neomei/agentwiki-sync-protocol test
pnpm --filter @neomei/agentwiki-sync-protocol typecheck
git add packages/sync-protocol/src
git commit -m "feat(sync): define folder-aware protocol v2"
```

Expected: all protocol tests and typecheck PASS; v1 fixtures remain byte-for-byte unchanged.

---

### Task 2: Add the additive Folder schema and isolated PostgreSQL gate

**Files:**
- Modify: `apps/server/prisma/schema.prisma`
- Create: `apps/server/prisma/migrations/20260828120000_expand_space_folders/migration.sql`
- Create: `scripts/folder-test-database.mjs`
- Create: `scripts/folder-schema-db.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces: Prisma `Folder`, `PagePathAlias`, `ContentDeletionBatch`, `SyncRevisionFolderRow`, `SyncRevisionTreeDeltaRow`, and `withFolderTestDatabase`.
- Consumers: every later server and migration task.

- [ ] **Step 1: Write the fail-closed database harness and schema test first**

```ts
export function validateFolderTestDatabaseUrl(value: string | undefined): URL;
export function withFolderTestDatabase<T>(
  baseDatabaseUrl: string,
  callback: (context: { databaseUrl: string; schemaName: string }) => Promise<T>,
): Promise<T>;
```

Reject missing/non-PostgreSQL URLs, database names without `test`, repeated `schema` parameters, and generated names outside `^folder_test_[a-z0-9_]+$`. The test must prove active sibling Folder uniqueness, same names under different parents, Page/Folder same basename coexistence, valid self-relations, alias multiplicity, deletion batch relations, revision rows, and cascades.

- [ ] **Step 2: Verify RED against a dedicated database**

```bash
FOLDER_TEST_DATABASE_URL='postgresql://agentwiki:test_password@127.0.0.1:5432/agentwiki_test' node --test scripts/folder-schema-db.test.mjs
```

Expected: FAIL because the schema and harness are absent. If the test database is unavailable, provision an authorized disposable database; never substitute production `DATABASE_URL`.

- [ ] **Step 3: Add the Release A Prisma fields and relations**

Use `BigInt @default(0)` for `Space.contentTreeRevision`. Add nullable `Page.folderId` and `Page.deletionBatchId` while retaining `parentId` temporarily. Add nullable `PageVersion.folderId` while retaining its legacy `parentId` until Release B. Add nullable `folderId` to `SyncRevisionPageRow` so v2 Page snapshots preserve placement while v1 rows remain representable. `Folder` includes `name/nameKey/path/pathKey/sortOrder`, timestamps, soft-delete fields, and a self-parent relation. `PagePathAlias` includes `spaceId/pageId/path/pathKey/expiresAt`. `ContentDeletionBatch` includes actor IDs, root Folder, deleted revision, counts, impact hash, and restore time.

The revision rows are immutable snapshots:

```prisma
model SyncRevisionFolderRow {
  revisionId     String
  folderId       String
  parentFolderId String?
  name           String
  path           String
  pathKey        String
  sortOrder      Int
  updatedAt      DateTime

  @@id([revisionId, folderId])
  @@unique([revisionId, pathKey])
}
```

- [ ] **Step 4: Add SQL-only active-state constraints and indexes**

The migration must create partial unique indexes for active Folder siblings and active Folder paths, because nullable soft-delete state cannot be expressed safely as a Prisma `@@unique`:

```sql
CREATE UNIQUE INDEX "Folder_active_sibling_name_key"
  ON "Folder"("spaceId", COALESCE("parentId", ''), "nameKey")
  WHERE "deletedAt" IS NULL;
CREATE UNIQUE INDEX "Folder_active_path_key"
  ON "Folder"("spaceId", "pathKey")
  WHERE "deletedAt" IS NULL;
ALTER TABLE "Folder" ADD CONSTRAINT "Folder_not_self_parent"
  CHECK ("parentId" IS NULL OR "parentId" <> "id");
```

Add non-empty/path/hash/count checks and indexes for `(spaceId,parentId,deletedAt,sortOrder,id)`, aliases, deletion batches, Page `folderId`, and revision rows.

- [ ] **Step 5: Generate Prisma and run the real schema gate**

```bash
pnpm --filter @agentwiki/server exec prisma generate
FOLDER_TEST_DATABASE_URL="$FOLDER_TEST_DATABASE_URL" node --test scripts/folder-schema-db.test.mjs
```

Expected: PASS and the harness leaves zero `folder_test_*` schemas.

- [ ] **Step 6: Add the root gate and commit**

Add `test:e2e:folders-db` as a fail-closed script that requires `FOLDER_TEST_DATABASE_URL`, builds the server, and runs all Folder DB tests.

```bash
git add apps/server/prisma package.json scripts/folder-test-database.mjs scripts/folder-schema-db.test.mjs
git commit -m "feat(folders): add additive folder schema"
```

---

### Task 3: Implement ContentTree read/create invariants and revision locking

**Files:**
- Create: `apps/server/src/content-tree/content-tree.types.ts`
- Create: `apps/server/src/content-tree/folder-name.ts`
- Create: `apps/server/src/content-tree/folder-name.spec.ts`
- Create: `apps/server/src/content-tree/content-tree.service.ts`
- Create: `apps/server/src/content-tree/content-tree.service.spec.ts`
- Modify: `apps/server/src/core/sync/space-revision-writer.service.ts`
- Modify: `apps/server/src/core/sync/space-revision-writer.service.spec.ts`

**Interfaces:**
- Produces: `ContentTreeService.listChildren`, `createFolder`, `placePage`, `ContentTreeConflict`, and portable Folder naming/path allocation.
- Consumers: REST, Page service, Review publisher, Sync push, and migration.

- [ ] **Step 1: Write failing unit/property tests**

Cover root and nested creation, direct-child pagination, deterministic Folder-before-Page ordering, `hasChildren`, duplicate portable names, depth/path/count limits, cross-Space parents, stale tree revision, and concurrent creates. Add property tests over Unicode names to prove `nameKey` and path validation agree with Sync Protocol.

- [ ] **Step 2: Verify RED**

```bash
pnpm --filter @agentwiki/server test -- --runTestsByPath src/content-tree/folder-name.spec.ts src/content-tree/content-tree.service.spec.ts
```

Expected: FAIL because `ContentTreeService` does not exist.

- [ ] **Step 3: Define the transactional interface**

```ts
export interface CreateFolderInput {
  spaceId: string;
  name: string;
  parentId: string | null;
  expectedTreeRevision: bigint;
  actor: { userId?: string; agentId?: string };
}

export interface MoveTreeNodeInput {
  spaceId: string;
  kind: 'folder' | 'page';
  nodeId: string;
  targetFolderId: string | null;
  beforeId?: string;
  expectedTreeRevision: bigint;
  expectedUpdatedAt: Date;
}
```

`listChildren` accepts `parentFolderId`, opaque cursor, and `take` 1..200. Its cursor binds Space, parent, item kind, sort order, created time, and ID so it cannot be replayed on another tree location.

- [ ] **Step 4: Implement one lock/revision boundary**

Extend `SpaceRevisionWriterService.lockSpace` to return the locked Space tree revision. Add `advanceContentTreeRevision(tx, spaceId, expected)` using compare-and-swap while the advisory lock is held. `ContentTreeService` must lock first, validate the expected revision, compute all paths, write, advance both revisions, and return the new revision from the same transaction.

- [ ] **Step 5: Implement Folder names and direct-child queries**

`normalizeFolderName` trims only surrounding whitespace, normalizes NFC, rejects portable-invalid names, computes `foldCase`, and returns UTF-8 byte counts. Use bounded recursive CTEs for ancestors/count checks and two indexed queries for Folder and Page children; merge only one page of results with Folder-first stable ordering.

- [ ] **Step 6: Run tests, typecheck, and commit**

```bash
pnpm --filter @agentwiki/server test -- --runTestsByPath src/content-tree/folder-name.spec.ts src/content-tree/content-tree.service.spec.ts src/core/sync/space-revision-writer.service.spec.ts
pnpm --filter @agentwiki/server typecheck
git add apps/server/src/content-tree apps/server/src/core/sync/space-revision-writer.service.*
git commit -m "feat(folders): add transactional content tree core"
```

---

### Task 4: Implement rename/move, aliases, recursive delete, and restore

**Files:**
- Modify: `apps/server/src/content-tree/content-tree.service.ts`
- Modify: `apps/server/src/content-tree/content-tree.service.spec.ts`
- Create: `apps/server/src/content-tree/content-tree.db.spec.ts`
- Modify: `apps/server/src/core/sync/readable-sync-path.service.ts`
- Modify: `apps/server/src/core/sync/readable-sync-path.service.spec.ts`
- Create: `scripts/content-tree-operations-db.test.mjs`

**Interfaces:**
- Produces: `renameFolder`, `moveNode`, `deleteImpact`, `deleteFolder`, `restoreDeletionBatch`, and `resolvePagePath`.
- Consumers: Folder API, Markdown resolution, Review publisher, and Sync push.

- [ ] **Step 1: Write failing mutation and PostgreSQL concurrency tests**

Cover Folder-to-descendant cycle rejection, cross-Space moves, subtree path rewrites, Page move path allocation, old-path aliases, 20-alias trimming, ambiguous aliases, stale `updatedAt`, two concurrent moves, delete impact hash, recursive soft delete, exact restore, root restore, explicit top-level rename, occupied restore target, and rollback on the 10,001st affected node.

- [ ] **Step 2: Verify RED in unit and isolated DB gates**

```bash
pnpm --filter @agentwiki/server test -- --runTestsByPath src/content-tree/content-tree.service.spec.ts
FOLDER_TEST_DATABASE_URL="$FOLDER_TEST_DATABASE_URL" node --test scripts/content-tree-operations-db.test.mjs
```

Expected: FAIL on missing mutation methods.

- [ ] **Step 3: Precompute the complete mutation before writing**

Use a recursive CTE to load at most 10,001 descendants. Calculate every new Folder path, Page path, and `pathKey` in memory, validate depth/bytes, query all conflicts, and only then write. Single-node move reorders only direct siblings and compacts their `sortOrder` deterministically.

- [ ] **Step 4: Write Page aliases and update paths in one transaction**

Before a Page path changes, insert the old `(spaceId,pageId,path,pathKey)` with `skipDuplicates`. Update Folder descendants parent-first and Pages after their containing Folder paths are fixed. Alias resolution returns current Page first, one alias second, `MARKDOWN_REFERENCE_AMBIGUOUS` for multiple Pages, and not-found otherwise.

- [ ] **Step 5: Implement batch delete/restore**

`deleteImpact` returns counts and SHA-256 over sorted `folder:<id>`/`page:<id>` identifiers. `deleteFolder` rechecks that hash, creates one `ContentDeletionBatch`, and stamps the same batch ID/deletedAt on all affected records. Restore accepts exactly one strategy:

```ts
type RestoreStrategy =
  | { kind: 'original' }
  | { kind: 'root' }
  | { kind: 'rename-root'; name: string };
```

Any active collision fails before clearing deletion state.

- [ ] **Step 6: Run all focused gates and commit**

```bash
pnpm --filter @agentwiki/server test -- --runTestsByPath src/content-tree/content-tree.service.spec.ts src/core/sync/readable-sync-path.service.spec.ts
FOLDER_TEST_DATABASE_URL="$FOLDER_TEST_DATABASE_URL" node --test scripts/content-tree-operations-db.test.mjs
git add apps/server/src/content-tree apps/server/src/core/sync/readable-sync-path.service.* scripts/content-tree-operations-db.test.mjs
git commit -m "feat(folders): add atomic tree lifecycle operations"
```

---

### Task 5: Expose Folder REST APIs and move Page/template/Markdown consumers to `folderId`

**Files:**
- Create: `apps/server/src/content-tree/content-tree.dto.ts`
- Create: `apps/server/src/content-tree/content-tree.controller.ts`
- Create: `apps/server/src/content-tree/content-tree.controller.spec.ts`
- Create: `apps/server/src/content-tree/content-tree.module.ts`
- Modify: `apps/server/src/app.module.ts`
- Modify: `apps/server/src/core/dto/page.dto.ts`
- Modify: `apps/server/src/core/dto/page.dto.spec.ts`
- Modify: `apps/server/src/core/page/page.controller.ts`
- Modify: `apps/server/src/core/page/page.service.ts`
- Modify: `apps/server/src/core/page/page.controller.spec.ts`
- Modify: `apps/server/src/core/page/page.service.spec.ts`
- Modify: `apps/server/src/page-templates/page-template.service.ts`
- Modify: `apps/server/src/page-templates/page-template.service.spec.ts`
- Modify: `apps/server/src/markdown-resources/markdown-resource.service.ts`
- Modify: `apps/server/src/markdown-resources/markdown-resource.service.spec.ts`

**Interfaces:**
- Produces: the spec's Space-scoped Folder/content-tree routes and Folder-aware Page creation/resolution.
- Consumers: web client, MCP, migration tooling, and Markdown preview.

- [ ] **Step 1: Write controller/DTO tests for the exact HTTP contract**

Test `GET /spaces/:spaceId/content-tree`, Folder search/create/update/move/delete-impact/delete/restore, numeric `treeRevision` serialized as decimal strings, cursor binding, `take` bounds, and error codes from spec section 12. Verify Viewer read-only, Editor create/move/rename, and only Owner/Admin delete/restore.

- [ ] **Step 2: Verify RED**

```bash
pnpm --filter @agentwiki/server test -- --runTestsByPath src/content-tree/content-tree.controller.spec.ts src/core/dto/page.dto.spec.ts
```

Expected: FAIL because the routes and `folderId` DTOs do not exist.

- [ ] **Step 3: Add strict DTOs and routes**

All writes reject unknown fields. Create Page accepts `folderId?: string | null` and `expectedTreeRevision`; during Release A, `parentId` is accepted only behind `ALLOW_LEGACY_PAGE_PARENT_WRITE=true`, never together with `folderId`, and defaults off outside migration tests.

- [ ] **Step 4: Route every structural Page mutation through `ContentTreeService`**

Page create, move, title rename, archive/restore, template-based create, Page-version restore, and Review publishing must not call `ReadableSyncPathService.allocate` independently. New Page versions record `folderId`; Release A migration maps legacy `PageVersion.parentId` where possible, and Release B removes that field. Non-structural body-only edits continue using Page versioning but do not advance `contentTreeRevision`.

- [ ] **Step 5: Make Markdown/Wiki resolution Folder-aware**

Resolve `[[标题]]`, `[[路径/标题]]`, Page embeds, and image/page resource lookups against current Folder-qualified paths plus aliases. Current path wins; ambiguous title or alias returns structured candidates without leaking other Spaces.

- [ ] **Step 6: Run focused server gates and commit**

```bash
pnpm --filter @agentwiki/server test -- --runTestsByPath src/content-tree/content-tree.controller.spec.ts src/core/page/page.controller.spec.ts src/core/page/page.service.spec.ts src/page-templates/page-template.service.spec.ts src/markdown-resources/markdown-resource.service.spec.ts
pnpm --filter @agentwiki/server typecheck
git add apps/server/src
git commit -m "feat(folders): expose folder APIs and page placement"
```

---

### Task 6: Build deterministic legacy Page-tree preflight and backfill

**Files:**
- Create: `scripts/space-folder-migration.mjs`
- Create: `scripts/space-folder-migration.test.mjs`
- Create: `scripts/space-folder-migration-db.test.mjs`
- Create: `docs/operations/space-folder-migration.md`
- Modify: `package.json`

**Interfaces:**
- Produces: `preflightSpaceFolderMigration`, `migrateSpaceFolders`, resumable batch IDs, and an operator report.
- Consumers: Release A production migration and Release B cutover gate.

- [ ] **Step 1: Write pure migration-plan tests**

Test roots, 32-level nesting, sibling title collisions, invalid portable titles, `项目.md` beside `项目/`, stable Page IDs/titles, old `syncPath` aliases, already migrated rows, cycles, orphaned parent IDs, deleted Pages, and repeat execution.

- [ ] **Step 2: Define deterministic Folder-name sanitization**

Normalize NFC; trim; replace controls and `/\\:*?\"<>|` with `-`; collapse repeated `-` and spaces; turn empty names into `untitled-folder`; append `-folder` to reserved names; truncate by UTF-8 bytes and append `-<first8 sha256>`; allocate sibling collisions as ` (2)`, ` (3)` in stable Page-ID order. Report every transformation.

- [ ] **Step 3: Implement the exact legacy translation**

For each legacy Page with children, create one same-title Folder. A root Page remains a root Page and its children move into its Folder. A nested Page moves into the Folder chain created for its ancestors; its own children move into its same-title child Folder. Keep Page IDs, titles, content, authors, and timestamps; write the prior `syncPath` as an alias before assigning the Folder-qualified path.

- [ ] **Step 4: Add preflight and idempotent transaction batches**

Preflight is read-only and fails on cycles, cross-Space parent pointers, unresolved collisions, paths beyond limits, or more than 10,000 active Folders. Migration locks one Space, records `space-folders-v1:<spaceId>` as its batch key, writes the complete Space atomically, and is a no-op on the same completed key.

- [ ] **Step 5: Run pure and PostgreSQL tests twice**

```bash
node --test scripts/space-folder-migration.test.mjs
FOLDER_TEST_DATABASE_URL="$FOLDER_TEST_DATABASE_URL" node --test scripts/space-folder-migration-db.test.mjs
FOLDER_TEST_DATABASE_URL="$FOLDER_TEST_DATABASE_URL" node --test scripts/space-folder-migration-db.test.mjs
```

Expected: both DB runs PASS; the second reports zero new Folder/Page mutations.

- [ ] **Step 6: Document dry-run/apply/rollback boundary and commit**

The runbook must show backup verification, `--dry-run`, per-Space apply, report retention, post-counts, and the rule that rollback restores the database backup rather than trying to infer the legacy tree.

```bash
git add scripts/space-folder-migration* docs/operations/space-folder-migration.md package.json
git commit -m "feat(folders): add deterministic legacy tree migration"
```

---

### Task 7: Add Folder-aware server Sync Protocol v2 and fail-closed v1 behavior

**Files:**
- Create: `apps/server/src/integrations/obsidian/sync-v2.controller.ts`
- Create: `apps/server/src/integrations/obsidian/sync-v2.http.integration.spec.ts`
- Create: `apps/server/src/integrations/obsidian/sync-v2-revision.service.ts`
- Create: `apps/server/src/integrations/obsidian/sync-v2-revision.service.spec.ts`
- Modify: `apps/server/src/integrations/obsidian/sync-v1.controller.ts`
- Modify: `apps/server/src/integrations/obsidian/sync-v1.http.integration.spec.ts`
- Modify: `apps/server/src/integrations/obsidian/push-session.service.ts`
- Modify: `apps/server/src/integrations/obsidian/push-session.service.spec.ts`
- Modify: `apps/server/src/integrations/obsidian/sync-capabilities.service.ts`
- Modify: `apps/server/src/core/sync/space-revision-writer.service.ts`
- Create: `scripts/sync-v2-folder-db.test.mjs`
- Create: `docs/contracts/agentwiki-obsidian-sync-api-v2.md`
- Modify: `docs/contracts/agentwiki-obsidian-sync-api-v1.md`

**Interfaces:**
- Produces: `/sync/v2` spaces/head/snapshot/delta/push-session endpoints and Folder snapshot rows.
- Consumers: Local Sync and the Obsidian plugin.

- [ ] **Step 1: Write v2 HTTP/DB tests before controller code**

Cover empty Folder snapshot/pull, parent-before-child pagination, Page `folderId`, Folder/page move deltas, recursive archive, restore, resume cursors, response byte caps, stale base revision, conflicting local Folder operations, idempotent finalize, and atomic rejection of a mixed invalid batch.

- [ ] **Step 2: Add a v1 upgrade-required test**

A Space with any active Folder or any Page with non-null `folderId` must return HTTP 409 with `SYNC_PROTOCOL_UPGRADE_REQUIRED` on v1 head/snapshot/delta/push-session creation. Folder-free Spaces keep their existing v1 hashes and responses.

- [ ] **Step 3: Implement immutable v2 revision snapshots**

Within the existing Space lock, snapshot active Folders and Pages into revision rows. Compute `revisionContentHash` from the canonical v2 manifest including Folder identity/parent/path/order and Page identity/folder/path/content hash. Delta order is: archive Pages, archive child Folders, upsert parent Folders, upsert child Folders, upsert Pages.

- [ ] **Step 4: Publish v2 push operations through `ContentTreeService`**

Push-session finalize parses strict v2 batches, verifies confirmation hash, checks base/tree revisions, resolves Folder refs, and calls one ContentTree transaction. No controller or push service writes Folder/Page paths directly.

- [ ] **Step 5: Run server, protocol, and DB gates**

```bash
pnpm --filter @neomei/agentwiki-sync-protocol test
pnpm --filter @agentwiki/server test -- --runTestsByPath src/integrations/obsidian/sync-v2.http.integration.spec.ts src/integrations/obsidian/sync-v2-revision.service.spec.ts src/integrations/obsidian/sync-v1.http.integration.spec.ts src/integrations/obsidian/push-session.service.spec.ts
FOLDER_TEST_DATABASE_URL="$FOLDER_TEST_DATABASE_URL" node --test scripts/sync-v2-folder-db.test.mjs
```

Expected: v2 gates PASS; v1 compatibility fixtures remain green and Folder Spaces fail closed.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/integrations/obsidian apps/server/src/core/sync scripts/sync-v2-folder-db.test.mjs docs/contracts
git commit -m "feat(sync): serve atomic folder protocol v2"
```

---

### Task 8: Upgrade Local Sync for Folder identity, safe apply ordering, and conflicts

**Files:**
- Modify: `packages/local-sync/src/agentwiki-client.ts`
- Modify: `packages/local-sync/src/agentwiki-client.spec.ts`
- Modify: `packages/local-sync/src/sync/sync-engine.ts`
- Modify: `packages/local-sync/src/sync/sync-engine.spec.ts`
- Modify: `packages/local-sync/src/sync/merge.ts`
- Modify: `packages/local-sync/src/sync/merge.spec.ts`
- Modify: `packages/local-sync/src/workspace/manifest.ts`
- Modify: `packages/local-sync/src/workspace/manifest.spec.ts`
- Modify: `packages/local-sync/src/workspace/state.ts`
- Modify: `packages/local-sync/src/workspace/state.spec.ts`
- Modify: `packages/local-sync/src/workspace/layout.ts`
- Modify: `apps/client/e2e/local-sync.spec.ts`

**Interfaces:**
- Produces: protocol negotiation, private `folderId -> path` state, Folder scan/merge/apply, and recovery-safe transactions.
- Consumers: CLI/local workflows and higher-level Obsidian acceptance.

- [ ] **Step 1: Write failing v2 state and merge tests**

Test v1 state migration, future-version rejection, empty Folder persistence, Folder rename by stable ID, offline rename ambiguity, add/add name conflict, delete/modify, parent delete/child add, Page/Folder same basename, and no hidden marker inside managed content.

- [ ] **Step 2: Write failing filesystem safety/recovery tests**

Use an exact `mkdtemp` root. Cover symlink ancestors, symlink destination, path traversal, case-only rename, interrupted parent creation, interrupted child removal, fsync checkpoints, and journal replay. Cleanup only the exact temp directory returned by `mkdtemp`.

- [ ] **Step 3: Implement private Folder identity state**

```ts
export interface FolderIdentityStateV2 {
  schemaVersion: 2;
  spaceId: string;
  revision: string;
  folders: Record<string, { path: string; pathKey: string; updatedAt: string }>;
}
```

Store it under the existing private workspace/control root, never under `AgentWiki/pages/`. Reject duplicate IDs, duplicate active path keys, unknown parents, cycles, and future schema versions.

- [ ] **Step 4: Apply remote changes in dependency order**

Create/rename Folders parent-first, write/move Pages next, remove Pages before Folders, and remove Folders child-first. Empty Folders are materialized. Every path component is `lstat`-checked before and immediately before mutation; changed device/inode identities abort the transaction.

- [ ] **Step 5: Generate explicit local changes and conflicts**

Known ID plus new path is a rename. A new directory without an ID is a create. Two possible identity matches or an offline rename of an empty unknown Folder is `folder-identity-ambiguous`, never guessed. Push one atomic v2 session with the current base/tree revision.

- [ ] **Step 6: Run package gates and commit**

```bash
pnpm --filter @neomei/agentwiki-local-sync test
pnpm --filter @neomei/agentwiki-local-sync typecheck
pnpm --filter @neomei/agentwiki-local-sync build
git add packages/local-sync apps/client/e2e/local-sync.spec.ts
git commit -m "feat(local-sync): synchronize folder hierarchies safely"
```

---

### Task 9: Add Agent Folder scopes and MCP primitive tools

**Files:**
- Modify: `apps/server/src/core/authorization/authorization.service.ts`
- Modify: `apps/server/src/core/authorization/authorization.service.spec.ts`
- Modify: `apps/server/src/core/authorization/live-agent-authorization.ts`
- Modify: `apps/server/src/core/authorization/live-agent-authorization.spec.ts`
- Modify: `apps/server/src/mcp/mcp.service.ts`
- Modify: `apps/server/src/mcp/mcp.service.spec.ts`
- Modify: `apps/server/src/mcp/agent-access-roles.spec.ts`
- Modify: `apps/server/src/review/agent-write-boundary.spec.ts`

**Interfaces:**
- Produces: MCP `list_folders` and `propose_folder_change`; live-scope enforcement for read/write/delete.
- Consumers: Agents with authorized Space grants.

- [ ] **Step 1: Write least-privilege tests**

Prove revoked/expired/disabled/cross-Space grants fail, old grants without Folder scopes fail, reader can list only, editor can propose create/move/rename, delete requires `folders:delete`, publisher still follows Space approval policy, and an Agent cannot call human REST routes directly.

- [ ] **Step 2: Verify RED**

```bash
pnpm --filter @agentwiki/server test -- --runTestsByPath src/mcp/agent-access-roles.spec.ts src/mcp/mcp.service.spec.ts src/review/agent-write-boundary.spec.ts
```

Expected: FAIL because Folder tools/scopes are absent.

- [ ] **Step 3: Register strict MCP tools**

`list_folders` accepts `spaceId`, optional parent/query/cursor/take. `propose_folder_change` accepts one of `create|rename|move|delete|restore`, `expectedTreeRevision`, and `expectedUpdatedAt` for existing targets. Return serialized ChangeSet IDs and impact summaries; never publish inside the MCP handler.

- [ ] **Step 4: Recheck authorization at proposal and publish time**

The proposal requires live scopes. Auto-publish re-evaluates the same required scope set inside the publish transaction; lost authorization demotes to pending review using the existing behavior. Audit success/failure without logging Folder names from private Spaces.

- [ ] **Step 5: Run focused gates and commit**

```bash
pnpm --filter @agentwiki/server test -- --runTestsByPath src/core/authorization/authorization.service.spec.ts src/core/authorization/live-agent-authorization.spec.ts src/mcp/agent-access-roles.spec.ts src/mcp/mcp.service.spec.ts src/review/agent-write-boundary.spec.ts
git add apps/server/src/core/authorization apps/server/src/mcp apps/server/src/review/agent-write-boundary.spec.ts
git commit -m "feat(mcp): authorize folder lifecycle proposals"
```

---

### Task 10: Publish atomic `propose_document_tree` ChangeSets

**Files:**
- Modify: `apps/server/src/mcp/mcp.service.ts`
- Modify: `apps/server/src/mcp/mcp.service.spec.ts`
- Modify: `apps/server/src/review/review.service.ts`
- Modify: `apps/server/src/review/review.service.spec.ts`
- Modify: `apps/server/src/core/dto/review.dto.ts`
- Create: `apps/server/src/core/dto/review.dto.spec.ts`
- Modify: `apps/server/src/core/security/audit.service.ts`
- Modify: `apps/server/src/core/security/audit.service.spec.ts`
- Create: `scripts/document-tree-publish-db.test.mjs`

**Interfaces:**
- Produces: one ChangeSet containing up to 100 Folder/Page operations with ChangeSet-local `folderRef` dependencies.
- Consumers: Agents autonomously authoring hierarchical document suites.

- [ ] **Step 1: Write schema and topology tests first**

Cover forward references, duplicate refs, missing refs, ref cycles, Folder depth, 100/101 operations, 2 MiB boundary, cross-Space IDs, mixed create/update/delete, stale tree revision, and exact rollback when operation 100 conflicts.

- [ ] **Step 2: Define the operation union**

```ts
type DocumentTreeOperation =
  | { op: 'create_folder'; folderRef: string; parent: { folderId?: string; folderRef?: string }; name: string }
  | { op: 'move_folder'; folderId: string; target: { folderId?: string; folderRef?: string }; expectedUpdatedAt: string }
  | { op: 'create_page'; folder: { folderId?: string; folderRef?: string }; title: string; content: string }
  | { op: 'move_page'; pageId: string; folder: { folderId?: string; folderRef?: string }; expectedUpdatedAt: string }
  | { op: 'archive_folder'; folderId: string; expectedUpdatedAt: string; impactHash: string };
```

Exactly one of `folderId`/`folderRef` is allowed in each reference object. `folderRef` matches `^[A-Za-z][A-Za-z0-9_-]{0,63}$`.

- [ ] **Step 3: Compile accepted items into a topological plan**

Reject the complete ChangeSet before publication if any dependency is invalid. Resolve local refs only inside the transaction. Call `ContentTreeService.publishDocumentTree` once so Folder creation, Page writes, aliases, audit, content tree revision, and sync revision commit atomically.

- [ ] **Step 4: Preserve publisher and human review policy**

Required scopes are the union of all operations. A non-publisher creates pending review. A publisher auto-publishes only where current Space policy allows; Folder delete still requires `folders:delete`. Store only bounded summaries in audit metadata.

- [ ] **Step 5: Run unit and real DB tests**

```bash
pnpm --filter @agentwiki/server test -- --runTestsByPath src/mcp/mcp.service.spec.ts src/review/review.service.spec.ts src/core/dto/review.dto.spec.ts src/core/security/audit.service.spec.ts
FOLDER_TEST_DATABASE_URL="$FOLDER_TEST_DATABASE_URL" node --test scripts/document-tree-publish-db.test.mjs
```

Expected: PASS, including the all-or-nothing conflict case.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/mcp apps/server/src/review apps/server/src/core/dto/review.dto* apps/server/src/core/security/audit.service.* scripts/document-tree-publish-db.test.mjs
git commit -m "feat(agents): publish hierarchical document trees atomically"
```

---

### Task 11: Replace the web Page tree with a lazy, accessible ContentTree

**Files:**
- Create: `apps/client/src/features/content-tree/contentTreeTypes.ts`
- Create: `apps/client/src/features/content-tree/contentTreeApi.ts`
- Create: `apps/client/src/features/content-tree/contentTreeApi.spec.ts`
- Create: `apps/client/src/features/content-tree/contentTreeState.ts`
- Create: `apps/client/src/features/content-tree/contentTreeState.spec.ts`
- Create: `apps/client/src/features/content-tree/ContentTree.tsx`
- Create: `apps/client/src/features/content-tree/ContentTree.spec.tsx`
- Create: `apps/client/src/features/content-tree/FolderDialog.tsx`
- Create: `apps/client/src/features/content-tree/FolderDialog.spec.tsx`
- Create: `apps/client/src/features/content-tree/FolderDeleteDialog.tsx`
- Create: `apps/client/src/features/content-tree/ContentBreadcrumbs.tsx`
- Modify: `apps/client/src/features/space/SpaceView.tsx`
- Modify: `apps/client/src/features/space/SpaceView.spec.tsx`
- Modify: `apps/client/src/features/page-templates/NewPageDialog.tsx`
- Modify: `apps/client/src/features/page-templates/NewPageDialog.spec.tsx`
- Modify: `apps/client/src/api/space-types.ts`
- Modify: `apps/client/src/i18n/messages.ts`
- Create: `apps/client/e2e/space-folders.spec.ts`

**Interfaces:**
- Produces: lazy ContentTree, Folder lifecycle dialogs, Page destination picker, breadcrumbs, keyboard and mobile interaction.
- Consumers: Space page creation/navigation and template flow.

- [ ] **Step 1: Write state/API tests before UI code**

Cover per-parent cursor caches, revision invalidation, deduped concurrent expansion, stale-response suppression on route changes, optimistic mutation rollback, selection preservation, and a Page/Folder same-name pair.

- [ ] **Step 2: Write component accessibility tests**

Require `role=tree/treeitem/group`, correct `aria-expanded/level/selected`, Enter/Space selection, ArrowRight expand, ArrowLeft collapse/parent, ArrowUp/Down visible traversal, Home/End, focus restoration after dialog close, visible focus, and no hover-only actions.

- [ ] **Step 3: Implement lazy ContentTree without loading 10,000 nodes**

Fetch root only on Space load. Fetch one Folder's direct children on first expansion and paginate on demand. Preserve expanded IDs in Space-local session state. On a mutation response with a newer tree revision, invalidate only affected parent caches; on an unknown gap, clear all tree caches and refetch root.

- [ ] **Step 4: Add lifecycle interactions**

Toolbar and context menu offer New Folder, Rename, Move, Delete, Restore where authorized. Delete first loads impact counts/hash and requires confirmation. Restore defaults to original and exposes root/explicit rename only after a conflict response. Mobile uses tap menus and destination sheets, not drag-only interaction.

- [ ] **Step 5: Integrate Page/template creation and breadcrumbs**

`NewPageDialog` keeps the confirmed two-step template-first flow and replaces Page parent selection with Folder destination selection. Page routes show Folder breadcrumbs; editing a Page title does not navigate until the server returns its current path/revision.

- [ ] **Step 6: Run focused client and browser tests**

```bash
pnpm --filter @agentwiki/client test -- src/features/content-tree src/features/space/SpaceView.spec.tsx src/features/page-templates/NewPageDialog.spec.tsx
pnpm --filter @agentwiki/client exec tsc --noEmit
pnpm --filter @agentwiki/client exec playwright test e2e/space-folders.spec.ts --project=chromium
```

Expected: desktop and 390px cases PASS with keyboard-only create/move/delete/restore coverage.

- [ ] **Step 7: Commit**

```bash
git add apps/client/src apps/client/e2e/space-folders.spec.ts
git commit -m "feat(client): add accessible Space content tree"
```

---

### Task 12: Upgrade and verify the real Obsidian plugin against Sync v2

**Files:**
- Modify: `/Users/neomei/项目/codexprojects/AgentWiki-Obsidian/package.json`
- Modify: `/Users/neomei/项目/codexprojects/AgentWiki-Obsidian/src/agentwiki/protocol/types.ts`
- Modify: `/Users/neomei/项目/codexprojects/AgentWiki-Obsidian/src/agentwiki/protocol/schemas.ts`
- Modify: `/Users/neomei/项目/codexprojects/AgentWiki-Obsidian/src/agentwiki/protocol/batching.ts`
- Modify: `/Users/neomei/项目/codexprojects/AgentWiki-Obsidian/src/agentwiki/protocol/canonical.ts`
- Modify: `/Users/neomei/项目/codexprojects/AgentWiki-Obsidian/src/agentwiki/protocol/hash.ts`
- Modify: `/Users/neomei/项目/codexprojects/AgentWiki-Obsidian/src/agentwiki/protocol/index.ts`
- Modify: `/Users/neomei/项目/codexprojects/AgentWiki-Obsidian/src/agentwiki/client.ts`
- Modify: `/Users/neomei/项目/codexprojects/AgentWiki-Obsidian/src/agentwiki/push-remote.ts`
- Create: `/Users/neomei/项目/codexprojects/AgentWiki-Obsidian/src/core/folder-identity.ts`
- Create: `/Users/neomei/项目/codexprojects/AgentWiki-Obsidian/tests/unit/folder-identity.test.ts`
- Modify: `/Users/neomei/项目/codexprojects/AgentWiki-Obsidian/src/application/sync-runtime.ts`
- Modify: `/Users/neomei/项目/codexprojects/AgentWiki-Obsidian/src/application/sync-coordinator.ts`
- Modify: `/Users/neomei/项目/codexprojects/AgentWiki-Obsidian/src/application/settings.ts`
- Modify: `/Users/neomei/项目/codexprojects/AgentWiki-Obsidian/src/obsidian/adapters.ts`
- Modify: `/Users/neomei/项目/codexprojects/AgentWiki-Obsidian/src/obsidian/sync-center-modal.ts`
- Modify: `/Users/neomei/项目/codexprojects/AgentWiki-Obsidian/src/obsidian/preview-logic.ts`
- Modify: `/Users/neomei/项目/codexprojects/AgentWiki-Obsidian/src/obsidian/preview-modal.ts`
- Modify: `/Users/neomei/项目/codexprojects/AgentWiki-Obsidian/src/storage/baseline.ts`
- Modify: `/Users/neomei/项目/codexprojects/AgentWiki-Obsidian/tests/integration/sync-runtime.test.ts`
- Create: `/Users/neomei/项目/codexprojects/AgentWiki-Obsidian/tests/integration/protocol-v2-conformance.test.ts`
- Modify: `/Users/neomei/项目/codexprojects/AgentWiki-Obsidian/tests/e2e/manual-sync-flow.test.ts`

**Interfaces:**
- Produces: installed-plugin-compatible Sync v2 negotiation, private Folder mapping, Folder preview decisions, and safe Vault application.
- Consumers: the already connected `/Users/neomei/Obsidian/NeoMei-Docs/AgentWiki` mapping.

- [ ] **Step 1: Record a clean cross-repository baseline**

In AgentWiki-Obsidian, ignore the untracked `.codegraph/` index, confirm no unrelated user changes, record current commit/version, and run `npm run check`. Do not copy or publish any bundle in this task.

- [ ] **Step 2: Update the vendored protocol and write failing Folder tests**

Keep the runtime's vendored protocol modules in conformance with the AgentWiki package and test future-version rejection, v1 Folder-space upgrade messaging, Folder identity persistence outside visible files, and empty Folder round-trip. Add `check:v2-conformance` to `package.json`; the dedicated test reads `AGENTWIKI_SYNC_PROTOCOL_SOURCE`, imports the built local package, and fails closed when the variable is absent. Do not commit a machine-specific `file:` dependency or alter the published package version in this implementation task.

- [ ] **Step 3: Implement secure Folder scan/apply and private identity**

Store Folder identity through `ObsidianLocalControlStore`; do not write marker files. Validate every ancestor through the Vault adapter, reject symlink/reparse escapes, create parents first, delete children first, and preserve `.agentwiki` baselines during recovery.

- [ ] **Step 4: Add explicit preview/conflict UX**

Sync Center lists local/remote Folder creates, renames, moves, deletes, and ambiguous identity conflicts separately from Pages. `确认执行` remains disabled until every binding/conflict has a choice. Cancelling or closing preserves the pre-sync baseline and pending server conflict.

- [ ] **Step 5: Run the complete plugin gate**

```bash
cd /Users/neomei/项目/codexprojects/AgentWiki-Obsidian
npm run check
AGENTWIKI_SYNC_PROTOCOL_SOURCE='/Users/neomei/项目/codexprojects/AgentWiki /agentwiki/.worktrees/markdown-rendering-attachments/agentwiki/packages/sync-protocol/dist/esm/index.js' npm run check:v2-conformance
```

Expected: format, lint, typecheck, unit/integration/E2E tests, build, and bundle checks PASS.

- [ ] **Step 6: Perform real connected-Vault acceptance only after explicit confirmation**

Use the existing mapping `/Users/neomei/Obsidian/NeoMei-Docs/AgentWiki`; do not reconnect it. Create nested and empty Folders on web and in Obsidian, preview both directions, verify Page/Folder same basename, rename/move/delete/restore, then ask for the user's explicit `确认执行` before applying any preview that would mutate the real Vault.

- [ ] **Step 7: Commit plugin changes separately**

```bash
cd /Users/neomei/项目/codexprojects/AgentWiki-Obsidian
git add package.json src tests
git commit -m "feat(sync): support Space folder hierarchies"
```

Record both repository commit IDs in the acceptance report; do not tag or release yet.

---

### Task 13: Cut over legacy hierarchy, run repeated audits, and prepare release evidence

**Files:**
- Create: `apps/server/prisma/migrations/20260828190000_cutover_space_folders/migration.sql`
- Modify: `apps/server/prisma/schema.prisma`
- Modify: `apps/server/src/core/page/page.service.ts`
- Modify: `apps/server/src/core/page/page.controller.ts`
- Delete after zero-usage proof: `apps/client/src/components/PageTree.tsx`
- Delete after zero-usage proof: `apps/client/src/features/space/applyMove.spec.ts`
- Modify: `package.json`
- Modify: `README.md`
- Modify: `docs/operations/space-folder-migration.md`

**Interfaces:**
- Produces: Release B schema without `Page.parentId`, a zero-legacy-usage gate, full validation evidence, and a deployment-ready runbook.
- Consumers: later authorized release/deployment work.

- [ ] **Step 1: Add a zero-legacy-usage cutover test**

The test scans application and test source for Page-parent writes, `/pages/reorder`, and `/pages/hierarchy` consumers; allow only the migration script, historical docs, and explicit v1 compatibility tests. A DB precondition query must return zero active Pages with non-null `parentId` and zero active Pages with an invalid/missing Folder mapping after backfill.

- [ ] **Step 2: Verify RED before cleanup**

```bash
rg -n "parentId|pages/reorder|pages/hierarchy|PageTree" apps packages scripts --glob '!**/dist/**'
FOLDER_TEST_DATABASE_URL="$FOLDER_TEST_DATABASE_URL" node --test scripts/space-folder-migration-db.test.mjs
```

Expected: the deliberate audit still identifies legacy Page hierarchy code.

- [ ] **Step 3: Remove legacy writers/readers and add Release B migration**

Remove `Page.parentId`, `PageVersion.parentId`, the Page self-relation, reorder DTO/route, legacy hierarchy route, and unused client tree code. Make Folder-aware Page fields/constraints final. The SQL migration must abort if the zero-legacy precondition fails; it must not silently null or drop unresolved data.

- [ ] **Step 4: Run the first full repository audit/gate**

```bash
pnpm lint
pnpm typecheck
pnpm test
FOLDER_TEST_DATABASE_URL="$FOLDER_TEST_DATABASE_URL" pnpm test:e2e:folders-db
pnpm build
git diff --check
```

Fix every Folder-feature regression or worthwhile adjacent bug caused by the changed code paths, then rerun the focused failing gate.

- [ ] **Step 5: Run a fresh second code review and regression round**

Re-read the spec completion criteria against actual code, review transaction boundaries, authorization, path/symlink safety, migration idempotency, cursor bounds, React stale-request handling, and v1 fail-closed behavior. Run:

```bash
pnpm lint
pnpm typecheck
pnpm test
FOLDER_TEST_DATABASE_URL="$FOLDER_TEST_DATABASE_URL" pnpm test:e2e:folders-db
pnpm --filter @agentwiki/client exec playwright test e2e/space-folders.spec.ts --project=chromium
```

If any bug is fixed, repeat this entire second round from the top until no worthwhile Folder-related defect remains.

- [ ] **Step 6: Run cross-repository and real-runtime acceptance**

Run `npm run check` in AgentWiki-Obsidian. Start a disposable/local AgentWiki stack, test Owner/Admin/Editor/Viewer and Agent scopes, create a multi-level document suite through `propose_document_tree`, sync it to a temporary Vault, edit/move it back, and verify server paths/IDs/revisions. Only after explicit confirmation, repeat the preview/apply on the existing NeoMei-Space mapping.

- [ ] **Step 7: Prepare release evidence without releasing**

Record separately: AgentWiki branch/commit, `origin/master` relation, AgentWiki-Obsidian branch/commit, protocol/local-sync/plugin package versions, migration dry-run counts, npm publication need, production container/image state, public HTTP result, and real Vault result. Do not infer any of these from local tests.

- [ ] **Step 8: Commit cutover and plan completion**

```bash
git add apps/server/prisma apps/server/src apps/client/src package.json README.md docs/operations/space-folder-migration.md
git commit -m "refactor(folders): complete Page hierarchy cutover"
git status --short --branch
git log -5 --oneline
```

Expected: clean AgentWiki worktree, clean intended plugin worktree except `.codegraph/`, and no push/publish/deploy performed.

---

## Completion Checklist

- [ ] Folder is a first-class Space container with no per-Folder ACL and no Page-as-folder behavior.
- [ ] Web users can lazily browse and fully manage Folder trees within their roles on desktop, mobile, and keyboard.
- [ ] Authorized Agents can propose and, where policy permits, publish complete hierarchical document suites atomically.
- [ ] Page/template creation targets Folder IDs and Folder-aware Markdown/Wiki resolution honors bounded aliases.
- [ ] Recursive delete/restore, conflicts, audit, revisions, and migrations are atomic and tested against PostgreSQL.
- [ ] Sync Protocol v2, Local Sync, and AgentWiki-Obsidian preserve Folder IDs, empty Folders, paths, and explicit conflicts in both directions.
- [ ] v1 clients fail closed for Folder Spaces; Folder-free v1 fixtures do not drift.
- [ ] Legacy Page hierarchy is backfilled idempotently and removed only after zero-usage/data preconditions pass.
- [ ] Repeated unit, integration, DB, browser, filesystem-safety, plugin, and real-Vault checks are green.
- [ ] Local, GitHub, npm, plugin bundle, and production states are reported separately before any release claim.
