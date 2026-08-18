# CodeGraph Optional Deep Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an explicitly requested deep-analysis mode that derives module-first architecture, bounded module relationships, change impact, and optional local-Agent explanations from a current CodeGraph snapshot without changing standard-scan defaults.

**Architecture:** The existing `CodeGraphProvider` gains an optional public-SDK capability driver loaded from the independently installed CodeGraph package. It opens the index read-only, normalizes symbols and relationships into the AgentWiki snapshot contract, detects modules, and generates deterministic deep pages. A resumable local analysis session exposes bounded evidence work items to the calling Agent; validated enrichment is stored separately and merged only at finalization. Deep artifacts have independent ownership/staleness and are reconciled only by an explicitly confirmed deep run.

**Tech Stack:** TypeScript, Node.js 24/26, Zod, Vitest, MCP SDK, dynamic ESM/CommonJS loading, independently installed CodeGraph public SDK, pnpm.

## Global Constraints

- Begin only after `2026-08-18-codegraph-standard-scan-cutover.md` is complete and verified.
- Implement against `docs/superpowers/specs/2026-08-18-codegraph-local-code-analysis-design.md`.
- Deep mode runs only when the user explicitly requests it and confirms a plan whose `analysisMode` is `deep`. Never infer deep intent from repository size, scanner capabilities, prior runs, onboarding, or a standard request.
- Standard onboarding and standard `knowledge_prepare` behavior must remain byte- and call-path independent from deep analysis wherever practical. Standard mode must not load the CodeGraph SDK or create an enrichment session.
- Use only CodeGraph's public SDK/export surface. Do not read internal SQLite tables, import private `dist/*` modules, or add CodeGraph to AgentWiki dependencies.
- Locate the optional SDK from `AGENTWIKI_CODEGRAPH_SDK` or the already discovered executable's owning package. A CLI-only installation remains valid for standard mode and reports deep mode unavailable.
- Capability negotiation is method/shape based. Do not gate on exact CodeGraph versions.
- Never call `CodeGraph.getCode()` or persist raw source bodies. Semantic context is graph metadata with `includeCode: false` or equivalent.
- Module pages are the unit of publication. Never publish one page per symbol or raw symbol edges.
- Enrichment is explanatory only. It cannot overwrite deterministic facts, IDs, counts, paths, relationships, or evidence.
- AgentWiki Local Sync does not directly invoke a model provider. The already connected local Agent reads bounded work items and submits structured enrichment through gateway tools.
- Enrichment failure, timeout, refusal, or unsupported semantic capability is non-blocking and becomes a Preview warning. Snapshot or deterministic deep-analysis failure blocks the Preview.
- Deep output has its own ownership. Standard scans carry it forward; only a confirmed deep run can replace it, and stale deletion is a separate previewed decision.
- Preserve unrelated working-tree changes and stage only task files.

---

### Task 1: Add a dynamically loaded public-SDK capability driver

**Files:**
- Create: `packages/local-sync/src/codegraph/deep-driver.ts`
- Create: `packages/local-sync/src/codegraph/sdk-loader.ts`
- Create: `packages/local-sync/src/codegraph/sdk-loader.spec.ts`
- Create: `packages/local-sync/src/codegraph/sdk-driver.ts`
- Create: `packages/local-sync/src/codegraph/sdk-driver.spec.ts`
- Modify: `packages/local-sync/src/codegraph/contracts.ts`
- Modify: `packages/local-sync/src/codegraph/provider.ts`
- Modify: `packages/local-sync/src/codegraph/provider.spec.ts`
- Modify: `packages/local-sync/src/codegraph/index.ts`

**Interfaces:**

```ts
export interface RawCodeGraphNode {
  id: string; // ephemeral during normalization; never persisted as identity
  kind: string;
  name: string;
  qualifiedName: string;
  filePath: string;
  language: string;
  startLine: number;
  endLine: number;
  visibility?: string;
  isExported?: boolean;
}

export interface RawCodeGraphEdge {
  source: string;
  target: string;
  kind: string;
  line?: number;
}

export interface DeepStructureDriver {
  capabilities(): Promise<Pick<CodeGraphCapabilities['optional'],
    'symbols.list' | 'relations.read' | 'semantic.explore' | 'impact.read' | 'routes.read'>>;
  withReadOnlyGraph<T>(sourceRoot: string, use: (graph: DeepGraphReader) => Promise<T>): Promise<T>;
}

export interface DeepGraphReader {
  files(): Promise<Array<{ path: string; contentHash: string; language: string; size: number; nodeCount: number }>>;
  nodesInFile(path: string): Promise<RawCodeGraphNode[]>;
  outgoingEdges(nodeId: string): Promise<RawCodeGraphEdge[]>;
  fileDependents(path: string): Promise<string[]>;
  routingManifest(limit: number): Promise<unknown | null>;
  relevantSubgraph(query: string, limit: number): Promise<unknown | null>;
}
```

