# Local Knowledge Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the versioned local protocol, atomic per-Space workspace, deterministic validation, and resumable orchestration state machine without adapters or network sync.

**Architecture:** Replace retired external compiler-shaped in-memory values with canonical `SourceArtifact`, `KnowledgeBundle`, Recipe, validation, and job-state modules. Keep semantic content submission as an explicit MCP work-item exchange so the connected Agent supplies cognition while local code owns IDs, hashes, provenance, state transitions, and preview persistence.

**Tech Stack:** Node.js 26, TypeScript/ESM, Zod 3, MCP SDK, Vitest, SHA-256, atomic filesystem writes.

## Global Constraints

- Work only under `~/.agentwiki/spaces/<space-id>/`; never modify the scanned source directory.
- `wiki/` contains readable knowledge; `.state/` contains manifests, bases, drafts, jobs, and checkpoints.
- Serialized uploads must reject `local-only` artifacts and unknown schema/recipe versions.
- A job transition is valid only from its declared predecessor and persists before returning.
- Preview is read-only and expires; confirmation is a separate later operation.

---

### Task 1: Canonical protocol and stable hashes

**Files:**
- Create: `packages/local-sync/src/protocol.ts`
- Create: `packages/local-sync/src/canonical-json.ts`
- Create: `packages/local-sync/src/protocol.spec.ts`
- Create: `packages/local-sync/src/testing/protocol-fixtures.ts`

**Interfaces:**
- Produces: `SourceArtifactSchema`, `KnowledgeBundleSchema`, `KnowledgeItemSchema`, `ValidationIssueSchema`, `canonicalJson(value)`, `contentHash(value)`, and reusable typed protocol fixtures.
- Consumers: every later local module and the server parser in Plan 3.

- [ ] **Step 1: Write failing canonicalization and schema tests**

```ts
import { describe, expect, it } from 'vitest';
import { canonicalJson, contentHash } from './canonical-json.js';
import { KnowledgeBundleSchema, SourceArtifactSchema } from './protocol.js';

describe('local knowledge protocol', () => {
  it('hashes objects independently of key insertion order', () => {
    expect(contentHash({ b: 2, a: 1 })).toBe(contentHash({ a: 1, b: 2 }));
    expect(canonicalJson({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
  });

  it('fails closed for local-only upload provenance', () => {
    const artifact = SourceArtifactSchema.parse({
      schemaVersion: 'source-artifact@1', artifactId: 'artifact-1', adapterId: 'fixture',
      adapterVersion: '1.0.0', sourceId: 'source-1', logicalKey: 'module/core',
      contentHash: 'a'.repeat(64), updatedAt: '2026-07-30T00:00:00.000Z', kind: 'code',
      content: { title: 'Core', body: 'Derived knowledge' }, evidence: [], sensitivity: 'local-only',
    });
    expect(() => KnowledgeBundleSchema.parse({
      schemaVersion: 'knowledge-bundle@1', recipeVersion: 'code-wiki@1', spaceId: 'space-1',
      baseRevision: '0', pages: [], memories: [], relations: [], provenance: [{ itemId: 'page-1', artifactIds: [artifact.artifactId], sensitivity: artifact.sensitivity }], deletions: [],
    })).toThrow(/local-only/);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `pnpm --filter @neomei/agentwiki-local-sync test -- protocol.spec.ts`

Expected: FAIL because `protocol.ts` and `canonical-json.ts` do not exist.

- [ ] **Step 3: Implement canonical JSON and protocol schemas**

```ts
// canonical-json.ts
import { createHash } from 'node:crypto';

export function canonicalJson(value: unknown): string {
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') throw new TypeError('Value is not canonical JSON');
  if (typeof value === 'number' && !Number.isFinite(value)) throw new TypeError('Non-finite numbers are not canonical JSON');
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}

export function contentHash(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}
```

```ts
// protocol.ts — use these exact public names and literals
import { z } from 'zod';

const Sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
export const EvidenceReferenceSchema = z.object({ sourcePath: z.string().min(1), locator: z.string().min(1), sourceHash: Sha256.optional() }).strict();
export const StructuredKnowledgeSchema = z.object({ title: z.string().min(1), body: z.string(), attributes: z.record(z.unknown()).optional() }).strict();
export const SourceArtifactSchema = z.object({
  schemaVersion: z.literal('source-artifact@1'), artifactId: z.string().min(1), adapterId: z.string().min(1),
  adapterVersion: z.string().min(1), sourceId: z.string().min(1), logicalKey: z.string().min(1),
  contentHash: Sha256, updatedAt: z.string().datetime(), kind: z.enum(['code', 'document', 'memory', 'relation']),
  content: StructuredKnowledgeSchema, evidence: z.array(EvidenceReferenceSchema),
  sensitivity: z.enum(['shareable', 'review-required', 'local-only']),
}).strict();
export type SourceArtifact = z.infer<typeof SourceArtifactSchema>;

export const WikiPageSchema = z.object({ id: z.string().min(1), path: z.string().min(1), title: z.string().min(1), content: z.string(), parentId: z.string().nullable(), order: z.number().int().nonnegative() }).strict();
export const SharedMemorySchema = z.object({ id: z.string().min(1), type: z.enum(['episodic', 'semantic']), content: z.string().min(1), tags: z.array(z.string()), validUntil: z.string().datetime().nullable() }).strict();
export const KnowledgeRelationSchema = z.object({ id: z.string().min(1), sourceId: z.string().min(1), targetId: z.string().min(1), relation: z.string().min(1), strength: z.number().min(0).max(1) }).strict();
export const ProvenanceRecordSchema = z.object({ itemId: z.string().min(1), artifactIds: z.array(z.string().min(1)).min(1), sensitivity: z.enum(['shareable', 'review-required', 'local-only']) }).strict();
export const DeletionProposalSchema = z.object({ itemId: z.string().min(1), itemKind: z.enum(['page', 'memory', 'relation']), reason: z.string().min(1) }).strict();
export const KnowledgeItemSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('page'), value: WikiPageSchema }),
  z.object({ kind: z.literal('memory'), value: SharedMemorySchema }),
  z.object({ kind: z.literal('relation'), value: KnowledgeRelationSchema }),
]);
export const KnowledgeBundleSchema = z.object({
  schemaVersion: z.literal('knowledge-bundle@1'), recipeVersion: z.string().regex(/^[a-z-]+@1$/u),
  spaceId: z.string().min(1), baseRevision: z.string().min(1), pages: z.array(WikiPageSchema),
  memories: z.array(SharedMemorySchema), relations: z.array(KnowledgeRelationSchema),
  provenance: z.array(ProvenanceRecordSchema), deletions: z.array(DeletionProposalSchema),
}).strict().superRefine((bundle, context) => {
  for (const record of bundle.provenance) if (record.sensitivity === 'local-only') context.addIssue({ code: z.ZodIssueCode.custom, message: 'local-only provenance cannot enter a KnowledgeBundle' });
});
export type KnowledgeBundle = z.infer<typeof KnowledgeBundleSchema>;
export const ValidationIssueSchema = z.object({ itemId: z.string(), rule: z.string(), artifactIds: z.array(z.string()), repairable: z.boolean(), message: z.string() }).strict();
export type ValidationIssue = z.infer<typeof ValidationIssueSchema>;
```

Create reusable fixtures with these exact exports so later task tests do not invent incompatible shapes:

```ts
export const artifactFixtures = (): SourceArtifact[] => [SourceArtifactSchema.parse({
  schemaVersion: 'source-artifact@1', artifactId: 'artifact-core', adapterId: 'fixture', adapterVersion: '1.0.0',
  sourceId: 'source-1', logicalKey: 'module/core', contentHash: 'a'.repeat(64), updatedAt: '2026-07-30T00:00:00.000Z',
  kind: 'code', content: { title: 'Core', body: 'Derived core knowledge' },
  evidence: [{ sourcePath: 'src/core.ts', locator: 'Core' }], sensitivity: 'shareable',
})];
export const organizedPageFixture = () => ({ kind: 'page' as const, value: { id: 'page-core', path: 'core.md', title: 'Core', content: '# Core\n', parentId: null, order: 0 } });
export const bundleFixture = (overrides: Partial<KnowledgeBundle> = {}): KnowledgeBundle => KnowledgeBundleSchema.parse({
  schemaVersion: 'knowledge-bundle@1', recipeVersion: 'code-wiki@1', spaceId: 'space-1', baseRevision: '0',
  pages: [organizedPageFixture().value], memories: [], relations: [],
  provenance: [{ itemId: 'page-core', artifactIds: ['artifact-core'], sensitivity: 'shareable' }], deletions: [], ...overrides,
});
```

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm --filter @neomei/agentwiki-local-sync test -- protocol.spec.ts && pnpm --filter @neomei/agentwiki-local-sync typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/local-sync/src/protocol.ts packages/local-sync/src/canonical-json.ts packages/local-sync/src/protocol.spec.ts packages/local-sync/src/testing/protocol-fixtures.ts
git commit -m "feat(local-sync): define knowledge protocol"
```

