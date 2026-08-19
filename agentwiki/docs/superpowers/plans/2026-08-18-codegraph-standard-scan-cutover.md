# CodeGraph Standard Scan Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace every active Codebase Memory code-scan path with a confirmed, deterministic CodeGraph standard scan that produces AgentWiki-owned snapshots and shareable derived knowledge without coupling the two products' versions.

**Architecture:** A local `CodeGraphProvider` discovers an independently installed CodeGraph executable, negotiates CLI capabilities, creates a read-only scan plan, and mutates `.codegraph/` only after the exact plan is confirmed. It normalizes `status --json` and `files --json` into `agentwiki-code-snapshot@1`; deterministic analyzers write private generated knowledge, and a generated adapter feeds the existing `SourceArtifact -> KnowledgeBundle -> Preview -> confirmation -> sync` path. CodeGraph is never installed or upgraded by AgentWiki, and Codebase Memory has no fallback path.

**Tech Stack:** TypeScript, Node.js 24/26, Zod, Vitest, Node test runner, MCP SDK, pnpm, independently installed CodeGraph CLI.

## Global Constraints

- Implement against the approved design in `docs/superpowers/specs/2026-08-18-codegraph-local-code-analysis-design.md`.
- Standard mode is the default and must never call an Agent, LLM, semantic query, or deep-analysis driver.
- AgentWiki must not add `@colbymchenry/codegraph` to any dependency, devDependency, lockfile entry, install script, or managed runtime catalog.
- Compatibility is determined from observable commands and JSON result shapes. The detected CodeGraph version is diagnostic evidence, never an exact allowlist or release-number dependency.
- `local_scan_sources` is read-only. `codegraph init` and `codegraph sync` may run only after `confirmedLocalScan: true` and a matching `localScanPlanHash`.
- Never read `.codegraph` SQLite tables. Never upload `.codegraph`, a normalized snapshot, raw source, binaries, credentials, absolute paths, or local diagnostic files.
- Generated and snapshot state lives below `~/.agentwiki/workspaces/<source-key>/`; the selected repository receives only CodeGraph-owned `.codegraph/` data.
- Do not edit `.gitignore`, Git configuration, or source files as part of scanning.
- Preserve the existing server-side Preview, explicit sync confirmation, ChangeSet, review, and revision semantics.
- This 2026-08-18 migration requirement is superseded by the approved 2026-08-19 final hardening rule: historical Codebase Memory data has no verifiable legacy ownership marker, so legacy-looking items must carry forward with a stable opaque migration-candidate warning and zero deletion proposal. Only a future, separately specified strict verifiable legacy-marker contract may propose deletion; new CodeGraph additions still require Preview before sync.
- Historical plans and verification evidence may retain historical Codebase Memory references. Active runtime source, active package documentation, the shared Skill, and current runtime contracts must not.
- Preserve unrelated working-tree changes. Stage and commit only the files named in the current task.

---

### Task 1: Lock the public scan and snapshot contracts

**Files:**
- Create: `packages/local-sync/src/codegraph/contracts.ts`
- Create: `packages/local-sync/src/codegraph/contracts.spec.ts`
- Create: `packages/local-sync/src/codegraph/scan-plan.ts`
- Create: `packages/local-sync/src/codegraph/scan-plan.spec.ts`
- Modify: `packages/local-sync/src/onboarding/errors.ts`
- Create: `packages/local-sync/src/onboarding/errors.spec.ts`
- Modify: `packages/local-sync/src/protocol/index.ts`

**Interfaces:**
- Produces the scanner-independent schemas used by every later task:

```ts
export const AnalysisModeSchema = z.enum(['standard', 'deep']);
export type AnalysisMode = z.infer<typeof AnalysisModeSchema>;

export const CodeGraphCapabilitiesSchema = z.object({
  required: z.object({
    'index.status': z.boolean(),
    'index.sync': z.boolean(),
    'files.list': z.boolean(),
  }).strict(),
  optional: z.object({
    'symbols.list': z.boolean(),
    'relations.read': z.boolean(),
    'semantic.explore': z.boolean(),
    'impact.read': z.boolean(),
    'routes.read': z.boolean(),
  }).strict(),
}).strict();

export const CodeGraphSourcePlanSchema = z.object({
  sourceKey: z.string().regex(/^[a-f0-9]{64}$/u),
  displayPath: z.string().min(1),
  canonicalSourcePath: z.string().min(1), // local-only; never enters publish output
  indexPath: z.string().min(1),
  action: z.enum(['none', 'init', 'sync', 'rebuild']),
  indexState: z.enum(['missing', 'ready', 'stale', 'incomplete', 'failed']),
  estimatedFiles: z.number().int().nonnegative(),
}).strict();

export const LocalScanPlanSchema = z.object({
  schemaVersion: z.literal('agentwiki-local-scan-plan@1'),
  provider: z.literal('codegraph'),
  executableIdentity: z.string().min(1),
  detectedVersion: z.string().min(1),
  capabilities: CodeGraphCapabilitiesSchema,
  analysisMode: AnalysisModeSchema,
  sources: z.array(CodeGraphSourcePlanSchema).min(1),
  limits: z.object({ maxFiles: z.number().int().positive(), maxGeneratedBytes: z.number().int().positive() }).strict(),
  localScanPlanHash: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict();

export interface StandardCodeFile {
  fileId: string;
  path: string;
  language: string;
  nodeCount: number;
  sizeBytes: number;
}
```

- `hashLocalScanPlan` hashes a canonical representation excluding only `displayPath` and the hash field itself. It includes canonical source identity, executable identity, version, capabilities, index target/state/action, analysis mode, and limits.
- Adds stable public failure codes: `CODEGRAPH_NOT_FOUND`, `CODEGRAPH_CAPABILITY_UNSUPPORTED`, `CODEGRAPH_SCAN_PLAN_CHANGED`, `CODEGRAPH_INDEX_INCOMPLETE`, `CODEGRAPH_SCAN_FAILED`, `CODE_SNAPSHOT_INVALID`, `CODE_ANALYSIS_FAILED`, and `CODE_ENRICHMENT_SKIPPED`.

