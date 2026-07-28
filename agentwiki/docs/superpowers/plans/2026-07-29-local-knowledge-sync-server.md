# Local Knowledge Sync Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add secure one-time local-plugin enrollment and import validated OKF knowledge bundles into the existing Source → Run → ChangeSet pipeline.

**Architecture:** Keep temporary enrollment state in Redis and permanent Agent credentials in the existing `AgentCredential` table. Add a small `KnowledgeSyncService` around OKF validation, source/version identity, idempotency, and sync-state reads; keep compilation, review, evidence, and publication in the existing `SourceService` and `ReviewService`.

**Tech Stack:** NestJS 10, Prisma 5/PostgreSQL, Redis/ioredis, Zod 3, Jest 30, existing Agent Credential and IngestRun pipeline.

## Global Constraints

- Local knowledge must not reach AgentWiki before an explicit user confirmation recorded by the client.
- OKF envelope version is exactly `0.1`; upload limit is 10 MiB.
- Agent authorization remains `Credential scopes ∩ Space grant scopes ∩ Agent status ∩ Space policy`.
- Agents cannot receive `review:decide` and cannot approve their own ChangeSets.
- The server must never accept or access an absolute local path.
- Long-lived Agent credentials must never appear in generated installation instructions or server logs.
- Installation codes expire after 600 seconds and may be redeemed once.
- New user-visible errors use stable business error codes.
- Do not add a second review, publishing, queue, or audit pipeline.

---

## File Structure

- `apps/server/prisma/schema.prisma`: add stable OKF source identity and pin each sync run to its uploaded SourceVersion.
- `apps/server/prisma/migrations/20260729010000_add_local_knowledge_sync/migration.sql`: migrate the two fields and their indexes/foreign key.
- `apps/server/src/knowledge-pipeline/okf-envelope.ts`: own OKF schema, validation, redaction, hashing, title derivation, and normalized types.
- `apps/server/src/knowledge-pipeline/okf-envelope.spec.ts`: trust-boundary tests for OKF input.
- `apps/server/src/knowledge-pipeline/knowledge-sync.service.ts`: own state lookup and atomic Source/SourceVersion/IngestRun creation.
- `apps/server/src/knowledge-pipeline/knowledge-sync.service.spec.ts`: idempotency/no-op/race tests.
- `apps/server/src/knowledge-pipeline/knowledge-sync.controller.ts`: expose authenticated state and upload endpoints.
- `apps/server/src/knowledge-pipeline/knowledge-sync.http.integration.spec.ts`: verify HTTP authentication, scopes, size limits, queueing, and stable errors.
- `apps/server/src/knowledge-pipeline/source.service.ts`: consume pinned OKF versions and preserve explicit evidence through the existing compiler.
- `apps/server/src/knowledge-pipeline/source.service.spec.ts`: prove OKF pages, evidence, relations, deletion, and no duplicate version.
- `apps/server/src/knowledge-pipeline/knowledge-pipeline.module.ts`: register/export the new service and controller.
- `apps/server/src/mcp/mcp.service.ts`: register `get_knowledge_sync_state`.
- `apps/server/src/mcp/mcp.service.spec.ts`: verify tool registration and authorization.
- `apps/server/src/database/redis.service.ts`: add strict one-time-value primitives without changing permissive cache helpers.
- `apps/server/src/database/redis.service.spec.ts`: verify atomic `SET NX EX` and `GETDEL` behavior.
- `apps/server/src/core/dto/local-sync.dto.ts`: validate installation creation and exchange requests.
- `apps/server/src/core/agent/local-sync-installation.service.ts`: create, revoke, rate-limit, and exchange one-time codes.
- `apps/server/src/core/agent/local-sync-installation.service.spec.ts`: expiration, reuse, scope, pause, and secret-handling tests.
- `apps/server/src/core/agent/local-sync-installation.controller.ts`: human-authenticated creation/revocation and public code exchange.
- `apps/server/src/core/agent/agent.module.ts`: register the enrollment service/controller.
- `apps/server/src/core/filters/business-error.ts`: add installation-specific stable error codes.
- `apps/server/.env.example`: document `LOCAL_SYNC_PACKAGE_VERSION` and `PUBLIC_API_URL`.

### Task 1: Persist stable OKF source identity and pinned run input

**Files:**
- Modify: `apps/server/prisma/schema.prisma`
- Create: `apps/server/prisma/migrations/20260729010000_add_local_knowledge_sync/migration.sql`

**Interfaces:**
- Produces: `Source.sourceKey: string | null` and `IngestRun.inputSourceVersionId: string | null`.
- Produces: Prisma unique selector `spaceId_type_sourceKey`.
- Consumes: existing `SourceVersion` and `IngestRun` relations.

- [ ] **Step 1: Add the schema fields and relations**

Add these fields without changing the existing content-identity unique constraint used by `text`, `file`, `url`, and `git` sources:

```prisma
model Source {
  sourceKey String?

  @@unique([spaceId, type, sourceKey])
}

model SourceVersion {
  inputRuns IngestRun[] @relation("IngestRunInputVersion")
}

model IngestRun {
  inputSourceVersion   SourceVersion? @relation("IngestRunInputVersion", fields: [inputSourceVersionId], references: [id], onDelete: SetNull)
  inputSourceVersionId String?

  @@index([inputSourceVersionId])
}
```

