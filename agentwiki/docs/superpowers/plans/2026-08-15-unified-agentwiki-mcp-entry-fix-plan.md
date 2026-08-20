# Unified AgentWiki MCP Entry Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the two competing Agent connection instructions and make an existing Agent install or update the single unified `agentwiki` gateway through `onboard --code`.

**Architecture:** Ordinary Agent Credentials remain API/script credentials and no longer register MCP. A new existing-Agent attachment path exchanges the current one-time installation code, confirms and migrates old AgentWiki MCP entries, then installs and verifies the same gateway used by full onboarding. The gateway remains the only client MCP and routes `wiki_*`, `local_*`, and `knowledge_*` tools.

**Tech Stack:** TypeScript, React 18/Vitest/Testing Library, NestJS/Jest, Node CLI, MCP SDK, pnpm.

## Global Constraints

- A client receives exactly one stdio MCP named `agentwiki`.
- Do not restore the retired public `connect` command or a direct remote MCP installation path.
- Ordinary Credential creation shows the one-time API key but no MCP instructions.
- Existing-Agent attachment uses exact-version `onboard --server <url> --code <code> --protocol ndjson` and does not run Device Auth, create a new Agent, scan, or sync.
- API keys never enter MCP configuration, command output, documentation fixtures, or Agent prompts.
- Configuration mutation remains confirmed, atomic, hash-checked, backed up, and reversible on failure.
- This patch is version `0.3.7`; published `0.3.6` is immutable.

---

### Task 1: Lock the single-gateway instruction contract

**Files:**
- Modify: `apps/server/src/core/agent/local-sync-installation.service.spec.ts`
- Modify: `apps/client/src/features/agent/AgentDetail.spec.tsx`
- Modify: `apps/client/src/features/agent/LocalSyncInstallCard.spec.tsx`
- Modify: `scripts/node-runtime-contract.test.mjs`

**Interfaces:**
- Consumes: current Agent Credential response `{ apiKey: string }` and local-sync installation response `{ instructions: string }`.
- Produces: regression assertions that reject direct MCP setup and retired `connect` instructions on every active surface.

- [x] **Step 1: Add the failing server instruction assertion**

Replace the legacy expectation with assertions equivalent to:

```ts
expect(result.instructions).toContain('@neomei/agentwiki-local-sync@0.3.7 onboard');
expect(result.instructions).toContain(`--code ${result.code}`);
expect(result.instructions).toContain('--protocol ndjson');
expect(result.instructions).not.toMatch(/\bconnect\b/);
```

- [x] **Step 2: Add failing client assertions**

Extend `AgentDetail.spec.tsx` so a mocked successful Credential creation renders the API key but no text matching `/MCP|mcp add|接入指令|Connect instructions/`. Update `LocalSyncInstallCard.spec.tsx` fixture and assertions to require `onboard --code`, exact `0.3.7`, and absence of `connect`.

- [x] **Step 3: Add a failing repository-wide runtime contract**

Read `connectInstructions.ts`, `AgentDetail.tsx`, `local-sync-installation.service.ts`, `packages/local-sync/README.md`, and the local-sync skill. Assert active files contain no direct `/api/mcp` registration instruction, no `mcp add agentwiki-`, no `connect --server`, and no heading that advertises two MCP servers.

- [x] **Step 4: Run the focused tests and verify RED**

Run:

```bash
pnpm --filter @agentwiki/server test -- local-sync-installation.service.spec.ts
pnpm --filter @agentwiki/client test -- AgentDetail.spec.tsx LocalSyncInstallCard.spec.tsx
node --test scripts/node-runtime-contract.test.mjs
```

Expected: failures show the current direct Credential MCP prompt, `connect` instruction, and stale two-MCP documentation.

---

### Task 2: Implement existing-Agent `onboard --code` attachment