### Task 2: Atomic per-Space local workspace

**Files:**
- Create: `packages/local-sync/src/atomic-files.ts`
- Create: `packages/local-sync/src/space-workspace.ts`
- Create: `packages/local-sync/src/space-workspace.spec.ts`

**Interfaces:**
- Consumes: `KnowledgeBundle` from Task 1.
- Produces: `SpaceWorkspace.open(home, spaceId)`, `readManifest()`, `materialize(bundle, revisionId)`, `readLocalBundle()`, `saveBase(bundle, revisionId)`.

- [ ] **Step 1: Write failing workspace tests**

```ts
it('materializes a complete revision atomically and keeps state private', async () => {
  const workspace = SpaceWorkspace.open(home, 'space-1');
  await workspace.materialize(bundleFixture({ baseRevision: '6' }), '7');
  await expect(readFile(join(home, '.agentwiki/spaces/space-1/wiki/pages/core.md'), 'utf8')).resolves.toContain('Core');
  expect((await stat(join(home, '.agentwiki/spaces/space-1/.state/manifest.json'))).mode & 0o777).toBe(0o600);
  expect((await workspace.readManifest()).currentRevision).toBe('7');
});
```

- [ ] **Step 2: Verify failure**

Run: `pnpm --filter @neomei/agentwiki-local-sync test -- space-workspace.spec.ts`

Expected: FAIL because `SpaceWorkspace` does not exist.

- [ ] **Step 3: Implement the workspace boundary**

Use this exact manifest and public API:

```ts
export interface SpaceManifest {
  schemaVersion: 1;
  spaceId: string;
  currentRevision: string;
  lastPulledRevision: string;
  localBundleHash: string;
  updatedAt: string;
}

export class SpaceWorkspace {
  static open(home: string, spaceId: string): SpaceWorkspace;
  readManifest(): Promise<SpaceManifest>;
  readLocalBundle(): Promise<KnowledgeBundle>;
  readBase(): Promise<KnowledgeBundle>;
  saveDraft(jobId: string, bundle: KnowledgeBundle): Promise<void>;
  saveBase(bundle: KnowledgeBundle, revisionId: string): Promise<void>;
  materialize(bundle: KnowledgeBundle, revisionId: string): Promise<void>;
}
```

`materialize` must write a sibling temporary tree, fsync files where supported, rename the old `wiki/` to a rollback name, rename the new tree to `wiki/`, update `.state/base/bundle.json` and `manifest.json`, then remove rollback data. Reject page paths containing absolute paths, `..`, NUL, or duplicate normalized paths. Write directories with `0700` and state files with `0600`.

- [ ] **Step 4: Run workspace tests**

Run: `pnpm --filter @neomei/agentwiki-local-sync test -- space-workspace.spec.ts`

Expected: PASS, including rollback-on-injected-rename-failure and traversal rejection cases.

- [ ] **Step 5: Commit**

```bash
git add packages/local-sync/src/atomic-files.ts packages/local-sync/src/space-workspace.ts packages/local-sync/src/space-workspace.spec.ts
git commit -m "feat(local-sync): add atomic space workspace"
```

### Task 3: Versioned recipes and deterministic validation

**Files:**
- Create: `packages/local-sync/src/recipes.ts`
- Create: `packages/local-sync/src/validation.ts`
- Create: `packages/local-sync/src/validation.spec.ts`

**Interfaces:**
- Produces: `Recipe`, `getRecipe(id)`, `validateKnowledgeBundle(bundle, artifacts, recipe)`.
- Consumers: the orchestrator and conflict engine.

- [ ] **Step 1: Write failing validation tests**

Cover exact rules: missing provenance, unknown artifact, duplicate item ID, duplicate normalized path, dangling relation, self relation, directory cycle, `local-only`, unacknowledged `review-required`, bundle over 10 MiB, and wrong base revision.