For OKF sources, `Source.contentHash` is `sha256(sourceKey)` so two different local sources with identical generated content do not collide with `@@unique([spaceId, type, contentHash])`. Actual content identity remains on `SourceVersion.contentHash`.

- [ ] **Step 2: Write the SQL migration**

```sql
ALTER TABLE "Source" ADD COLUMN "sourceKey" TEXT;
ALTER TABLE "IngestRun" ADD COLUMN "inputSourceVersionId" TEXT;

CREATE UNIQUE INDEX "Source_spaceId_type_sourceKey_key"
  ON "Source"("spaceId", "type", "sourceKey");
CREATE INDEX "IngestRun_inputSourceVersionId_idx"
  ON "IngestRun"("inputSourceVersionId");

ALTER TABLE "IngestRun"
  ADD CONSTRAINT "IngestRun_inputSourceVersionId_fkey"
  FOREIGN KEY ("inputSourceVersionId") REFERENCES "SourceVersion"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
```

- [ ] **Step 3: Validate and generate Prisma Client**

Run:

```bash
pnpm --filter @agentwiki/server exec prisma validate
pnpm --filter @agentwiki/server exec prisma generate
```

Expected: both commands exit 0 and the generated client exposes `sourceKey` and `inputSourceVersionId`.

- [ ] **Step 4: Commit**

```bash
git add apps/server/prisma/schema.prisma apps/server/prisma/migrations/20260729010000_add_local_knowledge_sync/migration.sql
git commit -m "feat: persist local knowledge sync identity"
```

### Task 2: Validate and normalize OKF envelopes at the trust boundary

**Files:**
- Create: `apps/server/src/knowledge-pipeline/okf-envelope.ts`
- Create: `apps/server/src/knowledge-pipeline/okf-envelope.spec.ts`

**Interfaces:**
- Produces: `parseOkfEnvelope(buffer: Buffer): NormalizedOkfEnvelope`.
- Produces: `NormalizedOkfDocument { path, title, content, contentHash, evidence }`.
- Consumes: no database or network services.

- [ ] **Step 1: Write failing validation tests**

Cover one valid bundle and each rejection independently:

```ts
import { createHash } from 'crypto';
import { parseOkfEnvelope } from './okf-envelope';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const valid = () => ({
  okfVersion: '0.1',
  sourceKey: 'repo-7f4e',
  name: 'Project Docs',
  kind: 'code',
  producer: { name: 'openwiki', version: '0.2.0' },
  documents: [{
    path: 'architecture/overview.md',
    content: '# Architecture\nSafe content',
    contentHash: hash('# Architecture\nSafe content'),
    evidence: [{ sourcePath: 'src/app.ts', sourceHash: hash('source'), quote: 'export class App' }],
  }],
});

it('normalizes a valid envelope and derives the H1 title', () => {
  expect(parseOkfEnvelope(Buffer.from(JSON.stringify(valid()))).documents[0])
    .toMatchObject({ path: 'architecture/overview.md', title: 'Architecture' });
});

it.each([
  ['/absolute.md'],
  ['../escape.md'],
  ['folder\\windows.md'],
])('rejects unsafe document path %s', (path) => {
  const input = valid();
  input.documents[0].path = path;
  expect(() => parseOkfEnvelope(Buffer.from(JSON.stringify(input)))).toThrow('relative POSIX path');
});

it('rejects duplicate paths and client hash mismatches', () => {
  const input = valid();
  input.documents.push({ ...input.documents[0] });
  expect(() => parseOkfEnvelope(Buffer.from(JSON.stringify(input)))).toThrow('duplicate');
  input.documents.pop();
  input.documents[0].contentHash = '0'.repeat(64);
  expect(() => parseOkfEnvelope(Buffer.from(JSON.stringify(input)))).toThrow('contentHash');
});

it('redacts secrets before returning server-owned hashes', () => {
  const input = valid();
  input.documents[0].content = 'token=secret-value';
  input.documents[0].contentHash = hash(input.documents[0].content);
  const parsed = parseOkfEnvelope(Buffer.from(JSON.stringify(input)));
  expect(parsed.documents[0].content).toBe('token=[REDACTED]');
  expect(parsed.documents[0].contentHash).toBe(hash('token=[REDACTED]'));
});
```

Also assert limits: 500 documents, 1 MiB per document, 20 evidence entries per document, 500 characters per quote, 512 characters per path, and 10 MiB total JSON.

- [ ] **Step 2: Run the test and observe failure**

Run:

```bash
pnpm --filter @agentwiki/server exec jest src/knowledge-pipeline/okf-envelope.spec.ts --runInBand
```

Expected: FAIL because `okf-envelope.ts` does not exist.

- [ ] **Step 3: Implement the pure parser**

Use Zod strict objects and a `superRefine` pass. The exported surface must be:

```ts
export interface NormalizedOkfEvidence {
  sourcePath: string;
  sourceHash: string;
  quote: string;
}

export interface NormalizedOkfDocument {
  path: string;
  title: string;
  content: string;
  contentHash: string;
  evidence: NormalizedOkfEvidence[];
}

export interface NormalizedOkfEnvelope {
  okfVersion: '0.1';
  sourceKey: string;
  name: string;
  kind: 'code' | 'documents' | 'mixed';
  producer: { name: string; version: string };
  documents: NormalizedOkfDocument[];
  contentHash: string;
}

export function parseOkfEnvelope(buffer: Buffer): NormalizedOkfEnvelope;
```

Validation rules:

```ts
const safePath = (value: string) => {
  if (!value || value.length > 512 || value.includes('\\') || value.startsWith('/')) return false;
  const normalized = posix.normalize(value);
  return normalized === value && !normalized.startsWith('../') && normalized !== '..';
};

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const titleFromMarkdown = (path: string, content: string) =>
  content.match(/^#\s+(.+)$/m)?.[1].trim().slice(0, 200)
  || posix.basename(path, posix.extname(path)).replace(/[-_]+/g, ' ').slice(0, 200);
```

Verify the client hash against original content first, redact both document content and evidence quotes with the existing secret patterns, recompute every returned document hash, then compute the envelope hash from canonical `JSON.stringify` of the normalized fields. Do not accept unknown top-level or document fields.

- [ ] **Step 4: Run the parser tests**

Run:

```bash
pnpm --filter @agentwiki/server exec jest src/knowledge-pipeline/okf-envelope.spec.ts --runInBand
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/knowledge-pipeline/okf-envelope.ts apps/server/src/knowledge-pipeline/okf-envelope.spec.ts
git commit -m "feat: validate OKF knowledge bundles"
```

### Task 3: Create sync state and atomic upload services

**Files:**
- Create: `apps/server/src/knowledge-pipeline/knowledge-sync.service.ts`
- Create: `apps/server/src/knowledge-pipeline/knowledge-sync.service.spec.ts`
- Create: `apps/server/src/knowledge-pipeline/knowledge-sync.controller.ts`
- Modify: `apps/server/src/knowledge-pipeline/knowledge-pipeline.module.ts`

**Interfaces:**
- Consumes: `parseOkfEnvelope(buffer)` from Task 2.
- Produces: `getState(spaceId, sourceKey): Promise<KnowledgeSyncState>`.
- Produces: `createSync(spaceId, principal, buffer, idempotencyKey, confirmed): Promise<KnowledgeSyncResult>`.
- Produces HTTP: `GET /api/spaces/:spaceId/knowledge-syncs/:sourceKey`.
- Produces HTTP: `POST /api/spaces/:spaceId/knowledge-syncs` multipart field `file`.

- [ ] **Step 1: Write failing service tests**

The harness must prove four cases:

```ts
it('creates one OKF source, version, and pinned queued run', async () => {
  await expect(service.createSync('space-1', agentPrincipal, okfBuffer, 'request-1', true))
    .resolves.toMatchObject({ status: 'queued', sourceId: 'source-1', sourceVersionId: 'version-1', runId: 'run-1' });
  expect(prisma.ingestRun.create).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ inputSourceVersionId: 'version-1', idempotencyKey: 'request-1' }),
  }));
});

it('returns the original result for a repeated idempotency key', async () => {
  prisma.ingestRun.findUnique.mockResolvedValue({ id: 'run-1', inputSourceVersionId: 'version-1' });
  await expect(service.createSync('space-1', agentPrincipal, okfBuffer, 'request-1', true))
    .resolves.toMatchObject({ status: 'queued', runId: 'run-1' });
  expect(prisma.sourceVersion.create).not.toHaveBeenCalled();
});

it('returns no-op without a new run when a completed version hash matches', async () => {
  prisma.sourceVersion.findFirst.mockResolvedValue({ id: 'version-1', contentHash: normalizedHash });
  prisma.ingestRun.findFirst.mockResolvedValue({ id: 'run-1', status: 'completed', inputSourceVersionId: 'version-1' });
  await expect(service.createSync('space-1', agentPrincipal, okfBuffer, 'request-2', true))
    .resolves.toEqual({ status: 'noop', sourceId: 'source-1', sourceVersionId: 'version-1', runId: null });
});

it('reuses an active run and retries a failed version without duplicating SourceVersion', async () => {
  prisma.sourceVersion.findFirst.mockResolvedValue({ id: 'version-1', contentHash: normalizedHash });
  prisma.ingestRun.findFirst.mockResolvedValueOnce({ id: 'run-active', status: 'extracting' });
  await expect(service.createSync('space-1', agentPrincipal, okfBuffer, 'request-2', true))
    .resolves.toMatchObject({ status: 'queued', runId: 'run-active' });
  prisma.ingestRun.findFirst.mockResolvedValueOnce({ id: 'run-failed', status: 'failed' });
  await service.createSync('space-1', agentPrincipal, okfBuffer, 'request-3', true);
  expect(prisma.sourceVersion.create).not.toHaveBeenCalled();
  expect(prisma.ingestRun.create).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ inputSourceVersionId: 'version-1' }),
  }));
});

it('refuses an upload without the explicit confirmation declaration', async () => {
  await expect(service.createSync('space-1', agentPrincipal, okfBuffer, 'request-3', false))
    .rejects.toMatchObject({ businessCode: 'SYNC_CONFIRMATION_REQUIRED' });
});
```

