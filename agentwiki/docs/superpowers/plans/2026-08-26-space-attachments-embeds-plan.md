# Space Attachments and Markdown Embeds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add permission-scoped Space image attachments, authenticated rendering, editor upload/paste/drop, deterministic Markdown resource resolution, and bounded dynamic page/section embeds.

**Architecture:** Store immutable image bytes in a content-addressed local storage adapter while PostgreSQL owns names, Space permissions, quota, lifecycle, and audit metadata. Resolve Markdown page/attachment references through one bounded server batch endpoint, fetch protected blobs with the Bearer API client, and recursively render page embeds through the shared Markdown context with explicit depth, count, byte, and cycle limits.

**Tech Stack:** NestJS 11, Prisma 5/PostgreSQL, Multer 2, file-type 21.3.2, image-size 2.0.2, Node filesystem streams, React 18, CodeMirror 6, Axios 1.18, Jest 30, Vitest 3, Node test runner, Playwright 1.62.

## Global Constraints

- The Markdown core and rich-rendering plans must be complete and green first.
- Image types are limited to PNG, JPEG, WebP, and GIF; SVG, HTML, PDF, audio, video, and unknown types are rejected.
- Defaults are 10 MiB per file, 500 MiB logical active bytes per Space, 10,000 px per dimension, and 40,000,000 pixels.
- Attachment bytes live outside the release tree; PostgreSQL stores metadata only.
- Storage keys are controlled SHA-256 paths and never contain user filenames.
- Attachment upload/archive/restore requires the same live human permission as page editing; Agents cannot mutate binary attachments.
- Attachment reads and Markdown resolution are authorized per request and never reveal cross-Space existence.
- Bearer tokens never enter image URLs, Markdown, DOM attributes, browser history, or logs.
- Page embeds are dynamic, same-Space only, maximum depth 3, maximum 20 per root document, maximum 200,000 embedded characters, and cycle-safe.
- Local knowledge sync continues to exclude binary source files.
- Database tests require `MARKDOWN_TEST_DATABASE_URL`, a database name containing `test`, and random `markdown_test_*` schemas; never migrate or clean `public`.
- Do not push, publish npm packages, migrate production, create production directories, or deploy production in this plan.

---

## File Structure

- Modify `apps/server/prisma/schema.prisma`: `SpaceAttachmentStatus`, `SpaceAttachment`, and relations.
- Create `apps/server/prisma/migrations/20260826120000_add_space_attachments/migration.sql`: constraints and indexes.
- Create `scripts/markdown-test-database.mjs` and `scripts/markdown-attachments-schema-db.test.mjs`: fail-closed isolated PostgreSQL harness.
- Modify root `package.json`: `test:e2e:markdown-db`.
- Create `scripts/attachment-deployment-contract.test.mjs`: persistent-volume and direct-deploy assertions.
- Create `apps/server/src/attachments/attachment.config.ts`: validated limits and paths.
- Create `apps/server/src/attachments/attachment-storage.ts`: adapter token/interface.
- Create `apps/server/src/attachments/local-attachment.storage.ts`: atomic content-addressed storage.
- Create `apps/server/src/attachments/attachment-upload.storage.ts`: streaming Multer temporary storage.
- Create `apps/server/src/attachments/attachment-validator.ts`: name, magic, MIME, dimensions, and hash validation.
- Create `apps/server/src/attachments/attachment.dto.ts`: list/state DTOs.
- Create `apps/server/src/attachments/attachment.service.ts`: quota, dedupe, lifecycle, and content authorization.
- Create `apps/server/src/attachments/attachment.controller.ts`: list/upload/archive/restore/content routes.
- Create `apps/server/src/attachments/attachment-cleanup.worker.ts`: retention and orphan reconciliation.
- Create `apps/server/src/attachments/attachment.module.ts`: API/worker exports.
- Create matching Jest specs for every attachment unit.
- Create `apps/server/src/markdown-resources/markdown-resource.dto.ts`, `.service.ts`, `.controller.ts`, `.module.ts`, and specs: batch resolver.
- Modify `apps/server/src/app.module.ts`, `apps/server/src/worker.module.ts`, `apps/server/src/health.controller.ts`, and specs: module/health integration.
- Create `apps/client/src/features/attachments/attachmentTypes.ts`, `attachmentApi.ts`, and specs.
- Create `apps/client/src/features/attachments/AttachmentImage.tsx` and spec: protected Blob rendering.
- Create `apps/client/src/features/attachments/AttachmentPickerDialog.tsx` and spec: search/upload/insert.
- Create `apps/client/src/components/markdown/resources.ts`, `resources.spec.ts`, `EmbeddedMarkdown.tsx`, and spec: references and embeds.
- Modify `apps/client/src/components/Markdown.tsx`, `MarkdownWorkspace.tsx`, and specs: resource context and image upload insertion.
- Modify `apps/client/src/features/page/PageEditor.tsx`, `PagePreview.tsx`, and specs: attachment and embed orchestration.
- Create `apps/client/e2e/markdown-attachments.spec.ts`: real owner/viewer and mobile acceptance.
- Modify deployment, Docker, env, docs, and health files listed in Task 9.

