# AgentWiki Production Readiness Closeout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Close every known AgentWiki implementation, verification, documentation, GitHub, npm, and production deployment gap with reproducible evidence.

**Architecture:** Preserve the existing React/Vite, NestJS/Prisma, Redis worker, and local-sync orchestrator architecture. Changes are limited to CLI ergonomics, safe E2E harnesses, documentation consistency, and release wiring; runtime product semantics remain unchanged.

**Tech Stack:** TypeScript, Node 24/26, pnpm, NestJS, React/Vite, Prisma/PostgreSQL, Redis, Vitest, Jest, Playwright, npm, systemd/Nginx.

## Global Constraints

- Never upload raw source repositories, binary documents, credentials, or local-only artifacts to AgentWiki.
- Agent destructive writes continue through ChangeSet unless `review:auto-publish` and Space policy both explicitly allow direct publication.
- Production E2E data must be uniquely named and removed in `finally`, including failure paths.
- Do not commit npm tarballs, secrets, `.env` files, or generated credentials.
- Every behavior change follows RED → GREEN → full regression verification.

---

### Task 1: Standardize local-sync CLI release behavior

**Files:**
- Modify: `packages/local-sync/src/cli.ts`
- Modify: `packages/local-sync/src/cli.spec.ts`
- Modify: `packages/local-sync/package.json`
- Modify: `apps/server/src/onboard/onboard.controller.ts`
- Test: `packages/local-sync/src/cli.spec.ts`

**Interfaces:**
- Produces: `runCli(argv?, home?)` returns usage text for `--help` and `{ version }` for `--version` without loading a connection.
- Produces: npm package and onboarding version `0.2.6`.

- [x] **Step 1: Write failing help/version tests**

```ts
it('returns usage for --help without requiring a connection', async () => {
  await expect(runCli(['--help'], home)).resolves.toMatch(/Usage:/);
});

it('returns the package version for --version without requiring a connection', async () => {
  await expect(runCli(['--version'], home)).resolves.toEqual({ version: '0.2.6' });
});
```

- [x] **Step 2: Run the focused test and verify RED**

Run: `pnpm --filter @neomei/agentwiki-local-sync test -- src/cli.spec.ts`

Expected: both new assertions fail because flags fall through to the usage error.

- [x] **Step 3: Add early help/version handling and bump versions**

```ts
export const CLI_USAGE = 'Usage: agentwiki-local-sync <connect|doctor|inspect|scan|preview|sync|upgrade|uninstall|mcp|start|work|preview-job|push-job|pull>';

if (values.help === true) return CLI_USAGE;
if (values.version === true) return { version: PACKAGE_VERSION };
```

Add `help` and `version` to `parseArgs` boolean options, set package/onboarding references to `0.2.6`, and keep orchestrator MCP registration enabled.

- [x] **Step 4: Verify GREEN and package smoke**

Run:

```bash
pnpm --filter @neomei/agentwiki-local-sync test
pnpm --filter @neomei/agentwiki-local-sync build
node packages/local-sync/dist/cli.js --help
node packages/local-sync/dist/cli.js --version
```

Expected: commands exit 0 and print usage/version without credentials.

### Task 2: Make destructive E2E harnesses safe and repeatable

**Files:**
- Modify: `scripts/smoke-test.mjs`
- Modify: `scripts/cross-machine-e2e.mjs`
- Modify: `scripts/test-space-agent-member.mjs`
- Create: `scripts/e2e-safety.mjs`
- Create: `scripts/e2e-safety.test.mjs`

**Interfaces:**
- Produces: `assertE2ETarget(url, env, prefix)` validates loopback by default and requires explicit remote opt-in plus confirmed HTTPS hostname.
- Produces: `cleanupFixture()` attempts Agent, Space, and User cleanup even when earlier cleanup fails.

- [x] **Step 1: Write failing safety and cleanup tests**

```js
test('remote destructive tests require opt-in and exact host confirmation', () => {
  assert.throws(() => assertE2ETarget('https://agentwiki.quukk.com/api', {}, 'AGENTWIKI_E2E'));
});

test('cleanup attempts every registered resource', async () => {
  const called = [];
  await cleanupFixture({ agentId: 'a', spaceId: 's', userId: 'u' }, async (kind) => called.push(kind));
  assert.deepEqual(called, ['agent', 'space', 'user']);
});
```

- [x] **Step 2: Verify RED**

Run: `node --test scripts/e2e-safety.test.mjs`

Expected: module/functions do not exist.

- [x] **Step 3: Implement the shared safety module and refactor scripts**

```js
export async function cleanupFixture(fixture, remove) {
  const failures = [];
  for (const [kind, id] of [['agent', fixture.agentId], ['space', fixture.spaceId], ['user', fixture.userId]]) {
    if (!id) continue;
    try { await remove(kind, id); } catch { failures.push(kind); }
  }
  if (failures.length) throw new Error(`Cleanup failed for ${failures.join(', ')}`);
}
```

Wrap every fixture lifecycle in `try/finally`, remove token/key prefixes from output, require explicit destructive opt-in, and make all assertions affect exit status.

- [x] **Step 4: Verify GREEN and runtime regression suite**

Run: `node --test scripts/*.test.mjs`

Expected: all enabled tests pass; real-DB tests may only skip when the isolated database URL is absent.

### Task 3: Consolidate superseded local knowledge documentation

**Files:**
- Delete: `docs/superpowers/specs/2026-07-28-local-knowledge-sync-design.md`
- Modify: `docs/superpowers/specs/2026-07-30-zero-config-local-knowledge-orchestrator-design.md`
- Modify: `.codex-memory/spec/local-knowledge-sync.md`