The state test must select the newest OKF version whose pinned run reached `completed` or `partial`, and return only `path` and `contentHash`, never page content, credential data, failed uploads, or local absolute paths.

- [ ] **Step 2: Run the service test and observe failure**

Run:

```bash
pnpm --filter @agentwiki/server exec jest src/knowledge-pipeline/knowledge-sync.service.spec.ts --runInBand
```

Expected: FAIL because `KnowledgeSyncService` does not exist.

- [ ] **Step 3: Implement the transaction boundary**

Use these public types and methods:

```ts
export interface KnowledgeSyncState {
  exists: boolean;
  sourceId: string | null;
  sourceVersionId: string | null;
  syncedAt: Date | null;
  documents: Array<{ path: string; contentHash: string }>;
}

export interface KnowledgeSyncResult {
  status: 'queued' | 'noop';
  sourceId: string;
  sourceVersionId: string;
  runId: string | null;
}

async getState(spaceId: string, sourceKey: string): Promise<KnowledgeSyncState>;

async createSync(
  spaceId: string,
  principal: Principal,
  file: Buffer,
  idempotencyKey: string,
  confirmed: boolean,
): Promise<KnowledgeSyncResult>;
```

Inside `createSync`:

1. Require `confirmed === true` and `idempotencyKey` length `1..128`.
2. Require `sourceKey` to match `/^[A-Za-z0-9._-]{1,128}$/`; apply the same check in `getState`.
3. Parse and normalize before opening the transaction.
4. Upsert `Source` by `spaceId_type_sourceKey` with `type: 'okf'`, `contentHash: sha256(sourceKey)`, and non-secret producer/kind metadata in `config`.
5. Return an existing run for `sourceId_idempotencyKey` before creating a version.
6. When a SourceVersion already has the normalized envelope hash: return its active run, return `noop` for a `completed`/`partial` run, or create a new run pinned to the existing version after `failed`/`cancelled`; never duplicate the SourceVersion.
7. Otherwise create `SourceVersion` with normalized JSON content and nested `SourceFileSnapshot` rows for documents.
8. Create a queued `IngestRun` pinned by `inputSourceVersionId` and snapshot the principal fields exactly as `SourceService.createRun` does.
9. Record `knowledge_sync.create` through `AuditService` with Agent ID, Credential ID, Space ID, sourceKey, normalized package hash, idempotency key, `userConfirmed: true`, and result status; never include file content, absolute paths, or a credential secret.
10. Catch only Prisma `P2002`, re-read the winner, and return it; rethrow every other error.

- [ ] **Step 4: Implement the controller and module registration**

The controller methods must be:

```ts
@Controller()
@UseGuards(CombinedAuthGuard)
export class KnowledgeSyncController {
  constructor(
    private readonly syncs: KnowledgeSyncService,
    private readonly authorization: AuthorizationService,
    private readonly queue: IngestQueue,
  ) {}

  @Get('spaces/:spaceId/knowledge-syncs/:sourceKey')
  async state(@Param('spaceId') spaceId: string, @Param('sourceKey') sourceKey: string, @Req() req: Request) {
    await this.authorization.assertSpaceAccess(req.user as any, spaceId,
      ['owner', 'admin', 'editor', 'viewer'], 'sources:read');
    return this.syncs.getState(spaceId, sourceKey);
  }

  @Post('spaces/:spaceId/knowledge-syncs')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024, files: 1 } }))
  async create(
    @Param('spaceId') spaceId: string,
    @Req() req: Request,
    @UploadedFile() file: { originalname: string; buffer: Buffer } | undefined,
    @Headers('idempotency-key') idempotencyKey?: string,
    @Headers('x-agentwiki-user-confirmed') confirmed?: string,
  ) {
    await this.authorization.assertSpaceAccess(req.user as any, spaceId, ['owner', 'editor'], 'sources:write');
    await this.authorization.assertSpaceAccess(req.user as any, spaceId, ['owner', 'editor'], 'runs:write');
    if (!file || !file.originalname.toLowerCase().endsWith('.okf.json')) {
      throw new BusinessException('SOURCE_INVALID', 'A .okf.json file is required');
    }
    const result = await this.syncs.createSync(spaceId, req.user as any, file.buffer,
      idempotencyKey || '', confirmed === 'true');
    if (result.status === 'queued') this.queue.enqueue();
    return result;
  }
}
```

Register `KnowledgeSyncService` and `KnowledgeSyncController` in `KnowledgePipelineModule`; export the service for MCP.

- [ ] **Step 5: Run focused tests**

Run:

```bash
pnpm --filter @agentwiki/server exec jest src/knowledge-pipeline/knowledge-sync.service.spec.ts --runInBand
pnpm --filter @agentwiki/server typecheck
```

