# Managed Knowledge Adapters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a private, pinned, non-interactive adapter runtime and first-party codebase-memory and MarkItDown adapters that emit compliant local `SourceArtifact` batches.

**Architecture:** A registry selects an adapter by inspected input, while `RuntimeManager` installs only missing pinned tools under `~/.agentwiki/runtime`. Every adapter runs through one bounded process supervisor and writes artifacts to the job store; it has no reference to Wiki materialization or the AgentWiki HTTP client.

**Tech Stack:** Node.js 26 child processes, TypeScript/ESM, Vitest, codebase-memory CLI/MCP, private Python virtual environment, MarkItDown.

## Global Constraints

- No adapter may import `AgentWikiClient`, `SpaceWorkspace`, sync commands, or review/publish code.
- No interactive `init`; stdin is closed unless the adapter protocol explicitly uses stdio JSON-RPC.
- Reuse an installed tool only after protocol/version verification; otherwise install the pinned version privately.
- Installation uses a lock file, checksum verification, staging directory, atomic switch, and rollback.
- Timeout/cancel kills the entire process group and captures redacted stderr.
- Original source trees are read-only from AgentWiki's perspective and must remain byte-for-byte unchanged.

---

### Task 1: Adapter contract and shared conformance suite

**Files:**
- Create: `packages/local-sync/src/adapters/types.ts`
- Create: `packages/local-sync/src/adapters/contract.ts`
- Create: `packages/local-sync/src/adapters/contract.spec.ts`
- Create: `packages/local-sync/src/testing/adapter-fixture.ts`

**Interfaces:**
- Consumes: `SourceArtifact` from the core plan.
- Produces: `SourceAdapter`, `AdapterManifest`, `ArtifactBatch`, `runAdapterContract(adapterFactory)`.

- [ ] **Step 1: Write the failing contract suite**

```ts
export function runAdapterContract(create: () => Promise<SourceAdapter>): void {
  it('returns a strict versioned manifest', async () => {
    const manifest = await (await create()).manifest();
    expect(manifest.protocolVersion).toBe('source-adapter@1');
    expect(manifest.permissions).not.toContain('network:agentwiki');
  });
  it('keeps stable ids for unchanged input', async () => {
    const adapter = await create();
    const first = await adapter.collect(fixtureInput);
    const second = await adapter.collect(fixtureInput, first.nextCursor);
    expect(second.artifacts.map(({ artifactId }) => artifactId)).toEqual(first.artifacts.map(({ artifactId }) => artifactId));
  });
}
```

Also assert strict schema parsing, deterministic order by `logicalKey`, normalized forward-slash locators, no absolute source path in serialized output, and a `local-only` artifact when the fixture contains a secret.

- [ ] **Step 2: Verify failure**

Run: `pnpm --filter @neomei/agentwiki-local-sync test -- adapters/contract.spec.ts`

Expected: FAIL because adapter contracts do not exist.

- [ ] **Step 3: Implement the exact contract**

```ts
export type LocalPermission = 'filesystem:read' | 'process:spawn' | 'network:package-registry';
export interface ManagedRuntimeDescriptor { runtimeId: string; version: string; integrity: string; executable: string; }
export interface AdapterManifest {
  adapterId: string; version: string; protocolVersion: 'source-adapter@1';
  inputKinds: Array<'directory' | 'file' | 'memory-store'>;
  artifactKinds: SourceArtifact['kind'][]; supportsIncremental: boolean;
  permissions: LocalPermission[]; runtime: ManagedRuntimeDescriptor;
}
export interface AdapterInput { rootPath: string; sourceId: string; include?: string[]; exclude?: string[]; }
export interface SourceDescriptor { sourceId: string; displayName: string; inputKind: 'directory' | 'file' | 'memory-store'; estimatedItems: number; }
export interface ArtifactBatch { artifacts: SourceArtifact[]; nextCursor?: string; skipped: Array<{ locator: string; reason: string }>; }
export interface SourceAdapter {
  manifest(): AdapterManifest;
  inspect(input: AdapterInput): Promise<SourceDescriptor>;
  collect(input: AdapterInput, cursor?: string): Promise<ArtifactBatch>;
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm --filter @neomei/agentwiki-local-sync test -- adapters/contract.spec.ts && pnpm --filter @neomei/agentwiki-local-sync typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/local-sync/src/adapters packages/local-sync/src/testing
git commit -m "feat(local-sync): define source adapter contract"
```

### Task 2: Bounded child-process supervisor

**Files:**
- Create: `packages/local-sync/src/runtime/process-supervisor.ts`
- Create: `packages/local-sync/src/runtime/process-supervisor.spec.ts`
- Create: `packages/local-sync/src/testing/process-tree-fixture.mjs`

