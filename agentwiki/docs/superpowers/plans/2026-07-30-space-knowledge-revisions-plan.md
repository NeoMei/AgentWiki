# Space Knowledge Revisions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add authoritative per-Space knowledge revisions, Snapshot/Delta APIs, and a confirmed KnowledgeBundle submission path that compiles into the existing human-review and scoped-auto-publish ChangeSet workflow.

**Architecture:** A strict server parser accepts only derived `knowledge-bundle@1` JSON and checks credential/Space authorization, base revision, hashes, idempotency, and size. A submission compiles stable knowledge IDs into page, shared-memory, relation, and tombstone ChangeItems; a revision is projected only after those items are actually published, so pending or rejected proposals never become pullable knowledge.

**Tech Stack:** NestJS 10, Prisma 5/PostgreSQL, Zod 3, Jest, existing Authorization/Review/Audit services.

## Global Constraints

- Keep existing OKF `0.1.x` endpoints during the migration window; new endpoints use `/knowledge-revisions` and JSON, not `.okf.json` upload.
- Every write requires `pages:write`, `memory:write`, `graph:write`, `sources:write`, and `runs:write` only for the item kinds present in the bundle; reads require the corresponding read scopes.
- Reject stale `baseRevision`, unknown fields, hash mismatch, duplicate stable IDs, local-only provenance, unsupported schema/recipe versions, and oversized payloads.
- Agents can submit proposals but cannot decide, approve, or publish them.
- A published or reverted knowledge ChangeSet creates a new immutable revision; database rows remain the materialized product view.
- Revision and submission idempotency is scoped to Space and principal credential.

---

### Task 1: Prisma schema for stable IDs, submissions, and revisions

**Files:**
- Modify: `apps/server/prisma/schema.prisma`
- Create: `apps/server/prisma/migrations/<timestamp>_space_knowledge_revisions/migration.sql`
- Create: `apps/server/src/knowledge-pipeline/knowledge-revision.schema.spec.ts`

**Interfaces:**
- Produces: `KnowledgeSubmission` and `SpaceKnowledgeRevision` Prisma models, required stable `knowledgeKey` on Page/KnowledgeRelation, and nullable stable `knowledgeKey` on space-visible AgentMemory.

- [ ] **Step 1: Write a failing schema contract test**

```ts
it('declares immutable per-space knowledge revisions and stable materialized keys', () => {
  const schema = readFileSync(join(process.cwd(), 'prisma/schema.prisma'), 'utf8');
  expect(schema).toMatch(/model SpaceKnowledgeRevision/);
  expect(schema).toMatch(/@@unique\(\[spaceId, sequence\]\)/);
  expect(schema).toMatch(/model KnowledgeSubmission/);
  expect(schema).toMatch(/model Page[\s\S]*knowledgeKey\s+String\s+@default\(cuid\(\)\)/);
  expect(schema).toMatch(/model KnowledgeRelation[\s\S]*knowledgeKey\s+String\s+@default\(cuid\(\)\)/);
  expect(schema).toMatch(/model AgentMemory[\s\S]*knowledgeKey\s+String\?/);
});
```

- [ ] **Step 2: Verify failure**

Run: `pnpm --filter @agentwiki/server test -- knowledge-revision.schema.spec.ts`

Expected: FAIL because the models do not exist.

- [ ] **Step 3: Add exact model fields and SQL constraints**