### Task 1: Add the attachment schema, migration constraints, and isolated database harness

**Files:**
- Modify: `apps/server/prisma/schema.prisma`
- Create: `apps/server/prisma/migrations/20260826120000_add_space_attachments/migration.sql`
- Create: `scripts/markdown-test-database.mjs`
- Create: `scripts/markdown-attachments-schema-db.test.mjs`

**Interfaces:**
- Produces: Prisma `SpaceAttachment`, `SpaceAttachmentStatus`, and `withMarkdownTestDatabase(baseUrl, callback)`.
- Consumers: server Tasks 3-5.

- [ ] **Step 1: Write the fail-closed harness tests and schema test**

The harness must export these exact interfaces:

```text
validateMarkdownTestDatabaseUrl(value: string | undefined) -> URL
withMarkdownTestDatabase<T>(baseDatabaseUrl: string, callback: ({ databaseUrl, schemaName }) -> Promise<T>) -> Promise<T>
```

Tests must reject missing URLs, non-PostgreSQL URLs, database names without `test`, repeated `schema` query parameters, and schema names outside `^markdown_test_[a-z0-9_]+$`. The schema test must migrate a generated schema, create two Spaces/users, verify same-Space normalized name uniqueness, allow the same name across Spaces, verify status/size/dimension checks, and prove cascade behavior.

- [ ] **Step 2: Run the harness/schema command and verify RED**

```bash
MARKDOWN_TEST_DATABASE_URL='postgresql://agentwiki:test_password@127.0.0.1:5432/agentwiki_test' node --test scripts/markdown-attachments-schema-db.test.mjs
```

Expected: FAIL because the harness, migration, and Prisma model do not exist. If the test database is unavailable, stop and provision an authorized disposable database; do not substitute production `DATABASE_URL`.

- [ ] **Step 3: Add the exact Prisma model**

```prisma
enum SpaceAttachmentStatus {
  active
  archived
}

model SpaceAttachment {
  id               String                @id @default(cuid())
  spaceId          String
  displayName      String
  nameKey          String
  contentHash      String
  storageKey       String
  mimeType         String
  sizeBytes        BigInt
  width            Int
  height           Int
  status           SpaceAttachmentStatus @default(active)
  uploadedByUserId String?
  createdAt        DateTime              @default(now())
  updatedAt        DateTime              @updatedAt
  archivedAt       DateTime?

  space          Space @relation(fields: [spaceId], references: [id], onDelete: Cascade)
  uploadedByUser User? @relation("AttachmentUploadedBy", fields: [uploadedByUserId], references: [id], onDelete: SetNull)

  @@unique([spaceId, nameKey])
  @@index([spaceId, status, updatedAt])
  @@index([contentHash])
  @@index([status, archivedAt])
}
```

Add `attachments SpaceAttachment[]` to Space and `attachmentsUploaded SpaceAttachment[] @relation("AttachmentUploadedBy")` to User.

- [ ] **Step 4: Write the SQL migration and harness implementation**

The migration must use these constraints and indexes in addition to the generated enum/table columns and foreign keys:

```sql
ALTER TABLE "SpaceAttachment" ADD CONSTRAINT "SpaceAttachment_hash_check"
  CHECK ("contentHash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "SpaceAttachment" ADD CONSTRAINT "SpaceAttachment_size_check"
  CHECK ("sizeBytes" > 0);
ALTER TABLE "SpaceAttachment" ADD CONSTRAINT "SpaceAttachment_dimensions_check"
  CHECK ("width" > 0 AND "height" > 0);
ALTER TABLE "SpaceAttachment" ADD CONSTRAINT "SpaceAttachment_state_check"
  CHECK (("status" = 'active' AND "archivedAt" IS NULL)
    OR ("status" = 'archived' AND "archivedAt" IS NOT NULL));
CREATE UNIQUE INDEX "SpaceAttachment_spaceId_nameKey_key"
  ON "SpaceAttachment"("spaceId", "nameKey");
CREATE INDEX "SpaceAttachment_spaceId_status_updatedAt_idx"
  ON "SpaceAttachment"("spaceId", "status", "updatedAt");
CREATE INDEX "SpaceAttachment_contentHash_idx"
  ON "SpaceAttachment"("contentHash");
CREATE INDEX "SpaceAttachment_status_archivedAt_idx"
  ON "SpaceAttachment"("status", "archivedAt");
```

