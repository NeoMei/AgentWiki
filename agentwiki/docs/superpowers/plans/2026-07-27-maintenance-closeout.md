# AgentWiki Maintenance Closeout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close every real outstanding maintenance task by rebuilding a clean Codebase Memory graph, reconciling stale task documents, and leaving the Codex feature branch verified and committed.

**Architecture:** Treat `.codex-memory/current.md` and `.codex-memory/tasks/index.md` as the authoritative task state. Remove generated dependency copies from the indexed source tree, delete the three stale AgentWiki graph projects through the Codebase Memory CLI, then rebuild the canonical project through the MCP full index. Historical checklists are reconciled with existing verification evidence rather than turning examples into new product scope.

**Tech Stack:** codebase-memory-mcp 0.9.0, Git, Markdown, Node.js 26.5.0, pnpm 11.9.0.

## Global Constraints

- Only the main product directory `agentwiki/` is indexed; reference repositories remain excluded.
- Generated dependencies and build products must never enter the graph.
- Historical example text does not create new product requirements.
- Existing authorization, provenance, review, memory, MCP, localization, and Markdown workspace behavior must remain unchanged.
- No user source code or historical recovery data is deleted; generated dependency copies are moved into the already ignored `.stale-node-modules/` directory.
- Completion requires fresh tests, builds, task-state checks, graph queries, and a clean tracked worktree.

---

### Task 1: Rebuild the canonical Codebase Memory graph

**Files:**
- Modify: `agentwiki/.gitignore`
- Modify: `agentwiki/.codebase-memory/graph.db.zst`
- Move generated directories: `agentwiki/apps/client/node_modules 2`, `agentwiki/apps/server/node_modules 2`

**Interfaces:**
- Consumes: `/Users/neomei/.local/bin/codebase-memory-mcp`, the repository path `/Users/neomei/项目/codexprojects/AgentWiki /agentwiki`, and the existing `.stale-node-modules/` ignore boundary.
- Produces: one canonical AgentWiki graph project with no `node_modules 2` nodes and a persistent `.codebase-memory/graph.db.zst` artifact.

- [x] **Step 1: Preserve the generated dependency copies outside the indexed tree**

Run from the repository root:

```bash
mkdir -p agentwiki/.stale-node-modules/node-modules-2
mv 'agentwiki/apps/client/node_modules 2' agentwiki/.stale-node-modules/node-modules-2/client
mv 'agentwiki/apps/server/node_modules 2' agentwiki/.stale-node-modules/node-modules-2/server
```

Expected: neither `apps/client/node_modules 2` nor `apps/server/node_modules 2` exists; both preserved copies exist below `.stale-node-modules/`.

- [x] **Step 2: Verify the ignore boundary**

Ensure `agentwiki/.gitignore` contains both `node_modules/` and `**/node_modules 2/`, then run:

```bash
rg -n '^node_modules/$|^\*\*/node_modules 2/$|^\.stale-node-modules/$' agentwiki/.gitignore
```

Expected: all three exclusion rules are printed.

- [x] **Step 3: Delete stale AgentWiki graph projects**

Run the Codebase Memory CLI once for each known stale project:

```bash
/Users/neomei/.local/bin/codebase-memory-mcp cli delete_project '{"project":"Users-neomei-iCloude4ba91e79b98efbc88e5bd92e6a1a3efbc89-Documents-codexprojects-AgentWiki-agentwiki"}'
/Users/neomei/.local/bin/codebase-memory-mcp cli delete_project '{"project":"Users-neomei-Documents-codexprojects-AgentWiki-agentwiki"}'
/Users/neomei/.local/bin/codebase-memory-mcp cli delete_project '{"project":"Users-neomei-e9a1b9e79bae-codexprojects-AgentWiki-agentwiki"}'
```

Expected: each existing project reports deletion; a subsequent `list_projects` call reports no AgentWiki project before reindexing.

- [x] **Step 4: Run a full persistent MCP index**

Call `index_repository` with:

```json
{
  "repo_path": "/Users/neomei/项目/codexprojects/AgentWiki /agentwiki",
  "mode": "full",
  "persistence": true,
  "name": "agentwiki"
}
```

Expected: status is `indexed`, the excluded directory list contains generated dependency/build directories, and `.codebase-memory/graph.db.zst` is non-empty.

- [x] **Step 5: Verify graph cleanliness and source discovery**

Use `query_graph` to search for `node_modules 2` paths and expect zero rows. Use `get_architecture` for `apps/server/src` and `apps/client/src`, then use `search_graph` for `AuthorizationService`, `ReviewService`, `MemoryService`, and `McpService`.

Expected: no generated dependency nodes; all four product services are discoverable from source paths.

