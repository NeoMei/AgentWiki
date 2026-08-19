# CodeGraph Stage 1 Final Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the final Stage 1 privacy, deletion, storage, home-consistency, and concurrent-scan gaps found by the repository-wide audit.

**Architecture:** Keep full scan capabilities internal, return a redacted gateway plan, and serialize the confirmed scanner-to-artifact lifecycle by source key. Harden snapshot persistence with the same private-root invariants as generated knowledge, and preserve all document items that lack strict current-source ownership.

**Tech Stack:** TypeScript, Node.js 24/26 contracts, Vitest, Zod, filesystem `FileHandle` APIs, existing `SourceLock`, MCP gateway, pnpm.

## Global Constraints

- CodeGraph remains independently installed and version-decoupled; AgentWiki never installs, upgrades, downgrades, bundles, or reads its SQLite database.
- `analysisMode: standard` is deterministic and never invokes Agent/LLM/deep behavior; Stage 2 remains unimplemented.
- Never expose or upload raw source, `.codegraph`, binaries, credentials, absolute paths, executable paths, or local diagnostics.
- Repository mutation requires an exact current `localScanPlanHash`; remote synchronization requires a separate exact Preview confirmation.
- Preserve all Task 1–10 changes and package hardening; do not reset, checkout, stage, commit, publish, or deploy.

---

### Task 1: Seal public planning and deletion boundaries

**Files:**
- Modify: `packages/local-sync/src/codegraph/contracts.ts`
- Modify: `packages/local-sync/src/codegraph/contracts.spec.ts`
- Modify: `packages/local-sync/src/codegraph/scan-plan.ts`
- Modify: `packages/local-sync/src/gateway/entry.ts`
- Modify: `packages/local-sync/src/gateway/entry.spec.ts`
- Modify: `packages/local-sync/src/gateway/server.spec.ts`
- Modify: `packages/local-sync/src/gateway/workflow-runtime.ts`
- Modify: `packages/local-sync/src/gateway/workflow-runtime.spec.ts`
- Modify: `packages/local-sync/package.json`
- Modify: `packages/local-sync/src/codegraph/package-boundary.spec.ts`
- Modify: `scripts/node-runtime-contract.test.mjs`

**Interfaces:**
- Produces: `PublicLocalScanPlanSchema` and `publicLocalScanPlan(plan: LocalScanPlan): PublicLocalScanPlan`.
- Public source records contain only `sourceKey`, `displayPath`, `action`, `indexState`, and `estimatedFiles`.
- `local_scan_sources` returns `{ plan: PublicLocalScanPlan | null, localScanPlanHash: string | null }`.
- Every mutable CodeGraph subpath, including `./dist/codegraph/index.js` and `./dist/codegraph/generated-store.js`, is absent and must resolve as `ERR_PACKAGE_PATH_NOT_EXPORTED`.

- [ ] **Step 1: Write RED gateway and schema tests**

Construct a full plan containing sentinel absolute canonical/index/executable paths. Assert the gateway/MCP response parses through `PublicLocalScanPlanSchema`, retains the exact hash and safe planning fields, and contains none of the sentinels.

- [ ] **Step 2: Run the focused tests and verify the current full plan leaks**

Run:

```bash
pnpm --filter @neomei/agentwiki-local-sync exec vitest run src/codegraph/contracts.spec.ts src/gateway/entry.spec.ts src/gateway/server.spec.ts
```

Expected: FAIL because `canonicalSourcePath`, `indexPath`, and `executableIdentity` are still returned.

- [ ] **Step 3: Implement the strict public plan DTO**

Add a strict Zod schema and a single conversion function. The converter must reconstruct a new object from allowlisted fields; it must not delete fields from or spread a full plan.

