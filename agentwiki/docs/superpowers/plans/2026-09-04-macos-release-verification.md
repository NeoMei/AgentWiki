# AgentWiki macOS Release Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On an Apple Silicon or Intel Mac, verify the published Windows-remediation candidate against disposable PostgreSQL/pgvector, Redis AOF, real CodeGraph, and all 25 Playwright browser scenarios without touching production data.

**Architecture:** Run PostgreSQL/pgvector and Redis as loopback-only disposable Docker containers, run the AgentWiki API/worker/client as local Node processes, and isolate every database-writing gate in a database whose name contains `test` and in generated test schemas. Keep database suites, real CodeGraph acceptance, and browser acceptance as separate gates so a failure has one clear owner and can be rerun independently.

**Tech Stack:** macOS, Git, Node.js 24 or 26, pnpm 11.9.0, Docker Desktop, PostgreSQL 16 + pgvector, Redis 7.4 with AOF, Chrome, Playwright, CodeGraph CLI.

## Global Constraints

- Work from a fresh clone of `https://github.com/NeoMei/AgentWiki.git` on `master`; record `git rev-parse HEAD` before testing.
- Never use a production or shared database. The PostgreSQL database name must contain `test`.
- Never migrate or remove the shared `public` schema. Repository database harnesses must create and remove only their generated prefixed schemas.
- Bind PostgreSQL, Redis, API, and Vite to loopback only. Stop if ports `3000`, `5173`, `55432`, or `56379` are already occupied.
- Disable paid model fallback and do not provide production API keys.
- Treat every skip as unresolved until its reason is recorded. Platform-specific skips are acceptable; missing configured PostgreSQL, Redis, Playwright, or CodeGraph is not.
- Preserve Playwright traces and logs for failures. Do not publish fixes until the failing behavior has a regression test and all affected gates pass again.

---

### Task 1: Check out and identify the published candidate

**Files:**
- Read: `package.json`
- Read: `agentwiki/package.json`
- Read: `agentwiki/docs/superpowers/plans/2026-09-03-release-readiness-audit.md`

**Interfaces:**
- Consumes: GitHub `origin/master`.
- Produces: an exact immutable commit id and a clean macOS worktree.

- [ ] **Step 1: Clone or fast-forward the repository**

```bash
git clone https://github.com/NeoMei/AgentWiki.git
cd AgentWiki
git checkout master
git pull --ff-only origin master
git status --short --branch
git rev-parse HEAD
```

Expected: `master` tracks `origin/master`, the worktree is clean, and the commit id is copied into the verification result.

- [ ] **Step 2: Verify toolchain versions**

```bash
cd agentwiki
node --version
corepack enable
corepack prepare pnpm@11.9.0 --activate
pnpm --version
docker version
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --version
```

Expected: Node is `24.x` or `26.x`, pnpm is `11.9.0`, Docker responds, and Google Chrome is installed.

- [ ] **Step 3: Install exactly the locked dependency graph**

```bash
pnpm install --frozen-lockfile
pnpm audit
```

Expected: installation exits 0 and the audit reports no known vulnerabilities.

### Task 2: Start disposable PostgreSQL/pgvector and Redis AOF

**Files:**
- Read: `agentwiki/docker-compose.yml`
- Read: `agentwiki/docs/operations/redis-audit-durability.md`

**Interfaces:**
- Consumes: Docker Desktop loopback ports `55432` and `56379`.
- Produces: `BASE_TEST_DATABASE_URL` and `REDIS_URL` for later gates.

- [ ] **Step 1: Fail closed if a requested port is occupied**

```bash
for port in 3000 5173 55432 56379; do
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN | grep -q LISTEN; then
    echo "port $port is already occupied" >&2
    exit 1
  fi
done
```

Expected: no output and exit 0.

- [ ] **Step 2: Start disposable services**