- [ ] **Step 1: Write failing schema tests**

Assert that standard is accepted, unknown keys are rejected, absolute file paths and traversal paths are rejected from normalized file records, missing required capabilities fail, and a 64-character source key is required.

- [ ] **Step 2: Write failing canonical-hash tests**

Use two plans with reordered object keys and reordered source inputs; expect the same hash after canonical sorting. Then change executable identity, detected version, one capability, index target, mode, and one limit individually; expect a different hash for every change.

- [ ] **Step 3: Run the focused tests and verify RED**

Run:

```bash
pnpm --filter @neomei/agentwiki-local-sync test -- src/codegraph/contracts.spec.ts src/codegraph/scan-plan.spec.ts src/onboarding/errors.spec.ts
```

Expected: FAIL because the CodeGraph contracts, hash function, and failure codes do not exist.

- [ ] **Step 4: Implement the schemas and canonical hash**

Use the existing `contentHash`/stable JSON conventions where possible. Normalize source arrays by `sourceKey`, recursively sort object keys, and never place `canonicalSourcePath` in any publish schema.

- [ ] **Step 5: Run the focused tests and verify GREEN**

Expected: all new contract tests pass; malformed or extra fields fail closed.

- [ ] **Step 6: Commit the contract boundary**

```bash
git add packages/local-sync/src/codegraph/contracts.ts packages/local-sync/src/codegraph/contracts.spec.ts packages/local-sync/src/codegraph/scan-plan.ts packages/local-sync/src/codegraph/scan-plan.spec.ts packages/local-sync/src/onboarding/errors.ts packages/local-sync/src/onboarding/errors.spec.ts packages/local-sync/src/protocol/index.ts
git commit -m "feat(local-sync): define CodeGraph scan contracts"
```

---

### Task 2: Implement read-only CodeGraph discovery and scan planning

**Files:**
- Create: `packages/local-sync/src/codegraph/command-runner.ts`
- Create: `packages/local-sync/src/codegraph/provider.ts`
- Create: `packages/local-sync/src/codegraph/provider.spec.ts`
- Create: `packages/local-sync/src/codegraph/source-discovery.ts`
- Create: `packages/local-sync/src/codegraph/source-discovery.spec.ts`
- Create: `packages/local-sync/src/codegraph/index.ts`

**Interfaces:**

```ts
export interface CodeGraphCommandRunner {
  run(command: string, args: string[], options: {
    cwd?: string;
    timeoutMs: number;
    maxBufferBytes: number;
  }): Promise<{ stdout: string; stderr: string; exitCode: number }>;
}

export interface PlanCodeScanInput {
  sourcePaths: string[];
  sourceType: 'auto' | 'code' | 'documents';
  analysisMode: 'standard' | 'deep';
}

export interface CodeGraphProvider {
  plan(input: PlanCodeScanInput): Promise<LocalScanPlan | null>;
  execute(plan: LocalScanPlan): Promise<CodeSnapshotReference[]>;
}
```

- Discovery order is explicit `AGENTWIKI_CODEGRAPH_BIN`, then `codegraph` on `PATH`.
- Executable identity uses the resolved executable path plus stable file metadata; it must not hash or upload the executable contents.
- Required capability probes use documented surfaces only: `--version`, `status --help`, `sync --help`, and `files --help`. `status --json <path>` may inspect index state. Planning must never call `init`, `sync`, `index`, or any write command.
- `source-discovery.ts` performs a bounded filename-only inspection for `sourceType: auto`; it treats code manifests/extensions as code and document extensions as documents without reading file bodies.
- Reject a source root that is not a real directory, resolves to a filesystem root/home directory, or contains a `.codegraph` symlink escaping `<canonical-root>/.codegraph`.

- [ ] **Step 1: Write failing discovery and no-mutation tests**

Cover explicit executable, PATH executable, missing executable, non-zero `--version`, a source with no code, and a mixed source. Assert the fake runner's command log contains no `init`, `sync`, or `index` during `plan()`.

- [ ] **Step 2: Write failing result-shape compatibility tests**

Provide at least these compatible status/file shapes:

```ts
{ initialized: true, fileCount: 12, pendingChanges: { added: 0, modified: 0, removed: 0 }, index: { state: 'complete', pendingRefs: 0 } }
{ initialized: true, files: 12, indexState: 'complete', pendingRefs: 0 }
```

Unknown fields must be ignored; missing core fields must produce `CODEGRAPH_CAPABILITY_UNSUPPORTED` or `CODEGRAPH_INDEX_INCOMPLETE`, not a guessed plan.

- [ ] **Step 3: Write failing path-security tests**

Use temporary directories to test `..`, a home/root source, an in-repository `.codegraph` directory, an in-repository symlink, and an escaping symlink. The normal directory is accepted; unsafe roots and escaping symlinks are rejected before any CodeGraph mutation.

- [ ] **Step 4: Run the provider tests and verify RED**

```bash
pnpm --filter @neomei/agentwiki-local-sync test -- src/codegraph/provider.spec.ts src/codegraph/source-discovery.spec.ts
```

Expected: FAIL because planning and capability negotiation are not implemented.

- [ ] **Step 5: Implement minimal discovery, probing, normalization, and planning**

Use `execFile`, never a shell. Cap planning commands at 30 seconds and 8 MiB of output. Redact absolute paths from thrown public messages, while retaining local-only diagnostics for `doctor`.

- [ ] **Step 6: Run the provider tests and verify GREEN**

Expected: compatible JSON shapes normalize to one plan; missing required capabilities block; standard planning remains read-only.