The Space foreign key uses `ON DELETE CASCADE`; uploader uses `ON DELETE SET NULL`. The harness clones the proven page-template isolation pattern but uses `MARKDOWN_TEST_DATABASE_URL` and `markdown_test_*` only; its `finally` drops only the generated quoted schema.

- [ ] **Step 5: Generate Prisma and run the actual isolated schema test**

```bash
pnpm --filter @agentwiki/server exec prisma generate
MARKDOWN_TEST_DATABASE_URL="$MARKDOWN_TEST_DATABASE_URL" node --test scripts/markdown-attachments-schema-db.test.mjs
```

Expected: PASS with one created and one removed `markdown_test_*` schema; zero matching schemas remain afterward.

- [ ] **Step 6: Commit schema and harness**

```bash
git add apps/server/prisma/schema.prisma apps/server/prisma/migrations/20260826120000_add_space_attachments/migration.sql scripts/markdown-test-database.mjs scripts/markdown-attachments-schema-db.test.mjs
git commit -m "feat(attachments): add isolated attachment schema"
```

### Task 2: Implement validated local content-addressed storage and streaming upload temp files

**Files:**
- Modify: `apps/server/package.json`
- Modify: `pnpm-lock.yaml`
- Create: `apps/server/src/attachments/attachment.config.ts`
- Create: `apps/server/src/attachments/attachment-storage.ts`
- Create: `apps/server/src/attachments/local-attachment.storage.ts`
- Create: `apps/server/src/attachments/local-attachment.storage.spec.ts`
- Create: `apps/server/src/attachments/attachment-upload.storage.ts`
- Create: `apps/server/src/attachments/attachment-upload.storage.spec.ts`
- Create: `apps/server/src/attachments/attachment-validator.ts`
- Create: `apps/server/src/attachments/attachment-validator.spec.ts`

**Interfaces:**
- Produces: `AttachmentConfig`, `ATTACHMENT_STORAGE`, `AttachmentStorage`, `PreparedAttachment`, `validateUploadedImage(file, config)`.
- Consumers: AttachmentService and cleanup worker.

- [ ] **Step 1: Install reviewed server dependencies**

```bash
pnpm --filter @agentwiki/server add file-type@21.3.2 image-size@2.0.2
pnpm --filter @agentwiki/server add -D @types/multer@2.2.0
```

Expected: versions are explicit in the server package and compatible with the root file-type override.

- [ ] **Step 2: Write failing config/storage/validator tests**

Use `mkdtemp(join(tmpdir(), 'agentwiki-attachment-test-'))` and remove only that exact returned path in `afterEach`. Cover production missing/relative path rejection, permissions `0700/0600`, two identical temp files converging on one hash path, DB-failure cleanup not deleting a pre-existing content file, path traversal names, MIME/magic mismatch, rejected SVG, 10 MiB boundary, 10,001 px dimension, 40,000,001 pixels, and accepted PNG/JPEG/WebP/GIF fixtures.

- [ ] **Step 3: Run focused tests and verify RED**

```bash
pnpm --filter @agentwiki/server test -- --runTestsByPath src/attachments/local-attachment.storage.spec.ts src/attachments/attachment-upload.storage.spec.ts src/attachments/attachment-validator.spec.ts
```

Expected: FAIL because the modules do not exist.

- [ ] **Step 4: Implement the exact adapter contract**

```ts
export const ATTACHMENT_STORAGE = Symbol('ATTACHMENT_STORAGE');

export interface StoredAttachment {
  contentHash: string;
  storageKey: string;
  sizeBytes: bigint;
  created: boolean;
}

export interface AttachmentStorage {
  createTempPath(): Promise<string>;
  publish(tempPath: string, contentHash: string, sizeBytes: bigint): Promise<StoredAttachment>;
  open(storageKey: string): Promise<NodeJS.ReadableStream>;
  removeIfUnreferenced(storageKey: string): Promise<void>;
  probe(): Promise<{ writable: true; availableBytes: bigint }>;
}
```

`LocalAttachmentStorage` must shard as `sha256/ab/cd/<64hex>`, validate every storage key before use, write temp files under `<root>/.tmp`, `fsync` before atomic rename, tolerate `EEXIST` as dedupe, and never recursively delete the configured root.

`AttachmentUploadStorage` implements Multer `StorageEngine`, streams the incoming file to a storage-created temp file, enforces byte count while streaming, and returns `path`, `size`, and original metadata to Multer. `_removeFile` unlinks only the exact validated temp path.

- [ ] **Step 5: Implement image validation**

`validateUploadedImage` normalizes the filename to NFC, rejects control/path separators and names over 200 code points or 512 UTF-8 bytes, computes streaming SHA-256/size, uses `fileTypeFromFile` for magic, requires extension/declared/detected MIME agreement, reads bounded header bytes for `imageSize`, and applies exact config limits. Return:

```ts
export interface PreparedAttachment {
  displayName: string;
  nameKey: string;
  contentHash: string;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';
  sizeBytes: bigint;
  width: number;
  height: number;
  tempPath: string;
}
```

- [ ] **Step 6: Run tests, typecheck, and commit**

```bash
pnpm --filter @agentwiki/server test -- --runTestsByPath src/attachments/local-attachment.storage.spec.ts src/attachments/attachment-upload.storage.spec.ts src/attachments/attachment-validator.spec.ts
pnpm --filter @agentwiki/server typecheck
git add apps/server/package.json pnpm-lock.yaml apps/server/src/attachments
git commit -m "feat(attachments): add safe local blob storage"
```

Expected: tests and typecheck PASS.

### Task 3: Implement attachment API, live human authorization, names, quota, and lifecycle

**Files:**
- Create: `apps/server/src/attachments/attachment.dto.ts`
- Create: `apps/server/src/attachments/attachment.dto.spec.ts`
- Create: `apps/server/src/attachments/attachment.service.ts`
- Create: `apps/server/src/attachments/attachment.service.spec.ts`
- Create: `apps/server/src/attachments/attachment.controller.ts`
- Create: `apps/server/src/attachments/attachment.controller.spec.ts`
- Create: `apps/server/src/attachments/attachment.module.ts`
- Modify: `apps/server/src/app.module.ts`

**Interfaces:**
- Produces: list/upload/archive/restore/content routes from the design and `AttachmentSummary` JSON with decimal-string `sizeBytes`.
- Consumers: client API and Markdown resolver.

- [ ] **Step 1: Write failing DTO/controller/service tests**

Cover exact decorators/routes, HumanOnlyGuard on mutation controller, owner/editor success, admin/viewer/Agent denial, pagination 1-100, query length 80, `expectedUpdatedAt`, same-content reuse, same-name/different-content suffix, case-insensitive/NFC conflicts, 500 MiB logical quota, concurrent uploads under a Space advisory lock, archive/restore compare-and-set, and content read for every readable member.

The quota assertion must count logical active metadata bytes even when content hashes dedupe.

- [ ] **Step 2: Run tests and verify RED**

```bash
pnpm --filter @agentwiki/server test -- --runTestsByPath src/attachments/attachment.dto.spec.ts src/attachments/attachment.controller.spec.ts src/attachments/attachment.service.spec.ts
```

Expected: FAIL because the API does not exist.

- [ ] **Step 3: Implement DTOs and controller routes**

Define list query `q`, `status`, `skip`, `take`; state DTO with strict ISO `expectedUpdatedAt`. Register Multer asynchronously with `AttachmentUploadStorage` and one-file/10-MiB limits. Put `CombinedAuthGuard` on `SpaceAttachmentController`, add method-level `HumanOnlyGuard` to upload/archive/restore only, and put `CombinedAuthGuard` on the separate `AttachmentContentController`. The list route remains readable to authorized humans and Agents; binary mutations remain human-only.

- [ ] **Step 4: Implement locked service semantics**

For upload: validate live human access before reading metadata, validate the temp image, publish content, enter a Prisma transaction, acquire `SpaceRevisionWriterService.lockSpace`, revalidate live access, sum active logical bytes, choose exact/reused/suffixed name under the lock, and create metadata. On failure, remove only a newly published unreferenced blob after checking no DB row uses its storage key.

Archive and restore use `updateMany` predicates on id, Space, status, and `updatedAt`; zero rows returns stable `RESOURCE_CONFLICT`. Archive sets `archivedAt`; restore clears it. Archived names remain reserved. Content read loads attachment, authorizes its Space, checks storage existence, and returns stream metadata without exposing storageKey.

- [ ] **Step 5: Run API tests and application module smoke**

```bash
pnpm --filter @agentwiki/server test -- --runTestsByPath src/attachments/attachment.dto.spec.ts src/attachments/attachment.controller.spec.ts src/attachments/attachment.service.spec.ts src/app.module.spec.ts
```

Expected: PASS; AppModule resolves the controller/service/storage graph.

- [ ] **Step 6: Commit attachment API**

```bash
git add apps/server/src/attachments apps/server/src/app.module.ts
git commit -m "feat(attachments): add authorized Space attachment API"
```

### Task 4: Add retention cleanup, storage health, and actual database/HTTP integration