**Interfaces:**
- Produces: `runManagedProcess(request, signal)`.
- Consumers: runtime installation and both adapters.

- [ ] **Step 1: Write failing lifecycle tests**

```ts
await expect(runManagedProcess({
  command: process.execPath, args: [fixture, 'hang-with-child'], cwd: root,
  timeoutMs: 100, maxStdoutBytes: 1024, maxStderrBytes: 1024, env: {},
}, AbortSignal.timeout(5_000))).rejects.toMatchObject({ code: 'PROCESS_TIMEOUT' });
await expect(waitForPidFileChildToExit(childPidFile, 2_000)).resolves.toBe(true);
```

Cover success, non-zero exit, timeout, AbortSignal cancellation, stdout overflow, stderr overflow, secret redaction, cwd validation, and descendant cleanup.

- [ ] **Step 2: Verify failure**

Run: `pnpm --filter @neomei/agentwiki-local-sync test -- runtime/process-supervisor.spec.ts`

Expected: FAIL because `runManagedProcess` is absent.

- [ ] **Step 3: Implement the supervisor**

```ts
export interface ManagedProcessRequest {
  command: string; args: string[]; cwd: string; env: Record<string, string>;
  timeoutMs: number; maxStdoutBytes: number; maxStderrBytes: number;
  stdin?: string;
}
export interface ManagedProcessResult { stdout: string; stderr: string; exitCode: number; durationMs: number; }
export async function runManagedProcess(request: ManagedProcessRequest, signal?: AbortSignal): Promise<ManagedProcessResult>;
```

Spawn detached on POSIX; on cancel/timeout send `SIGTERM` to `-pid`, wait 2 seconds, then `SIGKILL` the process group. On Windows use `taskkill /PID <pid> /T /F`. Default stdin is `ignore`; stdout/stderr are pipes with byte ceilings. Build the child environment from a fixed allowlist (`PATH`, `HOME`, `TMPDIR`, locale variables) plus explicit request values; never inherit AgentWiki API keys.

- [ ] **Step 4: Run lifecycle tests**

Run: `pnpm --filter @neomei/agentwiki-local-sync test -- runtime/process-supervisor.spec.ts`

Expected: PASS and no fixture descendant remains alive.

- [ ] **Step 5: Commit**

```bash
git add packages/local-sync/src/runtime/process-supervisor.ts packages/local-sync/src/runtime/process-supervisor.spec.ts packages/local-sync/src/testing/process-tree-fixture.mjs
git commit -m "feat(local-sync): supervise adapter processes"
```

### Task 3: Private runtime manager with atomic install and rollback

**Files:**
- Create: `packages/local-sync/src/runtime/runtime-catalog.ts`
- Create: `packages/local-sync/src/runtime/runtime-manager.ts`
- Create: `packages/local-sync/src/runtime/runtime-manager.spec.ts`
- Create: `packages/local-sync/src/runtime/runtime-lock.ts`

**Interfaces:**
- Produces: `RuntimeManager.ensure(runtimeId)`, `.resolveExecutable(runtimeId)`, `.doctor()`.

- [ ] **Step 1: Write failing install tests**

```ts
const installed = await manager.ensure('markitdown');
expect(installed.version).toBe(catalog.markitdown.version);
expect(installed.executable.startsWith(join(home, '.agentwiki', 'runtime'))).toBe(true);
expect(await manager.ensure('markitdown')).toEqual(installed);
```

Add cases for lock contention, wrong checksum, interrupted staging, failed new-version doctor with old version retained, offline missing package, and owner-only file modes.

- [ ] **Step 2: Verify failure**

Run: `pnpm --filter @neomei/agentwiki-local-sync test -- runtime/runtime-manager.spec.ts`

Expected: FAIL because the manager does not exist.

- [ ] **Step 3: Implement pinned catalog and manager**

```ts
export interface RuntimeCatalogEntry {
  id: 'codebase-memory' | 'markitdown'; version: string; integrity: string;
  install: { command: string; args: string[] }; executable: string[];
  verifyArgs: string[]; versionPattern: RegExp;
}
export interface InstalledRuntime { id: string; version: string; executable: string; installedAt: string; integrity: string; }
export class RuntimeManager {
  ensure(id: RuntimeCatalogEntry['id'], signal?: AbortSignal): Promise<InstalledRuntime>;
  resolveExecutable(id: RuntimeCatalogEntry['id']): Promise<string>;
  doctor(): Promise<Array<{ id: string; status: 'ready' | 'missing' | 'broken'; version?: string; detail: string }>>;
}
```

Pin these verified registry artifacts in the production catalog:

```ts
const catalog = {
  codebaseMemory: {
    id: 'codebase-memory', version: '0.9.0',
    integrity: 'sha512-Zv1qmX/v2LDOJuc+BKmgx11X7P2GMAZmeFuOKdlXqFxRwi/dUGqismHIPdjv2xjOZpJ6B2g7aD5GOW3+eL+CYA==',
    package: 'codebase-memory-mcp@0.9.0', executable: ['node_modules', '.bin', 'codebase-memory-mcp'],
  },
  markitdown: {
    id: 'markitdown', version: '0.1.7',
    integrity: 'sha256-4d1f3c69cd43b82288fdc3653686d759dcf355ee7c681aa6a855aed98a1e4f44',
    package: 'markitdown==0.1.7', executable: ['python', '-m', 'markitdown'],
  },
} as const;
```

Install codebase-memory from the exact npm tarball verified by npm integrity. Download the MarkItDown 0.1.7 source distribution, verify the listed SHA-256 before installing it into the private virtual environment, and reject Python below 3.10. Never use floating dependency specifiers. Tests inject a fixture catalog and never contact public registries. Store the selected version and integrity in `~/.agentwiki/runtime/runtime-lock.json`.

- [ ] **Step 4: Run manager tests**

Run: `pnpm --filter @neomei/agentwiki-local-sync test -- runtime/runtime-manager.spec.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/local-sync/src/runtime/runtime-catalog.ts packages/local-sync/src/runtime/runtime-manager.ts packages/local-sync/src/runtime/runtime-manager.spec.ts packages/local-sync/src/runtime/runtime-lock.ts
git commit -m "feat(local-sync): manage private adapter runtimes"
```

### Task 4: codebase-memory adapter

**Files:**
- Create: `packages/local-sync/src/adapters/codebase-memory-adapter.ts`
- Create: `packages/local-sync/src/adapters/codebase-memory-adapter.spec.ts`
- Create: `packages/local-sync/src/testing/fixtures/code-project/package.json`
- Create: `packages/local-sync/src/testing/fixtures/code-project/src/index.ts`

**Interfaces:**
- Consumes: `RuntimeManager`, `runManagedProcess`, adapter contract.
- Produces: `CodebaseMemoryAdapter` with `adapterId = 'codebase-memory'`.

- [ ] **Step 1: Write failing contract and fixture tests**

Use an injected fake executable returning architecture, modules, symbols, dependencies, entry points, and call edges as JSON. Assert stable artifacts for `architecture/overview`, `module/<path>`, and `symbol/<qualified-name>`; assert no source file body or absolute root path is serialized.

- [ ] **Step 2: Verify failure**

Run: `pnpm --filter @neomei/agentwiki-local-sync test -- adapters/codebase-memory-adapter.spec.ts`

Expected: FAIL because the adapter is absent.

- [ ] **Step 3: Implement non-interactive collection**

```ts
export class CodebaseMemoryAdapter implements SourceAdapter {
  constructor(private readonly runtime: RuntimeManager, private readonly run = runManagedProcess) {}
  manifest(): AdapterManifest;
  inspect(input: AdapterInput): Promise<SourceDescriptor>;
  collect(input: AdapterInput, cursor?: string): Promise<ArtifactBatch>;
}
```

Call only documented non-interactive codebase-memory index/query commands. Generate `artifactId = sha256('codebase-memory\0' + sourceId + '\0' + logicalKey)`. Put summarized graph facts into `content`, source-relative symbol/module locators into `evidence`, and the normalized artifact hash into `contentHash`. If the tool cannot provide structured JSON, fail with `ADAPTER_PROTOCOL_ERROR`; do not scrape prose output.

- [ ] **Step 4: Run adapter tests**

Run: `pnpm --filter @neomei/agentwiki-local-sync test -- adapters/codebase-memory-adapter.spec.ts`

Expected: PASS, including the shared contract suite.

- [ ] **Step 5: Commit**

```bash
git add packages/local-sync/src/adapters/codebase-memory-adapter.ts packages/local-sync/src/adapters/codebase-memory-adapter.spec.ts packages/local-sync/src/testing/fixtures/code-project
git commit -m "feat(local-sync): add codebase memory adapter"
```

### Task 5: MarkItDown document adapter

**Files:**
- Create: `packages/local-sync/src/adapters/markitdown-adapter.ts`
- Create: `packages/local-sync/src/adapters/markitdown-adapter.spec.ts`
- Create: `packages/local-sync/src/document-segmentation.ts`
- Create: `packages/local-sync/src/testing/fixtures/documents/sample.md`
- Create: `packages/local-sync/src/testing/fixtures/documents/sample.txt`
- Generate minimal PDF and DOCX inputs inside the test temporary directory; do not commit binary fixtures.