```bash
export TEST_DB_PASSWORD='agentwiki_mac_test_only_20260904'
export BASE_TEST_DATABASE_URL="postgresql://agentwiki_test:${TEST_DB_PASSWORD}@127.0.0.1:55432/agentwiki_test"
export REDIS_URL='redis://127.0.0.1:56379'

docker run --rm -d --name agentwiki-mac-postgres \
  -e POSTGRES_USER=agentwiki_test \
  -e POSTGRES_PASSWORD="$TEST_DB_PASSWORD" \
  -e POSTGRES_DB=agentwiki_test \
  -p 127.0.0.1:55432:5432 \
  pgvector/pgvector:pg16

docker run --rm -d --name agentwiki-mac-redis \
  -p 127.0.0.1:56379:6379 \
  redis:7.4-alpine \
  redis-server --appendonly yes --appendfsync everysec
```

Expected: both commands print container ids.

- [ ] **Step 3: Verify pgvector and Redis durability**

```bash
until docker exec agentwiki-mac-postgres pg_isready -U agentwiki_test -d agentwiki_test; do sleep 1; done
docker exec agentwiki-mac-postgres \
  psql -U agentwiki_test -d agentwiki_test -v ON_ERROR_STOP=1 \
  -c 'CREATE EXTENSION IF NOT EXISTS vector' \
  -c "SELECT current_database(), current_user, extversion FROM pg_extension WHERE extname = 'vector'"

until docker exec agentwiki-mac-redis redis-cli ping | grep -q PONG; do sleep 1; done
docker exec agentwiki-mac-redis redis-cli INFO persistence | grep '^aof_enabled:1'
docker exec agentwiki-mac-redis redis-cli WAITAOF 1 0 1000
```

Expected: PostgreSQL reports database/user `agentwiki_test` and a pgvector version; Redis reports `aof_enabled:1`, and `WAITAOF` reports at least one local fsync.

### Task 3: Eliminate database-related unit/integration skips

**Files:**
- Test: `agentwiki/scripts/*.test.mjs`
- Test: `agentwiki/apps/server/src/**/*.db.spec.ts`

**Interfaces:**
- Consumes: `BASE_TEST_DATABASE_URL` from Task 2.
- Produces: full repository test evidence with no skip caused by a missing database variable.

- [ ] **Step 1: Export every dedicated test database variable**

```bash
export DATABASE_URL="$BASE_TEST_DATABASE_URL"
export FOLDER_TEST_DATABASE_URL="$BASE_TEST_DATABASE_URL"
export MARKDOWN_TEST_DATABASE_URL="$BASE_TEST_DATABASE_URL"
export COLLABORATION_TEST_DATABASE_URL="$BASE_TEST_DATABASE_URL"
export PAGE_TEMPLATE_TEST_DATABASE_URL="$BASE_TEST_DATABASE_URL"
export PG_DUMP_BIN="$(command -v pg_dump)"
test -n "$PG_DUMP_BIN" && test "${PG_DUMP_BIN#/}" != "$PG_DUMP_BIN" && test -x "$PG_DUMP_BIN"
```

- [ ] **Step 2: Run the complete repository gates**

```bash
pnpm test 2>&1 | tee /tmp/agentwiki-mac-pnpm-test.log
pnpm typecheck
pnpm lint
pnpm build
pnpm audit
```

Expected: every command exits 0. macOS pass/skip counts may differ from Windows because platform-specific tests differ.

- [ ] **Step 3: Prove the database prerequisites did not cause a skip**

```bash
if rg -n 'DATABASE_URL is not configured|TEST_DATABASE_URL is not configured|PostgreSQL is unavailable|Redis is unavailable' /tmp/agentwiki-mac-pnpm-test.log; then
  echo 'database or Redis coverage is still skipped' >&2
  exit 1
fi
```

Expected: no matching lines and exit 0.

### Task 4: Run the independently installed CodeGraph acceptance

**Files:**
- Test: `agentwiki/scripts/codegraph-standard-scan-e2e.test.mjs`
- Read: `agentwiki/docs/verification/codegraph-standard-scan-cutover.md`

**Interfaces:**
- Consumes: an independently installed trusted `codegraph` executable.
- Produces: real local scanner evidence instead of the Windows skip.

- [ ] **Step 1: Verify the executable is independently available**

```bash
command -v codegraph
codegraph --help >/tmp/agentwiki-codegraph-help.txt
test -s /tmp/agentwiki-codegraph-help.txt
```