Expected: PASS and exit 0.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/knowledge-pipeline/knowledge-sync.service.ts apps/server/src/knowledge-pipeline/knowledge-sync.service.spec.ts apps/server/src/knowledge-pipeline/knowledge-sync.controller.ts apps/server/src/knowledge-pipeline/knowledge-pipeline.module.ts
git commit -m "feat: accept idempotent OKF sync uploads"
```

### Task 4: Compile the pinned OKF version through the existing pipeline

**Files:**
- Modify: `apps/server/src/knowledge-pipeline/source.service.ts`
- Modify: `apps/server/src/knowledge-pipeline/source.service.spec.ts`

**Interfaces:**
- Consumes: `IngestRun.inputSourceVersionId` and normalized envelope JSON.
- Produces: existing Page, Relation, Evidence, Artifact, ChangeSet, and auto-publish behavior without a second SourceVersion.

- [ ] **Step 1: Write failing pipeline tests**

Add an OKF run fixture with two linked documents and explicit evidence. Assert:

```ts
expect(prisma.sourceVersion.create).not.toHaveBeenCalled();
expect(prisma.artifact.createMany).toHaveBeenCalledWith(expect.objectContaining({
  data: expect.arrayContaining([
    expect.objectContaining({ type: 'compiled_page', metadata: expect.objectContaining({ sourcePath: 'a.md' }) }),
    expect.objectContaining({ type: 'relation_candidate' }),
  ]),
}));
expect(prisma.evidence.createMany).toHaveBeenCalledWith(expect.objectContaining({
  data: expect.arrayContaining([
    expect.objectContaining({
      quote: 'export class App',
      location: expect.objectContaining({ sourcePath: 'a.md', originalSourcePath: 'src/app.ts' }),
    }),
  ]),
}));
expect(prisma.changeSet.create).toHaveBeenCalledWith(expect.objectContaining({
  data: expect.objectContaining({ status: 'pending_review' }),
}));
```

Also assert a missing/deleted pinned version fails the run rather than reading the newest version.

- [ ] **Step 2: Run the focused test and observe failure**

Run:

```bash
pnpm --filter @agentwiki/server exec jest src/knowledge-pipeline/source.service.spec.ts --runInBand
```

Expected: FAIL because `SourceService.fetch` does not understand `okf` or pinned versions.

- [ ] **Step 3: Extend fetched segment types and pinned fetch**

Extend the private shape:

```ts
interface FetchedSegment {
  sourcePath: string;
  title: string;
  content: string;
  format: 'markdown' | 'json';
  evidence?: Array<{ sourcePath: string; sourceHash: string; quote: string }>;
}

interface FetchedSource {
  content: string;
  metadata?: object;
  cleanup?: string;
  files?: Array<{ path: string; contentHash: string; size: number; commit?: string }>;
  segments?: FetchedSegment[];
  sourceVersion?: { id: string; version: number; contentHash: string };
}
```

Load the run with `inputSourceVersion: true`. For `source.type === 'okf'`, require that relation, parse its already-normalized JSON, map `documents` to segments, and return the pinned SourceVersion. Never fall back to the latest version.

- [ ] **Step 4: Reuse the pinned version and preserve explicit evidence**

Replace the version selection with:

```ts
let version = fetched.sourceVersion
  ? await this.prisma.sourceVersion.findUnique({ where: { id: fetched.sourceVersion.id } })
  : await this.prisma.sourceVersion.findFirst({ where: { sourceId: run.sourceId, contentHash } });