**Files:**
- Create: `apps/server/src/attachments/attachment-cleanup.worker.ts`
- Create: `apps/server/src/attachments/attachment-cleanup.worker.spec.ts`
- Modify: `apps/server/src/attachments/attachment.module.ts`
- Modify: `apps/server/src/worker.module.ts`
- Modify: `apps/server/src/health.controller.ts`
- Modify: `apps/server/src/health.controller.spec.ts`
- Create: `scripts/markdown-attachments-http-db.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces: worker-only bounded cleanup and health response `attachmentStorage: 'ok'`.
- Consumers: deployment and verification.

- [ ] **Step 1: Write failing cleanup and health tests**

Cover PROCESS_ROLE api no timer, worker immediate tick plus interval, overlapping tick suppression, archived retention cutoff, batch size 100, metadata deletion before hash reference check, shared blob retention, orphan grace period, storage failure logging without process crash, and health 503 when probe fails or available space is below the configured minimum.

- [ ] **Step 2: Run tests and verify RED**

```bash
pnpm --filter @agentwiki/server test -- --runTestsByPath src/attachments/attachment-cleanup.worker.spec.ts src/health.controller.spec.ts
```

Expected: FAIL because cleanup and storage health are absent.

- [ ] **Step 3: Implement bounded cleanup and health**

Follow the existing `RecoveryWorker` OnModuleInit/OnModuleDestroy pattern. Defaults: poll 60 minutes, retention 30 days, orphan grace 24 hours, batch 100. Each archived row deletion runs in a transaction; after commit, query by storageKey before physical deletion. Orphan scanning only visits validated hash paths under the configured root and never uses a broad recursive delete.

Inject storage into HealthController and include `attachmentStorage: 'ok'` only after probe succeeds and free bytes meet `ATTACHMENT_MIN_FREE_BYTES`.

- [ ] **Step 4: Add real HTTP/database integration**

Within `withMarkdownTestDatabase`, start a Nest test app against the isolated schema and a unique `mkdtemp` storage root. Register owner/editor/viewer/outsider and an Agent credential, then exercise multipart upload, list, authenticated blob bytes/headers, quota, spoofed MIME, archive/restore conflicts, cross-Space denial, and Agent denial. Always close the app, disconnect Prisma, delete only the exact temp root, and let the harness drop only the generated schema.

Add the root script only now that both referenced files exist:

```json
"test:e2e:markdown-db": "node --test scripts/markdown-attachments-schema-db.test.mjs scripts/markdown-attachments-http-db.test.mjs"
```

- [ ] **Step 5: Run the actual database gate**

```bash
MARKDOWN_TEST_DATABASE_URL="$MARKDOWN_TEST_DATABASE_URL" pnpm test:e2e:markdown-db
```

Expected: both schema and HTTP suites PASS with zero skips and zero remaining `markdown_test_*` schemas.

- [ ] **Step 6: Commit cleanup and integration**

```bash
git add apps/server/src/attachments apps/server/src/worker.module.ts apps/server/src/health.controller.ts apps/server/src/health.controller.spec.ts scripts/markdown-attachments-http-db.test.mjs package.json
git commit -m "feat(attachments): verify lifecycle and storage health"
```

### Task 5: Add bounded same-Space Markdown resource resolution

**Files:**
- Create: `apps/server/src/markdown-resources/markdown-resource.dto.ts`
- Create: `apps/server/src/markdown-resources/markdown-resource.dto.spec.ts`
- Create: `apps/server/src/markdown-resources/markdown-resource.service.ts`
- Create: `apps/server/src/markdown-resources/markdown-resource.service.spec.ts`
- Create: `apps/server/src/markdown-resources/markdown-resource.controller.ts`
- Create: `apps/server/src/markdown-resources/markdown-resource.controller.spec.ts`
- Create: `apps/server/src/markdown-resources/markdown-resource.module.ts`
- Modify: `apps/server/src/app.module.ts`

**Interfaces:**
- Produces: `POST /api/spaces/:spaceId/markdown/resolve` with at most 100 unique references.
- Consumers: client resource hook in Task 7.

- [ ] **Step 1: Write failing resolver tests**

Request items have `{ key, kind: 'page' | 'attachment', target, heading?, blockId? }`, with key/target max 512 and array max 100. Tests cover exact page ID, syncPath, slug, title order; title ambiguity; `.md` page behavior; image-extension attachment-only behavior; active and retained-archived attachments; same-Space restriction; outsider denial; and identical external `unresolved` results for missing/forbidden targets.

- [ ] **Step 2: Run tests and verify RED**

```bash
pnpm --filter @agentwiki/server test -- --runTestsByPath src/markdown-resources/markdown-resource.dto.spec.ts src/markdown-resources/markdown-resource.service.spec.ts src/markdown-resources/markdown-resource.controller.spec.ts
```

Expected: FAIL because resolver files are missing.

- [ ] **Step 3: Implement the response union and bounded queries**

```ts
export type ResolvedMarkdownResource =
  | { key: string; status: 'resolved'; kind: 'page'; pageId: string; title: string; slug: string }
  | { key: string; status: 'resolved'; kind: 'attachment'; attachmentId: string; displayName: string; mimeType: string; width: number; height: number }
  | { key: string; status: 'unresolved' }
  | { key: string; status: 'ambiguous' };