- [x] **Step 6: Commit the clean graph**

```bash
git --git-dir=/Users/neomei/.local/share/AgentWiki.git --work-tree='/Users/neomei/项目/codexprojects/AgentWiki ' add agentwiki/.gitignore agentwiki/.codebase-memory/graph.db.zst
git --git-dir=/Users/neomei/.local/share/AgentWiki.git --work-tree='/Users/neomei/项目/codexprojects/AgentWiki ' commit -m "chore: rebuild clean codebase memory graph"
```

Expected: the commit contains only the ignore rule and graph artifact.

---

### Task 2: Reconcile task documents and repository hygiene

**Files:**
- Create: `.gitignore`
- Modify: `decisions/2026-07-04-project-init.md`
- Modify: `design/methodology.md`
- Modify: `agentwiki/docs/superpowers/plans/2026-07-16-node26-compatibility.md`
- Modify: `agentwiki/docs/superpowers/plans/2026-07-27-maintenance-closeout.md`
- Modify: `.codex-memory/current.md`
- Add: `.codex-memory/spec/*.md`, `.codex-memory/tasks/**/*.md`, `.codex-memory/archive/*.md`

**Interfaces:**
- Consumes: completed P0-P6 remediation evidence, Node 26 gate evidence, the canonical graph statistics from Task 1, and the project memory rules in `AGENTS.md`.
- Produces: authoritative documentation with no false active checkboxes, ignored local recovery noise, and committed structured project memory.

- [x] **Step 1: Add repository-root hygiene ignores**

Create `.gitignore` with:

```gitignore
.DS_Store
**/.DS_Store
.git-icloud-incomplete-*/
.superpowers/
```

Expected: macOS metadata, the frozen iCloud Git recovery directory, and the SDD scratch ledger disappear from `git status` without deletion.

- [x] **Step 2: Reconcile the initialization decision**

Mark the four remaining actions in `decisions/2026-07-04-project-init.md` complete. Add a short note that the development checklist is implemented by the Node 26 runtime tests and project memory, while milestone checkpoints are implemented by `.codex-memory/current.md` and archived task briefs.

Expected: the decision record has no unchecked action item and does not claim a new script exists.

- [x] **Step 3: Prevent the methodology example from becoming an active task list**

Label the Yjs section in `design/methodology.md` as a historical illustrative decision-log example and replace its three checkbox bullets with ordinary example bullets prefixed `示例后续行动：`.

Expected: the example remains readable but is not returned by the repository's unchecked-task scan.

- [x] **Step 4: Backfill the completed Node 26 plan**

Replace every task-step checkbox in `agentwiki/docs/superpowers/plans/2026-07-16-node26-compatibility.md` from `- [ ]` to `- [x]` and add a completion note referencing the verified baseline in `.codex-memory/current.md`.

Expected: the plan contains no unchecked task step.

- [x] **Step 5: Update authoritative project memory**

Update `.codex-memory/current.md` with the clean graph counts and maintenance-closeout status. Keep `.codex-memory/tasks/index.md` at `活跃任务：无`, and include the existing structured spec/task/archive files in version control.

Expected: current memory contains only current facts and all new memory files are intentional Git additions.

- [x] **Step 6: Close this plan and commit documentation**

Mark every completed checkbox in this plan, then run:

```bash
git --git-dir=/Users/neomei/.local/share/AgentWiki.git --work-tree='/Users/neomei/项目/codexprojects/AgentWiki ' add .gitignore .codex-memory decisions/2026-07-04-project-init.md design/methodology.md agentwiki/docs/superpowers/plans/2026-07-16-node26-compatibility.md agentwiki/docs/superpowers/plans/2026-07-27-maintenance-closeout.md
git --git-dir=/Users/neomei/.local/share/AgentWiki.git --work-tree='/Users/neomei/项目/codexprojects/AgentWiki ' commit -m "docs: close completed project tasks"
```

Expected: the commit contains task-state, memory, and hygiene documentation only.

---

### Task 3: Track the canonical AgentWiki product source

**Files:**
- Modify: `.gitignore`
- Modify: `agentwiki/.gitignore`
- Add: `AGENTS.md`
- Add: `agentwiki/` product source, configuration, migrations, tests, and deployment units that are not ignored
- Add: `decisions/TEMPLATE.md`
- Add: `design/` current project design artifacts that are not already tracked

**Interfaces:**
- Consumes: the verified main product tree and the reference/local-file boundary established in project memory.
- Produces: a repository where all canonical AgentWiki source is versioned while reference repositories, local recovery helpers, secrets, logs, and generated JavaScript remain local and ignored.

- [x] **Step 1: Extend repository-root local/reference ignores**