**Files:**
- Create: `packages/local-sync/src/onboarding/attach.ts`
- Create: `packages/local-sync/src/onboarding/attach.spec.ts`
- Modify: `packages/local-sync/src/cli.ts`
- Modify: `packages/local-sync/src/cli.spec.ts`
- Modify: `packages/local-sync/src/onboarding/install.ts`
- Modify: `packages/local-sync/src/onboarding/install.spec.ts`

**Interfaces:**
- Consumes: `AgentWikiClient.exchange(serverBaseUrl, code)`, `detectClient(requested, runner)`, `preflight(client, home, serverBaseUrl)`, `installGatewayEntry(...)`, `verifyGateway(...)`.
- Produces:

```ts
export interface AttachCliInput {
  home: string;
  protocol: 'ndjson' | 'human';
  serverBaseUrl: string;
  code: string;
  requestedClient: AgentClient | 'auto';
}

export interface AttachReport {
  connectionId: string;
  agentId: string;
  client: AgentClient;
  mcpName: 'agentwiki';
  migratedEntries: string[];
  configBackupPath: string;
  manifestHash: string;
  reloadRequired: boolean;
}

export function runAttachment(input: AttachCliInput, overrides?: Partial<AttachmentDependencies>): Promise<AttachReport>;
```

- [x] **Step 1: Write failing CLI routing tests**

Add an `attach` method to `CliRuntime`, then assert:

```ts
await runCli([
  'onboard', '--server', 'https://wiki.test/api', '--code', 'AW-TEST',
  '--protocol', 'ndjson', '--agent', 'codex',
], home, { attach });

expect(attach).toHaveBeenCalledWith({
  home,
  protocol: 'ndjson',
  serverBaseUrl: 'https://wiki.test/api',
  code: 'AW-TEST',
  requestedClient: 'codex',
});
expect(onboard).not.toHaveBeenCalled();
```

Also assert `onboard resume --code` is rejected and `onboard --code` requires a non-empty code.

- [x] **Step 2: Run the CLI test and verify RED**

Run: `pnpm --filter @neomei/agentwiki-local-sync test -- src/cli.spec.ts`

Expected: FAIL because `--code` and `CliRuntime.attach` do not exist.

- [x] **Step 3: Implement minimal CLI dispatch**

Add `code` to `parseArgs`, add `requestedClient` to attachment input, and route `onboard --code` to `runAttachment`. Preserve the existing full onboarding and resume branches unchanged. Update `CLI_USAGE` to document optional `--code CODE` without adding a new public command.

- [x] **Step 4: Write failing attachment orchestration tests**

Use injected real-function dependencies to verify this exact order:

```ts
[
  'detect-client', 'analyze-config', 'confirm-plan', 'exchange-code',
  'archive-state', 'save-connection', 'install-skill', 'install-gateway',
  'verify-gateway', 'verify-access',
]
```

Assert the saved connection has `mcpName: 'agentwiki'`, the exchanged `agentId` and `credentialId`, and no scan/sync dependency. Add failure cases for denied confirmation, invalid code, gateway verification failure, and rollback/revoke cleanup.

- [x] **Step 5: Run the attachment test and verify RED**

Run: `pnpm --filter @neomei/agentwiki-local-sync test -- src/onboarding/attach.spec.ts`

Expected: FAIL because `runAttachment` does not exist.

- [x] **Step 6: Extract the shared installation primitive**

Refactor `onboarding/install.ts` so bootstrap and attachment both call a package-private primitive with the following boundary:

```ts
interface ExchangedGatewayInstallInput {
  home: string;
  client: AgentClient;
  expectedConfigHash: string;
  exchange: ExchangeResult;
  connectionId: string;
  expectedAgentId?: string;
  expectedPluginVersion: string;
}

async function installExchangedGateway(
  input: ExchangedGatewayInstallInput,
  deps: GatewayInstallDependencies,
): Promise<{ connection: LocalSyncConnection; backupPath: string; manifestHash: string }>;
```

The primitive archives/initializes local state, persists the credential at `0600`, installs the Skill and gateway, verifies MCP and remote access, and rolls back/revokes on failure. The existing bootstrap path still validates its confirmed Agent/Space before calling it.