**Interfaces:**
- Produces: `MarkItDownAdapter` with `adapterId = 'markitdown'`.

- [ ] **Step 1: Write failing conversion tests**

Assert Markdown/TXT are read directly, PDF/DOCX invoke the pinned private executable, headings produce stable logical keys, evidence locators include source-relative file plus heading/page, one failed file is reported in `skipped`, and no binary bytes appear in artifacts.

- [ ] **Step 2: Verify failure**

Run: `pnpm --filter @neomei/agentwiki-local-sync test -- adapters/markitdown-adapter.spec.ts`

Expected: FAIL because the adapter is absent.

- [ ] **Step 3: Implement document collection**

```ts
export class MarkItDownAdapter implements SourceAdapter {
  constructor(private readonly runtime: RuntimeManager, private readonly run = runManagedProcess) {}
  manifest(): AdapterManifest;
  inspect(input: AdapterInput): Promise<SourceDescriptor>;
  collect(input: AdapterInput, cursor?: string): Promise<ArtifactBatch>;
}
```

Accept only `.md`, `.markdown`, `.txt`, `.pdf`, and `.docx`; apply a per-file size ceiling before reading. Normalize converted Markdown, split by heading with deterministic fallback chunks, and mark secret-containing chunks `local-only`. Store only normalized text and evidence locators. Never copy source files into `~/.agentwiki`.

- [ ] **Step 4: Run adapter tests**

Run: `pnpm --filter @neomei/agentwiki-local-sync test -- adapters/markitdown-adapter.spec.ts`

Expected: PASS, including the shared contract suite.

- [ ] **Step 5: Commit**

```bash
git add packages/local-sync/src/adapters/markitdown-adapter.ts packages/local-sync/src/adapters/markitdown-adapter.spec.ts packages/local-sync/src/document-segmentation.ts packages/local-sync/src/testing/fixtures/documents
git commit -m "feat(local-sync): add markitdown adapter"
```

### Task 6: Adapter registry and orchestrator collection integration

**Files:**
- Create: `packages/local-sync/src/adapters/registry.ts`
- Create: `packages/local-sync/src/adapters/registry.spec.ts`
- Modify: `packages/local-sync/src/orchestrator.ts`
- Modify: `packages/local-sync/src/mcp.ts`
- Modify: `packages/local-sync/src/cli.ts`
- Modify: `packages/local-sync/skill/SKILL.md`

**Interfaces:**
- Produces: `AdapterRegistry.select(path, recipeId)`, `inspect_adapters`, managed `COLLECT` transition.

- [ ] **Step 1: Write failing selection and privacy tests**

Assert a TypeScript repo selects codebase-memory, a PDF directory selects MarkItDown, mixed input may invoke both and merges by stable artifact ID, an explicit adapter override is validated, and serialized job/preview/log files contain neither fixture secrets nor absolute root paths.

- [ ] **Step 2: Verify failure**

Run: `pnpm --filter @neomei/agentwiki-local-sync test -- adapters/registry.spec.ts orchestrator.spec.ts`

Expected: FAIL because collection is not connected.

- [ ] **Step 3: Integrate collection**

```ts
export class AdapterRegistry {
  constructor(private readonly adapters: SourceAdapter[]) {}
  inspect(path: string): Promise<Array<{ adapterId: string; descriptor: SourceDescriptor }>>;
  select(path: string, recipeId: Recipe['id'], requestedAdapterId?: string): Promise<SourceAdapter[]>;
}
```

`start_knowledge_job` must canonicalize the explicit path supplied by the user's current request, verify that every Adapter remains within that root, inspect/select adapters, return the selected adapters and exact local permissions, then run the `COLLECT` stage. The explicit path in the current invocation is the local-read authorization; do not add a redundant second confirmation. Upload confirmation remains separate and mandatory. Persist artifacts under `.state/jobs/<job-id>/artifacts/` with `0600` mode.

- [ ] **Step 4: Run the phase gate**

Run:

```bash
pnpm --filter @neomei/agentwiki-local-sync test
pnpm --filter @neomei/agentwiki-local-sync typecheck
pnpm lint
pnpm --filter @neomei/agentwiki-local-sync build
```

Expected: all commands exit `0`; real local smoke on a tiny repo and one PDF reaches `PREVIEW` without retired external compiler, manual init, a model key, a port, or a daemon.

- [ ] **Step 5: Commit**

```bash
git add packages/local-sync/src/adapters/registry.ts packages/local-sync/src/adapters/registry.spec.ts packages/local-sync/src/orchestrator.ts packages/local-sync/src/mcp.ts packages/local-sync/src/cli.ts packages/local-sync/skill/SKILL.md
git commit -m "feat(local-sync): collect through managed adapters"
```
