# AgentWiki Node 26-Only Compatibility Implementation Plan

> Superseded on 2026-07-30: the current runtime contract supports Node 24 and Node 26 and defaults to Node 24. This completed plan remains as historical implementation evidence.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Node.js 26 the only supported AgentWiki runtime across local development, tests, builds, Docker, and direct deployment.

**Architecture:** Establish a repository-level Node 26 contract, add a tested Node-based supervisor for the three development processes, and isolate Vitest workers from Node 26's process-global Web Storage so jsdom owns browser storage. Keep the application framework versions and production topology unchanged.

**Tech Stack:** Node.js 26, pnpm 11.9, Node built-in test runner, Vitest 3/jsdom, React/Vite, NestJS, Prisma, Docker, Bash/systemd.

## Global Constraints

- Only `agentwiki/` is adapted; reference projects remain untouched.
- Node.js `>=26 <27` is the only supported runtime; Node 20, 22, and 24 compatibility is not retained.
- Keep pnpm at `11.9.0` and do not upgrade unrelated application dependencies.
- Keep the existing API, Worker, frontend, PostgreSQL, Redis, and systemd topology unchanged.
- Preserve all current authorization, provenance, review, memory, MCP, localization, and Markdown workspace behavior.
- Run every verification command with `node --version` reporting major 26.
- Run package, test, build, and runtime commands from `agentwiki/`; run the listed `git add` and `git commit` commands from the repository root.

> **完成记录（2026-07-27）：** 本计划全部步骤已完成；已验证的 Node 26.5.0 + pnpm 11.9.0 基线、测试、构建、迁移、开发服务健康检查和图谱证据见 `.codex-memory/current.md`。

---

### Task 1: Declare and enforce the Node 26 runtime contract

**Files:**
- Create: `agentwiki/.node-version`
- Create: `agentwiki/scripts/node26-contract.test.mjs`
- Modify: `agentwiki/package.json`
- Modify: `agentwiki/apps/server/package.json`
- Modify: `agentwiki/pnpm-lock.yaml`
- Modify: `agentwiki/apps/server/Dockerfile`
- Modify: `agentwiki/apps/client/Dockerfile`
- Modify: `agentwiki/docker-compose.yml`
- Modify: `agentwiki/deploy.sh`

**Interfaces:**
- Consumes: Node 26 at `node`, pnpm 11.9.0, current workspace manifests.
- Produces: `engines.node = ">=26 <27"`, `.node-version = 26`, Node 26 Docker defaults, a remote deployment preflight, and `pnpm test:runtime`.

- [x] **Step 1: Write the failing runtime-contract test**

Create `scripts/node26-contract.test.mjs`:

```js
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFile(resolve(root, path), 'utf8');

test('the repository declares Node 26 as its only runtime', async () => {
  assert.equal(process.versions.node.split('.')[0], '26');

  const packageJson = JSON.parse(await read('package.json'));
  assert.equal(packageJson.engines.node, '>=26 <27');
  assert.equal(packageJson.packageManager, 'pnpm@11.9.0');
  assert.equal((await read('.node-version')).trim(), '26');

  const serverPackage = JSON.parse(await read('apps/server/package.json'));
  assert.equal(serverPackage.devDependencies['@types/node'], '^26.0.0');
});

test('Docker and direct deployment enforce Node 26', async () => {
  const runtimeFiles = await Promise.all([
    read('apps/server/Dockerfile'),
    read('apps/client/Dockerfile'),
    read('docker-compose.yml'),
  ]);
  for (const source of runtimeFiles) {
    assert.match(source, /node:26-alpine/);
    assert.doesNotMatch(source, /node:20-alpine/);
  }

  const deploy = await read('deploy.sh');
  assert.match(deploy, /REQUIRED_NODE_MAJOR="26"/);
  assert.match(deploy, /\/usr\/bin\/node/);
  assert.match(deploy, /requires Node\.js 26/);
});
```

- [x] **Step 2: Run the contract test and verify the expected failure**

Run:

```bash
export PATH="/usr/local/bin:$PATH"
node --version
node --test scripts/node26-contract.test.mjs
```