- [ ] **Step 7: Commit the planning boundary**

```bash
git add packages/local-sync/src/codegraph/command-runner.ts packages/local-sync/src/codegraph/provider.ts packages/local-sync/src/codegraph/provider.spec.ts packages/local-sync/src/codegraph/source-discovery.ts packages/local-sync/src/codegraph/source-discovery.spec.ts packages/local-sync/src/codegraph/index.ts
git commit -m "feat(local-sync): plan CodeGraph scans without mutation"
```

---

### Task 3: Execute confirmed scans and normalize snapshot v1

**Files:**
- Create: `packages/local-sync/src/codegraph/normalizer.ts`
- Create: `packages/local-sync/src/codegraph/normalizer.spec.ts`
- Create: `packages/local-sync/src/codegraph/snapshot-store.ts`
- Create: `packages/local-sync/src/codegraph/snapshot-store.spec.ts`
- Create: `packages/local-sync/src/codegraph/source-lock.ts`
- Create: `packages/local-sync/src/codegraph/source-lock.spec.ts`
- Modify: `packages/local-sync/src/codegraph/provider.ts`
- Modify: `packages/local-sync/src/codegraph/provider.spec.ts`

**Interfaces:**

```ts
export const CodeSnapshotManifestSchema = z.object({
  schemaVersion: z.literal('agentwiki-code-snapshot@1'),
  sourceKey: z.string().regex(/^[a-f0-9]{64}$/u),
  scanner: z.object({ provider: z.literal('codegraph'), detectedVersion: z.string(), capabilities: CodeGraphCapabilitiesSchema }).strict(),
  index: z.object({ state: z.literal('complete'), indexedAt: z.string().datetime() }).strict(),
  counts: z.object({ files: z.number().int().nonnegative(), modules: z.literal(0), symbols: z.literal(0), relations: z.literal(0) }).strict(),
  datasets: z.object({ files: z.string(), modules: z.string(), symbols: z.string(), relations: z.string() }).strict(),
  snapshotHash: z.string().regex(/^[a-f0-9]{64}$/u),
  complete: z.literal(true),
  warnings: z.array(z.string()),
}).strict();
```

- Standard normalization writes sorted `files.ndjson` and empty, valid `modules.ndjson`, `symbols.ndjson`, and `relations.ndjson` files.
- Stable file IDs derive from source key plus normalized relative path, never CodeGraph internal IDs.
- The snapshot hash covers the normalized dataset hashes and scanner facts, not absolute paths or wall-clock write time.
- `execute()` must re-plan immediately before mutation and reject `CODEGRAPH_SCAN_PLAN_CHANGED` if the hash differs.
- `action: init` runs `codegraph init <source>`; `action: sync` runs `codegraph sync <source>`; `none` skips mutation. A rebuild requires a separately confirmed plan action and must not be inferred from a transient error.
- After mutation, `status --json` must be complete with zero pending refs before `files --path <source> --format flat --json` is accepted.

- [ ] **Step 1: Write failing normalization golden tests**

Add small CLI fixtures with reordered files and unknown fields. Assert byte-identical NDJSON and Markdown-facing data, forward-slash relative paths, stable IDs, sorted order, empty deep datasets, and no absolute root or CodeGraph node ID.

- [ ] **Step 2: Write failing plan revalidation and index-state tests**

Assert that a version/capability/index-target change after confirmation prevents `init`/`sync`; partial, failed, interrupted, pending-reference, and malformed statuses never write a new current snapshot.

- [ ] **Step 3: Write failing atomic-store and lock tests**

Simulate an interrupted staging write and a failed replacement. Verify the prior successful snapshot remains readable. Start two scans for the same source key and assert serialization; scans for different keys may proceed concurrently. Test stale lock recovery with a dead PID and bounded age.

- [ ] **Step 4: Run the focused tests and verify RED**

```bash
pnpm --filter @neomei/agentwiki-local-sync test -- src/codegraph/normalizer.spec.ts src/codegraph/snapshot-store.spec.ts src/codegraph/source-lock.spec.ts src/codegraph/provider.spec.ts
```

Expected: FAIL because execution, normalization, persistence, and locking are absent.

- [ ] **Step 5: Implement confirmed execution and the standard normalizer**

Use `codegraph files --path <root> --format flat --json`. Accept an array or `{ files: [...] }`; reject missing `path`, path traversal, duplicates, negative counts, oversized outputs, and more than the confirmed `maxFiles`.

- [ ] **Step 6: Implement atomic snapshot persistence**

Write to a sibling staging directory, validate every file and hash, fsync files and directory, then swap under the source lock. Keep/recover one backup until the new directory is complete. Never treat a backup or staging directory as current.

- [ ] **Step 7: Run focused tests and verify GREEN**

Expected: only complete confirmed scans advance the current snapshot; failure retains the previous snapshot for diagnostics only.

- [ ] **Step 8: Commit confirmed execution and snapshots**

```bash
git add packages/local-sync/src/codegraph/normalizer.ts packages/local-sync/src/codegraph/normalizer.spec.ts packages/local-sync/src/codegraph/snapshot-store.ts packages/local-sync/src/codegraph/snapshot-store.spec.ts packages/local-sync/src/codegraph/source-lock.ts packages/local-sync/src/codegraph/source-lock.spec.ts packages/local-sync/src/codegraph/provider.ts packages/local-sync/src/codegraph/provider.spec.ts
git commit -m "feat(local-sync): persist confirmed CodeGraph snapshots"
```

---

### Task 4: Generate deterministic base knowledge and SourceArtifacts