```prisma
model KnowledgeSubmission {
  id                 String   @id @default(cuid())
  spaceId            String
  baseRevisionId     String?
  principalKey       String
  idempotencyKey     String
  schemaVersion      String
  recipeVersion      String
  contentHash        String
  bundle             Json
  status             String   @default("pending")
  changeSetId        String?  @unique
  appliedRevisionId  String?  @unique
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt
  space              Space    @relation(fields: [spaceId], references: [id], onDelete: Cascade)
  changeSet          ChangeSet? @relation(fields: [changeSetId], references: [id], onDelete: SetNull)
  appliedRevision    SpaceKnowledgeRevision? @relation("AppliedKnowledgeRevision", fields: [appliedRevisionId], references: [id], onDelete: SetNull)

  @@unique([spaceId, principalKey, idempotencyKey])
  @@index([spaceId, status, createdAt])
}

model SpaceKnowledgeRevision {
  id                String   @id @default(cuid())
  spaceId           String
  sequence          Int
  parentRevisionId  String?
  schemaVersion     String
  recipeVersion     String
  contentHash       String
  snapshot          Json
  delta             Json
  sourceChangeSetId String?
  createdAt         DateTime @default(now())
  space             Space    @relation(fields: [spaceId], references: [id], onDelete: Cascade)
  appliedSubmission KnowledgeSubmission? @relation("AppliedKnowledgeRevision")

  @@unique([spaceId, sequence])
  @@unique([spaceId, contentHash])
  @@index([spaceId, createdAt])
}
```

Add `knowledgeKey String @default(cuid())` with `@@unique([spaceId, knowledgeKey])` to `Page`; add `knowledgeKey String @default(cuid()) @unique` to `KnowledgeRelation`; add nullable `knowledgeKey String?` to `AgentMemory`. Add relation arrays on Space and a nullable one-to-one `knowledgeSubmission` on ChangeSet. `principalKey` is `credential:<credentialId>` for API keys and `user:<userId>` for human JWT submissions; it must never contain the credential secret.

The SQL migration must add Page/Relation keys as nullable, backfill deterministic `page:<id>` and `relation:<id>` keys, then set those two columns `NOT NULL`. Backfill `memory:<id>` only for active `visibility = 'space'` memories. Replace the existing AgentMemory global content unique constraint with a partial unique index for manual memories where `knowledgeKey IS NULL`, plus a partial unique `(spaceId, knowledgeKey)` index where `knowledgeKey IS NOT NULL`; this prevents a synced stable memory from colliding with an unrelated private memory while retaining manual-memory deduplication. Do not rewrite page content.

- [ ] **Step 4: Validate and test the migration**

Run:

```bash
pnpm --filter @agentwiki/server exec prisma format
pnpm --filter @agentwiki/server exec prisma validate
pnpm --filter @agentwiki/server test -- knowledge-revision.schema.spec.ts
```

Expected: PASS. Apply the migration only to the disposable local development database after making a backup.

- [ ] **Step 5: Commit**

```bash
git add apps/server/prisma/schema.prisma apps/server/prisma/migrations apps/server/src/knowledge-pipeline/knowledge-revision.schema.spec.ts
git commit -m "feat(server): persist space knowledge revisions"
```

### Task 2: Strict server-side KnowledgeBundle parser

**Files:**
- Create: `apps/server/src/knowledge-pipeline/knowledge-bundle.ts`
- Create: `apps/server/src/knowledge-pipeline/knowledge-bundle.spec.ts`
- Modify: `apps/server/src/core/filters/business-error.ts`

**Interfaces:**
- Produces: `parseKnowledgeBundle(buffer)`, `NormalizedKnowledgeBundle`, new business codes `KNOWLEDGE_BUNDLE_INVALID`, `KNOWLEDGE_BASE_STALE`, `KNOWLEDGE_REVISION_NOT_FOUND`.

- [ ] **Step 1: Write failing parser tests**

Use golden JSON copied from the local package protocol fixture. Assert canonical sorting/hash, unknown-key rejection, 10 MiB limit, duplicate IDs/paths, dangling relations, local-only provenance, invalid dates, unsupported version, and redaction of secrets from thrown messages.

- [ ] **Step 2: Verify failure**

Run: `pnpm --filter @agentwiki/server test -- knowledge-bundle.spec.ts`

Expected: FAIL because the parser does not exist.

- [ ] **Step 3: Implement the parser**

```ts
export interface NormalizedKnowledgeBundle {
  schemaVersion: 'knowledge-bundle@1'; recipeVersion: string; spaceId: string;
  baseRevision: string; pages: NormalizedPage[]; memories: NormalizedMemory[];
  relations: NormalizedRelation[]; provenance: NormalizedProvenance[];
  deletions: NormalizedDeletion[]; contentHash: string;
}
export function parseKnowledgeBundle(input: Buffer): NormalizedKnowledgeBundle;
```