- SDK lookup order:
  1. explicit absolute `AGENTWIKI_CODEGRAPH_SDK` entry;
  2. walk upward from the resolved CodeGraph executable to an owning `package.json` whose name is `@colbymchenry/codegraph`, then load its public package entry;
  3. unavailable, with standard mode unaffected.
- Probe `CodeGraph.open`, `getFiles`, `getNodesInFile`/`getNodesByKind`, `getOutgoingEdges`, `getFileDependents`/`getImpactRadius`, `getRoutingManifest`, and `findRelevantContext` by presence. Do not call write/index methods during probing.
- Open with `{ readOnly: true, sync: false }` and always call `close()` in `finally`.

- [ ] **Step 1: Write failing SDK lookup tests**

Use fake package layouts for explicit entry, npm shim symlink, executable without an SDK, wrong package name, missing platform bundle, and a package outside the executable ancestry. Assert no global npm query, install, or network call occurs.

- [ ] **Step 2: Write failing capability-shape tests**

Test a full public surface, CLI-only surface, symbols without relations, relations without impact, and extra future methods. Required deep capabilities are `symbols.list` and `relations.read`; semantic/impact/routes remain independently optional.

- [ ] **Step 3: Write failing read-only lifecycle tests**

Assert `CodeGraph.open(root, { readOnly: true, sync: false })`, method delegation, and exactly-once `close()` on success and thrown callbacks. Assert `getCode`, `sync`, `index`, `clear`, and direct DB exports are never called.

- [ ] **Step 4: Run focused tests and verify RED**

```bash
pnpm --filter @neomei/agentwiki-local-sync test -- src/codegraph/sdk-loader.spec.ts src/codegraph/sdk-driver.spec.ts src/codegraph/provider.spec.ts
```

Expected: FAIL because the deep capability driver is absent.

- [ ] **Step 5: Implement public-entry loading and method-based negotiation**

Use `createRequire`/dynamic import against the resolved public package entry. Treat load errors as optional capability unavailability; preserve the exact cause only in local diagnostics.

- [ ] **Step 6: Implement the read-only adapter**

Validate every returned object at the boundary. Ignore unknown fields. Reject missing IDs/paths/line ranges and close the graph before returning a public error.

- [ ] **Step 7: Run focused tests and verify GREEN**

Expected: full SDK enables deep capabilities, CLI-only installations retain standard mode, and no exact version comparison appears.

- [ ] **Step 8: Commit the optional SDK boundary**

```bash
git add packages/local-sync/src/codegraph/deep-driver.ts packages/local-sync/src/codegraph/sdk-loader.ts packages/local-sync/src/codegraph/sdk-loader.spec.ts packages/local-sync/src/codegraph/sdk-driver.ts packages/local-sync/src/codegraph/sdk-driver.spec.ts packages/local-sync/src/codegraph/contracts.ts packages/local-sync/src/codegraph/provider.ts packages/local-sync/src/codegraph/provider.spec.ts packages/local-sync/src/codegraph/index.ts
git commit -m "feat(local-sync): negotiate CodeGraph deep capabilities"
```

---

### Task 2: Normalize deep symbols, relations, routes, and manifest facts

**Files:**
- Create: `packages/local-sync/src/codegraph/deep-normalizer.ts`
- Create: `packages/local-sync/src/codegraph/deep-normalizer.spec.ts`
- Create: `packages/local-sync/src/codegraph/manifest-reader.ts`
- Create: `packages/local-sync/src/codegraph/manifest-reader.spec.ts`
- Modify: `packages/local-sync/src/codegraph/contracts.ts`
- Modify: `packages/local-sync/src/codegraph/snapshot-store.ts`
- Modify: `packages/local-sync/src/codegraph/snapshot-store.spec.ts`
- Modify: `packages/local-sync/src/codegraph/pipeline.ts`
- Modify: `packages/local-sync/src/codegraph/pipeline.spec.ts`

**Snapshot records:**

```ts
export interface NormalizedSymbol {
  symbolId: string;
  fileId: string;
  kind: string;
  name: string;
  qualifiedName: string;
  language: string;
  lineRange: [number, number];
  visibility?: 'public' | 'private' | 'protected' | 'internal';
  exported?: boolean;
}

export interface NormalizedRelation {
  relationId: string;
  sourceSymbolId: string;
  targetSymbolId: string;
  relationType: string;
  sourceFileId: string;
  targetFileId: string;
  line?: number;
}

export interface NormalizedModuleHint {
  moduleId: string;
  rootPath: string;
  name: string;
  kind: 'workspace' | 'package' | 'scanner' | 'directory';
  manifestPath?: string;
}
```

- IDs derive from source key, relative path, kind, and qualified name. Raw CodeGraph node IDs exist only in an in-memory mapping while edges are normalized.
- Read only bounded module manifests: `package.json`, `pnpm-workspace.yaml`, `Cargo.toml`, `go.mod`, and equivalent allowlisted files. Parse names/workspace roots only; do not persist manifest bodies or arbitrary dependency values.
- Deep plan limits must bind `maxSymbols`, `maxRelations`, `maxModules`, `maxPages`, `maxGeneratedBytes`, and `maxEnrichmentWorkItems`. Exceeding a confirmed limit blocks with an actionable re-plan; it never truncates silently.
- Sort and hash every deep dataset before atomic snapshot replacement.