if (!version && fetched.sourceVersion) throw new Error('Pinned source version no longer exists');
if (!version) {
  const latest = await this.prisma.sourceVersion.findFirst({
    where: { sourceId: run.sourceId },
    orderBy: { version: 'desc' },
  });
  try {
    version = await this.prisma.sourceVersion.create({
      data: {
        sourceId: run.sourceId,
        version: (latest?.version || 0) + 1,
        content: sanitized,
        contentHash,
        metadata: fetched.metadata as any,
      },
    });
  } catch (error: any) {
    if (error?.code !== 'P2002') throw error;
    version = await this.prisma.sourceVersion.findFirst({
      where: { sourceId: run.sourceId, contentHash },
    });
    if (!version) throw error;
  }
  if (fetched.files?.length) {
    await this.prisma.sourceFileSnapshot.createMany({
      data: fetched.files.map((file) => ({ ...file, sourceVersionId: version!.id })),
    });
  }
}
```

Create explicit evidence alongside chunk evidence:

```ts
const chunkEvidence = chunks.map((chunk) => ({
  runId: id,
  sourceVersionId: version!.id,
  quote: chunk.content.slice(0, 500),
  location: chunk.location,
  confidence: 1,
}));
const explicitEvidence = segments.flatMap((segment) =>
  (segment.evidence || []).map((evidence) => ({
    runId: id,
    sourceVersionId: version!.id,
    quote: evidence.quote,
    location: {
      sourcePath: segment.sourcePath,
      originalSourcePath: evidence.sourcePath,
      sourceHash: evidence.sourceHash,
    },
    confidence: 1,
  })),
);
await this.prisma.evidence.createMany({ data: [...chunkEvidence, ...explicitEvidence] });
```

Keep current redaction, relation compilation, optimistic concurrency, review, auto-publish, lease, audit, and cancellation checks unchanged.

- [ ] **Step 5: Run pipeline and regression tests**

Run:

```bash
pnpm --filter @agentwiki/server exec jest src/knowledge-pipeline/source.service.spec.ts --runInBand
pnpm --filter @agentwiki/server exec jest src/review/review.service.spec.ts --runInBand
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/knowledge-pipeline/source.service.ts apps/server/src/knowledge-pipeline/source.service.spec.ts
git commit -m "feat: compile pinned OKF source versions"
```

### Task 5: Expose sync state through MCP and verify HTTP authorization

**Files:**
- Modify: `apps/server/src/mcp/mcp.service.ts`
- Modify: `apps/server/src/mcp/mcp.controller.ts`
- Modify: `apps/server/src/mcp/mcp.service.spec.ts`
- Create: `apps/server/src/knowledge-pipeline/knowledge-sync.http.integration.spec.ts`

**Interfaces:**
- Consumes: `KnowledgeSyncService.getState`.
- Produces MCP tool: `get_knowledge_sync_state({ spaceId, sourceKey })`.

- [ ] **Step 1: Write failing MCP tests**

Assert the registered tool delegates only after authorization:

```ts
expect(authorization.assertSpaceAccess).toHaveBeenCalledWith(
  principal, 'space-1', ['owner', 'admin', 'editor', 'viewer'], 'sources:read',
);
expect(syncs.getState).toHaveBeenCalledWith('space-1', 'repo-7f4e');
```

Update the integration metadata test to expect `get_knowledge_sync_state: sources:read`.

- [ ] **Step 2: Implement the MCP tool**

Inject `KnowledgeSyncService` into `McpService` and register:

```ts
registerTool('get_knowledge_sync_state', {
  description: 'Return path and content hashes from the last confirmed local knowledge sync. No page content is returned.',
  inputSchema: {
    spaceId: z.string().describe(SPACE_ID),
    sourceKey: z.string().min(1).max(128),
  },
}, async ({ spaceId, sourceKey }: { spaceId: string; sourceKey: string }) => {
  await this.authorization.assertSpaceAccess(principal, spaceId,
    ['owner', 'admin', 'editor', 'viewer'], 'sources:read');
  return this.text(await this.syncs.getState(spaceId, sourceKey));
});
```

- [ ] **Step 3: Add HTTP integration coverage**

Build a Nest testing module using the existing CombinedAuth/Authorization integration pattern and assert:

- a credential missing `sources:write` receives `AUTH_SCOPE_REQUIRED`;
- a grant missing `runs:write` receives `SPACE_ACCESS_DENIED`;
- a non-editor receives 403;
- missing confirmation receives `SYNC_CONFIRMATION_REQUIRED`;
- a file over 10 MiB receives 413, not 500;
- valid upload queues exactly once;
- repeated `Idempotency-Key` returns the original run;
- state returns hashes but not document content.

- [ ] **Step 4: Run MCP and HTTP tests**

Run:

```bash
pnpm --filter @agentwiki/server exec jest src/mcp/mcp.service.spec.ts src/knowledge-pipeline/knowledge-sync.http.integration.spec.ts --runInBand
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/mcp/mcp.service.ts apps/server/src/mcp/mcp.controller.ts apps/server/src/mcp/mcp.service.spec.ts apps/server/src/knowledge-pipeline/knowledge-sync.http.integration.spec.ts
git commit -m "feat: expose local knowledge sync state"
```

### Task 6: Issue and exchange one-time local-plugin installation codes

**Files:**
- Modify: `apps/server/src/database/redis.service.ts`
- Modify: `apps/server/src/database/redis.service.spec.ts`
- Create: `apps/server/src/core/dto/local-sync.dto.ts`
- Create: `apps/server/src/core/agent/local-sync-installation.service.ts`
- Create: `apps/server/src/core/agent/local-sync-installation.service.spec.ts`
- Create: `apps/server/src/core/agent/local-sync-installation.controller.ts`
- Modify: `apps/server/src/core/agent/agent.service.ts`
- Modify: `apps/server/src/core/agent/agent.service.spec.ts`
- Modify: `apps/server/src/core/agent/agent.module.ts`
- Modify: `apps/server/src/core/filters/business-error.ts`
- Modify: `apps/server/.env.example`

**Interfaces:**
- Produces: `POST /api/agents/:agentId/local-sync-installations` (human JWT only).
- Produces: `DELETE /api/agents/:agentId/local-sync-installations/:installationId` (human JWT only).
- Produces: `POST /api/integrations/local-sync/exchange` (one-time code).
- Produces: strict Redis helpers `setOnce` and `getDel`.

- [ ] **Step 1: Write failing strict Redis tests**

```ts
it('stores a one-time value only when absent', async () => {
  const client = { set: jest.fn().mockResolvedValue('OK') };
  const service = serviceWithClient(client);
  await expect(service.setOnce('install:hash', 'payload', 600)).resolves.toBe(true);
  expect(client.set).toHaveBeenCalledWith('install:hash', 'payload', 'EX', 600, 'NX');
});

it('atomically returns and deletes a one-time value', async () => {
  const client = { getdel: jest.fn().mockResolvedValue('payload') };
  const service = serviceWithClient(client);
  await expect(service.getDel('install:hash')).resolves.toBe('payload');
});

it('strictly deletes revocation state', async () => {
  const client = { del: jest.fn().mockResolvedValue(1) };
  const service = serviceWithClient(client);
  await expect(service.deleteStrict('install:hash')).resolves.toBe(1);
});