```

Authorize the Space once, normalize NFC/case keys, perform bounded `findMany` queries, resolve in the documented order, and never return candidates for unresolved/ambiguous items. Do not accept page content in the request.

- [ ] **Step 4: Run resolver tests and integration regression**

```bash
pnpm --filter @agentwiki/server test -- --runTestsByPath src/markdown-resources
MARKDOWN_TEST_DATABASE_URL="$MARKDOWN_TEST_DATABASE_URL" pnpm test:e2e:markdown-db
```

Expected: PASS with zero database skips.

- [ ] **Step 5: Commit resolver API**

```bash
git add apps/server/src/markdown-resources apps/server/src/app.module.ts
git commit -m "feat(markdown): resolve scoped page and attachment refs"
```

### Task 6: Build the client attachment API, protected Blob image, and picker

**Files:**
- Create: `apps/client/src/features/attachments/attachmentTypes.ts`
- Create: `apps/client/src/features/attachments/attachmentApi.ts`
- Create: `apps/client/src/features/attachments/attachmentApi.spec.ts`
- Create: `apps/client/src/features/attachments/AttachmentImage.tsx`
- Create: `apps/client/src/features/attachments/AttachmentImage.spec.tsx`
- Create: `apps/client/src/features/attachments/AttachmentPickerDialog.tsx`
- Create: `apps/client/src/features/attachments/AttachmentPickerDialog.spec.tsx`
- Modify: `apps/client/src/i18n/messages.ts`

**Interfaces:**
- Produces: list/upload/archive/restore/fetchBlob client functions, `AttachmentImage`, and picker `onInsert(displayName)`.
- Consumers: PageEditor and Markdown resource renderer.

- [ ] **Step 1: Write failing API/Blob/picker tests**

Assert URL encoding, multipart without forced JSON Content-Type, decimal size parsing, `responseType: 'blob'`, one Object URL per loaded attachment, revocation on ID change/unmount, stale response suppression, 401 behavior through the shared interceptor, picker search pagination, active/archived filters, archive/restore compare-and-set, final suffixed name insertion, upload progress, focus trap, Escape, keyboard operation, `aria-live` status/error announcements, and no insertion on failure.

- [ ] **Step 2: Run tests and verify RED**

```bash
pnpm --filter @agentwiki/client exec vitest run src/features/attachments
```

Expected: FAIL because the feature directory is absent.

- [ ] **Step 3: Implement exact client functions and protected image behavior**

Use the shared Axios instance for every request. `fetchAttachmentBlob(id, signal)` calls encoded `attachments/:id/content` with `{ responseType: 'blob', signal }`. `AttachmentImage` creates/revokes Object URLs in an effect, renders bounded loading/error frames with fixed aspect ratio when dimensions are known, uses filename fallback alt, and never puts the API route or token into `src`.

- [ ] **Step 4: Implement the existing-attachment picker**

Reuse `ModalDialog`. Provide search, active/archived filters, file input accepting `.png,.jpg,.jpeg,.webp,.gif`, upload progress, archive/restore actions using `expectedUpdatedAt`, final filename confirmation, and `onInsert` for active attachments only. The picker receives `spaceId`; it does not infer permission from local user roles and surfaces server 403/409/quota errors through translated `aria-live` messages.

- [ ] **Step 5: Run attachment client tests and commit**

```bash
pnpm --filter @agentwiki/client exec vitest run src/features/attachments
git add apps/client/src/features/attachments apps/client/src/i18n/messages.ts
git commit -m "feat(editor): add protected image attachment picker"
```

Expected: PASS with no leaked Object URLs after cleanup.

### Task 7: Resolve Markdown resources and render bounded page/section/image embeds

**Files:**
- Create: `apps/client/src/components/markdown/resources.ts`
- Create: `apps/client/src/components/markdown/resources.spec.ts`
- Create: `apps/client/src/components/markdown/EmbeddedMarkdown.tsx`
- Create: `apps/client/src/components/markdown/EmbeddedMarkdown.spec.tsx`
- Modify: `apps/client/src/components/markdown/obsidian.ts`
- Modify: `apps/client/src/components/Markdown.tsx`
- Modify: `apps/client/src/components/Markdown.spec.tsx`
- Modify: `apps/client/src/features/page/PagePreview.tsx`
- Modify: `apps/client/src/features/page/PageVersionHistory.tsx`

**Interfaces:**
- Produces: `collectMarkdownResourceRefs`, `resolveMarkdownResources`, `extractMarkdownSection`, `MarkdownResourceMap`, and recursive render context.
- Consumers: editor preview and page view.

- [ ] **Step 1: Write failing resource and embed tests**

Cover unique collection and max-100 failure, image-extension classification, aliases, heading extraction through the next same/higher heading, missing heading, direct/indirect cycles, depth 3, root count 20, total 200,000 characters, duplicate request caching, dynamic target refresh, version-mode current-content label, attachment Blob component, and unresolved/ambiguous literal markers.

- [ ] **Step 2: Run tests and verify RED**

```bash
pnpm --filter @agentwiki/client exec vitest run src/components/markdown/resources.spec.ts src/components/markdown/EmbeddedMarkdown.spec.tsx src/components/Markdown.spec.tsx
```

Expected: FAIL because embed/resource contracts do not exist.

- [ ] **Step 3: Implement client resource types and batch resolution**

```ts
export interface MarkdownEmbedBudget {
  depth: number;
  embedCount: number;
  embeddedChars: number;
  visitedPageIds: ReadonlySet<string>;
}