- [ ] **Step 1: Write failing stable-ID and edge-mapping tests**

Provide equivalent graphs with different raw node IDs/order. Expect byte-identical normalized symbols/relations and stable hashes. Change a qualified name/path/kind and expect only the corresponding normalized identity and references to change.

- [ ] **Step 2: Write failing invalid-graph tests**

Reject duplicate normalized symbols, dangling edges, out-of-root paths, invalid line ranges, unknown source/target IDs, a dataset over its confirmed cap, and raw node IDs leaking into serialized files.

- [ ] **Step 3: Write failing manifest-reader tests**

Cover a pnpm monorepo, nested npm packages, Cargo workspace, Go module, malformed/oversized manifests, symlinks, and unsupported manifests. Persist only normalized module facts.

- [ ] **Step 4: Run focused tests and verify RED**

```bash
pnpm --filter @neomei/agentwiki-local-sync test -- src/codegraph/deep-normalizer.spec.ts src/codegraph/manifest-reader.spec.ts src/codegraph/snapshot-store.spec.ts src/codegraph/pipeline.spec.ts
```

Expected: FAIL because deep datasets and bound limits do not exist.

- [ ] **Step 5: Implement batched read-only normalization**

Iterate sorted files, normalize nodes file-by-file, keep only the temporary raw-ID map needed for edges, and release each raw result promptly. Validate limits before committing the snapshot.

- [ ] **Step 6: Implement allowlisted manifest normalization**

Cap each manifest read at 1 MiB. Treat parse errors as warnings unless the manifest is the only module-boundary source; never copy manifest text into evidence.

- [ ] **Step 7: Run focused tests and verify GREEN**

Expected: deep snapshots are stable across CodeGraph internal IDs and contain no source bodies or absolute paths.

- [ ] **Step 8: Commit deep snapshot normalization**

```bash
git add packages/local-sync/src/codegraph/deep-normalizer.ts packages/local-sync/src/codegraph/deep-normalizer.spec.ts packages/local-sync/src/codegraph/manifest-reader.ts packages/local-sync/src/codegraph/manifest-reader.spec.ts packages/local-sync/src/codegraph/contracts.ts packages/local-sync/src/codegraph/snapshot-store.ts packages/local-sync/src/codegraph/snapshot-store.spec.ts packages/local-sync/src/codegraph/pipeline.ts packages/local-sync/src/codegraph/pipeline.spec.ts
git commit -m "feat(local-sync): normalize CodeGraph deep snapshots"
```

---

### Task 3: Detect modules and changed/affected analysis scope

**Files:**
- Create: `packages/local-sync/src/codegraph/module-detector.ts`
- Create: `packages/local-sync/src/codegraph/module-detector.spec.ts`
- Create: `packages/local-sync/src/codegraph/change-impact.ts`
- Create: `packages/local-sync/src/codegraph/change-impact.spec.ts`
- Modify: `packages/local-sync/src/codegraph/contracts.ts`
- Modify: `packages/local-sync/src/codegraph/pipeline.ts`
- Modify: `packages/local-sync/src/codegraph/pipeline.spec.ts`

**Interfaces:**

```ts
export interface CodeModule {
  moduleId: string;
  sourceKey: string;
  name: string;
  rootPath: string;
  boundarySource: 'workspace-manifest' | 'package-manifest' | 'scanner' | 'directory' | 'top-level';
  fileIds: string[];
  symbolIds: string[];
}

export interface DeepAnalysisScope {
  snapshotHash: string;
  previousDeepSnapshotHash?: string;
  changedModuleIds: string[];
  affectedModuleIds: string[];
  unchangedModuleIds: string[];
  fullRebuild: boolean;
  reason: 'first-deep-run' | 'module-boundaries-changed' | 'incremental';
}
```

- Boundary priority is exactly: workspace/package manifests, scanner module hints, stable source directory, top-level fallback.
- Choose the deepest valid owning boundary for a file while keeping workspace roots as containers rather than duplicate content pages.
- Compare file content hashes when the deep SDK supplies them. Changed modules plus modules reachable through normalized dependencies/impact become the affected set.
- A missing previous deep snapshot or changed module boundary forces deterministic full deep regeneration, not a guessed incremental subset.

- [ ] **Step 1: Write failing boundary-priority tests**

Cover nested workspace packages, one package owning multiple source directories, scanner hints below a package boundary, no manifests, root-only files, test directories, generated/vendor paths, and ambiguous equal-depth boundaries.

- [ ] **Step 2: Write failing relation aggregation-scope tests**

Assert files and symbols belong to exactly one leaf module; workspace containers may summarize child modules but do not duplicate their symbols.

- [ ] **Step 3: Write failing impact tests**

