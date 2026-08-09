# Local Knowledge Orchestrator 0.2.0 Implementation Roadmap

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this roadmap plan-by-plan. Every linked plan uses checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the mandatory retired external compiler path with a zero-configuration local knowledge orchestrator, managed source adapters, authoritative per-Space revisions, confirmation-gated bidirectional sync, and three-way conflict proposals.

**Architecture:** The work is split into four sequential, independently reviewable plans. Plans 1 and 2 produce a useful offline local workspace before any server protocol changes; Plan 3 adds the authoritative server revision contract; Plan 4 joins both sides, adds conflict handling, migrates installation UX, and proves the release with real Agents and two local homes.

**Tech Stack:** Node.js 26, TypeScript/ESM, stdio MCP SDK, Zod, Vitest, NestJS 10, Prisma 5/PostgreSQL, Jest, React/Vite, Playwright-compatible browser verification.

## Global Constraints

- Raw source repositories, original binary documents, raw Agent Memory databases, and local credentials never leave the local machine.
- One Space has one unified Wiki; adapters are provenance sources, never separate visible wikis.
- The current local Agent performs semantic organization; the orchestrator embeds no model and uses no shared model key.
- Every upload requires a fresh preview plus explicit confirmation in the current conversation.
- The server is authoritative; local files are an editable cache and working copy.
- Conflicts use base/local/remote proposals; last-write-wins is forbidden.
- Adapters cannot write Wiki files, upload data, approve, or publish.
- Normal setup is one pinned install instruction; no interactive init, manual MCP JSON, local port, or daemon.
- `0.1.x` connections do not switch automatically; the new protocol ships as `0.2.0` only after real E2E acceptance.

---

## Plan Order

1. [Protocol, workspace, validation, and deterministic job state](2026-07-30-local-knowledge-core-plan.md)
   - Deliverable: offline `start → collect fixture → work items → validate → preview` flow with crash recovery and no network.
2. [Managed adapter runtime and first-party adapters](2026-07-30-local-knowledge-adapters-plan.md)
   - Deliverable: codebase-memory and MarkItDown produce compliant `SourceArtifact` batches without retired external compiler or manual init.
3. [Authoritative Space revisions and server ChangeSet bridge](2026-07-30-space-knowledge-revisions-plan.md)
   - Deliverable: Snapshot/Delta/Pull/Submit APIs that compile a confirmed KnowledgeBundle into reviewable page, memory, relation, and deletion items.
4. [Bidirectional sync, conflict proposals, installation migration, and release](2026-07-30-local-knowledge-sync-release-plan.md)
   - Deliverable: two-home sync, three-way merge, updated MCP/Skill/UI/docs, real Agent acceptance, and a release-ready `0.2.0` package.

## Cross-Plan Gates

- Do not begin Plan 2 until Plan 1's package tests, typecheck, lint, and build pass.
- Do not begin Plan 3 until Plan 2 proves raw files and credentials never enter serialized artifacts.
- Do not begin Plan 4 until the server migration applies to a disposable PostgreSQL database and revision integration tests pass.
- Do not publish or update `latest` until all real E2E scenarios in Plan 4 pass on Codex, Claude Code, and OpenCode.

## Specification Coverage

| Confirmed requirement | Implemented by |
| --- | --- |
| Local-only collection, organization, validation, and secret checks | Core Tasks 1-5; Adapters Tasks 1-6 |
| codebase-memory, MarkItDown, future agent-memory as equal adapters | Adapters Tasks 1, 4, 5, 6; the contract is the future agent-memory extension point |
| Current local Agent performs semantic organization | Core Tasks 4-5 |
| Deterministic state machine, Recipe, Schema, evidence, checkpoints, bounded repair | Core Tasks 1-5 |
| One unified Wiki per Space and owner-only local state | Core Task 2; Sync Tasks 3-4 |
| No raw repository, binary document, memory DB, or credential upload | Core Task 3; Adapters Tasks 1-6; Sync Tasks 8-9 |
| Complete portable derived knowledge, not short-excerpt-only | Protocol `KnowledgeBundle`; Server Tasks 2 and 4 |
| Server-authoritative immutable Revision with Snapshot/Delta | Server Tasks 1, 3, 5, 6 |
| ChangeSet review and scoped auto-publish remain authoritative | Server Tasks 4-6 |
| Bidirectional incremental sync and cross-machine restore | Sync Tasks 1, 3, 4, 8 |
| base/local/remote merge proposal with explicit confirmation | Sync Tasks 2, 4, 5, 8 |
| One install instruction, private runtime, no init/key/MCP JSON/port/daemon | Adapters Tasks 2-3; Sync Tasks 6-7 |
| Adapter atomic upgrade/rollback and process-group cleanup | Adapters Tasks 2-3 |
| `0.1.x` stays legacy; explicit `0.2.0` migration | Sync Tasks 6-7 |
| Real Codex, Claude Code, OpenCode and two-machine verification | Sync Tasks 8-9 |

## Final Verification

Run from the project root:

```bash
pnpm test:runtime
pnpm --filter @neomei/agentwiki-local-sync test
pnpm --filter @agentwiki/server test
pnpm --filter @agentwiki/client test
pnpm typecheck
pnpm lint
pnpm build
AGENTWIKI_LOCAL_SYNC_E2E=1 pnpm test:e2e:local-sync
```

Expected: every command exits `0`; the E2E report records Snapshot recovery, Delta pull, confirmed push, conflict preview, approval/publish, and zero raw-source leakage.