Mirror the local Zod schema exactly, then run server-only invariants. Sort pages by path/id, memories and relations by id, provenance by itemId, deletions by kind/id before hashing. Do not import source files from the publishable npm package into the server build; keep a shared golden fixture test to detect drift.

- [ ] **Step 4: Run parser tests**

Run: `pnpm --filter @agentwiki/server test -- knowledge-bundle.spec.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/knowledge-pipeline/knowledge-bundle.ts apps/server/src/knowledge-pipeline/knowledge-bundle.spec.ts apps/server/src/core/filters/business-error.ts
git commit -m "feat(server): validate knowledge bundles"
```

### Task 3: Snapshot and Delta read service

**Files:**
- Create: `apps/server/src/knowledge-revision/knowledge-revision.service.ts`
- Create: `apps/server/src/knowledge-revision/knowledge-revision.service.spec.ts`
- Create: `apps/server/src/knowledge-revision/knowledge-revision.module.ts`

**Interfaces:**
- Produces: `current(spaceId)`, `snapshot(spaceId, revisionId?)`, `delta(spaceId, fromRevisionId)`.

- [ ] **Step 1: Write failing revision read tests**

```ts
await expect(service.current('space-1')).resolves.toEqual({ revisionId: '0', sequence: 0, contentHash: emptyHash });
await expect(service.delta('space-1', 'rev-1')).resolves.toEqual({ fromRevision: 'rev-1', toRevision: 'rev-3', revisions: [revision2, revision3] });
await expect(service.delta('space-2', 'rev-1')).rejects.toMatchObject({ businessCode: 'KNOWLEDGE_REVISION_NOT_FOUND' });
```

Cover first-Space empty snapshot, explicit historic snapshot, ordered delta, wrong-Space revision, deleted Space, and a configured max delta count that tells clients to fetch a Snapshot.

- [ ] **Step 2: Verify failure**

Run: `pnpm --filter @agentwiki/server test -- knowledge-revision.service.spec.ts`

Expected: FAIL because the service is absent.

- [ ] **Step 3: Implement read contracts**

```ts
export interface RevisionHead { revisionId: string; sequence: number; contentHash: string; }
export interface RevisionSnapshot extends RevisionHead { schemaVersion: string; recipeVersion: string; bundle: unknown; }
export interface RevisionDelta { fromRevision: string; toRevision: string; revisions: Array<{ revisionId: string; sequence: number; contentHash: string; delta: unknown }>; }
export class KnowledgeRevisionService {
  current(spaceId: string): Promise<RevisionHead>;
  snapshot(spaceId: string, revisionId?: string): Promise<RevisionSnapshot>;
  delta(spaceId: string, fromRevisionId: string): Promise<RevisionDelta>;
}
```

Represent an empty Space as virtual revision `0`; never create an empty database row just because a client reads it. Return immutable stored JSON and ETags based on `contentHash` at the controller layer.

- [ ] **Step 4: Run service tests**

Run: `pnpm --filter @agentwiki/server test -- knowledge-revision.service.spec.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/knowledge-revision/knowledge-revision.service.ts apps/server/src/knowledge-revision/knowledge-revision.service.spec.ts apps/server/src/knowledge-revision/knowledge-revision.module.ts
git commit -m "feat(server): read space knowledge revisions"
```

### Task 4: Compile confirmed submissions into ChangeSets

**Files:**
- Create: `apps/server/src/knowledge-pipeline/knowledge-submission.service.ts`
- Create: `apps/server/src/knowledge-pipeline/knowledge-submission.service.spec.ts`
- Modify: `apps/server/src/review/review.service.ts`
- Modify: `apps/server/src/review/review.service.spec.ts`

**Interfaces:**
- Produces: `submit(spaceId, principal, bundle, idempotencyKey, confirmed)` and ChangeItems `create_page`, `update_page`, `archive_page`, `upsert_space_memory`, `archive_space_memory`, `create_relation`, `archive_relation`, `update_relation_strength`.

- [ ] **Step 1: Write failing compilation tests**