**Files:**
- Create: `packages/local-sync/src/codegraph/base-analyzer.ts`
- Create: `packages/local-sync/src/codegraph/base-analyzer.spec.ts`
- Create: `packages/local-sync/src/codegraph/generated-store.ts`
- Create: `packages/local-sync/src/codegraph/generated-store.spec.ts`
- Create: `packages/local-sync/src/codegraph/generated-adapter.ts`
- Create: `packages/local-sync/src/codegraph/generated-adapter.spec.ts`
- Modify: `packages/local-sync/src/codegraph/contracts.ts`
- Modify: `packages/local-sync/src/codegraph/index.ts`

**Interfaces:**

```ts
export interface GeneratedKnowledgeRecord {
  schemaVersion: 'agentwiki-generated-code-knowledge@1';
  relativePath: string;
  logicalKey: string;
  title: string;
  analysisLayer: 'base';
  sourceKey: string;
  snapshotHash: string;
  contentHash: string;
  evidenceIds: string[];
}

export interface BaseAnalysisResult {
  records: GeneratedKnowledgeRecord[];
  warnings: string[];
}
```

- Generate `architecture/overview.md` for every standard snapshot and `architecture/entry-points.md` only when deterministic filename evidence exists.
- The overview contains repository-relative statistics, languages, ecosystem/framework hints derived only from normalized filenames, index evidence, and scan completeness. It contains no raw source body or absolute path.
- Generated base files live at `~/.agentwiki/workspaces/<source-key>/generated/codegraph/base/`; the validated publish copy lives under `publish/`.
- The adapter ID is `agentwiki-codegraph-generated`; artifact metadata includes `identityKey`, `analysisLayer`, `sourceKey`, and `snapshotHash`.

- [ ] **Step 1: Write failing deterministic analyzer tests**

Feed identical snapshots with different input order and clock values; expect byte-identical Markdown. Test language counts, known manifest/config filename hints, entry-point filename hints, empty repositories, and caps. Assert no absolute source root, raw source body, or scanner-internal ID appears.

- [ ] **Step 2: Write failing generated-store safety tests**

Reject traversal paths, symlinks, oversized files, a content-hash mismatch, and writes outside the private workspace. Verify base is immutable during publish assembly and an interrupted publish retains the previous complete publish set.

- [ ] **Step 3: Write failing adapter tests**

Assert one generated Markdown file becomes one `SourceArtifact` with stable identity/evidence, `analysisLayer: base`, `snapshotHash`, `sourceKey`, `sensitivity: shareable`, and a relative `agentwiki-code-snapshot://` evidence URI.

- [ ] **Step 4: Run focused tests and verify RED**

```bash
pnpm --filter @neomei/agentwiki-local-sync test -- src/codegraph/base-analyzer.spec.ts src/codegraph/generated-store.spec.ts src/codegraph/generated-adapter.spec.ts
```

Expected: FAIL because analysis and generated storage do not exist.

- [ ] **Step 5: Implement the base analyzer and generated store**

Keep Markdown ordering fixed: title, scan evidence, repository shape, languages, ecosystem hints, entry points, warnings. Use normalized counts only.

- [ ] **Step 6: Implement the generated adapter**

Read only the validated publish manifest; never walk arbitrary generated directories. Reuse existing sensitivity and artifact ID helpers, but use CodeGraph-era logical keys such as `codegraph/architecture/overview` so the migration Preview can show an explicit replacement.

- [ ] **Step 7: Run focused tests and verify GREEN**

Expected: identical snapshots produce identical generated bytes and stable artifacts.

- [ ] **Step 8: Commit deterministic base analysis**

```bash
git add packages/local-sync/src/codegraph/base-analyzer.ts packages/local-sync/src/codegraph/base-analyzer.spec.ts packages/local-sync/src/codegraph/generated-store.ts packages/local-sync/src/codegraph/generated-store.spec.ts packages/local-sync/src/codegraph/generated-adapter.ts packages/local-sync/src/codegraph/generated-adapter.spec.ts packages/local-sync/src/codegraph/contracts.ts packages/local-sync/src/codegraph/index.ts
git commit -m "feat(local-sync): generate deterministic CodeGraph knowledge"
```

---

### Task 5: Integrate CodeGraph planning and preparation into the gateway

**Files:**
- Create: `packages/local-sync/src/codegraph/pipeline.ts`
- Create: `packages/local-sync/src/codegraph/pipeline.spec.ts`
- Modify: `packages/local-sync/src/gateway/knowledge-workflows.ts`
- Modify: `packages/local-sync/src/gateway/knowledge-workflows.spec.ts`
- Modify: `packages/local-sync/src/gateway/workflow-runtime.ts`
- Modify: `packages/local-sync/src/gateway/workflow-runtime.spec.ts`
- Modify: `packages/local-sync/src/gateway/entry.ts`
- Modify: `packages/local-sync/src/gateway/server.ts`
- Modify: `packages/local-sync/src/gateway/server.spec.ts`
- Modify: `packages/local-sync/src/gateway/manifest.ts`
- Modify: `packages/local-sync/src/gateway/manifest.spec.ts`

**Interfaces:**

```ts
export interface PrepareInput {
  spaceId: string;
  sourcePaths: string[];
  sourceType?: 'auto' | 'code' | 'documents';
  analysisMode?: 'standard' | 'deep';
  localScanPlanHash?: string;
  confirmedLocalScan?: boolean;
}

export interface CodeGraphPipeline {
  plan(input: PlanCodeScanInput): Promise<LocalScanPlan | null>;
  collect(input: {
    spaceId: string;
    sourcePaths: string[];
    sourceType: 'auto' | 'code' | 'documents';
    analysisMode: 'standard';
    localScanPlanHash: string;
    confirmedLocalScan: true;
  }): Promise<{ artifacts: SourceArtifact[]; sourceKeys: string[]; processedFiles: number; warnings: string[] }>;
}
```