- [x] **Step 7: Implement the attachment protocol**

`runAttachment` must emit a bounded preview containing only client, server origin, `oldEntries`, `reloadRequired`, and the fixed MCP name. It requests one confirmation through the existing NDJSON/human protocol types, then calls the shared installation primitive. It must never emit the installation code or API key.

- [x] **Step 8: Run focused local-sync tests and verify GREEN**

Run:

```bash
pnpm --filter @neomei/agentwiki-local-sync test -- src/cli.spec.ts src/onboarding/attach.spec.ts src/onboarding/install.spec.ts
```

Expected: all selected files pass with zero failures.

- [x] **Step 9: Commit the attachment runtime**

```bash
git add packages/local-sync/src/cli.ts packages/local-sync/src/cli.spec.ts \
  packages/local-sync/src/onboarding/attach.ts packages/local-sync/src/onboarding/attach.spec.ts \
  packages/local-sync/src/onboarding/install.ts packages/local-sync/src/onboarding/install.spec.ts
git commit -m "feat(local-sync): attach existing agents through unified gateway"
```

---

### Task 3: Make AgentWiki MCP configuration ownership precise

**Files:**
- Modify: `packages/local-sync/src/installer/plan.ts`
- Modify: `packages/local-sync/src/installer/plan.spec.ts`
- Modify: `packages/local-sync/src/installer/client-config.ts`
- Modify: `packages/local-sync/src/installer/client-config.spec.ts`
- Modify: `packages/local-sync/src/onboarding/preflight.ts`
- Modify: `packages/local-sync/src/onboarding/preflight.spec.ts`
- Modify: `packages/local-sync/src/onboarding/coordinator.ts`
- Modify: `packages/local-sync/src/onboarding/coordinator.spec.ts`

**Interfaces:**
- Consumes: the current public server base URL.
- Produces:

```ts
export function looksLikeLegacyAgentWikiEntry(
  name: string,
  commandText: string,
  serverBaseUrl?: string,
): boolean;

export async function analyzeConfig(
  client: AgentClient,
  home?: string,
  serverBaseUrl?: string,
): Promise<{ hash: string; oldEntries: string[]; hasConflict: boolean }>;
```

- [x] **Step 1: Write failing ownership tests**

For Codex, Claude and OpenCode fixtures, assert that entries containing `@neomei/agentwiki-local-sync` or the current server `/api/mcp` endpoint are migration candidates, while `my-agentwiki-helper` pointing elsewhere is preserved. Assert uninstall removes only an `agentwiki` entry whose command contains the local-sync package and leaves an unknown same-name entry untouched.

- [x] **Step 2: Run installer tests and verify RED**

Run:

```bash
pnpm --filter @neomei/agentwiki-local-sync test -- src/installer/plan.spec.ts src/installer/client-config.spec.ts
```

Expected: FAIL because matching currently relies on broad name/domain heuristics and uninstall deletes by name alone.

- [x] **Step 3: Implement endpoint- and signature-based ownership**

Normalize `serverBaseUrl` to its origin/path prefix, match the package signature or the exact current `/mcp` endpoint, and keep only explicit historical local-sync names as name-based compatibility. Change TOML block handling to inspect the complete block, not only the header. `removeGatewayEntry` must require both name `agentwiki` and local-sync package signature.

- [x] **Step 4: Propagate server URL through preflight**

Extend `PreflightFn` with optional `serverBaseUrl`, pass it from the coordinator and attachment path, and update mocks/tests. No server/client type is added; the value remains a generic HTTP base URL.

- [x] **Step 5: Run focused installer/onboarding tests and verify GREEN**

Run:

```bash
pnpm --filter @neomei/agentwiki-local-sync test -- \
  src/installer/plan.spec.ts src/installer/client-config.spec.ts \
  src/onboarding/preflight.spec.ts src/onboarding/coordinator.spec.ts
```

Expected: all selected files pass.