```ts
export const PublicCodeGraphSourcePlanSchema = CodeGraphSourcePlanSchema.pick({
  sourceKey: true,
  displayPath: true,
  action: true,
  indexState: true,
  estimatedFiles: true,
}).strict();

export const PublicLocalScanPlanSchema = LocalScanPlanSchema.pick({
  schemaVersion: true,
  provider: true,
  detectedVersion: true,
  capabilities: true,
  analysisMode: true,
  limits: true,
  localScanPlanHash: true,
}).extend({ sources: z.array(PublicCodeGraphSourcePlanSchema) }).strict();

export function publicLocalScanPlan(plan: LocalScanPlan): PublicLocalScanPlan {
  return PublicLocalScanPlanSchema.parse({
    schemaVersion: plan.schemaVersion,
    provider: plan.provider,
    detectedVersion: plan.detectedVersion,
    capabilities: plan.capabilities,
    analysisMode: plan.analysisMode,
    limits: plan.limits,
    localScanPlanHash: plan.localScanPlanHash,
    sources: plan.sources.map(({ sourceKey, displayPath, action, indexState, estimatedFiles }) => ({
      sourceKey, displayPath, action, indexState, estimatedFiles,
    })),
  });
}
```

- [ ] **Step 4: Write RED document retention tests**

Prepare a base bundle containing a manual page, a strict CodeGraph base page, a strict deep page, and a page from another document source. Run a documents-only prepare that emits none of them. Assert zero deletion proposals and exact carry-forward of all four items.

- [ ] **Step 5: Remove unowned document absence deletion**

Merge current document additions/updates into the base bundle and carry unmatched base pages, memories, relations, and provenance. Do not infer ownership from paths, titles, adapter names, or missing artifacts.

```ts
function mergeDocumentBundle(base: KnowledgeBundle, current: KnowledgeBundle): KnowledgeBundle {
  return mergeBundleItemsByStableId({
    base,
    current,
    deletions: current.deletions,
    preserveUnmatchedBase: true,
  });
}
```

The implementation may use the repository's existing deterministic merge helpers instead of introducing `mergeBundleItemsByStableId`, but the result must sort canonically, reject conflicting duplicate IDs, update matching current IDs, and retain every unmatched base item and its provenance.

- [ ] **Step 6: Write RED package-boundary tests and remove the mutable export**

Assert Node resolution/import of `@neomei/agentwiki-local-sync/dist/codegraph/index.js` and `generated-store.js` fails with `ERR_PACKAGE_PATH_NOT_EXPORTED`, including percent-encoded variants. Internal relative imports continue to work; no external facade import is documented.

- [ ] **Step 7: Verify Task 1**

Run focused tests, the Node runtime contract, package build/pack, local-sync full tests, typecheck, lint, and `git diff --check`. Expected: all pass and no retired or private local path surface is exported.

---

### Task 2: Harden snapshot persistence and bind runtime home

**Files:**
- Modify: `packages/local-sync/src/codegraph/snapshot-store.ts`
- Modify: `packages/local-sync/src/codegraph/snapshot-store.spec.ts`
- Modify: `packages/local-sync/src/codegraph/source-lock.ts`
- Modify: `packages/local-sync/src/codegraph/source-lock.spec.ts`
- Modify: `packages/local-sync/src/codegraph/generated-store-core.ts`
- Modify: `packages/local-sync/src/codegraph/generated-store.ts`
- Modify: `packages/local-sync/src/codegraph/pipeline.ts`
- Modify: `packages/local-sync/src/codegraph/pipeline.spec.ts`
- Modify: `packages/local-sync/src/gateway/entry.ts`
- Modify: `packages/local-sync/src/onboarding/runtime.ts`
- Modify: `scripts/codegraph-standard-scan-e2e.test.mjs`

**Interfaces:**
- Produces an internal source-lock lease accepted only by lease-bound snapshot read/write operations.
- Safe public-in-module `read`/`write` acquire the source lock themselves; provider/pipeline operations use the lease-bound variants.
- `CodeGraphPipelineOptions` receives `home: string`; its default generated store is created from that exact private root without mutating `process.env.HOME`.

- [ ] **Step 1: Write RED filesystem attack tests**