Expected: `command -v` prints an absolute executable path. If it does not, record CodeGraph as the only remaining external prerequisite; do not substitute a mock.

- [ ] **Step 2: Run the real scanner gate**

```bash
AGENTWIKI_CODEGRAPH_E2E=1 \
AGENTWIKI_CODEGRAPH_BIN="$(command -v codegraph)" \
pnpm test:e2e:codegraph-standard-scan
```

Expected: one real CodeGraph standard-scan test passes and no private source path or scanner payload is sent to the server.

### Task 5: Run all 25 Playwright scenarios against an isolated full stack

**Files:**
- Test: `agentwiki/apps/client/e2e/*.spec.ts`
- Read: `agentwiki/apps/client/playwright.config.ts`
- Read: `agentwiki/apps/server/.env.example`

**Interfaces:**
- Consumes: disposable PostgreSQL/Redis, API `127.0.0.1:3000`, and Vite `127.0.0.1:5173`.
- Produces: authenticated frontend/backend/UI evidence for all 25 collected scenarios.

- [ ] **Step 1: Create a unique E2E schema and local-only runtime environment**

```bash
export E2E_SCHEMA="mac_e2e_$(date +%Y%m%d%H%M%S)_$RANDOM"
export DATABASE_URL="${BASE_TEST_DATABASE_URL}?schema=${E2E_SCHEMA}"
export JWT_SECRET='mac-e2e-jwt-secret-20260904-at-least-sixty-four-characters-long-only'
export API_KEY_SECRET='mac-e2e-api-key-secret-20260904-local-only'
export APP_SECRET="$JWT_SECRET"
export AGENTWIKI_SERVER_PEPPER='mac-e2e-server-pepper-20260904-local-only'
export AGENTWIKI_DEPLOYMENT_SEED="$(openssl rand -base64 32)"
export PUBLIC_API_URL='http://127.0.0.1:3000/api'
export CORS_ORIGINS='http://127.0.0.1:5173'
export AGENTWIKI_LISTEN_HOST='127.0.0.1'
export PORT='3000'
export ATTACHMENT_STORAGE_PATH="$(mktemp -d /tmp/agentwiki-mac-attachments.XXXXXX)"
export ATTACHMENT_MIN_FREE_BYTES='1'
export ASSIST_OPENCODE_ALLOW_PAID_FALLBACK='false'

pnpm --filter @agentwiki/server exec prisma migrate deploy
pnpm --filter @agentwiki/server build
pnpm --filter @agentwiki/client exec playwright install chrome
```

Expected: migrations target only `E2E_SCHEMA`; server build and Chrome installation exit 0.

- [ ] **Step 2: Start API, worker, and client as owned processes**

```bash
pnpm --filter @agentwiki/server start:prod >/tmp/agentwiki-mac-api.log 2>&1 &
export API_PID=$!
pnpm --filter @agentwiki/server start:worker >/tmp/agentwiki-mac-worker.log 2>&1 &
export WORKER_PID=$!
pnpm --filter @agentwiki/client dev -- --host 127.0.0.1 --port 5173 --strictPort >/tmp/agentwiki-mac-client.log 2>&1 &
export CLIENT_PID=$!

until curl -fsS http://127.0.0.1:3000/api/health | grep -q '"status":"ok"'; do sleep 1; done
until curl -fsS http://127.0.0.1:5173/ >/dev/null; do sleep 1; done
```

Expected: both health checks succeed; `/tmp/agentwiki-mac-api.log` contains no startup failure.

- [ ] **Step 3: Collect and run the complete browser suite serially**

```bash
AGENTWIKI_WEB_URL='http://127.0.0.1:5173' \
AGENTWIKI_API_URL='http://127.0.0.1:3000/api' \
AGENTWIKI_LOCAL_SYNC_E2E=1 \
pnpm --filter @agentwiki/client exec playwright test --list

AGENTWIKI_WEB_URL='http://127.0.0.1:5173' \
AGENTWIKI_API_URL='http://127.0.0.1:3000/api' \
AGENTWIKI_LOCAL_SYNC_E2E=1 \
pnpm --filter @agentwiki/client exec playwright test --workers=1
```

Expected: collection reports exactly 25 tests in 7 files; execution reports 25 passed, 0 failed, and 0 skipped.