- [x] **Step 6: Commit ownership hardening**

```bash
git add packages/local-sync/src/installer packages/local-sync/src/onboarding/preflight* \
  packages/local-sync/src/onboarding/coordinator*
git commit -m "fix(local-sync): scope MCP migration to owned AgentWiki entries"
```

---

### Task 4: Remove the direct Credential MCP entry and update server instructions

**Files:**
- Delete: `apps/client/src/features/agent/connectInstructions.ts`
- Delete: `apps/client/src/features/agent/connectInstructions.spec.ts`
- Modify: `apps/client/src/features/agent/AgentDetail.tsx`
- Modify: `apps/client/src/features/agent/AgentDetail.spec.tsx`
- Modify: `apps/client/src/i18n/messages.ts`
- Modify: `apps/client/src/features/agent/LocalSyncInstallCard.tsx`
- Modify: `apps/client/src/features/agent/LocalSyncInstallCard.spec.tsx`
- Modify: `apps/server/src/core/agent/local-sync-installation.service.ts`
- Modify: `apps/server/src/core/agent/local-sync-installation.service.spec.ts`

**Interfaces:**
- Consumes: existing REST endpoints for Credential creation and local-sync installation creation.
- Produces: one-time API-key display for ordinary Credentials and exact-version unified gateway instructions for existing Agents.

- [x] **Step 1: Implement the server instruction change**

Generate exactly:

```text
Run this pinned command with your local Agent:
npx --yes @neomei/agentwiki-local-sync@0.3.7 onboard --server <url> --code <code> --protocol ndjson --agent auto
After installation, report the complete doctor output to the user.
Installation only configures the unified agentwiki gateway; it does not scan or sync local knowledge.
```

- [x] **Step 2: Remove the Credential connect prompt**

Delete the `buildAgentConnectInstructions` import, state, copy button and `<pre>` from `AgentDetail`. Keep the one-time key and copy-key button, and add localized copy explaining that the key is for API/scripts/external systems while Agent access uses the unified gateway card above.

- [x] **Step 3: Update the local-sync card copy**

Rename its visible purpose from a second “local sync connection” to installing/updating the unified AgentWiki gateway. Preserve the short expiry, explicit scopes, copy, regenerate, error and timer behavior.

- [x] **Step 4: Run server/client focused tests and verify GREEN**

Run:

```bash
pnpm --filter @agentwiki/server test -- local-sync-installation.service.spec.ts
pnpm --filter @agentwiki/client test -- AgentDetail.spec.tsx LocalSyncInstallCard.spec.tsx
```

Expected: all selected tests pass and no rendered Credential panel contains MCP instructions.

- [x] **Step 5: Commit product surface changes**

```bash
git add apps/client/src/features/agent apps/client/src/i18n/messages.ts \
  apps/server/src/core/agent/local-sync-installation.service.ts \
  apps/server/src/core/agent/local-sync-installation.service.spec.ts
git commit -m "fix(onboarding): expose only the unified AgentWiki gateway"
```

---

### Task 5: Align version, documentation, Skill and contract gates