```ts
const issues = validateKnowledgeBundle(bundle, artifacts, getRecipe('code-wiki@1'), {
  expectedBaseRevision: '7', acknowledgedReviewArtifactIds: new Set(), trustedRevisionProvenanceIds: new Set(),
});
expect(issues).toContainEqual(expect.objectContaining({ rule: 'provenance.required', itemId: 'page-1', repairable: true }));
```

- [ ] **Step 2: Verify failure**

Run: `pnpm --filter @neomei/agentwiki-local-sync test -- validation.spec.ts`

Expected: FAIL because validators do not exist.

- [ ] **Step 3: Implement recipes and validators**

```ts
export interface Recipe {
  id: 'code-wiki@1' | 'document-library@1' | 'agent-memory@1' | 'space-reconcile@1' | 'three-way-merge@1';
  acceptedArtifactKinds: SourceArtifact['kind'][];
  requiredPagePaths: string[];
  maxRepairAttempts: number;
  maxBundleBytes: number;
  deletionPolicy: 'proposal-only';
}

export interface ValidationContext {
  expectedBaseRevision: string;
  acknowledgedReviewArtifactIds: Set<string>;
  trustedRevisionProvenanceIds: Set<string>;
}

export function validateKnowledgeBundle(
  input: unknown,
  artifacts: SourceArtifact[],
  recipe: Recipe,
  context: ValidationContext,
): ValidationIssue[];
```