Assert create/update/noop/archive for all three item kinds; optimistic tokens (`expectedUpdatedAt`/`expectedLastModifiedAt`); stable `knowledgeKey`; idempotent retries; stale base rejection returning current revision; a bundle Space mismatch; and item-specific scope requirements. Assert no revision is created while ChangeSet is pending or rejected.

- [ ] **Step 2: Verify failure**

Run: `pnpm --filter @agentwiki/server test -- knowledge-submission.service.spec.ts review.service.spec.ts`

Expected: FAIL because submission compilation and memory ChangeItems are absent.

- [ ] **Step 3: Implement submission compilation**

```ts
export interface KnowledgeSubmissionResult {
  status: 'pending_review' | 'published' | 'noop' | 'existing';
  submissionId: string; changeSetId: string | null; currentRevision: string;
}
export class KnowledgeSubmissionService {
  submit(spaceId: string, principal: Principal, raw: Buffer, idempotencyKey: string, confirmed: boolean): Promise<KnowledgeSubmissionResult>;
}
```

Require `X-AgentWiki-User-Confirmed: true`. Lock the Space revision head inside the transaction, compare `bundle.baseRevision`, compute ChangeItems against rows keyed by `knowledgeKey`, and create one `KnowledgeSubmission` plus one ChangeSet. Reuse the existing scoped-auto-publish predicate exactly; never grant the submitting Agent review authority. A same-hash current bundle returns `noop` without a ChangeSet.

- [ ] **Step 4: Extend ReviewService for shared-memory items**

For `upsert_space_memory`, create/update an `AgentMemory` with `visibility: 'space'`, `knowledgeKey`, submitting Agent ownership, SHA-256 content hash, and no server LLM requirement; embeddings may remain empty. For `archive_space_memory`, soft-delete with optimistic `updatedAt`. Add both types to publish, revert, unsupported-type checks, and revision projection tests.

- [ ] **Step 5: Run compilation tests**

Run: `pnpm --filter @agentwiki/server test -- knowledge-submission.service.spec.ts review.service.spec.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/knowledge-pipeline/knowledge-submission.service.ts apps/server/src/knowledge-pipeline/knowledge-submission.service.spec.ts apps/server/src/review/review.service.ts apps/server/src/review/review.service.spec.ts
git commit -m "feat(server): compile knowledge submissions"
```

### Task 5: Project immutable revision only after publish or revert

**Files:**
- Create: `apps/server/src/knowledge-revision/knowledge-revision-projector.ts`
- Create: `apps/server/src/knowledge-revision/knowledge-revision-projector.spec.ts`
- Modify: `apps/server/src/review/review.service.ts`
- Modify: `apps/server/src/review/review.module.ts`
- Modify: `apps/server/src/core/page/page.service.ts`
- Modify: `apps/server/src/core/page/page.service.spec.ts`
- Modify: `apps/server/src/core/knowledge/knowledge.service.ts`
- Create: `apps/server/src/core/knowledge/knowledge.service.spec.ts`
- Modify: `apps/server/src/memory/memory.service.ts`
- Modify: `apps/server/src/memory/memory.service.spec.ts`
- Modify: the corresponding Page, Knowledge, and Memory modules to import `KnowledgeRevisionModule`

**Interfaces:**
- Produces: `KnowledgeRevisionProjector.project(tx, spaceId, changeSetId)`.

- [ ] **Step 1: Write failing projection tests**

Assert pending/rejected sets have no revision, publish creates exactly one next sequence, auto-publish also projects, repeated publish is idempotent, revert creates a compensating next revision, and concurrent publishers cannot create the same sequence. Also assert direct human page create/update/archive, relation create/update/archive, and space-visible memory create/update/archive each produce a Revision, while private Agent Memory changes do not enter the Space Snapshot.

- [ ] **Step 2: Verify failure**

Run: `pnpm --filter @agentwiki/server test -- knowledge-revision-projector.spec.ts review.service.spec.ts`

Expected: FAIL because projection is absent.

- [ ] **Step 3: Implement projector inside the publication transaction**