- `local_scan_sources` gains `analysisMode` and returns a plan plus `localScanPlanHash`; it never creates a preview.
- `knowledge_prepare` requires the exact confirmed local plan for every code-bearing request. Document-only requests keep the MarkItDown flow and require no CodeGraph hash.
- Stage 1 rejects `analysisMode: deep` with `CODEGRAPH_CAPABILITY_UNSUPPORTED` and an actionable “deep analysis is not installed yet” next action; it must not silently downgrade to standard.
- The runtime uses `CodeGraphPipeline` for code and `AdapterManager` only for MarkItDown documents.

- [ ] **Step 1: Write failing gateway schema tests**

Assert both tools expose `analysisMode`, `localScanPlanHash`, and `confirmedLocalScan` as appropriate. Reject unknown modes and non-boolean confirmation. Keep `knowledge_confirm_and_sync` unchanged.

- [ ] **Step 2: Write failing workflow consent tests**

Cover missing confirmation, false confirmation, missing hash, stale hash, standard success, deep rejection, document-only success without a hash, and mixed input requiring a code plan. Assert every rejected case makes zero `init`/`sync` calls and zero remote calls.

- [ ] **Step 3: Write failing integration-order tests**

Assert the successful local order is `plan -> validate hash -> execute/sync -> normalize -> analyze -> publish manifest -> generated adapter -> organize -> validate -> save preview`. Assert no remote call occurs before `knowledge_confirm_and_sync`.

- [ ] **Step 4: Run focused tests and verify RED**

```bash
pnpm --filter @neomei/agentwiki-local-sync test -- src/codegraph/pipeline.spec.ts src/gateway/knowledge-workflows.spec.ts src/gateway/workflow-runtime.spec.ts src/gateway/server.spec.ts src/gateway/manifest.spec.ts
```

Expected: FAIL because the gateway does not accept or enforce scan-plan confirmation.

- [ ] **Step 5: Implement the pipeline and inject it into both gateway entry points**

Create the provider once per runtime. Pass the same instance to `scanSources` and `createKnowledgeWorkflowRuntime` so direct planning and preparation use the same compatibility logic without relying on in-memory plan state.

- [ ] **Step 6: Update MCP tool schemas and descriptions**

State explicitly that standard is default, code scans may write `.codegraph/` only after a matching confirmed plan, and deep mode requires an explicit user request plus Stage 2 support.

- [ ] **Step 7: Run focused tests and verify GREEN**

Expected: standard code and mixed workflows produce a local preview only after exact plan confirmation; documents remain functional.

- [ ] **Step 8: Commit gateway integration**

```bash
git add packages/local-sync/src/codegraph/pipeline.ts packages/local-sync/src/codegraph/pipeline.spec.ts packages/local-sync/src/gateway/knowledge-workflows.ts packages/local-sync/src/gateway/knowledge-workflows.spec.ts packages/local-sync/src/gateway/workflow-runtime.ts packages/local-sync/src/gateway/workflow-runtime.spec.ts packages/local-sync/src/gateway/entry.ts packages/local-sync/src/gateway/server.ts packages/local-sync/src/gateway/server.spec.ts packages/local-sync/src/gateway/manifest.ts packages/local-sync/src/gateway/manifest.spec.ts
git commit -m "feat(local-sync): route standard scans through CodeGraph"
```

---

### Task 6: Bind onboarding consent to the local scan plan

**Files:**
- Create: `packages/local-sync/src/onboarding/local-plan-hash.ts`
- Create: `packages/local-sync/src/onboarding/local-plan-hash.spec.ts`
- Modify: `packages/local-sync/src/onboarding/coordinator.ts`
- Modify: `packages/local-sync/src/onboarding/coordinator.spec.ts`
- Modify: `packages/local-sync/src/onboarding/runtime.ts`
- Modify: `packages/local-sync/src/onboarding/runtime.spec.ts`
- Modify: `packages/local-sync/src/onboarding/session.ts`
- Modify: `packages/local-sync/src/onboarding/session.spec.ts`
- Modify: `scripts/onboarding-e2e.mjs`
- Modify: `scripts/onboarding-e2e.test.mjs`

**Interfaces:**

```ts
export interface OnboardingCheckpoint {
  // existing fields...
  serverPlanHash?: string;
  localScanPlanHash?: string;
  onboardingPlanHash?: string;
  localScanPlan?: Record<string, unknown>;
}

export function hashOnboardingPlan(input: {
  serverPlanHash: string;
  localScanPlanHash?: string;
}): string;
```

- Keep `hashServerPlan` byte-compatible with the server. Never add local fields to the server plan or server authorization hash.
- Before the existing plan confirmation, build the read-only local plan. Show `serverPlan` and `localScanPlan` in the same preview and confirm a composite `onboardingPlanHash` that binds both distinct hashes.
- After confirmation, bootstrap still receives only `serverPlanHash`; first scan receives `localScanPlanHash` and `confirmedLocalScan: true`.
- On resume, re-plan before scan execution. A changed local plan returns `CODEGRAPH_SCAN_PLAN_CHANGED` and moves to a recoverable confirmation state instead of mutating the repository.

- [ ] **Step 1: Write failing composite-hash tests**

Assert server hash remains unchanged, the composite changes with either child hash, and document-only onboarding omits the local hash without changing server bootstrap input.

- [ ] **Step 2: Write failing coordinator tests**

Assert local planning happens before confirmation and before bootstrap; the preview contains both plans; a confirmed code onboarding passes the exact local hash into `prepare`; denial causes no bootstrap/scan; resume revalidates a stale local plan.

- [ ] **Step 3: Update the E2E harness test first and verify RED**

Make the harness answer the existing `plan` confirmation using the emitted composite hash and include `analysisMode: standard` in source inputs. Add a protocol simulation where the local plan changes and assert the CLI emits `CODEGRAPH_SCAN_PLAN_CHANGED` without reaching completion.

- [ ] **Step 4: Run focused tests and verify RED**