Use `KnowledgeBundleSchema.safeParse`, build Maps/Sets once, sort issues by `itemId` then `rule`, and never mutate the input. Verify every Artifact `contentHash` against canonical `content`. Provenance IDs beginning with `revision:` are trusted only when copied from the validated base/remote Snapshot and present in `trustedRevisionProvenanceIds`; a local job cannot fabricate them. Secret scanning in this phase must flag `agk_`/`awk_` tokens, PEM private-key headers, and common assignment names (`API_KEY`, `TOKEN`, `PASSWORD`, `SECRET`) with non-empty values.

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm --filter @neomei/agentwiki-local-sync test -- validation.spec.ts && pnpm --filter @neomei/agentwiki-local-sync typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/local-sync/src/recipes.ts packages/local-sync/src/validation.ts packages/local-sync/src/validation.spec.ts
git commit -m "feat(local-sync): validate knowledge recipes"
```

### Task 4: Resumable job store and state machine

**Files:**
- Create: `packages/local-sync/src/job-state.ts`
- Create: `packages/local-sync/src/job-store.ts`
- Create: `packages/local-sync/src/orchestrator.ts`
- Create: `packages/local-sync/src/orchestrator.spec.ts`

**Interfaces:**
- Produces: `KnowledgeJob`, `KnowledgeWorkItem`, `KnowledgeOrchestrator.start`, `.next`, `.submit`, `.validate`, `.preview`.
- The network `PUSH` transition remains deliberately unavailable until Plan 4.

- [ ] **Step 1: Write failing state-machine tests**

```ts
it('resumes at the first incomplete work item and never skips confirmation', async () => {
  const first = await orchestrator.start({ spaceId: 'space-1', recipeId: 'code-wiki@1', source: { adapterId: 'fixture', input: '/repo' } });
  await orchestrator.recordArtifacts(first.id, artifactFixtures());
  const item = await orchestrator.next(first.id);
  await orchestrator.submit(first.id, item!.id, organizedPageFixture());
  const resumed = await createOrchestrator(home).get(first.id);
  expect(resumed.stage).toBe('ORGANIZE');
  const preview = await orchestrator.preview(first.id);
  expect(preview.stage).toBe('PREVIEW');
  expect(preview).not.toHaveProperty('upload');
});
```

- [ ] **Step 2: Verify failure**

Run: `pnpm --filter @neomei/agentwiki-local-sync test -- orchestrator.spec.ts`

Expected: FAIL because orchestration files do not exist.

- [ ] **Step 3: Implement exact state and transition API**

```ts
export type JobStage = 'DISCOVER' | 'COLLECT' | 'ORGANIZE' | 'VALIDATE' | 'PREVIEW' | 'CONFIRM' | 'PUSH' | 'MATERIALIZE' | 'COMPLETED' | 'FAILED';
export interface KnowledgeJob {
  schemaVersion: 1; id: string; spaceId: string; recipeId: Recipe['id']; stage: JobStage;
  baseRevision: string; source: { adapterId: string; input: string };
  workItems: KnowledgeWorkItem[]; repairAttempts: Record<string, number>;
  previewNonce?: string; previewExpiresAt?: string; createdAt: string; updatedAt: string;
}
export interface KnowledgeWorkItem {
  id: string; artifactIds: string[]; status: 'pending' | 'submitted' | 'invalid' | 'valid';
  outputItemIds: string[]; issues: ValidationIssue[];
}
```

Persist each transition through `JobStore.compareAndWrite(jobId, expectedUpdatedAt, nextJob)` using atomic rename. Work-item IDs are `sha256(recipeId + sorted artifactIds).slice(0, 24)`. Reject stale writes, out-of-order submits, duplicate output IDs, expired previews, and repairs after the Recipe maximum.

- [ ] **Step 4: Run orchestration tests**

Run: `pnpm --filter @neomei/agentwiki-local-sync test -- orchestrator.spec.ts`

Expected: PASS for crash recovery, stale writer rejection, bounded repair, and preview expiry.

- [ ] **Step 5: Commit**

```bash
git add packages/local-sync/src/job-state.ts packages/local-sync/src/job-store.ts packages/local-sync/src/orchestrator.ts packages/local-sync/src/orchestrator.spec.ts
git commit -m "feat(local-sync): add resumable knowledge jobs"
```

### Task 5: Expose offline orchestration through MCP

**Files:**
- Modify: `packages/local-sync/src/mcp.ts`
- Modify: `packages/local-sync/src/cli.ts`
- Create: `packages/local-sync/src/mcp-orchestrator.spec.ts`
- Modify: `packages/local-sync/skill/SKILL.md`

**Interfaces:**
- Consumes: the Task 4 orchestrator.
- Produces MCP tools: `start_knowledge_job`, `get_next_work_item`, `read_artifacts`, `submit_organized_item`, `validate_knowledge_job`, `preview_knowledge_job`.

- [ ] **Step 1: Write failing MCP registration tests**

Assert that all six tool names are registered, each rejects unknown keys, and `preview_knowledge_job` returns counts plus sensitivity warnings but never an upload command or credential.

- [ ] **Step 2: Verify failure**

Run: `pnpm --filter @neomei/agentwiki-local-sync test -- mcp-orchestrator.spec.ts`

Expected: FAIL because the new tools are absent.

- [ ] **Step 3: Register the exact tool contracts**

```ts
start_knowledge_job: { spaceId: z.string().min(1), path: z.string().min(1), recipeId: z.enum(['code-wiki@1', 'document-library@1', 'agent-memory@1']) }
get_next_work_item: { jobId: z.string().uuid() }
read_artifacts: { jobId: z.string().uuid(), workItemId: z.string().min(1) }
submit_organized_item: { jobId: z.string().uuid(), workItemId: z.string().min(1), items: z.array(KnowledgeItemSchema).min(1), provenance: z.array(ProvenanceRecordSchema).min(1) }
validate_knowledge_job: { jobId: z.string().uuid(), acknowledgedReviewArtifactIds: z.array(z.string()).default([]) }
preview_knowledge_job: { jobId: z.string().uuid() }
```

Keep legacy `0.1.x` tools behind their existing command names during development; do not advertise them in the `0.2.0` Skill. Update the Skill to instruct the Agent to loop only while a work item is returned, repair only listed invalid item IDs, show preview verbatim, and stop for confirmation.

- [ ] **Step 4: Run the phase gate**

Run:

```bash
pnpm --filter @neomei/agentwiki-local-sync test
pnpm --filter @neomei/agentwiki-local-sync typecheck
pnpm lint
pnpm --filter @neomei/agentwiki-local-sync build
```

Expected: all commands exit `0`; an offline fixture reaches `PREVIEW` with no HTTP request.

- [ ] **Step 5: Commit**

```bash
git add packages/local-sync/src/mcp.ts packages/local-sync/src/cli.ts packages/local-sync/src/mcp-orchestrator.spec.ts packages/local-sync/skill/SKILL.md
git commit -m "feat(local-sync): expose knowledge orchestration tools"
```