Expected: Node reports `v26.x`; the test fails because `engines`, `packageManager`, `.node-version`, Node 26 type declarations, Docker defaults, and deployment preflight are absent.

- [x] **Step 3: Add the repository and type-level runtime declarations**

Add `.node-version`:

```text
26
```

Update the root manifest with:

```json
{
  "name": "agentwiki",
  "version": "0.0.1",
  "private": true,
  "engines": {
    "node": ">=26 <27"
  },
  "packageManager": "pnpm@11.9.0",
  "scripts": {
    "test:runtime": "node --test scripts/*.test.mjs"
  }
}
```

Preserve every existing script and dependency; add `test:runtime` alongside them. Change the server manifest's direct declaration to:

```json
"@types/node": "^26.0.0"
```

Regenerate only the lockfile changes implied by that manifest edit:

```bash
pnpm install --lockfile-only
pnpm install --frozen-lockfile
```

- [x] **Step 4: Change Docker defaults to Node 26**

In both Dockerfiles use:

```dockerfile
ARG NODE_IMAGE=node:26-alpine
```

In both `docker-compose.yml` build argument locations use:

```yaml
NODE_IMAGE: ${NODE_IMAGE:-node:26-alpine}
```

- [x] **Step 5: Add local and remote deployment preflight checks**

Immediately after `set -euo pipefail` in `deploy.sh`, add:

```bash
REQUIRED_NODE_MAJOR="26"

require_node_26() {
  local executable="${1:-node}"
  local version major
  version="$(${executable} --version 2>/dev/null || true)"
  major="${version#v}"
  major="${major%%.*}"
  if [ "${major}" != "${REQUIRED_NODE_MAJOR}" ]; then
    echo "AgentWiki requires Node.js 26; ${executable} reports ${version:-not installed}." >&2
    return 1
  fi
}

require_node_26 node
```

Immediately after the remote heredoc's `set -euo pipefail`, add the escaped remote check:

```bash
required_node_major="26"
node_binary="/usr/bin/node"
node_version="\$("\$node_binary" --version 2>/dev/null || true)"
node_major="\${node_version#v}"
node_major="\${node_major%%.*}"
if [ "\$node_major" != "\$required_node_major" ]; then
  echo "AgentWiki requires Node.js 26; \$node_binary reports \${node_version:-not installed}." >&2
  exit 1
fi
```

- [x] **Step 6: Verify the runtime contract turns green**

Run:

```bash
node --test scripts/node26-contract.test.mjs
pnpm install --frozen-lockfile
```

Expected: the contract test passes and the frozen install exits 0 without an unsupported-engine warning.

- [x] **Step 7: Commit the runtime contract**

```bash
git add agentwiki/.node-version agentwiki/scripts/node26-contract.test.mjs agentwiki/package.json agentwiki/apps/server/package.json agentwiki/pnpm-lock.yaml agentwiki/apps/server/Dockerfile agentwiki/apps/client/Dockerfile agentwiki/docker-compose.yml agentwiki/deploy.sh
git commit -m "build: require Node 26 across AgentWiki"
```

### Task 2: Replace the shell background command with a tested development supervisor

**Files:**
- Create: `agentwiki/scripts/dev-runner.mjs`
- Create: `agentwiki/scripts/dev-runner.test.mjs`
- Modify: `agentwiki/package.json`

**Interfaces:**
- Consumes: root `.env`, `APP_SECRET` or `JWT_SECRET`, pnpm workspace scripts.
- Produces: `resolveDevEnvironment(env): Record<string, string>`, `startDevelopmentStack(options): { children, stop, completion }`, and a reliable `pnpm dev` entrypoint.

- [x] **Step 1: Write failing tests for environment resolution and supervision**

Create `scripts/dev-runner.test.mjs`:

```js
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import { resolveDevEnvironment, startDevelopmentStack } from './dev-runner.mjs';

class FakeChild extends EventEmitter {
  exitCode = null;
  signals = [];

  kill(signal) {
    this.signals.push(signal);
    this.exitCode = 0;
    this.emit('exit', 0, signal);
    return true;
  }
}

test('uses APP_SECRET only when JWT_SECRET is absent', () => {
  assert.equal(resolveDevEnvironment({ APP_SECRET: 'app-secret' }).JWT_SECRET, 'app-secret');
  assert.equal(
    resolveDevEnvironment({ APP_SECRET: 'app-secret', JWT_SECRET: 'jwt-secret' }).JWT_SECRET,
    'jwt-secret',
  );
});

test('rejects a development environment without a signing secret', () => {
  assert.throws(
    () => resolveDevEnvironment({}),
    /JWT_SECRET or APP_SECRET is required/,
  );
});

test('stops sibling processes after an unexpected child exit', async () => {
  const spawned = [];
  const stack = startDevelopmentStack({
    commands: [
      { name: 'api', command: 'api', args: [] },
      { name: 'worker', command: 'worker', args: [] },
    ],
    env: { JWT_SECRET: 'secret' },
    spawnProcess: () => {
      const child = new FakeChild();
      spawned.push(child);
      return child;
    },
  });

  spawned[0].exitCode = 7;
  spawned[0].emit('exit', 7, null);

  assert.deepEqual(await stack.completion, { exitCode: 7, signal: null });
  assert.deepEqual(spawned[1].signals, ['SIGTERM']);
});

test('forwards an explicit shutdown signal to every child', async () => {
  const spawned = [];
  const stack = startDevelopmentStack({
    commands: [{ name: 'api', command: 'api', args: [] }],
    env: { JWT_SECRET: 'secret' },
    spawnProcess: () => {
      const child = new FakeChild();
      spawned.push(child);
      return child;
    },
  });

  stack.stop('SIGINT');

  assert.deepEqual(await stack.completion, { exitCode: 0, signal: 'SIGINT' });
  assert.deepEqual(spawned[0].signals, ['SIGINT']);
});
```

- [x] **Step 2: Run the runner tests and verify they fail for the missing module**

Run:

```bash
node --test scripts/dev-runner.test.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `scripts/dev-runner.mjs`.

- [x] **Step 3: Implement the minimal Node 26 development supervisor**

Create `scripts/dev-runner.mjs`:

```js
#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { loadEnvFile } from 'node:process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const defaultCommands = [
  { name: 'api', command: 'pnpm', args: ['--filter', 'server', 'start:dev'] },
  { name: 'worker', command: 'pnpm', args: ['--filter', 'server', 'start:worker:dev'] },
  { name: 'client', command: 'pnpm', args: ['--filter', 'client', 'dev'] },
];

export function resolveDevEnvironment(env) {
  const resolved = { ...env };
  if (!resolved.JWT_SECRET && resolved.APP_SECRET) resolved.JWT_SECRET = resolved.APP_SECRET;
  if (!resolved.JWT_SECRET) throw new Error('JWT_SECRET or APP_SECRET is required');
  return resolved;
}

export function startDevelopmentStack({
  commands = defaultCommands,
  env = process.env,
  spawnProcess = spawn,
} = {}) {
  const children = [];
  let settled = false;
  let settle;
  const completion = new Promise((resolveCompletion) => {
    settle = resolveCompletion;
  });

  const terminateChildren = (signal) => {
    for (const child of children) {
      if (child.exitCode === null) child.kill(signal);
    }
  };

  const finishUnexpected = (exitCode, signal) => {
    if (settled) return;
    settled = true;
    terminateChildren('SIGTERM');
    settle({ exitCode: exitCode && exitCode !== 0 ? exitCode : 1, signal });
  };

  const stop = (signal = 'SIGTERM') => {
    if (settled) return;
    settled = true;
    terminateChildren(signal);
    settle({ exitCode: 0, signal });
  };

  for (const definition of commands) {
    const child = spawnProcess(definition.command, definition.args, {
      cwd: projectRoot,
      env,
      stdio: 'inherit',
    });
    children.push(child);
    child.once('error', (error) => {
      console.error(`[${definition.name}] failed to start: ${error.message}`);
      finishUnexpected(1, null);
    });
    child.once('exit', (code, signal) => finishUnexpected(code, signal));
  }

  return { children, stop, completion };
}