```bash
pnpm --filter @neomei/agentwiki-local-sync test -- src/onboarding/local-plan-hash.spec.ts src/onboarding/coordinator.spec.ts src/onboarding/runtime.spec.ts src/onboarding/session.spec.ts
node --test scripts/onboarding-e2e.test.mjs
```

Expected: FAIL because onboarding does not persist or bind the local scan plan.

- [ ] **Step 5: Implement separate hashes and resume-safe checkpoints**

Do not change protocol version or confirmation reply shape: the existing top-level `planHash` carries the composite onboarding hash. Persist the two child hashes separately for their downstream consumers.

- [ ] **Step 6: Run focused tests and verify GREEN**

Expected: onboarding preserves its three user actions while explicitly binding `.codegraph/` mutation to the confirmed combined plan.

- [ ] **Step 7: Commit onboarding consent**

```bash
git add packages/local-sync/src/onboarding/local-plan-hash.ts packages/local-sync/src/onboarding/local-plan-hash.spec.ts packages/local-sync/src/onboarding/coordinator.ts packages/local-sync/src/onboarding/coordinator.spec.ts packages/local-sync/src/onboarding/runtime.ts packages/local-sync/src/onboarding/runtime.spec.ts packages/local-sync/src/onboarding/session.ts packages/local-sync/src/onboarding/session.spec.ts scripts/onboarding-e2e.mjs scripts/onboarding-e2e.test.mjs
git commit -m "feat(local-sync): confirm CodeGraph plans during onboarding"
```

---

### Task 7: Make bundle reconciliation analysis-layer aware and preview migration

**Files:**
- Create: `packages/local-sync/src/organize/analysis-layer-reconcile.ts`
- Create: `packages/local-sync/src/organize/analysis-layer-reconcile.spec.ts`
- Modify: `packages/local-sync/src/organize/index.ts`
- Modify: `packages/local-sync/src/gateway/workflow-runtime.ts`
- Modify: `packages/local-sync/src/gateway/workflow-runtime.spec.ts`
- Modify: `packages/local-sync/src/organize/organizer.spec.ts`

**Interfaces:**

```ts
export interface ReconcileScope {
  sourceKeys: Set<string>;
  ownedLayers: Set<'base' | 'deep'>;
  migrateLegacyCodebaseMemory: boolean;
}

export function reconcileAnalysisLayers(
  base: KnowledgeBundle,
  generated: KnowledgeBundle,
  scope: ReconcileScope,
): { bundle: KnowledgeBundle; added: number; modified: number; deleted: number; carried: number };
```

- Standard scans own only matching CodeGraph `base` items.
- Carry forward base-bundle pages, memories, relations, and provenance outside the current source/layer scope.
- Carry forward every `deep` item during standard scans, even when its snapshot hash is old; surface a stale warning rather than a deletion.
- A historical Codebase Memory-looking path/title or `metadata.node` shape is not ownership proof. Historical bases have no durable, verifiable legacy producer marker, so those items are carried with an opaque migration-candidate warning and no migration deletion is proposed.
- Never treat an arbitrary unowned AgentWiki page as Codebase Memory output.

- [ ] **Step 1: Write failing ownership tests**

Create a base bundle containing a current-source base page, a current-source deep page, another source's page, a document page, a relation, and an unrelated manual page. Standard reconciliation replaces/deletes only the owned base page and carries every other item.

- [ ] **Step 2: Write failing migration Preview tests**

Create a known legacy-looking overview plus a new CodeGraph overview. Because historical data has no verifiable legacy ownership marker, expect no deletion proposal, one addition, a stable opaque migration-candidate warning, and carry-forward. Add visually similar, manual, deep, CodeGraph-owned, and foreign pages and assert they are all carried rather than deleted by migration.

- [ ] **Step 3: Write failing stale-deep tests**

When the snapshot hash changes, carry the old deep page byte-for-byte and add a warning naming its logical module identity without exposing an absolute path. Do not generate a deletion proposal.

- [ ] **Step 4: Run focused tests and verify RED**

```bash
pnpm --filter @neomei/agentwiki-local-sync test -- src/organize/analysis-layer-reconcile.spec.ts src/gateway/workflow-runtime.spec.ts src/organize/organizer.spec.ts
```

Expected: FAIL because the current runtime performs a global page-only deletion diff.

- [ ] **Step 5: Implement ownership-aware assembly and full item diffing**

Reconcile pages, memories, relations, provenance, and deletion proposals. Deduplicate by canonical item ID. Preserve the base revision and recompute upload bytes after carry-forward and deletion assembly.

- [ ] **Step 6: Run focused tests and verify GREEN**

Expected: standard scans cannot erase deep or unrelated knowledge, while the known one-time legacy migration remains previewable.

- [ ] **Step 7: Commit layer-aware migration behavior**

```bash
git add packages/local-sync/src/organize/analysis-layer-reconcile.ts packages/local-sync/src/organize/analysis-layer-reconcile.spec.ts packages/local-sync/src/organize/index.ts packages/local-sync/src/gateway/workflow-runtime.ts packages/local-sync/src/gateway/workflow-runtime.spec.ts packages/local-sync/src/organize/organizer.spec.ts
git commit -m "fix(local-sync): reconcile CodeGraph analysis by ownership"
```

---

### Task 8: Remove Codebase Memory and retire the duplicate local preparation path