- [ ] **Step 4: Inspect service logs and browser artifacts**

```bash
rg -n 'ERROR|Unhandled|FATAL|ECONN|PrismaClient.*Error' \
  /tmp/agentwiki-mac-api.log /tmp/agentwiki-mac-worker.log /tmp/agentwiki-mac-client.log || true
test ! -d test-results || find test-results -maxdepth 3 -type f -print
test ! -d playwright-report || find playwright-report -maxdepth 3 -type f -print
```

Expected: no unexpected service error. Any Playwright trace must correspond to a diagnosed and rerun failure.

### Task 6: Clean up and publish the macOS verification evidence

**Files:**
- Create after successful execution: `agentwiki/docs/verification/macos-release-validation-2026-09-04.md`
- Update: `.codex-memory/current.md`
- Update: `.codex-memory/tasks/active/macos-release-verification-2026-09-04/brief.md`
- Update: `.codex-memory/tasks/active/macos-release-verification-2026-09-04/refs.md`

**Interfaces:**
- Consumes: exact command results and the candidate commit id.
- Produces: auditable cleanup proof and the final cross-platform release decision.

- [ ] **Step 1: Stop only the processes started in Task 5**

```bash
kill "$CLIENT_PID" "$WORKER_PID" "$API_PID"
wait "$CLIENT_PID" "$WORKER_PID" "$API_PID" 2>/dev/null || true
```

- [ ] **Step 2: Remove only the generated E2E schema and temporary attachment root**

```bash
case "$E2E_SCHEMA" in
  mac_e2e_[A-Za-z0-9_]*) ;;
  *) echo 'refusing to drop an unexpected schema name' >&2; exit 1 ;;
esac
case "$ATTACHMENT_STORAGE_PATH" in
  /tmp/agentwiki-mac-attachments.*) ;;
  *) echo 'refusing to remove an unexpected attachment path' >&2; exit 1 ;;
esac

docker exec agentwiki-mac-postgres \
  psql -U agentwiki_test -d agentwiki_test -v ON_ERROR_STOP=1 \
  -c "DROP SCHEMA IF EXISTS \"${E2E_SCHEMA}\" CASCADE"
rm -rf -- "$ATTACHMENT_STORAGE_PATH"
```

- [ ] **Step 3: Confirm repository harness cleanup and stop disposable containers**

```bash
docker exec agentwiki-mac-postgres \
  psql -U agentwiki_test -d agentwiki_test -Atc \
  "SELECT count(*) FROM pg_namespace WHERE nspname ~ '^(mac_e2e|folder_test|markdown_test|collaboration_test|page_template_test|sync_test)_';"

docker stop agentwiki-mac-redis agentwiki-mac-postgres

for port in 3000 5173 55432 56379; do
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN | grep -q LISTEN; then
    echo "port $port still has a listener" >&2
    exit 1
  fi
done
```

Expected: schema count is `0`, both containers stop, and all four ports have no listener.

- [ ] **Step 4: Write the verification record and make the release decision**

The verification record must contain the tested commit id, Mac model/architecture, macOS/Node/pnpm/Docker/PostgreSQL/Redis/Chrome/CodeGraph versions, exact pass/fail/skip counts for every command, Playwright `25/25` evidence, schema/port cleanup evidence, every failure and fix, and one final `PASS` or `BLOCKED` decision. A `PASS` decision requires zero failed gates and no skip caused by a missing PostgreSQL, Redis, Playwright, or CodeGraph prerequisite. For `PASS`, move `.codex-memory/tasks/active/macos-release-verification-2026-09-04/` to `.codex-memory/tasks/archive/` and move its entry from “活跃任务” to “最近完成”; for `BLOCKED`, keep it active and record the exact failing command and prerequisite.

- [ ] **Step 5: Commit and push only verified evidence or tested fixes**

```bash
cd ..
git status --short
git diff --check
git add agentwiki/docs/verification/macos-release-validation-2026-09-04.md \
  .codex-memory/current.md \
  .codex-memory/tasks
git commit -m "test(release): verify macOS full stack"
git push origin master
```

Expected: push succeeds only after all required gates and cleanup checks succeed.