export async function main() {
  loadEnvFile(resolve(projectRoot, '.env'));
  const env = resolveDevEnvironment(process.env);
  const stack = startDevelopmentStack({ env });
  process.once('SIGINT', () => stack.stop('SIGINT'));
  process.once('SIGTERM', () => stack.stop('SIGTERM'));
  const result = await stack.completion;
  process.exitCode = result.exitCode;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`AgentWiki development startup failed: ${error.message}`);
    process.exitCode = 1;
  });
}
```

- [x] **Step 4: Make the root scripts use the supervisor and include its tests**

Change the root scripts to:

```json
"dev": "node scripts/dev-runner.mjs",
"test:runtime": "node --test scripts/*.test.mjs",
"test": "pnpm test:runtime && pnpm --filter @agentwiki/server test && pnpm --filter @agentwiki/client test"
```

- [x] **Step 5: Verify runner tests and failure behavior**

Run:

```bash
pnpm test:runtime
env -u JWT_SECRET -u APP_SECRET node scripts/dev-runner.mjs
```

Expected: all runtime tests pass; the second command exits non-zero with `JWT_SECRET or APP_SECRET is required` and starts no child processes.

- [x] **Step 6: Commit the development supervisor**

```bash
git add agentwiki/scripts/dev-runner.mjs agentwiki/scripts/dev-runner.test.mjs agentwiki/package.json
git commit -m "dev: supervise AgentWiki processes on Node 26"
```

### Task 3: Isolate Vitest from Node 26 Web Storage

**Files:**
- Modify: `agentwiki/apps/client/vitest.config.ts`

**Interfaces:**
- Consumes: Vitest's default `forks` pool and existing jsdom setup.
- Produces: forked workers with `--no-experimental-webstorage`, allowing jsdom to provide test-local `localStorage`.

- [x] **Step 1: Reproduce the existing Node 26 regression**

Run:

```bash
node --version
pnpm --filter @agentwiki/client test
```

Expected: Node reports `v26.x`; all four files fail because `localStorage.getItem` or `localStorage.setItem` is unavailable, with the Node warning about `--localstorage-file`.

- [x] **Step 2: Add the minimal worker configuration**

Extend the existing `test` object in `apps/client/vitest.config.ts`:

```ts
test: {
  environment: 'jsdom',
  setupFiles: ['./src/test/setup.ts'],
  restoreMocks: true,
  exclude: ['node_modules', 'dist', 'e2e/**'],
  pool: 'forks',
  poolOptions: {
    forks: {
      execArgv: ['--no-experimental-webstorage'],
    },
  },
},
```

- [x] **Step 3: Verify the client tests turn green without persistent Node storage**

Run:

```bash
pnpm --filter @agentwiki/client test
```

Expected: 4/4 files and 4/4 tests pass; there is no Node `localStorage` warning and no `--localstorage-file` is used.

- [x] **Step 4: Commit the Vitest compatibility change**

```bash
git add agentwiki/apps/client/vitest.config.ts
git commit -m "test: isolate jsdom storage on Node 26"
```

### Task 4: Update active documentation and project memory

**Files:**
- Modify: `MIGRATION_README.md`
- Modify: `DEVELOPMENT_HANDBOOK.md`
- Modify: `design/OPERATIONS.md`
- Modify: `.codex-memory/current.md`

**Interfaces:**
- Consumes: the implemented Node 26 contract and `pnpm dev` behavior.
- Produces: one consistent operator/developer instruction set with no active AgentWiki Node 20 requirement.

- [x] **Step 1: Update migration and development instructions**

In `MIGRATION_README.md`, change the main AgentWiki runtime row to:

```markdown
| Node.js    | 26.x（唯一支持的 Node 主版本）                                      |
| pnpm       | 11.9.0（由根 `package.json` 的 `packageManager` 固定）               |
```

Keep reference-project version notes unchanged. State that `pnpm dev` loads the root `.env`, maps `APP_SECRET` to `JWT_SECRET` when needed, and supervises API, Worker, and frontend together.

Add a concise runtime baseline subsection near the technical stack in `DEVELOPMENT_HANDBOOK.md`:

```markdown
### 1.3 本地运行时基线