Compare prior/current deep snapshots for no change, one file change, removed file, renamed module, dependency fan-out, missing impact capability, and cyclic dependencies. Sort and cap affected modules deterministically.

- [ ] **Step 4: Run focused tests and verify RED**

```bash
pnpm --filter @neomei/agentwiki-local-sync test -- src/codegraph/module-detector.spec.ts src/codegraph/change-impact.spec.ts src/codegraph/pipeline.spec.ts
```

Expected: FAIL because module ownership and deep incremental scope do not exist.

- [ ] **Step 5: Implement module detection**

Normalize roots before comparison, exclude paths already excluded by the snapshot, and generate module IDs from source key plus normalized root—not display names.

- [ ] **Step 6: Implement conservative change/impact selection**

Use normalized relationships first and optional CodeGraph impact results only as additional affected evidence. When optional impact is unavailable, direct/transitive normalized module dependencies remain deterministic.

- [ ] **Step 7: Run focused tests and verify GREEN**

Expected: first run covers all modules; subsequent runs target exactly changed/affected modules unless boundaries changed.

- [ ] **Step 8: Commit module scope logic**

```bash
git add packages/local-sync/src/codegraph/module-detector.ts packages/local-sync/src/codegraph/module-detector.spec.ts packages/local-sync/src/codegraph/change-impact.ts packages/local-sync/src/codegraph/change-impact.spec.ts packages/local-sync/src/codegraph/contracts.ts packages/local-sync/src/codegraph/pipeline.ts packages/local-sync/src/codegraph/pipeline.spec.ts
git commit -m "feat(local-sync): scope deep analysis by module impact"
```

---

### Task 4: Generate deterministic deep pages and bounded relationships

**Files:**
- Create: `packages/local-sync/src/codegraph/deep-analyzer.ts`
- Create: `packages/local-sync/src/codegraph/deep-analyzer.spec.ts`
- Create: `packages/local-sync/src/codegraph/relation-aggregator.ts`
- Create: `packages/local-sync/src/codegraph/relation-aggregator.spec.ts`
- Modify: `packages/local-sync/src/codegraph/generated-store.ts`
- Modify: `packages/local-sync/src/codegraph/generated-store.spec.ts`
- Modify: `packages/local-sync/src/codegraph/generated-adapter.ts`
- Modify: `packages/local-sync/src/codegraph/generated-adapter.spec.ts`

**Generated output:**
- `architecture/modules/<stable-module-slug>.md`
- `architecture/dependencies.md`
- `architecture/entry-points.md` when route/entry evidence exists
- `relationships.json`, consumed locally by `GeneratedKnowledgeAdapter`

**Relationship manifest:**

```ts
export interface GeneratedModuleRelation {
  sourceModuleId: string;
  targetModuleId: string;
  relationType: 'depends-on' | 'calls' | 'imports' | 'extends' | 'implements' | 'routes-to';
  count: number;
  evidenceIds: string[];
  analysisLayer: 'deep';
  snapshotHash: string;
}
```

- Aggregate symbol edges by source module, target module, and relation type. Omit self-relations unless they represent a useful cycle summary.
- Cap evidence IDs per aggregate and total published relations. Counts retain the full normalized aggregate even when evidence samples are capped.
- Module pages contain responsibilities inferred from deterministic structure only: location, languages, public/exported symbol summaries, entry points, dependencies, dependents, and evidence IDs.
- Symbols appear as bounded sections/evidence, never pages.

- [ ] **Step 1: Write failing aggregation tests**

Cover thousands of symbol edges collapsing to a handful of module relations, duplicate edges, self edges, cycles, unknown relation types, stable sorting, evidence sampling, and caps.

- [ ] **Step 2: Write failing deep Markdown golden tests**

Use a small monorepo snapshot. Assert fixed module-page order, no raw source, no absolute paths, no raw CodeGraph IDs, no per-symbol page, and byte-identical output after input reordering.

- [ ] **Step 3: Write failing generated-adapter relation tests**

Assert relationship records become bounded `SourceArtifact(kind: 'relation')` values whose source/target are AgentWiki module page IDs, with `analysisLayer: deep`, `sourceKey`, and `snapshotHash` metadata.

- [ ] **Step 4: Run focused tests and verify RED**

```bash
pnpm --filter @neomei/agentwiki-local-sync test -- src/codegraph/relation-aggregator.spec.ts src/codegraph/deep-analyzer.spec.ts src/codegraph/generated-store.spec.ts src/codegraph/generated-adapter.spec.ts
```

Expected: FAIL because deterministic deep output and module relations are absent.

- [ ] **Step 5: Implement relation aggregation and module pages**

Use the confirmed `maxPages`, `maxRelations`, and generated-byte limits. If output would exceed a confirmed limit, stop before publish assembly and require a new plan with a narrower scope or larger explicit limit.

- [ ] **Step 6: Extend generated storage and adapter**

Write deterministic deep facts to `generated/codegraph/deep/` (create this directory as the deterministic deep layer), keep Agent output in `enrichment/`, and assemble validated output into `publish/`. Do not let enrichment edit deep/base files.