it('surfaces Redis errors for security state', async () => {
  const failure = new Error('redis unavailable');
  const service = serviceWithClient({ getdel: jest.fn().mockRejectedValue(failure) });
  await expect(service.getDel('install:hash')).rejects.toBe(failure);
});
```

- [ ] **Step 2: Implement strict Redis helpers and run tests**

```ts
async setOnce(key: string, value: string, ttlSeconds: number): Promise<boolean> {
  return (await this.getClient().set(key, value, 'EX', ttlSeconds, 'NX')) === 'OK';
}

async getDel(key: string): Promise<string | null> {
  return this.getClient().getdel(key);
}

async deleteStrict(key: string): Promise<number> {
  return this.getClient().del(key);
}
```

Run:

```bash
pnpm --filter @agentwiki/server exec jest src/database/redis.service.spec.ts --runInBand
```

Expected: PASS.

- [ ] **Step 3: Add request DTOs and business codes**

```ts
export class CreateLocalSyncInstallationDto {
  @IsArray() @ArrayMinSize(1) @IsString({ each: true }) @MaxLength(50, { each: true })
  scopes: string[];

  @IsString() @Matches(/^\d+\.\d+\.\d+$/)
  pluginVersion: string;
}

export class ExchangeLocalSyncInstallationDto {
  @IsString() @MinLength(12) @MaxLength(128)
  code: string;
}
```

Add `LOCAL_SYNC_CODE_INVALID` as 401, `LOCAL_SYNC_VERSION_UNSUPPORTED` as 409, and `SYNC_CONFIRMATION_REQUIRED` as 400 to `ERROR_CODE_MAP`.

- [ ] **Step 4: Write failing installation service tests**

Assert:

```ts
it('stores only a hash-keyed, 600-second one-time payload', async () => {
  const result = await service.create('owner-1', 'agent-1', ['sources:read'], '0.1.0', 'https://wiki.test/api');
  expect(result.code).toMatch(/^AW-[A-Z0-9-]+$/);
  expect(redis.setOnce).toHaveBeenCalledWith(expect.stringMatching(/^local-sync:install:/),
    expect.not.stringContaining(result.code), 600);
  expect(result.instructions).toContain('@agentwiki/local-sync@0.1.0 connect');
  expect(result.instructions).not.toContain('agk_');
});

it('consumes the code once and returns a newly issued credential once', async () => {
  redis.getDel.mockResolvedValue(JSON.stringify(payload));
  agents.getOwned.mockResolvedValue({ id: 'agent-1', status: 'active' });
  agents.createCredential.mockResolvedValue({ id: 'credential-1', apiKey: 'agk_secret' });
  await expect(service.exchange('AW-CODE', '127.0.0.1'))
    .resolves.toMatchObject({ apiKey: 'agk_secret', agentId: 'agent-1' });
  expect(redis.getDel).toHaveBeenCalledTimes(1);
});
```

Also cover expired/used codes, unsupported versions, paused/revoked Agent, invalid scopes, more than 10 exchange attempts per IP per minute, and audit metadata containing Credential ID but not API key.

- [ ] **Step 5: Reuse one credential-scope validator**

Move the existing validation and deduplication into a public method used by both ordinary credentials and installation codes:

```ts
normalizeCredentialScopes(scopes: string[]): string[] {
  const normalized = Array.from(new Set(scopes));
  if (normalized.length === 0 || normalized.some((scope) => !VALID_SCOPES.has(scope))) {
    throw new BadRequestException('Credential contains an invalid or empty scope list');
  }
  return normalized;
}
```

`AgentService.createCredential` must call this method. `LocalSyncInstallationService.create` must call it before creating the Redis record, so an invalid code is never issued.

- [ ] **Step 6: Implement installation creation, revocation, and exchange**

Use `randomBytes(18).toString('base64url').toUpperCase()` for the visible code and SHA-256 for the Redis key. The stored JSON payload is:

```ts
interface InstallationPayload {
  installationId: string;
  ownerId: string;
  agentId: string;
  scopes: string[];
  pluginVersion: string;
  serverUrl: string;
  expiresAt: string;
}
```

Set `installationId` to the full lowercase `sha256(code)` and store one TTL key, `local-sync:install:<installationId>`, containing the payload. The hash is safe to return to the authenticated UI and directly identifies the revocation key without a reverse index. Revocation uses `deleteStrict` on that key. Successful exchange computes the same hash and uses `GETDEL`; the visible code is never stored. If `setOnce` reports a collision, generate a new code up to three times, then fail without returning any code.

Service methods:

```ts
create(ownerId: string, agentId: string, scopes: string[], pluginVersion: string, serverUrl: string): Promise<{
  installationId: string; code: string; expiresAt: string; instructions: string;
}>;
revoke(ownerId: string, agentId: string, installationId: string): Promise<{ success: true }>;
exchange(code: string, ipAddress: string): Promise<{
  apiKey: string; agentId: string; credentialId: string; serverUrl: string;
  pluginVersion: string; scopes: string[];
}>;
```

Read the supported exact version from `LOCAL_SYNC_PACKAGE_VERSION`; reject absent or different versions. Read the canonical base from `PUBLIC_API_URL`, normalize one trailing slash, and use request-derived origin only in development. Call `AgentService.createCredential(payload.ownerId, payload.agentId, { name: 'Local sync plugin', scopes })` only after `getOwned` returns an active Agent.

The generated instruction must contain the pinned `npx` command, tell the local Agent to report `doctor` output, and state that install does not scan or sync.

- [ ] **Step 7: Add controllers and guards**

Use a separate controller so the public exchange route does not inherit `JwtAuthGuard`:

```ts
@Controller()
export class LocalSyncInstallationController {
  constructor(
    private readonly installations: LocalSyncInstallationService,
    private readonly config: ConfigService,
  ) {}

