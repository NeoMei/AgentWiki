# Local Sync Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish one local npm package that lets Codex, Claude Code, OpenCode, and compatible Agents inspect local sources, generate an OpenWiki OKF bundle, preview the diff, ask the user, and sync only after confirmation.

**Architecture:** `@agentwiki/local-sync` is a Node 20+ CLI plus stdio MCP server. It stores credentials outside projects, installs one shared Agent Skill, calls existing local OpenWiki/MarkItDown commands, accepts optional codebase-memory output from the host Agent, and uses the AgentWiki HTTP API for state and upload.

**Tech Stack:** Node.js 20+ standard library (`util.parseArgs`, `fetch`, `FormData`, `child_process`, `fs`), TypeScript 5, MCP SDK 1.29, Zod 3, Vitest 3, OpenWiki CLI, MarkItDown CLI.

## Global Constraints

- Package name is `@agentwiki/local-sync`; initial version is `0.1.0`.
- Runtime floor is Node.js 20 even though the AgentWiki monorepo itself currently uses Node.js 26.
- Installation, upgrade, and MCP launch commands pin an exact package version; never use `latest`.
- The package never bundles or silently installs OpenWiki, codebase-memory, MarkItDown, Python, or system tools.
- `connect` installs configuration only; it never scans, invokes a model, or syncs.
- `~/.agentwiki/credentials.json` is mode `0600` on POSIX and never appears in CLI arguments or logs.
- `~/.agentwiki/sync-state.json` maps absolute paths to opaque random source keys locally and is never uploaded.
- Non-loopback OpenWiki providers require a separate explicit `allowRemoteModel: true` acknowledgement before OpenWiki runs.
- AgentWiki upload requires a fresh preview and `confirmed: true`; preview and confirmation are separate from model consent.
- Default upload contains derived Wiki, relative paths, hashes, and short evidence only; no complete raw source tree.
- Codebase-memory is invoked by the host Agent through its existing MCP connection; this package consumes only the summary the Agent passes locally.
- The implementation must work without new runtime libraries beyond MCP SDK and Zod.

Primary implementation references:

- [OpenWiki CLI and OKF v0.1](https://github.com/langchain-ai/openwiki)
- [MarkItDown CLI](https://github.com/microsoft/markitdown)
- [OpenCode local MCP configuration](https://opencode.ai/docs/mcp-servers)
- [OpenCode Agent Skills compatibility paths](https://opencode.ai/docs/skills)

---

## File Structure

- `packages/local-sync/package.json`: public package metadata, exact bin entry, Node floor, scripts, and publish files.
- `packages/local-sync/tsconfig.json`: NodeNext build configuration.
- `packages/local-sync/src/config.ts`: atomic non-secret config, credential file, source-key map, preview files, and permissions.
- `packages/local-sync/src/config.spec.ts`: temp-HOME permission and persistence tests.
- `packages/local-sync/src/agent-clients.ts`: detect/register/remove Codex, Claude Code, and OpenCode MCP clients.
- `packages/local-sync/src/agent-clients.spec.ts`: command and config-adapter tests.
- `packages/local-sync/src/agentwiki-client.ts`: enrollment exchange, access/status requests, state lookup, and multipart upload.
- `packages/local-sync/src/agentwiki-client.spec.ts`: mock HTTP tests with secret-safe errors.
- `packages/local-sync/src/local-knowledge.ts`: source inspection, provider disclosure, MarkItDown conversion, OpenWiki execution, OKF collection, hashes, and preview diff.
- `packages/local-sync/src/local-knowledge.spec.ts`: local fixture tests with injected command runner.
- `packages/local-sync/src/mcp.ts`: four local MCP tools.
- `packages/local-sync/src/cli.ts`: `connect`, `doctor`, `inspect`, `prepare`, `sync`, `upgrade`, `uninstall`, and `mcp` commands.
- `packages/local-sync/src/cli.spec.ts`: CLI orchestration and output redaction tests.
- `packages/local-sync/skill/SKILL.md`: portable Agent Skill installed to `~/.agents/skills/agentwiki-local-sync/SKILL.md`.
- `package.json`: include local-sync in root build/test/typecheck/lint gates.
- `eslint.config.js`: include the new package source in the existing Node TypeScript rule set if the current glob does not cover it.

### Task 1: Scaffold a publishable Node 20 package and secure local state

**Files:**
- Create: `packages/local-sync/package.json`
- Create: `packages/local-sync/tsconfig.json`
- Create: `packages/local-sync/src/config.ts`
- Create: `packages/local-sync/src/config.spec.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `loadConfig`, `saveConfig`, `loadCredentials`, `saveCredentials`, `getOrCreateSourceKey`, `savePreview`, `claimPreview`, `releasePreview`, `completePreview`.
- Produces: package executable `agentwiki-local-sync`.

- [ ] **Step 1: Create package metadata**

```json
{
  "name": "@agentwiki/local-sync",
  "version": "0.1.0",
  "description": "Local OpenWiki and AgentWiki synchronization for coding agents",
  "type": "module",
  "bin": { "agentwiki-local-sync": "./dist/cli.js" },
  "main": "./dist/mcp.js",
  "types": "./dist/mcp.d.ts",
  "files": ["dist", "skill", "README.md", "LICENSE"],
  "engines": { "node": ">=20" },
  "publishConfig": { "access": "public", "provenance": true },
  "scripts": {
    "build": "tsc",
    "typecheck": "tsc --noEmit --incremental false",
    "test": "vitest run",
    "prepack": "pnpm build && pnpm test"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.29.0",
    "zod": "^3.25.76"
  },
  "devDependencies": {
    "@types/node": "^26.0.0",
    "typescript": "^5.4.0",
    "vitest": "^3.2.7"
  }
}
```

Use NodeNext, ES2022, strict mode, declarations, `src` root, and `dist` output in `tsconfig.json`. Do not inherit the root Node 26 engine as a runtime restriction.

- [ ] **Step 2: Write failing secure-state tests**

```ts
it('writes credentials with POSIX mode 0600 and never into the project', async () => {
  await saveCredentials(home, { version: 1, credentials: { local: { apiKey: 'agk_secret' } } });
  const path = join(home, '.agentwiki', 'credentials.json');
  expect((await stat(path)).mode & 0o777).toBe(0o600);
  expect(await readFile(path, 'utf8')).toContain('agk_secret');
});

it('reuses an opaque source key without exposing the path', async () => {
  const first = await getOrCreateSourceKey(home, '/private/project');
  const second = await getOrCreateSourceKey(home, '/private/project');
  expect(second).toBe(first);
  expect(first).toMatch(/^[0-9a-f-]{36}$/);
});

it('claims a preview once and completes it after upload', async () => {
  await savePreview(home, { id: 'preview-1', expiresAt: new Date(Date.now() + 60_000).toISOString(), envelopePath: '/tmp/a.okf.json', envelopeHash: 'abc' });
  await expect(claimPreview(home, 'preview-1')).resolves.toMatchObject({ id: 'preview-1' });
  await expect(claimPreview(home, 'preview-1')).rejects.toThrow('already in progress');
  await completePreview(home, 'preview-1');
  await expect(claimPreview(home, 'preview-1')).rejects.toThrow('not found or expired');
});
```

- [ ] **Step 3: Run the tests and observe failure**

```bash
pnpm --filter @agentwiki/local-sync test -- src/config.spec.ts
```

Expected: FAIL because the config module does not exist.

- [ ] **Step 4: Implement atomic state files**

Use these shapes:

```ts
export interface LocalSyncConnection {
  id: string;
  serverUrl: string;
  agentId: string;
  credentialId: string;
  pluginVersion: string;
  client: 'codex' | 'claude' | 'opencode';
  mcpName: string;
}

export interface LocalSyncConfig {
  version: 1;
  defaultConnectionId?: string;
  connections: Record<string, LocalSyncConnection>;
}

export interface CredentialFile {
  version: 1;
  credentials: Record<string, { apiKey: string }>;
}
```

All writes use `mkdir({ recursive: true, mode: 0o700 })`, a random sibling temp file, `writeFile` with mode `0600`, `rename`, then `chmod(0o600)`. JSON output ends with one newline. `claimPreview` atomically renames `.json` to `.inflight` so two Agent calls cannot upload it twice; `releasePreview` restores it after a retryable transport failure, and `completePreview` deletes it after a definitive server response. Preview TTL is 30 minutes.

- [ ] **Step 5: Add package gates to the root scripts**

Change root scripts so build/test/typecheck include `@agentwiki/local-sync`; extend the lint glob to `packages/local-sync/src/**/*.ts`. Keep server/client commands unchanged.

- [ ] **Step 6: Run focused tests and build**

```bash
pnpm install --lockfile-only
pnpm --filter @agentwiki/local-sync test
pnpm --filter @agentwiki/local-sync typecheck
pnpm --filter @agentwiki/local-sync build
```

Expected: PASS and `packages/local-sync/dist/cli.js` exists.

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-lock.yaml packages/local-sync/package.json packages/local-sync/tsconfig.json packages/local-sync/src/config.ts packages/local-sync/src/config.spec.ts
git commit -m "feat: scaffold secure local sync package"
```

### Task 2: Exchange one-time codes and keep Agent credentials out of arguments

**Files:**
- Create: `packages/local-sync/src/agentwiki-client.ts`
- Create: `packages/local-sync/src/agentwiki-client.spec.ts`

**Interfaces:**
- Produces: `AgentWikiClient.exchange`, `access`, `getSyncState`, `upload`.
- Consumes: server endpoints from the server implementation plan.

- [ ] **Step 1: Write failing HTTP-client tests**

Use an injected `fetch` implementation and assert exact requests:

```ts
it('exchanges the short-lived code without logging the returned key', async () => {
  const fetch = vi.fn().mockResolvedValue(jsonResponse({
    apiKey: 'agk_secret', agentId: 'agent-1', credentialId: 'cred-1',
    serverUrl: 'https://wiki.test/api', pluginVersion: '0.1.0', scopes: ['sources:read'],
  }));
  const client = new AgentWikiClient(fetch);
  await expect(client.exchange('https://wiki.test/api', 'AW-CODE'))
    .resolves.toMatchObject({ apiKey: 'agk_secret' });
  expect(fetch).toHaveBeenCalledWith('https://wiki.test/api/integrations/local-sync/exchange', expect.objectContaining({
    method: 'POST', body: JSON.stringify({ code: 'AW-CODE' }),
  }));
});

it('uses the stored key only in the Authorization header', async () => {
  const fetch = vi.fn().mockResolvedValue(jsonResponse({ exists: false, documents: [] }));
  await new AgentWikiClient(fetch).getSyncState(connection, 'agk_secret', 'space-1', 'source-1');
  const [url, init] = fetch.mock.calls[0];
  expect(url).not.toContain('agk_secret');
  expect(JSON.stringify(init.body || '')).not.toContain('agk_secret');
  expect(init.headers.Authorization).toBe('Bearer agk_secret');
});

it('uploads multipart with confirmation and idempotency headers', async () => {
  await client.upload(connection, 'agk_secret', 'space-1', envelopeBytes, 'preview-1');
  expect(fetch).toHaveBeenCalledWith(expect.stringEndingWith('/spaces/space-1/knowledge-syncs'), expect.objectContaining({
    method: 'POST',
    headers: expect.objectContaining({
      Authorization: 'Bearer agk_secret',
      'Idempotency-Key': 'preview-1',
      'X-AgentWiki-User-Confirmed': 'true',
    }),
  }));
});
```

Also assert non-2xx errors expose `code`, HTTP status, and server message but redact any `agk_` value.

- [ ] **Step 2: Run the tests and observe failure**

```bash
pnpm --filter @agentwiki/local-sync test -- src/agentwiki-client.spec.ts
```

Expected: FAIL because the client does not exist.

- [ ] **Step 3: Implement the native-fetch client**

```ts
export class AgentWikiClient {
  constructor(private readonly request: typeof fetch = fetch) {}

  exchange(serverUrl: string, code: string): Promise<ExchangeResult>;
  access(connection: LocalSyncConnection, apiKey: string): Promise<AccessResult>;
  getSyncState(connection: LocalSyncConnection, apiKey: string, spaceId: string, sourceKey: string): Promise<KnowledgeSyncState>;
  upload(connection: LocalSyncConnection, apiKey: string, spaceId: string, bytes: Uint8Array, idempotencyKey: string): Promise<KnowledgeSyncResult>;
}
```

Define the response contracts in the same file:

```ts
export interface ExchangeResult {
  apiKey: string;
  agentId: string;
  credentialId: string;
  serverUrl: string;
  pluginVersion: string;
  scopes: string[];
}

export interface AccessResult {
  access: Array<{
    id: string;
    name: string;
    status: string;
    grants: Array<{ role: string; space: { id: string; name: string } }>;
    credentials: Array<{ id: string; scopes: string[]; active: boolean }>;
  }>;
}

export interface KnowledgeSyncState {
  exists: boolean;
  sourceId: string | null;
  sourceVersionId: string | null;
  syncedAt: string | null;
  documents: Array<{ path: string; contentHash: string }>;
}

export interface KnowledgeSyncResult {
  status: 'queued' | 'noop';
  sourceId: string;
  sourceVersionId: string;
  runId: string | null;
}
```

Normalize `serverUrl` once, use `encodeURIComponent` for path values, use native `Blob`/`FormData`, and parse the existing business-error JSON. Implement one `redactSecrets(text)` before throwing or printing errors.

- [ ] **Step 4: Run tests and commit**

```bash
pnpm --filter @agentwiki/local-sync test -- src/agentwiki-client.spec.ts
git add packages/local-sync/src/agentwiki-client.ts packages/local-sync/src/agentwiki-client.spec.ts
git commit -m "feat: add local AgentWiki sync client"
```

Expected: tests PASS and commit succeeds.

### Task 3: Install one shared Skill and register the current Agent client

**Files:**
- Create: `packages/local-sync/src/agent-clients.ts`
- Create: `packages/local-sync/src/agent-clients.spec.ts`
- Create: `packages/local-sync/skill/SKILL.md`

**Interfaces:**
- Produces: `detectClient`, `installSkill`, `registerMcp`, `removeMcp`.
- Consumes: exact package version and connection ID; never consumes the API key.

- [ ] **Step 1: Write failing adapter tests**

```ts
it('uses exact-version stdio commands without credentials', async () => {
  await registerMcp('codex', 'agentwiki-local-a1', 'connection-1', '0.1.0', runner, home);
  expect(runner).toHaveBeenCalledWith('codex', [
    'mcp', 'add', 'agentwiki-local-a1', '--', 'npx', '-y',
    '@agentwiki/local-sync@0.1.0', 'mcp', '--connection', 'connection-1',
  ], expect.anything());
  expect(JSON.stringify(runner.mock.calls)).not.toContain('agk_');
});

it('uses Claude user scope', async () => {
  await registerMcp('claude', 'agentwiki-local-a1', 'connection-1', '0.1.0', runner, home);
  expect(runner).toHaveBeenCalledWith('claude', expect.arrayContaining(['--scope', 'user']), expect.anything());
});

it('patches only its OpenCode v1 MCP entry and preserves unrelated config', async () => {
  await writeFile(join(home, '.config/opencode/opencode.json'), JSON.stringify({ theme: 'system', mcp: { other: { type: 'remote', url: 'https://mcp.test' } } }));
  await registerMcp('opencode', 'agentwiki-local-a1', 'connection-1', '0.1.0', runner, home);
  const config = JSON.parse(await readFile(join(home, '.config/opencode/opencode.json'), 'utf8'));
  expect(config.theme).toBe('system');
  expect(config.mcp.other).toBeTruthy();
  expect(config.mcp['agentwiki-local-a1'].command).toEqual([
    'npx', '-y', '@agentwiki/local-sync@0.1.0', 'mcp', '--connection', 'connection-1',
  ]);
});
```

Also test: ambiguous `auto` returns installed choices instead of guessing; duplicate identical registration is a no-op; conflicting same-name config aborts; uninstall removes only the AgentWiki entry; invalid JSON/JSONC is not overwritten.

- [ ] **Step 2: Run tests and observe failure**

```bash
pnpm --filter @agentwiki/local-sync test -- src/agent-clients.spec.ts
```

Expected: FAIL because adapters do not exist.

- [ ] **Step 3: Implement minimal adapters**

```ts
export type AgentClient = 'codex' | 'claude' | 'opencode';
export type CommandRunner = (command: string, args: string[], options?: SpawnSyncOptions) => CommandResult;

export function detectClient(requested: AgentClient | 'auto', runner: CommandRunner): AgentClient;
export async function installSkill(home: string, skillSource: string, client: AgentClient): Promise<string[]>;
export async function registerMcp(client: AgentClient, name: string, connectionId: string, version: string, runner: CommandRunner, home: string): Promise<void>;
export async function removeMcp(client: AgentClient, name: string, runner: CommandRunner, home: string): Promise<void>;
```

Resolve the packaged source with `fileURLToPath(new URL('../skill/SKILL.md', import.meta.url))`. Install the canonical copy at `~/.agents/skills/agentwiki-local-sync/SKILL.md`, which OpenCode documents as a global compatible skill source and which Codex uses in this environment. For Claude Code, also install the same bytes at `~/.claude/skills/agentwiki-local-sync/SKILL.md`; return every installed path so uninstall can remove only these known copies.

Codex command:

```text
codex mcp add <name> -- npx -y @agentwiki/local-sync@<version> mcp --connection <id>
```

Claude command:

```text
claude mcp add --scope user <name> -- npx -y @agentwiki/local-sync@<version> mcp --connection <id>
```

For OpenCode 1.x, atomically edit `~/.config/opencode/opencode.json` and add only:

```json
{
  "type": "local",
  "command": ["npx", "-y", "@agentwiki/local-sync@0.1.0", "mcp", "--connection", "connection-1"],
  "enabled": true
}
```

For OpenCode 2.x, use `mcp.servers[name]` with `disabled: false` instead of `enabled`. Detect major version from `opencode --version`; never rewrite a config that cannot be parsed as strict JSON.

- [ ] **Step 4: Write the portable Agent Skill**

The complete behavioral core must be:

```markdown
---
name: agentwiki-local-sync
description: Build a local OpenWiki knowledge base from code or documents, preview its AgentWiki diff, ask the user, and sync only after explicit confirmation.
license: MIT
compatibility: codex, claude-code, opencode
---

# AgentWiki Local Sync

Use the `agentwiki-local-sync` MCP tools for local knowledge synchronization.

1. Call `inspect_local_source` first. Do not run OpenWiki when it reports a non-local model provider until you disclose the provider and the user explicitly agrees.
2. For a code repository, call the available codebase-memory MCP architecture/search tools first. Pass a concise structure summary to `prepare_knowledge_sync`; never paste secrets or full source files into the summary.
3. Call `prepare_knowledge_sync`. This processes files locally and returns a preview; it does not upload.
4. Show the target Space, added/updated/deleted/unchanged pages, skipped files, upload size, and provider boundary exactly as returned.
5. Ask: “是否同步到 AgentWiki？” Do not infer consent from an earlier install or model-provider approval.
6. Only after a clear yes in the current conversation, call `sync_prepared_knowledge` with the returned preview ID and `confirmed: true`.
7. Report Source, Run, and review status. Never approve a ChangeSet on the Agent's behalf.

If the user refuses, stop. Do not retry, upload, or retain a reusable confirmation.
```

- [ ] **Step 5: Run tests and commit**

```bash
pnpm --filter @agentwiki/local-sync test -- src/agent-clients.spec.ts
git add packages/local-sync/src/agent-clients.ts packages/local-sync/src/agent-clients.spec.ts packages/local-sync/skill/SKILL.md
git commit -m "feat: install local sync into supported agents"
```

Expected: PASS and commit succeeds.

### Task 4: Generate local OKF from code and document sources

**Files:**
- Create: `packages/local-sync/src/local-knowledge.ts`
- Create: `packages/local-sync/src/local-knowledge.spec.ts`

**Interfaces:**
- Produces: `inspectLocalSource`, `prepareKnowledgeSync`, `buildPreview`.
- Consumes: OpenWiki output, MarkItDown output, optional codebase-memory summary, and server hash state.

- [ ] **Step 1: Write failing provider and source-inspection tests**

```ts
it('classifies loopback OpenAI-compatible OpenWiki as local', async () => {
  const result = await inspectOpenWikiProvider({
    OPENWIKI_PROVIDER: 'openai-compatible',
    OPENAI_COMPATIBLE_BASE_URL: 'http://127.0.0.1:11434/v1',
    OPENWIKI_MODEL_ID: 'llama3.2',
  });
  expect(result).toEqual(expect.objectContaining({ provider: 'openai-compatible', local: true }));
});

it('classifies a provider without a loopback base URL as remote', async () => {
  expect((await inspectOpenWikiProvider({ OPENWIKI_PROVIDER: 'anthropic' })).local).toBe(false);
});

it('refuses remote OpenWiki before independent model consent', async () => {
  await expect(prepareKnowledgeSync({ ...input, allowRemoteModel: false }, deps))
    .rejects.toThrow('Remote OpenWiki model consent is required');
  expect(deps.run).not.toHaveBeenCalledWith('openwiki', expect.anything(), expect.anything());
});
```

Source inspection recognizes: git/code repository; Markdown/TXT/PDF/DOCX documents; mixed directory; unsupported/skipped files. It displays only a user-friendly root name, never the absolute path.

- [ ] **Step 2: Write failing conversion and OKF tests**

Using temp fixtures and an injected command runner, assert:

- `.md` and `.txt` are copied into a private staging directory;
- `.pdf` and `.docx` invoke `markitdown <input> -o <output>`;
- command arguments are arrays passed to `spawn`, never a shell string;
- OpenWiki runs with `DO_NOT_TRACK=1` and `openwiki code --update --print`;
- generated `openwiki/**/*.md` files become OKF documents;
- `openwiki/INSTRUCTIONS.md` is excluded;
- optional codebase-memory summary becomes `architecture/codebase-memory.md` capped at 50 KiB;
- client hashes are SHA-256 of exact UTF-8 content;
- file errors appear in `skippedFiles` and are not silently discarded.

- [ ] **Step 3: Run tests and observe failure**

```bash
pnpm --filter @agentwiki/local-sync test -- src/local-knowledge.spec.ts
```

Expected: FAIL because local knowledge orchestration does not exist.

- [ ] **Step 4: Implement source inspection and safe command execution**

Export:

```ts
export interface SourceInspection {
  displayName: string;
  kind: 'code' | 'documents' | 'mixed';
  files: { code: number; documents: number; unsupported: number };
  provider: { provider: string; model?: string; baseUrl?: string; local: boolean };
  dependencies: { openwiki: ToolStatus; markitdown: ToolStatus; git: ToolStatus };
}

export async function inspectLocalSource(path: string, deps?: LocalKnowledgeDeps): Promise<SourceInspection>;
export async function prepareKnowledgeSync(input: PrepareInput, deps?: LocalKnowledgeDeps): Promise<PreparedKnowledge>;
```

Define the supporting contracts in the same file:

```ts
export interface ToolStatus {
  command: string;
  available: boolean;
  version?: string;
}

export interface PrepareInput {
  path: string;
  allowRemoteModel: boolean;
  codebaseMemorySummary?: string;
}

export interface OkfEnvelope {
  okfVersion: '0.1';
  sourceKey: string;
  name: string;
  kind: 'code' | 'documents' | 'mixed';
  producer: { name: 'openwiki'; version: string };
  documents: Array<{
    path: string;
    content: string;
    contentHash: string;
    evidence?: Array<{ sourcePath: string; sourceHash: string; quote: string }>;
  }>;
}

export interface LocalKnowledgeDeps {
  home: string;
  run: CommandRunner;
  now: () => Date;
}
```

Resolve and validate the local root, but return only `basename(root)`. Use `spawn`/`execFile`, no shell. Limit command runtime to 30 minutes and terminate the child on timeout. Read `OPENWIKI_PROVIDER`, `OPENWIKI_MODEL_ID`, and provider-specific base URL names from process environment plus `~/.openwiki/.env`; never return any variable whose name contains `KEY`, `TOKEN`, `SECRET`, or `PASSWORD`.

- [ ] **Step 5: Implement MarkItDown and OpenWiki adapters**

Always run OpenWiki in a `mkdtemp` staging repository so scanning never rewrites the user's `AGENTS.md`, `CLAUDE.md`, or `openwiki/` files. For a git repository, enumerate working-tree files with `git ls-files -co --exclude-standard -z`, then copy the current tracked and untracked non-ignored files into staging; reject escaping symlinks, skip files over 1 MiB, and cap staging at 10,000 files or 100 MiB. For document roots, copy `.md`/`.txt` and convert `.pdf`/`.docx` with MarkItDown into the same staging repository. Initialize a minimal git repository in staging only when OpenWiki requires it, and delete staging in `finally`. Before a remote provider run, require `allowRemoteModel === true`.

The OpenWiki command is based on the upstream documented non-interactive code update path: `openwiki code --update --print`. The MarkItDown command is `markitdown <file> -o <output>`. Spawn MarkItDown with Azure/LLM OCR and cloud-plugin variables removed (`AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT`, `AZURE_DOCUMENT_INTELLIGENCE_KEY`, `OPENAI_API_KEY`) so PDF/DOCX conversion remains offline in the MVP. Preserve OpenWiki front matter and Markdown links unchanged.

- [ ] **Step 6: Build the envelope and local preview record**

```ts
export interface PreparedKnowledge {
  envelope: OkfEnvelope;
  envelopeBytes: Uint8Array;
  sourceKey: string;
  processedFiles: number;
  skippedFiles: Array<{ path: string; reason: string }>;
  provider: SourceInspection['provider'];
}
```

Collect at most 500 Markdown documents and 10 MiB encoded JSON, use only relative POSIX paths, and reject symlinks that escape the root. Create/reuse the opaque source key through `getOrCreateSourceKey`. Do not include the absolute root in the envelope.

- [ ] **Step 7: Run tests and commit**

```bash
pnpm --filter @agentwiki/local-sync test -- src/local-knowledge.spec.ts
git add packages/local-sync/src/local-knowledge.ts packages/local-sync/src/local-knowledge.spec.ts
git commit -m "feat: prepare local OpenWiki knowledge bundles"
```

Expected: PASS and commit succeeds.

### Task 5: Enforce preview-before-sync through local MCP tools

**Files:**
- Create: `packages/local-sync/src/mcp.ts`
- Create: `packages/local-sync/src/cli.ts`
- Create: `packages/local-sync/src/cli.spec.ts`

**Interfaces:**
- Produces MCP tools: `local_sync_status`, `inspect_local_source`, `prepare_knowledge_sync`, `sync_prepared_knowledge`.
- Produces CLI commands required by installation and manual diagnostics.
- Produces: `createLocalSyncCommands(deps): LocalSyncCommands`, shared by CLI and MCP so confirmation behavior cannot drift.

- [ ] **Step 1: Write failing orchestration tests**

```ts
it('prepare returns a diff but does not upload', async () => {
  const result = await commands.prepare({ path: fixture, spaceId: 'space-1', allowRemoteModel: true });
  expect(result).toMatchObject({ added: 1, updated: 0, deleted: 0, unchanged: 0 });
  expect(result.previewId).toEqual(expect.any(String));
  expect(agentwiki.upload).not.toHaveBeenCalled();
});

it('sync requires true confirmation and an unconsumed matching preview', async () => {
  await expect(commands.sync({ previewId: 'preview-1', confirmed: false }))
    .rejects.toThrow('Explicit user confirmation is required');
  expect(agentwiki.upload).not.toHaveBeenCalled();
});

it('rejects a preview when the envelope changed after preview', async () => {
  await expect(commands.sync({ previewId: 'preview-1', confirmed: true }))
    .rejects.toThrow('Prepared knowledge changed; generate a new preview');
});
```

Also assert a successful sync consumes the preview, passes the preview ID as the idempotency key, and reports `queued` versus `noop` without approving the ChangeSet.

- [ ] **Step 2: Run tests and observe failure**

```bash
pnpm --filter @agentwiki/local-sync test -- src/cli.spec.ts
```

Expected: FAIL because command orchestration does not exist.

- [ ] **Step 3: Implement the four MCP tools**

Use `McpServer` with `StdioServerTransport`. Tool inputs are:

```ts
export interface LocalSyncCommands {
  status(): Promise<Record<string, unknown>>;
  inspect(input: { path: string }): Promise<SourceInspection>;
  prepare(input: {
    path: string;
    spaceId: string;
    allowRemoteModel: boolean;
    codebaseMemorySummary?: string;
  }): Promise<SyncPreview>;
  sync(input: { previewId: string; confirmed: true }): Promise<KnowledgeSyncResult>;
}

export function createLocalSyncCommands(deps: CommandDependencies): LocalSyncCommands;

export interface SyncPreview {
  previewId: string;
  displayName: string;
  spaceId: string;
  added: number;
  updated: number;
  deleted: number;
  unchanged: number;
  processedFiles: number;
  skippedFiles: Array<{ path: string; reason: string }>;
  uploadBytes: number;
  provider: SourceInspection['provider'];
  expiresAt: string;
}

export interface CommandDependencies {
  connection: LocalSyncConnection;
  readApiKey: () => Promise<string>;
  client: AgentWikiClient;
  inspectLocalSource: typeof inspectLocalSource;
  prepareKnowledgeSync: typeof prepareKnowledgeSync;
  savePreview: typeof savePreview;
  claimPreview: typeof claimPreview;
  releasePreview: typeof releasePreview;
  completePreview: typeof completePreview;
  now: () => Date;
}
```

`CommandDependencies` contains the loaded connection, credential accessor, config store, `AgentWikiClient`, and local-knowledge functions. Tests construct it with fakes; production constructs it once for CLI or MCP.

Tool schemas are:

```ts
local_sync_status: {}
inspect_local_source: { path: z.string().min(1) }
prepare_knowledge_sync: {
  path: z.string().min(1),
  spaceId: z.string().min(1),
  allowRemoteModel: z.boolean().default(false),
  codebaseMemorySummary: z.string().max(50_000).optional(),
}
sync_prepared_knowledge: {
  previewId: z.string().uuid(),
  confirmed: z.literal(true),
}
```

`prepare_knowledge_sync` calls server state after local generation, computes added/updated/deleted/unchanged by path/hash, saves the envelope plus its hash in a 30-minute preview record, and returns the exact confirmation summary. `sync_prepared_knowledge` atomically consumes the preview, verifies its envelope hash, uploads once, deletes the temporary envelope, and reports Run/review status.

- [ ] **Step 4: Implement CLI parsing with Node standard library**

Use `parseArgs`, not Commander. Supported commands:

```text
agentwiki-local-sync connect --server <url> --code <code> --agent auto|codex|claude|opencode
agentwiki-local-sync doctor [--connection <id>]
agentwiki-local-sync inspect --path <path>
agentwiki-local-sync scan --path <path> --space <id> [--allow-remote-model]
agentwiki-local-sync preview --id <preview-id>
agentwiki-local-sync sync --preview <id> --confirm
agentwiki-local-sync upgrade --agent auto|codex|claude|opencode
agentwiki-local-sync uninstall --agent auto|codex|claude|opencode [--delete-credential] [--delete-sync-state]
agentwiki-local-sync mcp --connection <id>
```

`connect` flow is: preflight → install shared Skill → register credential-free MCP command → exchange code → atomically save connection/credential → run doctor. If exchange fails before credential receipt, remove the new MCP registration. If failure happens after exchange, retain the credential and print a masked recovery command using the connection ID.

`scan` calls the same prepare-and-diff function as the MCP `prepare_knowledge_sync` tool and stores a preview; `preview` only renders an existing unexpired preview. This preserves the public CLI names from the design without duplicating scanning logic.

`doctor` checks: Node version, package version, local files/modes, AgentWiki access identity, Space grants/scopes, MCP registration, OpenWiki >= 0.2.0, MarkItDown >= 0.1.0, git, codebase-memory presence in the selected client's MCP list, and provider boundary. It never invokes OpenWiki or scans a path.

`uninstall` removes only its MCP entry and decrements shared Skill usage; it preserves `sync-state.json` and credentials unless the matching explicit flags are present. It reminds the user that server-side revocation remains authoritative.

- [ ] **Step 5: Add a shebang and secret-safe output**

The first line of `cli.ts` is:

```ts
#!/usr/bin/env node
```

All output passes through a formatter that replaces `/\b(?:agk|awk)_[A-Za-z0-9_-]+\b/g` with `[REDACTED]`. Never serialize the credential object in thrown errors.

- [ ] **Step 6: Run focused tests and commit**

```bash
pnpm --filter @agentwiki/local-sync test -- src/cli.spec.ts
pnpm --filter @agentwiki/local-sync typecheck
git add packages/local-sync/src/mcp.ts packages/local-sync/src/cli.ts packages/local-sync/src/cli.spec.ts
git commit -m "feat: add preview-gated local sync MCP"
```

Expected: PASS and commit succeeds.

### Task 6: Package, install, and exercise the plugin in isolated homes

**Files:**
- Create: `packages/local-sync/README.md`
- Create: `packages/local-sync/LICENSE`
- Modify only files required by failures from this task.

**Interfaces:**
- Consumes the complete local package.
- Produces a packable tarball and verified Codex/Claude/OpenCode configuration behavior.

- [ ] **Step 1: Document only executable behavior**

README sections:

1. “Not yet published” until the npm publish step succeeds.
2. Node 20+ and `npx` prerequisites.
3. The AgentWiki-generated one-time instruction as the only recommended install path.
4. `doctor`, prepare/confirm/sync, upgrade, and uninstall commands.
5. Local/remote data boundaries and credential locations.
6. Supported client matrix with the exact versions actually tested.

Use the repository MIT license text in `LICENSE`.

- [ ] **Step 2: Run package gates**

```bash
pnpm --filter @agentwiki/local-sync test
pnpm --filter @agentwiki/local-sync typecheck
pnpm --filter @agentwiki/local-sync build
pnpm --filter @agentwiki/local-sync pack --pack-destination /tmp/agentwiki-local-sync-pack
```

Expected: one `agentwiki-local-sync-0.1.0.tgz`; tar listing contains only `dist`, `skill`, README, LICENSE, and package metadata; no fixture, `.env`, credential, or absolute path.

- [ ] **Step 3: Test real client registration in isolated HOME directories**

For each installed client binary, set a new temporary `HOME`, run the packed CLI with a mock enrollment server, then inspect only that temporary home:

```bash
HOME=<temp-home> npx -y /tmp/agentwiki-local-sync-pack/agentwiki-local-sync-0.1.0.tgz connect --server http://127.0.0.1:<mock-port>/api --code AW-TEST-CODE --agent codex
HOME=<temp-home> codex mcp get agentwiki-local-<suffix>
```

Repeat for Claude Code and OpenCode. Expected: shared Skill is discoverable, MCP command contains the exact package version and connection ID, no command/config contains the API key, credential mode is `0600`, and `doctor` passes against the mock server.

- [ ] **Step 4: Test upgrade and uninstall**

Run explicit-version upgrade, confirm the MCP command changes only to the target version, then uninstall. Expected: MCP entry removed, shared Skill retained only while another connection uses it, `sync-state.json` retained by default, and no unrelated client configuration changes.

- [ ] **Step 5: Run full repository gates**

```bash
pnpm test
pnpm typecheck
pnpm build
pnpm lint
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 6: Commit**

```bash
git add packages/local-sync/README.md packages/local-sync/LICENSE
git commit -m "docs: document local sync plugin"
```

### Task 7: Publish only after the release prerequisites are satisfied

**Files:**
- Modify: `packages/local-sync/README.md`
- Modify: `README.md`

**Interfaces:**
- Consumes verified tarball from Task 6.
- Produces npm `@agentwiki/local-sync@0.1.0` and matching GitHub tag/release.

- [ ] **Step 1: Verify external release prerequisites**

Run:

```bash
npm whoami
npm access ls-packages
npm view @agentwiki/local-sync version
```

Expected before first publish: authenticated npm identity controls the `@agentwiki` scope and the package lookup returns 404. If scope ownership is missing, stop here; do not substitute another package name without user approval.

- [ ] **Step 2: Inspect the exact tarball**

```bash
npm pack --dry-run --workspace packages/local-sync
```

Expected: no secrets, local paths, test fixtures, source maps containing absolute paths, or unpublished commands.

- [ ] **Step 3: Publish with provenance**

```bash
pnpm --filter @agentwiki/local-sync publish --access public --provenance
```

Expected: npm reports `@agentwiki/local-sync@0.1.0` published. This external mutation requires the user's explicit release authorization at execution time.

- [ ] **Step 4: Verify from a clean npm cache**

```bash
npm view @agentwiki/local-sync@0.1.0 dist.integrity engines bin
npx -y @agentwiki/local-sync@0.1.0 --help
```

Expected: integrity present, Node floor `>=20`, bin points to `dist/cli.js`, and help exits 0.

- [ ] **Step 5: Remove the unpublished warning and commit release docs**

Replace “Not yet published” with the verified install status and link the exact npm version. Then:

```bash
git add packages/local-sync/README.md README.md
git commit -m "docs: publish local sync plugin installation"
```

- [ ] **Step 6: Tag and release**

```bash
git tag local-sync-v0.1.0
git push origin master local-sync-v0.1.0
gh release create local-sync-v0.1.0 --verify-tag --title "AgentWiki Local Sync 0.1.0" --notes-file packages/local-sync/README.md
```

Expected: GitHub tag/release and npm package identify the same commit and version. Pushing/tagging/releasing requires the user's explicit authorization at execution time.