**Files:**
- Delete: `packages/local-sync/src/adapter/codebase-memory.ts`
- Delete: `packages/local-sync/src/adapter/codebase-memory.spec.ts`
- Delete: `packages/local-sync/src/local-knowledge.ts`
- Delete: `packages/local-sync/src/local-knowledge.spec.ts`
- Delete: `packages/local-sync/src/mcp.ts`
- Delete: `.codebase-memory/graph.db.zst`
- Modify: `.gitignore`
- Modify: `packages/local-sync/src/adapter/index.ts`
- Modify: `packages/local-sync/src/adapter/manager.ts`
- Modify: `packages/local-sync/src/adapter/manager.spec.ts`
- Modify: `packages/local-sync/src/core/orchestrator.ts`
- Modify: `packages/local-sync/src/core/orchestrator.spec.ts`
- Modify: `packages/local-sync/src/recipes.spec.ts`
- Modify: `packages/local-sync/src/cli.spec.ts`
- Modify: `packages/local-sync/package.json`
- Modify: `scripts/node-runtime-contract.test.mjs`

**Rationale:**
- `mcp.ts` and `local-knowledge.ts` are retired, package-excluded duplicates of the current gateway workflow. Keeping them would leave a hidden Codebase Memory production path and two scanner architectures.
- `AdapterManager` remains for MarkItDown only. CodeGraph is an external provider, not a managed adapter.

- [ ] **Step 1: Add a failing active-path removal contract**

In `scripts/node-runtime-contract.test.mjs`, scan active files under `packages/local-sync/src`, `packages/local-sync/README.md`, `packages/local-sync/skill/SKILL.md`, `packages/local-sync/package.json`, and `.gitignore`. Reject `codebase-memory`, `codebase_memory`, and `codebase-memory-mcp`. Exclude historical plans, archived verification evidence, and the approved migration design. Also assert the tracked `.codebase-memory/graph.db.zst` artifact no longer exists.

- [ ] **Step 2: Update failing manager/orchestrator expectations**

Expect `AdapterManager.listManaged()` to contain only `markitdown`; expect the default code recipe to resolve to `agentwiki-codegraph-generated`; remove legacy CLI command-orchestration tests imported from `mcp.ts`.

- [ ] **Step 3: Run focused tests and verify RED**

```bash
pnpm --filter @neomei/agentwiki-local-sync test -- src/adapter/manager.spec.ts src/core/orchestrator.spec.ts src/recipes.spec.ts src/cli.spec.ts
node --test scripts/node-runtime-contract.test.mjs
```

Expected: FAIL on active Codebase Memory files, manager entries, doctor checks, and documentation.

- [ ] **Step 4: Delete the retired scanner and duplicate workflow**

Remove exports/imports, the obsolete `!dist/mcp.*` package exclusions, the tracked legacy graph artifact, and its `.gitignore` exception. Do not add a compatibility wrapper or fallback command. Leave the independently managed `.codegraph/` directory under CodeGraph ownership; do not commit its database.

- [ ] **Step 5: Update active orchestration identities**

Use `agentwiki-codegraph-generated` wherever an active recipe or work item needs the code artifact source. Keep historical recipe version strings stable unless a test proves a new recipe version is required.

- [ ] **Step 6: Run focused tests and verify GREEN**

Expected: no active runtime path can invoke, install, diagnose, or fall back to Codebase Memory.

- [ ] **Step 7: Commit complete removal**

```bash
git add -A .codebase-memory/graph.db.zst .gitignore packages/local-sync/src/adapter packages/local-sync/src/local-knowledge.ts packages/local-sync/src/local-knowledge.spec.ts packages/local-sync/src/mcp.ts packages/local-sync/src/core/orchestrator.ts packages/local-sync/src/core/orchestrator.spec.ts packages/local-sync/src/recipes.spec.ts packages/local-sync/src/cli.spec.ts packages/local-sync/package.json scripts/node-runtime-contract.test.mjs
git commit -m "refactor(local-sync): remove Codebase Memory scanner"
```

---

### Task 9: Update doctor, Node support, package docs, and Agent instructions

**Files:**
- Modify: `packages/local-sync/src/cli.ts`
- Modify: `packages/local-sync/src/cli.spec.ts`
- Modify: `packages/local-sync/package.json`
- Modify: `packages/local-sync/README.md`
- Modify: `packages/local-sync/skill/SKILL.md`
- Modify: `CONTEXT.md`
- Modify: `scripts/node-runtime-contract.test.mjs`

**Required behavior:**
- Package engine becomes `>=24 <25 || >=26 <27`.
- `doctor` reports supported Node line, CodeGraph discovery/version, required/optional capabilities, and index status for an optional source path. It does not install or upgrade CodeGraph.
- The README explains independent installation/lifecycle, scan planning, `.codegraph/` consent, standard default, private snapshot/generated directories, and exact Preview/sync boundaries.
- The shared Skill instructs the Agent to call `local_scan_sources`, show the plan/hash, get explicit confirmation, call standard `knowledge_prepare`, show the resulting Preview, and ask separately before sync. It must not request deep mode unless the user explicitly asks for deep analysis.

- [ ] **Step 1: Write failing doctor tests**

Test Node 24, 25, 26, and 27 support decisions; CodeGraph missing; required capability failure; optional capability degradation; healthy status; and diagnostic version display without an exact-version assertion.

- [ ] **Step 2: Write failing documentation/runtime contracts**

Assert the active README and Skill contain `CodeGraph`, `analysisMode: standard`, `localScanPlanHash`, and explicit scan/sync confirmations; reject any promise that AgentWiki installs/upgrades CodeGraph or automatically runs deep analysis.

- [ ] **Step 3: Run tests and verify RED**

```bash
pnpm --filter @neomei/agentwiki-local-sync test -- src/cli.spec.ts
node --test scripts/node-runtime-contract.test.mjs
```

Expected: FAIL because doctor and active guidance still describe Codebase Memory and Node `>=20`.

- [ ] **Step 4: Implement capability-based doctor checks**

Reuse the provider probe rather than duplicating version parsing. A missing optional capability is a warning/degraded check; a missing required capability is a failure with installation guidance owned by CodeGraph.

- [ ] **Step 5: Rewrite active README and Skill workflow**