Append these exact entries to the root `.gitignore`:

```gitignore
0
docmost/
mnemon/
openwiki/
outline/
swarmvault/
docker-compose-remote.yml
ssh_login.*
ssh_test*.js
```

Expected: the frozen reference repositories, the local sentinel file, the compose file containing a local database password, and SSH helpers containing local credentials disappear from `git status` without deletion.

- [x] **Step 2: Ignore verified product-tree runtime/generated files**

Append these exact entries to `agentwiki/.gitignore`:

```gitignore
*.err
apps/client/vite.config.js
packages/shared/src/index.js
```

Expected: the server error log and JavaScript emitted from tracked TypeScript sources are ignored; `vite.config.ts` and `packages/shared/src/index.ts` remain visible for version control.

- [x] **Step 3: Stage the canonical project set**

```bash
git add .gitignore AGENTS.md agentwiki decisions design
git diff --cached --check
git diff --cached --name-only
```

Expected: the staged set contains main product source/config/migrations/tests, project instructions, decisions, and design documents. It contains no reference-repository path, `.env`, `.DS_Store`, `.git-icloud-incomplete-*`, `.stale-node-modules`, `node_modules`, `dist`, local SSH helper, `docker-compose-remote.yml`, `server.err`, `vite.config.js`, or `packages/shared/src/index.js`.

- [x] **Step 4: Review the staged source for credentials and generated-file leakage**

Run focused scans against staged file paths for private-key headers, credential-bearing local filenames, dependency/build directories, and generated JavaScript twins. Inspect any match and unstage it unless it is a documented placeholder or a deliberate source file.

Expected: no real credential, recovery directory, reference repository, dependency tree, runtime log, or generated duplicate remains staged.

- [x] **Step 5: Commit the canonical project source**

```bash
git commit -m "chore: track AgentWiki product source"
git status --short --untracked-files=all
```

Expected: the commit adds the complete canonical product tree and the worktree reports no visible untracked project files; ignored local/reference files remain present on disk.

---

### Task 4: Verify the completed maintenance state

**Files:**
- Verify only: repository and product files changed by Tasks 1-3

**Interfaces:**
- Consumes: all maintenance commits.
- Produces: fresh evidence that there are no active tasks, no source TODO markers, no generated dependency graph nodes, and no product regressions.

- [ ] **Step 1: Verify task-state scans**

```bash
rg -n --glob '*.md' --glob '!decisions/TEMPLATE.md' --glob '!agentwiki/docs/superpowers/plans/2026-07-27-maintenance-closeout.md' '^\s*[-*]\s+\[ \]' .codex-memory decisions design agentwiki/docs
rg -n --glob '!**/node_modules*/**' --glob '!**/dist/**' --glob '*.{ts,tsx,js,mjs,cjs,sql,prisma,css}' '\b(TODO|FIXME|TBD|XXX)\b' agentwiki/apps agentwiki/packages agentwiki/scripts agentwiki/prisma
```

Expected: 除当前执行计划和模板外无未完成任务；第二个命令无匹配。

- [ ] **Step 2: Run product gates under Node 26**

From `agentwiki/`, run:

```bash
node --version
pnpm test:runtime
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Expected: Node reports major 26 and every gate exits 0.

- [ ] **Step 3: Verify Git state and commit history**

```bash
git --git-dir=/Users/neomei/.local/share/AgentWiki.git --work-tree='/Users/neomei/项目/codexprojects/AgentWiki ' status --short --untracked-files=all
git --git-dir=/Users/neomei/.local/share/AgentWiki.git --work-tree='/Users/neomei/项目/codexprojects/AgentWiki ' log -4 --oneline --decorate
```

Expected: no tracked or untracked project changes remain, and both maintenance commits are present on `codex/node26-compatibility`.

- [ ] **Step 4: Record verification completion**

Complete Task 4 in this fixed order:

1. Mark all four Task 4 steps as `- [x]`.
2. Update `.codex-memory/current.md` with final verification evidence; even if the measured data is unchanged, record the fresh verification date and result.
3. Amend `docs: close completed project tasks` so the completed plan and final current-memory evidence are tracked together.
4. Run the final global task-state review and Git worktree check:

```bash
rg -n --glob '*.md' --glob '!decisions/TEMPLATE.md' '^\s*[-*]\s+\[ \]' .codex-memory decisions design agentwiki/docs
git --git-dir=/Users/neomei/.local/share/AgentWiki.git --work-tree='/Users/neomei/项目/codexprojects/AgentWiki ' status --short --untracked-files=all
```

Expected: the task scan has zero matches and the worktree is clean. This final review includes `2026-07-27-maintenance-closeout.md` after its Task 4 checkboxes are complete.