```ts
export class KnowledgeRevisionProjector {
  project(tx: Prisma.TransactionClient, spaceId: string, changeSetId: string): Promise<{ revisionId: string; sequence: number }>;
}
```

Read every active Page, every active space-visible AgentMemory, and every current KnowledgeRelation after the mutation; serialize the full unified normalized snapshot; diff against the preceding snapshot; insert the next revision and update a linked submission to `applied`. Preserve artifact provenance from the submission bundle. For human-created or human-modified items append a server provenance ID `revision:<newRevisionId>:<itemId>`; the server parser permits carried `revision:` IDs only when they already occur in the submitted base Snapshot, preventing local fabrication. A unique collision must retry the whole mutation transaction, not create a detached revision. Revert uses the same projector after reverse mutations.

Every direct mutation service must invoke the projector in the same database transaction after its materialized write. Refactor PageService, KnowledgeService, and the space-visible MemoryService paths to accept a transaction callback rather than projecting asynchronously. Page/Relation creation uses the Prisma `knowledgeKey` default; a new space-visible memory assigns a new key. Private memories retain `knowledgeKey = null` and never trigger a Space Revision.

- [ ] **Step 4: Run projector tests**

Run: `pnpm --filter @agentwiki/server test -- knowledge-revision-projector.spec.ts review.service.spec.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/knowledge-revision apps/server/src/review/review.service.ts apps/server/src/review/review.module.ts apps/server/src/core/page apps/server/src/core/knowledge apps/server/src/memory
git commit -m "feat(server): project published knowledge revisions"
```

### Task 6: Revision HTTP API, authorization, audit, and integration tests

**Files:**
- Create: `apps/server/src/knowledge-pipeline/knowledge-revision.controller.ts`
- Create: `apps/server/src/knowledge-pipeline/knowledge-revision.http.integration.spec.ts`
- Modify: `apps/server/src/knowledge-pipeline/knowledge-pipeline.module.ts`
- Modify: `apps/server/src/app.module.spec.ts`

**Interfaces:**
- Produces:
  - `GET /spaces/:spaceId/knowledge-revisions/current`
  - `GET /spaces/:spaceId/knowledge-revisions/:revisionId/snapshot`
  - `GET /spaces/:spaceId/knowledge-revisions/delta?from=<revisionId>`
  - `POST /spaces/:spaceId/knowledge-submissions`
  - `GET /spaces/:spaceId/knowledge-submissions/:submissionId`

- [ ] **Step 1: Write failing HTTP integration tests**

Test JWT and Agent credentials; viewer/read-only behavior; missing scopes; cross-Space IDs; stale base 409; missing confirmation; malformed/oversized JSON; duplicate idempotency; pending review; scoped auto-publish; published Snapshot; Delta; revoked grant; revoked credential; audit metadata without bundle content or secrets.

- [ ] **Step 2: Verify failure**

Run: `pnpm --filter @agentwiki/server test -- knowledge-revision.http.integration.spec.ts`

Expected: FAIL because routes are absent.

- [ ] **Step 3: Implement controllers and authorization**

Use `CombinedAuthGuard` and `AuthorizationService.assertSpaceAccess`. Read routes require `pages:read`, `memory:read`, and `graph:read` because Snapshot is unified; the submit service derives required write scopes from non-empty bundle sections and deletion kinds. Limit request body to 10 MiB and accept only `application/json`. Return ETag and `Cache-Control: private, no-store`.

- [ ] **Step 4: Run the server phase gate**

Run:

```bash
pnpm --filter @agentwiki/server test
pnpm --filter @agentwiki/server typecheck
pnpm lint
pnpm --filter @agentwiki/server build
pnpm --filter @agentwiki/server exec prisma validate
```

Expected: all commands exit `0`; a disposable PostgreSQL round trip proves pending submissions are not pullable and published submissions are.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/knowledge-pipeline/knowledge-revision.controller.ts apps/server/src/knowledge-pipeline/knowledge-revision.http.integration.spec.ts apps/server/src/knowledge-pipeline/knowledge-pipeline.module.ts apps/server/src/app.module.spec.ts
git commit -m "feat(server): expose knowledge revision sync API"
```