**Interfaces:**
- Produces: one authoritative zero-config architecture with codebase-memory and MarkItDown adapters plus local orchestrator; no retired compiler instruction.

- [x] **Step 1: Add a documentation contract test**

Add to `scripts/node-runtime-contract.test.mjs`:

```js
test('active local knowledge documentation does not require the retired compiler', async () => {
  const active = await readFile('docs/superpowers/specs/2026-07-30-zero-config-local-knowledge-orchestrator-design.md', 'utf8');
  assert.doesNotMatch(active, /retired compiler/);
});
```

- [x] **Step 2: Run and verify the documentation assertion**

Run: `node --test scripts/node-runtime-contract.test.mjs`

- [x] **Step 3: Mark the 2026-07-28 design superseded and update active references**

Delete the superseded design, remove the retired compiler from active acceptance paths, and keep the 2026-07-30 orchestrator design authoritative.

- [x] **Step 4: Re-run the documentation and local-sync tests**

Run: `pnpm test:runtime && pnpm --filter @neomei/agentwiki-local-sync test`

### Task 4: Run isolated database, API, Worker, and local-sync E2E

**Files:**
- No committed secrets or environment files.
- Runtime artifacts are created under temporary directories and removed afterward.

**Interfaces:**
- Consumes: isolated PostgreSQL database, Redis DB namespace, built API/Worker/local-sync CLI.
- Produces: migration, local-sync, assist, health, and cleanup evidence.

- [x] **Step 1: Create an isolated PostgreSQL database and apply all migrations**

Run `prisma migrate deploy` and `prisma migrate status` against the disposable database.

Expected: all migrations applied; the previously skipped nine real PostgreSQL tests run instead of skipping.

- [x] **Step 2: Start API and Worker with generated secrets**

Use loopback-only URLs, generated JWT/API-key secrets, and the isolated database. Poll `/api/health` until database, Redis, and audit persistence report `ok`.

- [x] **Step 3: Run local-sync E2E**

Run: `AGENTWIKI_LOCAL_SYNC_E2E=1 AGENTWIKI_API_URL=http://127.0.0.1:3000/api pnpm test:e2e:local-sync`

Expected: install, doctor, scan, preview, confirmation, ChangeSet review/publish, relation/evidence verification, no-op retry, credential revoke, and cleanup all pass.

- [x] **Step 4: Run assist routing E2E when a usable OpenCode model is available**

Run: `AGENTWIKI_ASSIST_E2E=1 AGENTWIKI_API_URL=http://127.0.0.1:3000/api pnpm test:e2e:assist`

Expected: task reaches `done` with model, tier, attempts, token usage, cost, and non-empty changes; cleanup succeeds.

- [x] **Step 5: Run safe cross-machine fixture**

Run the refactored loopback E2E and verify Agent writes, human reads/updates, Agent re-reads, and knowledge revision advances.

### Task 5: Run browser UI acceptance

**Files:**
- Modify: `scripts/test-space-agent-member.mjs`
- Create: `scripts/ui-production-smoke.mjs`

**Interfaces:**
- Produces: Playwright assertions for navigation, onboarding, Space Agent membership, desktop/mobile layouts, and cleanup.

- [x] **Step 1: Strengthen UI assertions before running**

Assert visible Agent option, viewer/editor defaults, successful member appearance, no horizontal overflow, no page errors, and bilingual labels. Replace screenshot-only checks with assertions.

- [x] **Step 2: Run against the isolated local stack**

Expected: desktop 1280x800 and mobile 390x844 pass; all created data is deleted.

- [ ] **Step 3: After deployment, run production read-only page smoke and controlled write UI E2E**

Verify `/`, `/guide`, `/onboard`, `/dashboard`, login, Space members, and local-sync guide. Use explicit remote opt-in and exact hostname confirmation.

### Task 6: Full gate, publish, GitHub, and production deployment

**Files:**
- Modify: `.codebase-memory/graph.db.zst`
- Modify: `.codex-memory/current.md`
- Modify: `README.md` only if version/usage references require it.

**Interfaces:**
- Produces: npm `0.2.6`, GitHub `master`, production service, and documentation at the same version.

- [x] **Step 1: Run all release gates**

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
git diff --check
```

Expected: zero failures; no skipped real-DB tests in the configured release environment.

- [x] **Step 2: Refresh codebase-memory full persistent index**

Expected: zero skipped source files, no `node_modules` paths, architecture/symbol/snippet/call-chain queries succeed.

- [x] **Step 3: Ensure release hygiene**

Verify no `.tgz`, `.env`, key, password, token, database dump, or temporary screenshot is staged.

- [ ] **Step 4: Commit and push the release branch, then integrate to `master`**

Use author `NeoMei <ffdeml@gmail.com>`. Push the tested commit and fast-forward `master` only after all gates pass.

- [ ] **Step 5: Publish npm `0.2.6`**

Use interactive npm WebAuthn confirmation and verify public registry `latest=0.2.6`.

- [ ] **Step 6: Deploy production and verify version parity**

Back up production, deploy API/Worker/frontend, apply migrations, verify systemd services and `/api/health`, then confirm `/api/onboard.json` uses `0.2.6`, Agent-key `/self` installation endpoint is present, and the local-sync MCP command includes `--orchestrator`.

- [x] **Step 7: Update project memory with current verified state**

Record only fresh evidence and remaining external limitations; remove completed items from `.codex-memory/current.md`.