Cover symlinks at `.agentwiki`, `workspaces`, `<sourceKey>`, and `codegraph`; ancestor swaps before staging creation/write, current-to-backup, staging-to-current, read, rollback, recovery, and cleanup; foreign staging/backup lookalikes; and missing/zero `O_NOFOLLOW`/`O_DIRECTORY`. Assert the external sentinel tree is byte-for-byte unchanged.

- [ ] **Step 2: Verify RED against the current store**

Run `snapshot-store.spec.ts`. Expected: symlink/ancestor-swap cases write outside the private root or fail without the required safe invariant.

- [ ] **Step 3: Implement private-root and handle-based storage**

Create/verify a `0700` private directory chain, record device/inode identities, use `O_NOFOLLOW` and handle stats for files, revalidate the chain around every mutation, and clean up only identity-matching operation-owned paths. Keep per-document/file and total size limits enforced before promotion.

```ts
type DirectoryIdentity = Readonly<{ path: string; dev: bigint; ino: bigint }>;

async function assertDirectoryIdentity(expected: DirectoryIdentity): Promise<void> {
  const current = await lstat(expected.path, { bigint: true });
  if (!current.isDirectory() || current.isSymbolicLink()
      || current.dev !== expected.dev || current.ino !== expected.ino) {
    throw invalidSnapshot('private snapshot directory changed', 'Directory identity mismatch');
  }
}

async function openSnapshotFile(path: string): Promise<FileHandle> {
  return open(path, constants.O_RDONLY | requiredNoFollowFlag());
}
```

- [ ] **Step 4: Add lease-aware locking**

Extend `SourceLock.withLock` to provide an opaque lease containing the exact source identity/token. Snapshot safe methods acquire it; lease-bound methods validate it and do not reacquire. Add stale/foreign/release/concurrency tests and run the existing lock suite repeatedly.

```ts
declare const sourceLeaseBrand: unique symbol;
export type SourceLockLease = Readonly<{
  sourceKey: string;
  token: string;
  [sourceLeaseBrand]: true;
}>;

withLock<T>(sourceKey: string, work: (lease: SourceLockLease) => Promise<T>): Promise<T>;

read(sourceKey: string): Promise<StoredCodeSnapshot | null>;
readWithLease(sourceKey: string, lease: SourceLockLease): Promise<StoredCodeSnapshot | null>;
write(snapshot: NormalizedCodeSnapshot): Promise<CodeSnapshotManifest>;
writeWithLease(snapshot: NormalizedCodeSnapshot, lease: SourceLockLease): Promise<CodeSnapshotManifest>;
```

- [ ] **Step 5: Write RED injected-home tests**

Construct gateway and onboarding pipelines with a disposable `home` while the process home points elsewhere. Assert snapshots, generated base/publish data, Preview, and client configuration exist only below the injected home and the global home remains untouched.

- [ ] **Step 6: Bind the generated store to runtime home**

Use a package-internal factory/core path to construct generated storage from the explicit runtime home. Do not expose caller-selected roots through the published facade and do not modify `process.env.HOME`.

```ts
// Package-internal module; not listed in package.json exports.
export function createInternalGeneratedKnowledgeStore(home: string): GeneratedKnowledgeStoreLike {
  return new GeneratedKnowledgeStoreCore({ workspaceRoot: join(home, '.agentwiki', 'workspaces') });
}

new CodeGraphPipeline({
  home: deps.home,
  provider: createCodeGraphProvider({ home: deps.home }),
});
```

- [ ] **Step 7: Verify Task 2**

Run snapshot/store/source-lock/pipeline/gateway/onboarding focused tests, source-lock at least three times, real gated CodeGraph E2E, local-sync full twice, typecheck, lint, build, and diff check.

---

### Task 3: Hold a source transaction through artifact publication

**Files:**
- Modify: `packages/local-sync/src/codegraph/provider.ts`
- Modify: `packages/local-sync/src/codegraph/provider.spec.ts`
- Modify: `packages/local-sync/src/codegraph/pipeline.ts`
- Modify: `packages/local-sync/src/codegraph/pipeline.spec.ts`
- Modify: `packages/local-sync/src/codegraph/snapshot-store.ts`
- Modify: `packages/local-sync/src/codegraph/source-lock.ts`
- Modify: `packages/local-sync/src/gateway/knowledge-workflows.spec.ts`
- Modify: `packages/local-sync/src/gateway/workflow-runtime.spec.ts`
- Modify: `scripts/codegraph-standard-scan-e2e.test.mjs`
- Modify: `docs/verification/codegraph-standard-scan-cutover.md`