- [ ] **Step 7: Run focused tests and verify GREEN**

Expected: deep output is module-first, bounded, deterministic, and adapter-compatible.

- [ ] **Step 8: Commit deterministic deep analysis**

```bash
git add packages/local-sync/src/codegraph/deep-analyzer.ts packages/local-sync/src/codegraph/deep-analyzer.spec.ts packages/local-sync/src/codegraph/relation-aggregator.ts packages/local-sync/src/codegraph/relation-aggregator.spec.ts packages/local-sync/src/codegraph/generated-store.ts packages/local-sync/src/codegraph/generated-store.spec.ts packages/local-sync/src/codegraph/generated-adapter.ts packages/local-sync/src/codegraph/generated-adapter.spec.ts
git commit -m "feat(local-sync): generate module-first deep analysis"
```

---

### Task 5: Add explicit deep planning and resumable Agent work sessions

**Files:**
- Create: `packages/local-sync/src/codegraph/analysis-session.ts`
- Create: `packages/local-sync/src/codegraph/analysis-session.spec.ts`
- Create: `packages/local-sync/src/codegraph/enrichment-contract.ts`
- Create: `packages/local-sync/src/codegraph/enrichment-contract.spec.ts`
- Modify: `packages/local-sync/src/gateway/knowledge-workflows.ts`
- Modify: `packages/local-sync/src/gateway/knowledge-workflows.spec.ts`
- Modify: `packages/local-sync/src/gateway/status.ts`
- Modify: `packages/local-sync/src/gateway/status.spec.ts`
- Modify: `packages/local-sync/src/gateway/manifest.ts`
- Modify: `packages/local-sync/src/gateway/manifest.spec.ts`
- Modify: `packages/local-sync/src/gateway/server.ts`
- Modify: `packages/local-sync/src/gateway/server.spec.ts`

**Prepare result union:**

```ts
export interface ReadyPrepareResult {
  status: 'preview_ready';
  jobId: string;
  previewHash: string;
  summary: Record<string, unknown>;
  warnings: string[];
}

export interface DeepAnalysisPendingResult {
  status: 'enrichment_pending';
  analysisSessionId: string;
  snapshotHash: string;
  workItems: Array<{ workItemId: string; moduleId: string; title: string; estimatedTokens?: number }>;
  deterministicSummary: Record<string, unknown>;
  warnings: string[];
}
```

**New hybrid tools:**

```text
knowledge_submit_code_enrichment
knowledge_finalize_code_analysis
```

- Reuse `local_read_artifacts` for bounded deep work-item evidence by accepting `analysisSessionId` as its `jobId` and resolving only declared work item IDs.
- The confirmed deep plan must show proposed modules, required/optional SDK capabilities, affected-scope estimate, page/relation/work-item caps, estimated duration/output size, and model cost as `client-owned/unknown` unless the calling Agent supplies a reliable estimate. Add `removeStaleDeep` to the hashed plan; default it to `false`.
- `knowledge_prepare(analysisMode: deep)` validates the confirmed deep plan, refreshes the snapshot, generates deterministic deep facts, stores an analysis session, and returns `enrichment_pending`. It does not create a syncable Preview yet.
- Build each work item from deterministic module facts plus an optional `relevantSubgraph` query with source inclusion disabled. Normalize that subgraph to known snapshot IDs before persistence; if semantic capability is absent or the result cannot be normalized, omit it and add a warning.
- The calling Agent reads each work item, submits structured enrichment or an explicit skip, then calls `knowledge_finalize_code_analysis`. Finalization assembles and validates the exact Preview and returns the normal `jobId`/`previewHash`.
- `knowledge_confirm_and_sync` remains unchanged and accepts only finalized Preview IDs.

- [ ] **Step 1: Write failing explicit-intent tests**

Assert a standard request cannot create a deep session; `deep` without a deep plan fails; a plan confirmed as standard cannot be reused for deep; onboarding still sends standard only; and a prior deep run does not auto-promote later scans.

- [ ] **Step 2: Write failing session persistence tests**

Create sessions under `~/.agentwiki/runtime/code-analysis/<analysisSessionId>/` with mode `0700`/files `0600`. Test resume, expiry, snapshot mismatch, unknown work item, duplicate submission, finalization before all items are completed/skipped, and atomic completion.

- [ ] **Step 3: Write failing gateway contract tests**

Assert the new tool schemas are strict; `local_read_artifacts` returns bounded normalized evidence; pending deep preparation has no `previewHash`; and `knowledge_confirm_and_sync` rejects an analysis session ID.

- [ ] **Step 4: Run focused tests and verify RED**

```bash
pnpm --filter @neomei/agentwiki-local-sync test -- src/codegraph/analysis-session.spec.ts src/codegraph/enrichment-contract.spec.ts src/gateway/knowledge-workflows.spec.ts src/gateway/status.spec.ts src/gateway/manifest.spec.ts src/gateway/server.spec.ts
```

Expected: FAIL because deep sessions and gateway tools do not exist.