Keep one AgentWiki gateway. Do not instruct users to add a second CodeGraph MCP to AgentWiki; CodeGraph may be independently installed for its own use, while AgentWiki invokes its supported local surfaces through the provider.

- [ ] **Step 6: Run tests and verify GREEN**

Expected: active docs and diagnostics match the approved ownership/consent model.

- [ ] **Step 7: Commit packaging and guidance**

```bash
git add packages/local-sync/src/cli.ts packages/local-sync/src/cli.spec.ts packages/local-sync/package.json packages/local-sync/README.md packages/local-sync/skill/SKILL.md CONTEXT.md scripts/node-runtime-contract.test.mjs
git commit -m "docs(local-sync): document independent CodeGraph scans"
```

---

### Task 10: Add real CodeGraph and three-client acceptance coverage

**Files:**
- Create: `scripts/codegraph-standard-scan-e2e.test.mjs`
- Create: `scripts/codegraph-standard-scan-fixture/README.md`
- Create: `scripts/codegraph-standard-scan-fixture/package.json`
- Create: `scripts/codegraph-standard-scan-fixture/src/index.ts`
- Modify: `scripts/onboarding-e2e.mjs`
- Modify: `scripts/onboarding-e2e.test.mjs`
- Modify: `package.json`
- Create: `docs/verification/codegraph-standard-scan-cutover.md`

**Acceptance flow:**

```text
real independent codegraph
  -> read-only plan
  -> explicit plan confirmation
  -> init/sync fixture
  -> snapshot@1
  -> generated Markdown
  -> SourceArtifact/KnowledgeBundle
  -> Preview
  -> explicit sync confirmation
  -> server review/publish
```

- [ ] **Step 1: Write a gated real-CodeGraph test**

Require `AGENTWIKI_CODEGRAPH_E2E=1`; otherwise skip with a clear reason. Copy the fixture to a temporary repository, use a temporary AgentWiki home, run the installed `codegraph`, and assert `.codegraph/` appears only after plan confirmation.

- [ ] **Step 2: Assert privacy and version decoupling in the E2E test**

Search snapshot-to-publish outputs for the temporary absolute root, raw fixture source body, `.codegraph/codegraph.db`, and executable path; expect none. Assert the npm lockfile has no AgentWiki dependency on `@colbymchenry/codegraph` and do not assert an exact detected CodeGraph version.

- [ ] **Step 3: Extend onboarding harness coverage to all clients**

Parameterize Codex, Claude Code, and OpenCode in isolated homes. Each must complete standard planning, confirmation, preview, and sync through one `agentwiki` MCP entry. Keep deep mode absent from these default flows.

- [ ] **Step 4: Run focused real acceptance**

```bash
AGENTWIKI_CODEGRAPH_E2E=1 node --test scripts/codegraph-standard-scan-e2e.test.mjs
node --test scripts/onboarding-e2e.test.mjs
```

Expected: the real scanner pipeline passes locally; the harness passes for all three clients.

- [ ] **Step 5: Run the complete verification matrix**

```bash
pnpm --filter @neomei/agentwiki-local-sync test
pnpm --filter @neomei/agentwiki-local-sync typecheck
pnpm --filter @neomei/agentwiki-local-sync build
pnpm lint
pnpm test:runtime
pnpm test
pnpm build
```

Expected: all commands exit 0. Record exact test counts, Node version, detected CodeGraph version (diagnostic only), capability result, and the real fixture snapshot counts.

- [ ] **Step 6: Run active-path audits**

```bash
rg -n "codebase-memory|codebase_memory|codebase-memory-mcp" packages/local-sync/src packages/local-sync/README.md packages/local-sync/skill packages/local-sync/package.json
rg -n '"@colbymchenry/codegraph"' package.json packages/local-sync/package.json pnpm-lock.yaml
git diff --check
git status --short
```

Expected: the first two searches return no matches; `git diff --check` is clean; only intended files remain changed.

- [ ] **Step 7: Write the verification report**

Document the confirmed plan hash behavior, real init/sync evidence, snapshot/generated paths, migration Preview counts, privacy audit, three-client results, and remaining Stage 2 non-goals. Do not claim deep analysis is implemented.

- [ ] **Step 8: Commit acceptance evidence**

```bash
git add scripts/codegraph-standard-scan-e2e.test.mjs scripts/codegraph-standard-scan-fixture scripts/onboarding-e2e.mjs scripts/onboarding-e2e.test.mjs package.json docs/verification/codegraph-standard-scan-cutover.md
git commit -m "test(local-sync): verify CodeGraph standard scan cutover"
```

---

## Stage 1 Definition of Done

- [ ] `local_scan_sources` returns a read-only, capability-based CodeGraph plan and stable local hash.
- [ ] No repository mutation happens before the exact plan is explicitly confirmed.
- [ ] A complete real CodeGraph scan produces a valid `agentwiki-code-snapshot@1`, deterministic generated knowledge, and an upload-free Preview.
- [ ] Preview/sync payloads contain no `.codegraph` database, raw source, absolute path, binary, credential, or local diagnostic file.
- [ ] Standard mode performs no Agent/LLM/deep operation.
- [ ] Standard reconciliation preserves deep and unrelated artifacts.
- [ ] Per 2026-08-19 final hardening, a migration Preview carries legacy-looking items with a stable opaque warning and zero deletion when no strict verifiable legacy marker exists; only a future marker contract may propose deletion, while CodeGraph additions remain previewed before sync.
- [ ] Active Codebase Memory code, install logic, diagnostics, tests, and user instructions are gone with no fallback.
- [ ] AgentWiki has no CodeGraph package dependency or exact-version gate.
- [ ] Codex, Claude Code, and OpenCode pass the standard onboarding/sync flow.
- [ ] Unit, runtime, real CodeGraph E2E, typecheck, lint, build, and full test suites pass with recorded evidence.