**Interfaces:**
- Replaces standalone mutable execution with an internal generic callback operation equivalent to `withConfirmedSnapshots<T>(plan, consume): Promise<T>`.
- The callback receives validated immutable snapshot values and runs before any acquired source lease is released.
- Multi-source leases are acquired in code-unit-sorted source-key order and released in reverse order.

- [ ] **Step 1: Write RED controlled concurrency tests**

Use barriers to pause scan A after snapshot A, start scan B for the same source, and assert B cannot execute or publish until A's artifact adaptation returns. Then reverse the schedule and assert each caller's artifact snapshot hash/body matches its own confirmed scan. Add a different-source case proving independent progress and a reversed multi-source-order case proving no deadlock.

- [ ] **Step 2: Verify the current interleaving fails**

Run provider/pipeline focused tests. Expected: B advances after provider execution releases its lock, and A may observe/publish B's current generated set.

- [ ] **Step 3: Implement the callback transaction**

Move sorted lease acquisition around scanner mutation, snapshot persistence/read, pipeline analysis, generated base writes, batch promotion, and artifact adaptation. Remove or make unreachable any package-consumable standalone execute path. On callback failure, return no artifacts and preserve the last complete snapshot/generated publish.

```ts
export interface ConfirmedCodeSnapshot {
  sourceKey: string;
  snapshotHash: string;
  files: number;
  snapshot: Readonly<StoredCodeSnapshot>;
}

export interface CodeGraphProvider {
  plan(input: PlanCodeScanInput): Promise<LocalScanPlan | null>;
  diagnose(input?: CodeGraphDiagnosisInput): Promise<CodeGraphDiagnosis>;
  withConfirmedSnapshots<T>(
    plan: LocalScanPlan,
    consume: (snapshots: readonly ConfirmedCodeSnapshot[]) => Promise<T>,
  ): Promise<T>;
}

return provider.withConfirmedSnapshots(plan, async (snapshots) => {
  const prepared = snapshots.map(analyzeConfirmedSnapshot);
  await writeEveryGeneratedBase(prepared);
  return generatedStore.withPublishedBatch(sourceKeys, adaptEveryValidatedPublish);
});
```

- [ ] **Step 4: Verify hash and failure behavior**

Add tests for plan drift before locking, scanner drift after confirmation, callback failure rollback, one source failing in a multi-source transaction, and no stale/mixed return values.

- [ ] **Step 5: Run the final matrix**

Run:

```bash
pnpm lint
pnpm typecheck
AGENTWIKI_CODEGRAPH_E2E=1 node --test scripts/codegraph-standard-scan-e2e.test.mjs
node --test scripts/onboarding-e2e.test.mjs
pnpm --filter @neomei/agentwiki-local-sync test
pnpm --filter @neomei/agentwiki-local-sync build
node --test scripts/node-runtime-contract.test.mjs
pnpm build
git diff --check
```

Expected: all commands pass. Run the same-source concurrency suite and full local-sync suite repeatedly before review.

- [x] **Step 6: Update verification evidence**

Recorded the redacted public-plan shape, snapshot filesystem attack matrix, injected-home paths, same-source concurrency barriers, real CodeGraph counts, and three-client results. The former loopback HTTP and Node 26 limitations were subsequently closed on the final unrestricted runner and are recorded in the verification report.

---

## Final Review Gate

- [x] Independent privacy/package reviewer approves with zero Critical/Important/Minor.
- [x] Independent concurrency/reconciliation reviewer approves with zero Critical/Important/Minor.
- [x] Independent release-evidence reviewer confirms the complete matrix, including loopback HTTP and checksum-verified Node 26 evidence, with zero Critical/Important/Minor.