- [ ] **Step 5: Implement bounded analysis sessions**

Use UUID session IDs, snapshot-bound work item IDs, 24-hour expiry, a maximum of 16 work items by default, and at most 64 KiB of evidence per item. Never include source bodies.

- [ ] **Step 6: Implement the prepare/read/submit/finalize state machine**

Legal states are `prepared -> enriching -> ready_to_finalize -> finalized` plus `expired`. All transitions are persisted atomically and idempotently. Finalization creates a normal immutable Preview, then marks the analysis session finalized.

- [ ] **Step 7: Run focused tests and verify GREEN**

Expected: deep requires explicit plan intent, survives restart, and cannot bypass Preview confirmation.

- [ ] **Step 8: Commit deep workflow orchestration**

```bash
git add packages/local-sync/src/codegraph/analysis-session.ts packages/local-sync/src/codegraph/analysis-session.spec.ts packages/local-sync/src/codegraph/enrichment-contract.ts packages/local-sync/src/codegraph/enrichment-contract.spec.ts packages/local-sync/src/gateway/knowledge-workflows.ts packages/local-sync/src/gateway/knowledge-workflows.spec.ts packages/local-sync/src/gateway/status.ts packages/local-sync/src/gateway/status.spec.ts packages/local-sync/src/gateway/manifest.ts packages/local-sync/src/gateway/manifest.spec.ts packages/local-sync/src/gateway/server.ts packages/local-sync/src/gateway/server.spec.ts
git commit -m "feat(local-sync): orchestrate explicit deep analysis sessions"
```

---

### Task 6: Validate and merge optional local-Agent enrichment

**Files:**
- Create: `packages/local-sync/src/codegraph/enrichment-validator.ts`
- Create: `packages/local-sync/src/codegraph/enrichment-validator.spec.ts`
- Create: `packages/local-sync/src/codegraph/enrichment-assembler.ts`
- Create: `packages/local-sync/src/codegraph/enrichment-assembler.spec.ts`
- Modify: `packages/local-sync/src/codegraph/enrichment-contract.ts`
- Modify: `packages/local-sync/src/codegraph/analysis-session.ts`
- Modify: `packages/local-sync/src/codegraph/generated-store.ts`
- Modify: `packages/local-sync/src/codegraph/generated-store.spec.ts`
- Modify: `packages/local-sync/skill/SKILL.md`

**Submission contract:**

```ts
export const CodeEnrichmentSubmissionSchema = z.object({
  analysisSessionId: z.string().uuid(),
  workItemId: z.string().min(1),
  snapshotHash: z.string().regex(/^[a-f0-9]{64}$/u),
  moduleId: z.string().min(1),
  skipped: z.boolean().default(false),
  explanation: z.object({
    responsibilities: z.array(z.string().max(500)).max(8),
    riskAreas: z.array(z.string().max(500)).max(8),
    readingOrder: z.array(z.string().max(500)).max(12),
    summary: z.string().max(4_000),
  }).strict().optional(),
  evidenceIds: z.array(z.string().min(1)).max(64),
}).strict();
```

- A non-skipped submission must reference the exact module/snapshot/work item and only evidence IDs exposed to that work item.
- Reject claims that contain absolute paths, credential-like text, raw source blocks, unsupported URLs, unknown page/relation IDs, or output above limits.
- Merge enrichment under a clearly labeled “Agent analysis” section after deterministic facts. It cannot replace headings, counts, module identity, dependency tables, or evidence.
- When semantic/impact capabilities are absent or an item is skipped, finalization uses deterministic deep output and adds `CODE_ENRICHMENT_SKIPPED` warnings.

- [ ] **Step 1: Write failing validation tests**

Cover valid enrichment, skip, wrong snapshot/module/work item, unknown evidence, duplicate evidence, secret-like content, absolute paths, Markdown code fences/source blocks, excessive fields, and unknown keys.

- [ ] **Step 2: Write failing non-overwrite tests**

Attempt to submit a changed module name, counts, relation table, snapshot hash, or deterministic body. The API shape and assembler must make each attempt impossible or reject it.

- [ ] **Step 3: Write failing merge golden tests**

Reorder valid submissions and expect byte-identical publish output. Verify deterministic base/deep files stay unchanged, enrichment lives only under `enrichment/`, and the final manifest records both deterministic and enrichment hashes.

- [ ] **Step 4: Run focused tests and verify RED**

```bash
pnpm --filter @neomei/agentwiki-local-sync test -- src/codegraph/enrichment-validator.spec.ts src/codegraph/enrichment-assembler.spec.ts src/codegraph/generated-store.spec.ts src/codegraph/analysis-session.spec.ts
```

Expected: FAIL because enrichment is not validated or isolated.

- [ ] **Step 5: Implement strict validation and deterministic merge**

Treat Agent text as untrusted local input. Reuse secret scanning and redaction, validate evidence ownership, sort array output where semantics allow, and compute a separate enrichment hash.

- [ ] **Step 6: Update the shared Skill**

