# Backend independent audit — round 1

Candidate: base `165c207bf4b644efa810ea6c9a3da11d28c4f96e` → HEAD `e0f2d12ab5d4214c6e326affe305fdc3c609ca3f`, product `ddfaf538`. Read-only review; no repository changes, services, DB, browser, model calls or shared build output. No CodeGraph directory. Read AGENTS, current/spec index, architecture, source-freshness spec and plan.

## Finding 1 — P2: idempotent replay rewrites the current Source metadata before returning its historical receipt

Location: `/Users/neomei/.codex/worktrees/knowledge-capabilities/AgentWiki /agentwiki/apps/server/src/knowledge-pipeline/knowledge-sync.service.ts:145` (lines 145–155).

`persistSync` upserts `name` and `config` from the request before consulting `SourceSyncReceipt`. Therefore A/K1 → B/K2 → replay A/K1 returns historical A correctly and leaves head B/generation 2, but commits A's source name/kind/producer over B. The API's source list and projected evidence now display the old name against the current accepted input; a queued B Run's ChangeSet title is also composed from the reverted `run.source.name` (`source.service.ts:587`). This can also undo a manual Source rename on a network retry. This is an ordinary supported request sequence, not corrupted-data setup.

Reproduced using the actual TypeScript `persistSync` implementation transpiled in memory, with a minimal transaction stub representing an existing B source and an A receipt. Output is `/tmp/agentwiki-comprehensive-audit-20261007/backend-idempotent-replay-proof.json`: before.name="B name", receipt result existing/VA/RA, after.name="A name" and producer B→A while head stays VB/2. No DB required for this deterministic ordering bug.

Fix: acquire/create the source identity without mutating existing metadata; after the source lock, return a verified existing receipt before any metadata update. Update current metadata only for a newly accepted request. Test A/K1→B/K2→replay A/K1, plus no-op receipt replay and rename→replay; assert all source metadata as well as head/generation remain unchanged on replay.

## Finding 2 — P2: source-bearing Run reads still trust cross-Space foreign keys

Location: `/Users/neomei/.codex/worktrees/knowledge-capabilities/AgentWiki /agentwiki/apps/server/src/knowledge-pipeline/source.controller.ts:84` (lines 84–88), with raw expansion at `/Users/neomei/.codex/worktrees/knowledge-capabilities/AgentWiki /agentwiki/apps/server/src/knowledge-pipeline/source.service.ts:287` (lines 287–293; list counterpart 279–284).

The new personal `sources:read` check only validates a PAT scope. `assertIngestRunAccess` checks `run.spaceId` (`authorization.service.ts:241`); then `getRun` returns `source: true`, all evidence and ChangeSet payloads without checking those records belong to that authorized Space. Unlike the new Page/Review/graph projections, a corrupted Run source FK can therefore expose a different Space's full Source URI/config; corrupted evidence associations similarly return quote/location/version IDs unfiltered. `listRuns` exposes foreign Source IDs/names/types. This is an existing adjacent raw-read weakness left open by this branch's source-read boundary changes; not claimed as a new normal-write exploit. It matters because the approved spec explicitly includes damaged cross-Space associations and does not treat a simple FK as an authorization proof.

Deterministic reproduction setup for isolated DB: create source SB in Space B and run RA with spaceId A/sourceId SB (ordinary independent FKs allow this); authenticate a viewer of A only; GET /runs/RA passes current controller authorization and returns SB's full object. Also link an evidence row on a valid A run to a B source version and verify its quote is returned. No DB was started for this review; code-path finding, awaiting centralized DB test if accepted.

Fix: validate Run→Source→Version and nested evidence/changeSet Space ownership before raw source-bearing responses, or reuse a dedicated authorized Run projection. Deny/redact incoherent association rather than disclose its target. Keep authorized normal Run details usable. Add A/B isolation tests for list and detail plus JWT/allowed PAT controls.

## Coverage and limits

Reviewed branch server/shared/Prisma changes and adjacent code: head/generation and receipts, source intake/update/run/retry/worker candidate creation, source publication guard, ordinary/collaboration publication and revert, Page edit/restore/list/detail/hierarchy, source-generation invalidation callsites across content tree/attachments/Obsidian, SourceFreshnessService snapshots/evidence/Review/graph projections, REST/MCP boundary wiring, personal credential locks, schema and additive migration. Checked all direct Page update/upsert callsites by search. No further actionable issue established in these paths. Did not interpret getState's last-completed-run semantics as a bug absent a stronger contract; did not classify cosmetic structure, hypothetical performance or unsupported attacker-controlled database writes as ordinary production exploits.
