# Auto-Generated Knowledge Graph — Design

Date: 2026-08-17
Status: Approved (three-layer scope confirmed by user)

## Goal

Automatically generate and refresh knowledge-graph relations so that every Space's graph stays current without manual curation, while preserving the project's safety model: deterministic signals land directly, probabilistic signals are surfaced or gated, and machine-generated data never overwrites human/Agent-authored relations.

## Current State

- `KnowledgeRelation` already supports `origin` (`manual` | `compiled` | `change_set` | `obsidian_sync`), `(sourcePageId, targetPageId, relation)` uniqueness, `confidence`, `evidenceId`.
- Pages already carry embeddings (`Page.embedding`) produced by `LlmService.generateEmbedding` during indexing; `PageSearchDocument.contentHash` tracks content changes.
- `SourceService` demonstrates the correct ownership pattern for automatic relations: diff against origin-scoped relations, only add/remove its own, never touch others.
- The worker process (`PROCESS_ROLE=worker)) provides two proven scheduling models: lease-based `IngestQueue` and the `memory.maintenance` interval timer.
- ChangeSet review flow already handles `create_relation` / `archive_relation` items from other origins.
- The client renders `[[Page Name]]` wiki-links in Markdown, but the server never extracts them into relations — the highest-quality signal is currently discarded.

## Design Principles

1. **Origin-scoped ownership.** Each automatic layer owns exactly one origin (`auto_wikilink`, `auto_similar`, `auto_llm`). A layer may create/delete only relations carrying its own origin. Unique-constraint conflicts where any other origin already claims the triple are skipped silently — human/Agent relations always win.
2. **Confidence by signal quality.** Wiki-links are authored content (confidence 1.0). Similarity is a probability (score as confidence). LLM extraction is a hypothesis (fixed base confidence, gated by review).
3. **Deterministic + reversible.** Layers 1–2 are pure functions of page content: rerunning after a revert restores the previous graph state. Layer 3 proposals live in a ChangeSet that can be rejected.
4. **No ambient writes without a space opt-in.** Layers run per Space; defaults are conservative (layer 1 on, layers 2–3 off).

## Layer 1 — Wiki-Link Extraction (origin `auto_wikilink`)

**Signal:** `[[Target Title]]` and `[[Target Title|display]]` in page Markdown.

**Behavior:** On refresh, for each non-deleted page in the Space: extract wiki-link targets, resolve each title to a page in the same Space (exact, case-insensitive, then slug match). Every resolved pair becomes a `references` relation with confidence 1.0. Unresolvable targets are reported as counts (dangling links), not errors.

**Reconciliation:** Full diff against existing `auto_wikilink` relations for those pages — new links create, removed links delete, surviving links stay untouched (no `lastModifiedAt` churn). Symmetric self-links are dropped.

## Layer 2 — Embedding Similarity (origin `auto_similar`)

**Signal:** Cosine similarity between page embeddings (already stored; no model calls).

**Behavior:** For each page pair with both embeddings present and similarity ≥ threshold (default 0.86, space-tunable), create a `similar_to` relation with confidence = score, strength = score. Store the canonical direction (lexicographically smaller pageId first) to avoid duplicate symmetric edges. Pairs below threshold or missing embeddings are removed from this origin on reconciliation.

**Cost control:** Similarity is computed in-process over the Space's embedding list; pairs above ~2,000 pages are computed in chunks ordered by page id. No external API calls.

## Layer 3 — LLM Semantic Extraction (origin `auto_llm`)

**Signal:** LLM analysis of page content proposing typed relations (`supports`, `contradicts`, `extends`, `related_to`) with short evidence quotes.

**Behavior:** Proposals are **never applied directly**. Each refresh run batches pages (default 6 pages/batch with titles + truncated content), asks the configured provider for relation proposals as strict JSON, validates the schema, and opens a ChangeSet titled `Auto graph suggestions YYYY-MM-DD HH:mm` containing `create_relation` / `archive_relation` items (origin `auto_llm`). A human approves or rejects through the existing review queue. Runs are rate-limited (min interval per space, default 24h) and skip when no LLM provider is configured or the previous proposal ChangeSet is still pending.

## Trigger Model

- **Manual:** `POST /spaces/:id/graph/refresh` (owner/admin) with optional `layers` filter; returns per-layer statistics.
- **Incremental hook:** after a ChangeSet publishes (or a page create/update/archive), enqueue an `auto_wikilink` refresh for affected pages (debounced by space, 30s).
- **Periodic sweep:** worker timer (default every 6h) scans Spaces with auto-graph enabled, skipping spaces whose page contentHash set is unchanged since the last run (persisted in `SpaceGraphState`).

## Data Model

New table `SpaceGraphState` (1:1 with Space):

- `spaceId` (unique), `wikilinkEnabled` (default true), `similarEnabled` (default false), `similarThreshold` (default 0.86), `llmEnabled` (default false)
- `lastContentHash` (hash of all page contentHashes, for sweep skipping)
- `lastRunAt`, `lastLlmChangeSetId`, `updatedAt`

`KnowledgeRelation.origin` gains the three new enum-like string values (no schema change — it is a free string with a check in service code).

## Service Boundaries

- `graph-extraction.service.ts` — pure extraction: wiki-link parser, title resolver, similarity calculator. No DB writes.
- `graph-refresh.service.ts` — orchestration: loads a Space's pages, runs layers, reconciles origin-scoped relations in a transaction, records stats, emits LLM ChangeSet proposals.
- `graph-maintenance.ts` — worker timer + debounce queue (follows `memory.maintenance` pattern).
- `graph.controller.ts` — manual refresh endpoint + settings get/patch (owner/admin guarded).

Existing `knowledge.service.ts` and MCP graph tools remain unchanged read paths.

## API

- `POST /spaces/:id/graph/refresh` — body `{ layers?: ('wikilink'|'similar'|'llm')[] }` → `{ wikilink: {created, removed, dangling}, similar: {...}, llm: {changeSetId|null, proposed} }`
- `GET /spaces/:id/graph/settings` → toggle states + threshold
- `PATCH /spaces/:id/graph/settings` → update toggles/threshold (owner/admin)

## Error Handling

- Missing embeddings: layer 2 reports `skipped` count, never fails the run.
- LLM unavailable/misconfigured: layer 3 reports `{ changeSetId: null, reason: 'llm_unavailable' }`; other layers still run.
- Invalid LLM JSON: retry once with a stricter prompt; on second failure record the error and continue without proposing (never block layers 1–2).
- Concurrent refreshes on the same Space: serialize via the existing transaction; the second run reconciles against the first's results naturally.

## UI

- Graph view edge tooltips/list gain an origin badge (自动·链接 / 自动·相似 / 自动·LLM / 手动 / 采集 / 同步); filter chips per origin.
- Space settings page gains an "Auto graph" card: three toggles + threshold slider, and a "Refresh now" button showing per-layer stats.

## Testing

- Unit: wiki-link parser (plain/alias/dangling/self-link), title resolution (exact/case/slug/ambiguous→skip), similarity canonicalization and threshold, LLM JSON validation.
- Integration (service): reconciliation add/remove/keep across reruns; ownership guard (never touches `manual`/other origins); unique-conflict skip; dangling reporting; ChangeSet proposal contents and gating (pending predecessor blocks).
- E2E-ish: manual endpoint happy path over a seeded space; worker debounce via fake timers (follow existing maintenance tests).
- Contract: new origins exposed through graph read APIs unchanged.

## Non-Goals

- Cross-Space relations.
- Embedding backfill orchestration (pages without embeddings are simply skipped until re-indexed).
- Graph visualization layout changes beyond the origin badge/filter.