Document the exact deep sequence, require a current explicit user request, show the deep plan/cost before confirmation, use the returned work items only, submit bounded structured explanations, finalize a Preview, then ask separately whether to sync.

- [ ] **Step 7: Run focused tests and verify GREEN**

Expected: failed/skipped enrichment never invalidates deterministic output and cannot overwrite it.

- [ ] **Step 8: Commit enrichment isolation**

```bash
git add packages/local-sync/src/codegraph/enrichment-validator.ts packages/local-sync/src/codegraph/enrichment-validator.spec.ts packages/local-sync/src/codegraph/enrichment-assembler.ts packages/local-sync/src/codegraph/enrichment-assembler.spec.ts packages/local-sync/src/codegraph/enrichment-contract.ts packages/local-sync/src/codegraph/analysis-session.ts packages/local-sync/src/codegraph/generated-store.ts packages/local-sync/src/codegraph/generated-store.spec.ts packages/local-sync/skill/SKILL.md
git commit -m "feat(local-sync): validate local Agent code enrichment"
```

---

### Task 7: Reconcile deep ownership, staleness, and explicit removal

**Files:**
- Modify: `packages/local-sync/src/organize/analysis-layer-reconcile.ts`
- Modify: `packages/local-sync/src/organize/analysis-layer-reconcile.spec.ts`
- Create: `packages/local-sync/src/codegraph/deep-state.ts`
- Create: `packages/local-sync/src/codegraph/deep-state.spec.ts`
- Modify: `packages/local-sync/src/codegraph/pipeline.ts`
- Modify: `packages/local-sync/src/codegraph/pipeline.spec.ts`
- Modify: `packages/local-sync/src/gateway/workflow-runtime.ts`
- Modify: `packages/local-sync/src/gateway/workflow-runtime.spec.ts`

**Rules:**
- Standard run: reconcile `base`; carry all `deep`; if snapshot hashes differ, mark local deep state stale and warn.
- Deep incremental run: reconcile changed/affected modules, carry unchanged deep modules and their relationships, and clear stale status only for regenerated modules.
- Deep full run: reconcile the full current source's deep layer.
- Missing module: propose deletion only in a confirmed deep Preview and label it as removed by the current snapshot.
- Explicit stale cleanup: requires a deep plan with `removeStaleDeep: true`; it is never implied by standard scanning or enrichment failure.

- [ ] **Step 1: Write failing standard carry-forward regression tests**

Repeat Stage 1's base/deep ownership cases with real generated metadata. Assert standard changes only base and persists stale status locally without changing deep page bytes.

- [ ] **Step 2: Write failing incremental deep reconciliation tests**

Use three modules where one changes and one is affected. Replace those two, carry the third, update cross-module relations consistently, and avoid duplicate provenance.

- [ ] **Step 3: Write failing removal-consent tests**

Remove a module from the snapshot. A standard run carries its stale deep page; a deep run proposes deletion; `removeStaleDeep: false` carries it with a warning; `true` includes a deletion that still requires normal Preview sync confirmation.

- [ ] **Step 4: Run focused tests and verify RED**

```bash
pnpm --filter @neomei/agentwiki-local-sync test -- src/codegraph/deep-state.spec.ts src/organize/analysis-layer-reconcile.spec.ts src/codegraph/pipeline.spec.ts src/gateway/workflow-runtime.spec.ts
```

Expected: FAIL because deep state and module-granular ownership are absent.

- [ ] **Step 5: Implement local deep state**

Store snapshot hash, module output hashes, stale module IDs, and last successful deep time under the private source workspace. Write atomically and never use it as server authority.

- [ ] **Step 6: Extend reconciliation to module-granular deep scopes**

Select owned items by `sourceKey`, `analysisLayer`, and `moduleId`. Reconcile relations when either endpoint is regenerated. Preserve unrelated pages/relations/provenance exactly.

- [ ] **Step 7: Run focused tests and verify GREEN**

Expected: standard never deletes deep, deep updates only its confirmed scope, and stale cleanup remains explicit/previewed.

- [ ] **Step 8: Commit deep ownership behavior**

```bash
git add packages/local-sync/src/organize/analysis-layer-reconcile.ts packages/local-sync/src/organize/analysis-layer-reconcile.spec.ts packages/local-sync/src/codegraph/deep-state.ts packages/local-sync/src/codegraph/deep-state.spec.ts packages/local-sync/src/codegraph/pipeline.ts packages/local-sync/src/codegraph/pipeline.spec.ts packages/local-sync/src/gateway/workflow-runtime.ts packages/local-sync/src/gateway/workflow-runtime.spec.ts
git commit -m "fix(local-sync): reconcile deep analysis independently"
```

---

### Task 8: Verify explicit deep analysis end to end

**Files:**
- Create: `scripts/codegraph-deep-analysis-e2e.test.mjs`
- Modify: `package.json`
- Modify: `packages/local-sync/README.md`
- Modify: `packages/local-sync/skill/SKILL.md`
- Create: `docs/verification/codegraph-optional-deep-analysis.md`
- Modify: `scripts/node-runtime-contract.test.mjs`

