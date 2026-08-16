# Auto Knowledge Graph Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement three-layer automatic knowledge-graph generation (wiki-link extraction, embedding similarity, LLM proposals via review) with per-space settings, manual refresh, incremental hooks, and worker sweeps.

**Architecture:** Pure extraction functions are separated from orchestration. A refresh service loads a space's pages, runs enabled layers, and reconciles origin-scoped relations transactionally (only ever touching its own origin). LLM proposals never write relations directly — they open a pending ChangeSet through the existing review flow. A worker maintenance timer sweeps spaces whose content changed.

**Tech Stack:** NestJS + Prisma (server), React + Vite (client), existing LlmService (deepseek/kimi/glm/qwen).

**Spec:** `docs/superpowers/specs/2026-08-17-auto-knowledge-graph-design.md`

## Global Constraints

- New origins: `auto_wikilink`, `auto_similar`, `auto_llm` — service-validated strings (schema column stays String).
- A layer may only create/delete relations with its own origin; unique-triple conflicts owned by another origin are skipped.
- Defaults: wikilink on, similar off (threshold 0.86), llm off.
- LLM layer must never auto-publish; ChangeSet status `pending_review`.
- Layer 2 makes zero external API calls (embeddings already on Page).
- All tests must pass: `pnpm --filter @agentwiki/server test`, `pnpm --filter @agentwiki/client test`, `pnpm test:runtime`, lint, typecheck.

---

### Task 1: SpaceGraphState model + migration

**Files:**
- Modify: `apps/server/prisma/schema.prisma`
- Create: `apps/server/prisma/migrations/20260817000000_add_space_graph_state/migration.sql`
- Test: `apps/server/src/knowledge-graph/graph-refresh.service.spec.ts` (later tasks extend)

**Interfaces:**
- Produces: Prisma model `SpaceGraphState` with fields from spec; client type available after `prisma generate`.

- [x] Add model to schema; write migration SQL; run `prisma generate`; commit.

### Task 2: graph-extraction.service (pure functions)

**Files:**
- Create: `apps/server/src/knowledge-graph/graph-extraction.service.ts`
- Test: `apps/server/src/knowledge-graph/graph-extraction.service.spec.ts`

**Interfaces:**
- Produces:
  - `extractWikiLinks(content: string): string[]` — unique target titles (alias-aware `[[Target|display]]`).
  - `resolveWikiLinks(pages: {id,title,slug}[], targets: string[]): { resolved: {sourcePageId,targetPageId}[], dangling: number }` — exact → case-insensitive → slug match; ambiguous → skipped+dangling; self-link dropped.
  - `cosineSimilarity(a: number[], b: number[]): number`
  - `computeSimilarPairs(pages: {id,embedding}[], threshold: number): {sourcePageId,targetPageId,score}[]` — canonical order (smaller id first), both-embeddings required.

- [x] Write failing tests (parser: plain/alias/dup/self; resolver: exact/case/slug/dangling/ambiguous; similarity: canonical order, threshold, missing embedding).
- [x] Implement minimal service. Run spec. Commit.

### Task 3: graph-refresh.service — layers 1+2 reconciliation

**Files:**
- Create: `apps/server/src/knowledge-graph/graph-refresh.service.ts`
- Create: `apps/server/src/knowledge-graph/knowledge-graph.module.ts`
- Modify: `apps/server/src/app.module.ts` (import module)
- Test: `apps/server/src/knowledge-graph/graph-refresh.service.spec.ts`

**Interfaces:**
- Produces: `refresh(spaceId: string, layers?: Layer[], actorUserId?: string): Promise<RefreshResult>` where
  `RefreshResult = { wikilink: {created,removed,dangling}, similar: {created,removed,skipped}, llm: {changeSetId: string|null, proposed: number, reason?: string} }`.
- Reads settings via `getOrCreateState(spaceId)` (defaults from spec).

- [x] Tests: rerun idempotency (second run → 0/0); ownership guard (never deletes `manual`/`compiled` relation on same triple); conflict skip; dangling count; canonical similar edges; threshold respects setting; toggle off → layer reports skipped.
- [x] Implement: load pages+existing auto relations, diff, transaction (createMany skipDuplicates + targeted deletes), update `lastRunAt`/`lastContentHash`.
- [x] Commit.

### Task 4: Layer 3 — LLM proposals via ChangeSet

**Files:**
- Modify: `apps/server/src/knowledge-graph/graph-refresh.service.ts`
- Modify: `apps/server/src/knowledge-graph/knowledge-graph.module.ts` (import ReviewModule)
- Test: extend `graph-refresh.service.spec.ts`

**Interfaces:**
- Consumes: `LlmService.generateText`, `prisma.changeSet.create` with `create_relation` items (payload keys match review flow: `relation, sourcePageId, targetPageId, confidence, evidenceQuote`).
- Produces: `llm` part of RefreshResult; blocks when prior proposal ChangeSet still pending; `llm_unavailable` when no provider.

- [x] Tests: no provider → reason; pending predecessor → skipped; valid JSON → ChangeSet with pending items (never auto-publish); invalid JSON retry-then-continue; pages < 2 → no-op.
- [x] Implement with strict JSON prompt + zod-style manual validation. Commit.

### Task 5: Controller — refresh + settings endpoints

**Files:**
- Create: `apps/server/src/knowledge-graph/knowledge-graph.controller.ts`
- Test: `apps/server/src/knowledge-graph/knowledge-graph.controller.spec.ts`

**Interfaces:**
- `POST /spaces/:id/graph/refresh` body `{layers?: Layer[]}` — guards: JwtAuth + owner/admin via AuthorizationService.
- `GET /spaces/:id/graph/settings` / `PATCH /spaces/:id/graph/settings` body `{wikilinkEnabled?,similarEnabled?,similarThreshold?,llmEnabled?}`.

- [x] Guard/serialization tests + implementation. Commit.

### Task 6: Worker sweep + incremental hook

**Files:**
- Create: `apps/server/src/knowledge-graph/graph-maintenance.ts`
- Modify: `apps/server/src/worker.module.ts` (provider)
- Modify: `apps/server/src/review/review.service.ts` — after publish success, enqueue debounce for affected space (via GraphMaintenance.enqueue(spaceId))
- Test: `apps/server/src/knowledge-graph/graph-maintenance.spec.ts`

**Interfaces:**
- `GraphMaintenance.enqueue(spaceId)` — 30s debounce; worker-only execution (PROCESS_ROLE check like memory.maintenance); interval sweep 6h (`GRAPH_SWEEP_MS` env), skipping spaces whose stored lastContentHash equals current.

- [x] Tests with fake timers: debounce collapses, worker-disabled no-op, hash-unchanged skip. Implement. Commit.

### Task 7: Client — origin badges/filters + settings card

**Files:**
- Modify: `apps/client/src/features/knowledge/KnowledgeGraph.tsx` — edge origin badge + filter chips (i18n keys).
- Modify: `apps/client/src/features/space/SpaceSettings.tsx` — Auto-graph card (3 toggles, threshold, Refresh now button + stats toast).
- Modify: `apps/client/src/i18n/messages.ts`
- Tests: extend existing spec files.

- [x] Tests: badge renders per origin; filter hides unselected origins; settings card PATCH + refresh call. Implement. Commit.

### Task 8: Gates, docs, deploy

- [x] Full: `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`.
- [x] README: mention auto-graph under Features.
- [x] DB backup → deploy → migrate status → smoke + UI smoke.
- [x] Update .codex-memory, push, final verification.