  @Post('agents/:agentId/local-sync-installations')
  @UseGuards(JwtAuthGuard, HumanOnlyGuard)
  create(
    @Req() req: Request,
    @Param('agentId') agentId: string,
    @Body() dto: CreateLocalSyncInstallationDto,
  ) {
    return this.installations.create(
      (req.user as { userId: string }).userId,
      agentId,
      dto.scopes,
      dto.pluginVersion,
      this.publicApiUrl(req),
    );
  }

  @Delete('agents/:agentId/local-sync-installations/:installationId')
  @UseGuards(JwtAuthGuard, HumanOnlyGuard)
  revoke(
    @Req() req: Request,
    @Param('agentId') agentId: string,
    @Param('installationId') installationId: string,
  ) {
    return this.installations.revoke(
      (req.user as { userId: string }).userId,
      agentId,
      installationId,
    );
  }

  @Post('integrations/local-sync/exchange')
  exchange(@Req() req: Request, @Body() dto: ExchangeLocalSyncInstallationDto) {
    return this.installations.exchange(dto.code, req.ip);
  }

  private publicApiUrl(req: Request): string {
    const configured = this.config.get<string>('PUBLIC_API_URL');
    if (configured) return configured.replace(/\/$/, '');
    if (this.config.get<string>('NODE_ENV') === 'production') {
      throw new InternalServerErrorException('PUBLIC_API_URL is required');
    }
    return `${req.protocol}://${req.get('host')}/api`;
  }
}
```

Register it and the service in `AgentModule`. Document:

```dotenv
PUBLIC_API_URL=http://localhost:3000/api
LOCAL_SYNC_PACKAGE_VERSION=0.1.0
```

- [ ] **Step 8: Run focused security tests**

Run:

```bash
pnpm --filter @agentwiki/server exec jest src/core/agent/local-sync-installation.service.spec.ts src/database/redis.service.spec.ts --runInBand
pnpm --filter @agentwiki/server exec jest src/core/agent/agent.service.spec.ts --runInBand
pnpm --filter @agentwiki/server typecheck
```

Expected: PASS and exit 0.

- [ ] **Step 9: Commit**

```bash
git add apps/server/src/database/redis.service.ts apps/server/src/database/redis.service.spec.ts apps/server/src/core/dto/local-sync.dto.ts apps/server/src/core/agent/local-sync-installation.service.ts apps/server/src/core/agent/local-sync-installation.service.spec.ts apps/server/src/core/agent/local-sync-installation.controller.ts apps/server/src/core/agent/agent.service.ts apps/server/src/core/agent/agent.service.spec.ts apps/server/src/core/agent/agent.module.ts apps/server/src/core/filters/business-error.ts apps/server/.env.example
git commit -m "feat: add one-time local sync enrollment"
```

### Task 7: Run the complete server gate and migration smoke test

**Files:**
- Modify only files required by failures from this task; do not broaden scope.

**Interfaces:**
- Consumes all server work from Tasks 1–6.
- Produces a server implementation ready for the local plugin plan.

- [ ] **Step 1: Run all server unit/integration tests**

```bash
pnpm --filter @agentwiki/server test
```

Expected: every Jest suite passes.

- [ ] **Step 2: Run static and production checks**

```bash
pnpm --filter @agentwiki/server typecheck
pnpm --filter @agentwiki/server build
pnpm lint
```

Expected: all commands exit 0 with zero lint errors.

- [ ] **Step 3: Apply the migration to the local test database**

```bash
pnpm --filter @agentwiki/server exec prisma migrate deploy
pnpm --filter @agentwiki/server exec prisma migrate status
```

Expected: the new migration applies once and status reports no pending migrations.

- [ ] **Step 4: Perform a local API smoke test**

Start the existing development stack, then use a temporary human account/Agent/Space to verify:

1. create an installation code;
2. exchange it once and receive an `agk_` credential;
3. repeat exchange and receive `LOCAL_SYNC_CODE_INVALID`;
4. upload a two-document `.okf.json` with confirmation and idempotency headers;
5. observe one Run and one pending-review ChangeSet;
6. publish as a human and read both pages, relation, and evidence;
7. repeat unchanged upload and receive `noop`;
8. revoke the credential and verify HTTP/MCP return 401;
9. delete the temporary Space, Agent, and account data.

Expected: no secret appears in server logs, and all temporary data is removed.

- [ ] **Step 5: Commit any narrowly scoped fixes, otherwise record the verified commit**

```bash
git status --short
git log -1 --oneline
```

Expected: clean working tree. If the smoke test required a fix, commit only that fix with `fix: close local sync server smoke gap` and rerun Steps 1–4.