**Acceptance flow:**

```text
explicit user deep request
  -> read-only deep plan + capabilities/cost/caps
  -> explicit plan confirmation
  -> current CodeGraph index + deep snapshot
  -> deterministic module pages/relations
  -> bounded Agent work items
  -> validated enrichment or explicit skips
  -> finalized Preview
  -> separate sync confirmation
  -> server review/publish
```

- [ ] **Step 1: Add a gated real-SDK E2E test**

Require both `AGENTWIKI_CODEGRAPH_E2E=1` and `AGENTWIKI_CODEGRAPH_DEEP_E2E=1`; otherwise skip. Use the Stage 1 fixture expanded to at least three modules with a dependency cycle and an entry point. Load the independently installed public SDK through the same provider path.

- [ ] **Step 2: Assert explicit-intent boundaries**

Run standard first and prove no SDK load/session/tool call. Then request deep, confirm its distinct plan, and prove a standard plan hash cannot authorize it. Finish with a second standard scan and prove deep pages are carried.

- [ ] **Step 3: Assert deterministic and enriched outputs**

Submit two valid Agent fixtures and one skip. Verify deterministic page bytes are unchanged by submissions, enrichment appears only in labeled sections, relation counts are aggregated, and no symbol page exists.

- [ ] **Step 4: Assert privacy and bounds**

Search snapshots, generated publish files, Preview JSON, and the server submission fixture for absolute roots, raw source body markers, CodeGraph raw node IDs, `.codegraph/codegraph.db`, secrets, and SDK/executable paths. Expect none. Assert page/relation/work-item limits.

- [ ] **Step 5: Run focused deep acceptance**

```bash
AGENTWIKI_CODEGRAPH_E2E=1 AGENTWIKI_CODEGRAPH_DEEP_E2E=1 node --test scripts/codegraph-deep-analysis-e2e.test.mjs
pnpm --filter @neomei/agentwiki-local-sync test
```

Expected: real SDK deep flow passes; standard regression tests remain unchanged.

- [ ] **Step 6: Run the complete verification matrix**

```bash
pnpm --filter @neomei/agentwiki-local-sync typecheck
pnpm --filter @neomei/agentwiki-local-sync build
pnpm lint
pnpm test:runtime
pnpm test
pnpm build
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 7: Run decoupling and active-contract audits**

```bash
rg -n '"@colbymchenry/codegraph"' package.json packages/local-sync/package.json pnpm-lock.yaml
rg -n "getCode\(|codegraph\.db|node:sqlite|dist/db|codebase-memory" packages/local-sync/src packages/local-sync/README.md packages/local-sync/skill
rg -n "analysisMode.*deep|knowledge_submit_code_enrichment|knowledge_finalize_code_analysis" packages/local-sync/src packages/local-sync/skill
```

Expected: no package dependency, raw-source/database/private-SDK access, or Codebase Memory active path; deep contracts appear only in explicit planning/session paths.

- [ ] **Step 8: Write the verification report**

Record detected CodeGraph version as diagnostics, negotiated methods, snapshot/module/symbol/relation counts, plan caps, work-item counts, skips/warnings, incremental affected modules, staleness behavior, privacy audit, and full test counts. State that AgentWiki and CodeGraph versions remain independent.

- [ ] **Step 9: Commit deep acceptance evidence**

```bash
git add scripts/codegraph-deep-analysis-e2e.test.mjs package.json packages/local-sync/README.md packages/local-sync/skill/SKILL.md docs/verification/codegraph-optional-deep-analysis.md scripts/node-runtime-contract.test.mjs
git commit -m "test(local-sync): verify optional CodeGraph deep analysis"
```

---

## Stage 2 Definition of Done

- [ ] A standard request never loads the SDK, opens a deep session, or calls the Agent.
- [ ] A deep request requires an explicit user request and a separately confirmed deep plan hash.
- [ ] CLI-only CodeGraph installations keep standard mode working and report deep capability unavailable without an AgentWiki/CodeGraph version gate.
- [ ] The public SDK opens read-only and no private DB/module or raw-source API is used.
- [ ] Deep snapshots use stable AgentWiki IDs and contain normalized files/modules/symbols/relations without raw CodeGraph IDs or source bodies.
- [ ] Publication is module-first; no symbol pages are produced.
- [ ] Module relationships are aggregated, bounded, and evidence-backed.
- [ ] Changed/affected module targeting is deterministic and conservative.
- [ ] Agent enrichment is structured, bounded, evidence-validated, separately stored, and unable to overwrite deterministic facts.
- [ ] Enrichment failure/skip yields warnings and a usable deterministic Preview.
- [ ] Standard scans preserve deep artifacts and mark them stale locally; deep reconciliation/removal remains explicitly previewed.
- [ ] A real independently installed CodeGraph SDK completes the deep flow through Preview, separate sync confirmation, and review/publish.
- [ ] Privacy, package decoupling, typecheck, lint, build, unit, runtime, and real E2E checks pass with recorded evidence.