**Files:**
- Modify: `package.json`
- Modify: `apps/server/package.json`
- Modify: `apps/client/package.json`
- Modify: `packages/local-sync/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `.env.example`
- Modify: `apps/server/.env.example`
- Modify: `apps/client/src/features/about/UsageGuide.tsx`
- Modify: `apps/client/src/features/about/UsageGuide.spec.tsx`
- Modify: `apps/client/src/features/about/LocalSyncGuideSection.tsx`
- Modify: `packages/local-sync/README.md`
- Modify: `packages/local-sync/skill/SKILL.md`
- Modify: `apps/server/src/onboard/onboard.controller.ts`
- Modify: `scripts/node-runtime-contract.test.mjs`

**Interfaces:**
- Consumes: the implemented `0.3.7` CLI and single gateway behavior.
- Produces: every active instruction surface advertises only the exact `0.3.7 onboard` command and one gateway.

- [x] **Step 1: Update all version-bearing files to `0.3.7`**

Use the package manager to update lockfile metadata after changing workspace package versions. Update `LOCAL_SYNC_PACKAGE_VERSION` examples and runtime constants to the same exact version.

- [x] **Step 2: Rewrite stale documentation**

Remove the “Two MCP servers” section and retired `mcp`, `connect`, upgrade and per-connection registration examples from the npm README. Describe the direct server MCP only as an internal bridge target of the local gateway. Update the Skill and UI guide so existing-Agent setup uses `onboard --code`, while global setup uses Device Auth `onboard`.

- [x] **Step 3: Run runtime and UI documentation tests**

Run:

```bash
node --test scripts/node-runtime-contract.test.mjs
pnpm --filter @agentwiki/client test -- UsageGuide.spec.tsx LocalSyncGuideSection.spec.tsx
```

Expected: all tests pass; active instruction surfaces contain no direct remote MCP registration or retired `connect` command.

- [x] **Step 4: Inspect the npm tarball**

Run in a fresh temporary directory:

```bash
agentwiki_pack_dir="$(mktemp -d)"
pnpm --filter @neomei/agentwiki-local-sync pack --pack-destination "$agentwiki_pack_dir"
```

Inspect the generated tarball file list and unpacked README/Skill/CLI help. Expected: version `0.3.7`, one gateway, no secret, no direct MCP installation path, no public `connect` command.

- [x] **Step 5: Commit release surfaces**

```bash
git add package.json apps/server/package.json apps/client/package.json \
  packages/local-sync/package.json pnpm-lock.yaml .env.example apps/server/.env.example \
  apps/client/src/features/about packages/local-sync/README.md packages/local-sync/skill/SKILL.md \
  apps/server/src/onboard/onboard.controller.ts scripts/node-runtime-contract.test.mjs
git commit -m "chore(release): prepare unified gateway 0.3.7"
```

---

### Task 6: Full verification and handoff

**Files:**
- Create: `docs/verification/unified-agentwiki-mcp-0.3.7.md`
- Modify: `.codex-memory/current.md`
- Create: `.codex-memory/tasks/active/unified-agentwiki-mcp-fix/brief.md`
- Create: `.codex-memory/tasks/active/unified-agentwiki-mcp-fix/decisions.md`
- Create: `.codex-memory/tasks/active/unified-agentwiki-mcp-fix/refs.md`

**Interfaces:**
- Consumes: Tasks 1-5.
- Produces: fresh verification evidence and durable handoff state; no release/deployment side effect.

- [x] **Step 1: Run the complete local gate**

Run independently and require exit code zero:

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
git diff --check
```

- [x] **Step 2: Run the single-gateway behavioral checks**

Run the onboarding E2E against an explicit local/isolated target where available. At minimum verify generated existing-Agent instructions, `onboard --code` NDJSON confirmation, one config entry named `agentwiki`, gateway handshake/tool list, Credential panel without MCP instructions, rollback, uninstall ownership, and absence of direct/legacy commands.

- [x] **Step 3: Write the verification report**

Record exact commands, test counts, skipped external dependencies, package/tarball version, config fixtures and known non-blocking warnings in `docs/verification/unified-agentwiki-mcp-0.3.7.md`.

- [x] **Step 4: Update project memory**

Set the active goal and current status to this fix, link the design, plan and verification report, and preserve unrelated deployment/history information. Do not stage `.codebase-memory/graph.db.zst` or unrelated submodule changes.

- [x] **Step 5: Commit the verification handoff**

```bash
git add docs/verification/unified-agentwiki-mcp-0.3.7.md .codex-memory
git commit -m "docs: verify unified AgentWiki gateway 0.3.7"
```

- [x] **Step 6: Stop before external release**

Report the verified branch and remaining explicit release actions: npm publish `0.3.7`, push/merge, production backup/deploy, health checks and three-client production acceptance. Do not perform those external writes unless separately authorized.