export type ResolvedMarkdownResource =
  | { key: string; status: 'resolved'; kind: 'page'; pageId: string; title: string; slug: string }
  | { key: string; status: 'resolved'; kind: 'attachment'; attachmentId: string; displayName: string; mimeType: string; width: number; height: number }
  | { key: string; status: 'unresolved' }
  | { key: string; status: 'ambiguous' };

export type MarkdownResourceMap = ReadonlyMap<string, ResolvedMarkdownResource>;
```

Collect refs from the AST rather than raw document regex, dedupe by canonical key, reject over 100 before request, and cancel stale requests when page/Space/source changes. Cache only within the active document tree.

- [ ] **Step 4: Implement dynamic embed components**

Update the Obsidian plugin so `![[Page]]`, `![[Page#Heading]]`, and `![[image.ext]]` become explicit custom nodes. Resolved normal wiki links must also prefer the batch resource map so Spaces with more than 200 pages are not limited by the legacy page-list fetch. `EmbeddedMarkdown` fetches the authorized page by ID, extracts the requested source slice, increments one shared root budget, checks visited IDs, and renders `<Markdown mode="embed">` with the same resources/context. It never enables task edits inside an embed. Version mode adds the translated current-content label.

Attachment nodes render `AttachmentImage`. Unresolved/ambiguous nodes render a localized warning containing the literal original marker.

- [ ] **Step 5: Run embed, Markdown, and page regressions**

```bash
pnpm --filter @agentwiki/client exec vitest run src/components/markdown src/components/Markdown.spec.tsx src/features/page/PagePreview.spec.tsx
```

Expected: PASS; cycles/limits are local fallbacks and no test issues more than one resolver request per document source.

- [ ] **Step 6: Commit scoped embeds**

```bash
git add apps/client/src/components/markdown apps/client/src/components/Markdown.tsx apps/client/src/components/Markdown.spec.tsx apps/client/src/features/page/PagePreview.tsx apps/client/src/features/page/PageVersionHistory.tsx
git commit -m "feat(markdown): render scoped page and image embeds"
```

### Task 8: Add editor upload button, insertion, paste, and drop

**Files:**
- Modify: `apps/client/src/components/MarkdownWorkspace.tsx`
- Modify: `apps/client/src/components/MarkdownWorkspace.spec.tsx`
- Modify: `apps/client/src/features/page/PageEditor.tsx`
- Modify: `apps/client/src/features/page/PageEditor.spec.tsx`

**Interfaces:**
- Consumes: AttachmentPickerDialog and upload API.
- Produces: `MarkdownWorkspaceHandle.insertText(text)` and image-file upload callback.

- [ ] **Step 1: Write failing editor interaction tests**

Test insertion at current selection, replacement of selected text, upload button opening picker, existing attachment insertion, clipboard image upload, multi-image order, drop position, upload failure preserving the document, and dirty state after successful insertion. Assert inserted source exactly:

```text
![[diagram.png]]
```

- [ ] **Step 2: Run tests and verify RED**

```bash
pnpm --filter @agentwiki/client exec vitest run src/components/MarkdownWorkspace.spec.tsx src/features/page/PageEditor.spec.tsx
```

Expected: FAIL because the editor has no insertion/upload contract.

- [ ] **Step 3: Implement CodeMirror insertion and image event handlers**

Capture the EditorView with `onCreateEditor`. Add `insertText(text)` to the imperative handle using `view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length } })`. Add `EditorView.domEventHandlers` for paste/drop; only intercept when at least one clipboard/dataTransfer item is an accepted image. Await the PageEditor upload callback, insert returned markers in input order, and report failure without inserting partial names.

- [ ] **Step 4: Wire PageEditor picker and capability**

Use the page response `capabilities.canEdit`. Only direct editors see the attachment button. Picker insertion calls `workspaceRef.current?.insertText`, while paste/drop calls a stable upload callback that returns final display names. Every successful insertion flows through the existing CodeMirror `onChange`, dirty state, explicit save, conflict, and template-snapshot rules.

- [ ] **Step 5: Run editor tests and commit**

```bash
pnpm --filter @agentwiki/client exec vitest run src/components/MarkdownWorkspace.spec.tsx src/features/page/PageEditor.spec.tsx src/features/attachments
git add apps/client/src/components/MarkdownWorkspace.tsx apps/client/src/components/MarkdownWorkspace.spec.tsx apps/client/src/features/page/PageEditor.tsx apps/client/src/features/page/PageEditor.spec.tsx
git commit -m "feat(editor): insert uploaded image attachments"
```

Expected: PASS with existing remote-update and save tests unchanged.

### Task 9: Complete deployment persistence, browser acceptance, documentation, and convergence

**Files:**
- Modify: `.env.example`
- Modify: `apps/server/.env.example`
- Modify: `docker-compose.yml`
- Modify: `deploy.sh`
- Modify: `deploy/systemd/agentwiki-api.service`
- Modify: `deploy/systemd/agentwiki-worker.service`
- Modify: `deploy/nginx/agentwiki.conf`
- Modify: `README.md`
- Modify: `docs/TESTING_GUIDE.md`
- Create: `docs/operations/markdown-attachments.md`
- Create: `apps/client/e2e/markdown-attachments.spec.ts`
- Create: `docs/verification/markdown-attachments-2026-08-26.md`
- Create: `scripts/attachment-deployment-contract.test.mjs`

**Interfaces:**
- Consumes: Tasks 1-8.
- Produces: durable deployment contract and complete local acceptance evidence.

- [ ] **Step 1: Add deploy/runtime contract tests before changing deployment files**

Create `scripts/attachment-deployment-contract.test.mjs` to assert Docker mounts one named attachment volume into backend and worker at the same path, both receive `ATTACHMENT_STORAGE_PATH`, systemd services share one explicit path, deploy preflight creates/checks the persistent directory outside `live_dir`, release packaging excludes it, nginx accepts 10 MiB plus multipart overhead, and health expects `attachmentStorage: ok`.

- [ ] **Step 2: Run deployment contract tests and verify RED**

```bash
pnpm test:runtime
```

Expected: new contract assertions FAIL before deployment files change.

- [ ] **Step 3: Implement persistent deployment wiring**

For Docker, add `attachment-data` mounted at `/var/lib/agentwiki/attachments` in backend and worker, with the matching environment variable. For direct deploy, use an explicit absolute persistent path outside the release/live tree, create it with mode `0700`, verify writable/free space before migration or service stop, and preserve it across release swaps. Add env examples for file/Space/pixel/free-space/retention limits. Increase nginx body allowance only to the exact multipart overhead needed above 10 MiB.

Document backup as PostgreSQL custom dump + filesystem snapshot + SHA-256 manifest, and restore as staged verification before service start.

- [ ] **Step 4: Add real browser acceptance**

Create disposable owner/editor/viewer/outsider accounts and two Spaces. Cover picker upload, paste, drop, reload, authenticated Blob display, same-name suffix, page and section embed, dynamic target change, cycle/depth/count fallback, viewer read/no-upload, cross-Space unresolved state, history current-content label, mobile layout, JWT absence from DOM/URLs, and zero console warnings/errors. Clean Space/users through APIs and only test-created local data.

- [ ] **Step 5: Run all dedicated and browser gates**

```bash
MARKDOWN_TEST_DATABASE_URL="$MARKDOWN_TEST_DATABASE_URL" pnpm test:e2e:markdown-db
pnpm --filter @agentwiki/client exec playwright test e2e/markdown-core.spec.ts e2e/markdown-attachments.spec.ts
pnpm test:runtime
```

Expected: database suites execute with zero skips, Playwright passes desktop and 390px assertions, runtime contracts pass.

- [ ] **Step 6: Run full repository convergence and fresh reviews**

```bash
pnpm test
pnpm lint
pnpm typecheck
pnpm build
git diff --check
```

Perform fresh reviews of filesystem boundaries, symlinks/path traversal, upload stream aborts, magic/dimensions, quota races, dedupe cleanup, archive/restore races, worker overlap, health, cross-Space enumeration, Blob URL lifetime, page embed cycles/budgets, editor dirty/conflict behavior, responsive UI, and docs/deploy accuracy. Every validated finding receives a failing regression test before its fix, followed by the focused suite and full affected gate.

- [ ] **Step 7: Record evidence and commit**

Record exact commit range, dependency versions, test counts/skips, database schema cleanup, filesystem temp cleanup, browser targets/screenshots, bundle chunks, deployment contract, known limits, and explicit local/GitHub/npm/production state.

```bash
git add .env.example apps/server/.env.example docker-compose.yml deploy.sh deploy/systemd deploy/nginx/agentwiki.conf README.md docs/TESTING_GUIDE.md docs/operations/markdown-attachments.md apps/client/e2e/markdown-attachments.spec.ts docs/verification/markdown-attachments-2026-08-26.md scripts/attachment-deployment-contract.test.mjs
git commit -m "docs: verify Markdown attachments and embeds"
```
