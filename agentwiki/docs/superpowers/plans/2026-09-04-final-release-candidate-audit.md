# AgentWiki Final Release Candidate Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 对 `origin/master..HEAD` 发布候选执行多轮任务、代码和全栈/UI 审查，修复所有值得修复的问题，并以最终不可变提交的新鲜证据得出结论。

**Architecture:** 将首轮发现拆为任务完整性、整分支代码、全栈/UI 覆盖三个独立视角并行读取。发现项经主线核验后按 systematic debugging + TDD 逐项修复，每轮修复后运行 scoped re-review；最后用 clean clone、隔离 Docker 服务和真实 Chrome/CodeGraph 做全套验收。

**Tech Stack:** Node.js 24, pnpm 11.9.0, TypeScript, NestJS, React/Vite, Prisma/PostgreSQL 16 + pgvector, Redis 7.4 AOF, Playwright/Chrome, CodeGraph CLI, Docker Desktop.

**Spec:** 用户本轮三项要求，以及 `.codex-memory/current.md`、`.codex-memory/spec/index.md` 与已归档 Windows/macOS 验证任务。

## Global Constraints

- 默认中文沟通，结论与证据分开；不用旧结论代替本轮新鲜验证。
- 仅在当前隔离工作区修改；不触碰原 Mac 脏工作区，不 push、不 npm publish、不生产部署。
- 任何 bug 修复必须先确认根因并观察失败回归，然后做最小修复和 GREEN 复验。
- PostgreSQL 只允许 loopback、名称含 `test` 的 disposable 数据库和随机前缀 schema；不迁移、清理或污染 shared `public`。
- PostgreSQL/Redis/API/Vite 仅绑定 loopback；使用前必须检查 `3000/5173/55432/56379`，完成后精确清理所有本轮资源。
- 真实 CodeGraph 和 Chrome Playwright 不得用 mock 或旧日志代替；UI 验收使用最终 collection 的 8 files / 26 tests，单 worker、0 retry。
- 三项既有 skip 只有在原因仍为平台或显式 opt-in 且非缺失 DB/Redis/Playwright/CodeGraph 时可接受。
- 重复审查至少包含首轮三视角、修复后 scoped re-review 以及最终整分支审查；Critical/Important 不得遗留，Minor 要根据实际价值裁决。

---

### Task 1: Audit task and handoff completeness

**Files:**
- Read: `.codex-memory/current.md`
- Read: `.codex-memory/spec/index.md`
- Read: `.codex-memory/tasks/archive/windows-release-readiness-2026-09-04/*`
- Read: `.codex-memory/tasks/archive/macos-release-verification-2026-09-04/*`
- Read: `docs/verification/macos-release-validation-2026-09-04.md`
- Modify if needed: the exact task/spec/evidence files that contain an actionable gap

**Interfaces:**
- Consumes: user requirements, archived Windows handoff, macOS evidence, Git history.
- Produces: a requirement-by-requirement verdict and actionable task findings.

- [x] Build a checklist mapping every requested deliverable and release gate to current evidence.
- [x] Verify every claimed commit, test count, skip reason, cleanup fact and deferred item against repository state.
- [x] Classify every gap as Critical, Important, Minor, or no-fix with technical reasoning.
- [x] If findings exist, reproduce and fix them with TDD where executable behavior is involved.
- [x] Run a fresh scoped re-review until no worthwhile task gap remains.

### Task 2: Audit the complete code branch

**Files:**
- Read: all files changed by `git diff --name-only origin/master..HEAD`
- Read: directly connected callers, invariants, tests and deployment paths
- Modify if needed: only files required by verified findings

**Interfaces:**
- Consumes: `origin/master..HEAD`, project specs and test contracts.
- Produces: whole-branch bug/security/portability/concurrency/data-safety findings and fixes.

- [x] Review the diff in multiple passes: security/data loss, concurrency/atomicity, cross-platform/process, API/UI contracts, test honesty.
- [x] Reproduce each valid finding and trace it to root cause before proposing a fix.
- [x] Add the smallest failing regression, observe RED, implement minimal fix, observe GREEN.
- [x] Run affected suites after each fix and a scoped reviewer after each fix batch.
- [x] Repeat whole-branch review with a fresh reviewer until no worthwhile bug remains.

### Task 3: Test full-stack and UI behavior

**Files:**
- Read: `playwright.config.ts`
- Read: `e2e/**/*.spec.ts`
- Read: `scripts/*test*database*.mjs`
- Modify if needed: affected implementation/tests only after a reproduced failure

**Interfaces:**
- Consumes: isolated PostgreSQL/pgvector, Redis AOF, API/worker/client, Chrome and test fixtures.
- Produces: full repository, real CodeGraph and 25-scenario UI evidence with cleanup.

- [x] Start exact Docker services after port/name guards and verify versions, loopback binding, pgvector and Redis AOF.
- [x] Run root `pnpm test:full`, typecheck, lint, build, audit and missing-prerequisite/skip checks.
- [x] Run real CodeGraph standard scan.
- [x] Start an isolated `mac_e2e_*` full stack; verify health and collect exactly 8 files / 26 tests.
- [x] Run Chrome Playwright with `--workers=1 --retries=0`; inspect service logs and failure artifacts.
- [x] For every failure, trace root cause, write RED, fix, rerun affected and full-stack/UI gates.
- [x] Repeat the full-stack/UI round until the final round finds no worthwhile issue.

### Task 4: Final immutable-code verification and cleanup

**Files:**
- Modify: `docs/verification/macos-release-validation-2026-09-04.md`
- Modify: `.codex-memory/current.md`
- Modify: `.codex-memory/tasks/archive/macos-release-verification-2026-09-04/*`

**Interfaces:**
- Consumes: all review reports, fix commits, test logs and resource handles.
- Produces: a clean final HEAD, final evidence commit, cleanup proof and integration options.

- [x] Dispatch fresh whole-branch review after all scoped loops; fix and re-review every valid finding.
- [x] Create a fresh `--no-local` clean clone at the final code SHA and rerun required gates.
- [x] Verify zero generated schema residue and unchanged protected `public` inventory.
- [x] Stop only exact owned processes/containers; remove exact E2E schema; move temporary artifacts recoverably where applicable; prove four ports clear.
- [x] Update formal evidence and project memory with exact SHAs and counts, then commit separately.
- [x] Confirm the evidence-only HEAD changes no executable files and present integration status without pushing automatically.