- AgentWiki 只支持 Node.js 26；根目录 `.node-version` 和 `engines.node` 是版本依据。
- pnpm 固定为 11.9.0，安装和门禁必须在 Node 26 下执行。
- 本地从 `agentwiki/` 运行 `pnpm dev`，由开发启动器统一加载环境并管理 API、Worker、Vite。
```

- [x] **Step 2: Update operations and current project memory**

In `design/OPERATIONS.md`, state before the deploy steps that `/usr/bin/node` must report Node 26 and that `deploy.sh` rejects other majors before dependency installation, build, migration, or service restart.

In `.codex-memory/current.md`, replace the Node 20 workaround with the final Node 26-only state, record that bare `pnpm dev` is supported, and record the Node 26 test/build result after Task 5 verification.

- [x] **Step 3: Check documentation consistency**

Run:

```bash
rg -n '(node:20-alpine|node@20|推荐 20|/opt/homebrew/opt/node@20)' agentwiki MIGRATION_README.md DEVELOPMENT_HANDBOOK.md design/OPERATIONS.md .codex-memory/current.md
```

Expected: no active AgentWiki runtime instruction or configuration remains; reference-project descriptions in `MIGRATION_README.md` may still mention their own Node versions.

- [x] **Step 4: Commit documentation and memory**

```bash
git add MIGRATION_README.md DEVELOPMENT_HANDBOOK.md design/OPERATIONS.md .codex-memory/current.md
git commit -m "docs: document Node 26-only development"
```

### Task 5: Run the complete Node 26 gate and refresh codebase memory

**Files:**
- Modify: `agentwiki/.codebase-memory/graph.db.zst`
- Modify if verification evidence changes status: `.codex-memory/current.md`

**Interfaces:**
- Consumes: all changes from Tasks 1-4, local PostgreSQL, local Redis.
- Produces: a passing Node 26 development baseline, live health evidence, and a refreshed knowledge graph.

- [x] **Step 1: Confirm the actual command runtime**

Run:

```bash
node --version
node -p "process.versions.node.split('.')[0]"
pnpm --version
```

Expected: Node `v26.x`, major `26`, pnpm `11.9.0`. Stop immediately if any value differs.

- [x] **Step 2: Run the static and automated gates**

Run:

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm --filter server exec prisma migrate status
```

Expected: install exit 0; lint has zero errors; type checks pass; runtime tests pass; server reports 16/16 suites and 58/58 tests; client reports 4/4 tests; build exits 0; Prisma reports 13 migrations and an up-to-date schema.

- [x] **Step 3: Start and smoke-test the complete development stack**

Run `pnpm dev`, then from a second terminal run:

```bash
curl -fsS -o /dev/null -w 'frontend HTTP %{http_code}\n' http://127.0.0.1:5173/
curl -fsS http://127.0.0.1:3000/api/health
ps -Ao pid,ppid,command | rg 'dist/worker|entryFile worker' | rg -v 'rg '
```

Expected: frontend HTTP 200; health JSON reports `status`, `database`, and `redis` as `ok`; a live ingestion Worker process is present. Send `Ctrl-C` and verify all three development children exit.

- [x] **Step 4: Validate deployment configuration within local limits**

Run:

```bash
bash -n deploy.sh
rg -n 'node:26-alpine|REQUIRED_NODE_MAJOR="26"|/usr/bin/node' apps/server/Dockerfile apps/client/Dockerfile docker-compose.yml deploy.sh
```

Expected: Bash syntax passes and every runtime location reports Node 26. If Docker is installed, additionally run `docker compose config` and build both images; otherwise record Docker execution as unavailable rather than passed.

- [x] **Step 5: Refresh and validate codebase-memory**

Run a full persistent `index_repository` for the `agentwiki/` path, then call `get_architecture` and search for `startDevelopmentStack` and the review publish path.

Expected: the index status is `indexed`, `.codebase-memory/graph.db.zst` is non-empty, the new runner symbols are discoverable, and the existing review pipeline remains connected.

- [x] **Step 6: Record final evidence and commit generated project artifacts**

Update `.codex-memory/current.md` with the exact Node 26 version, gate counts, live health result, and refreshed graph counts. Then run:

```bash
git add .codex-memory/current.md agentwiki/.codebase-memory/graph.db.zst
git commit -m "chore: record verified Node 26 baseline"
```

Expected: the commit contains only current project memory and the persistent code graph artifact.
