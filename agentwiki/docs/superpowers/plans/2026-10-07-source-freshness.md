# Source Freshness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make source changes visible to humans and Agents, and restore directly linked knowledge through reviewed updates.

**Architecture:** Track accepted OKF input head and generation, pin each Run, guard existing ChangeSet publication, and project an authorized freshness status. Keep existing ingestion, page storage, evidence and review systems.

**Tech Stack:** TypeScript, Nest/Prisma/PostgreSQL, React/Vite, current Jest/Vitest and isolated database helpers.

**Spec:** `agentwiki/docs/superpowers/specs/2026-10-07-source-freshness.md`.

## Global Constraints

- Worktree `/Users/neomei/.codex/worktrees/knowledge-capabilities/AgentWiki ` (trailing space), branch codex/knowledge-capabilities; Git explicit --work-tree; no core.worktree changes.
- Follow completed retrieval work; do not alter its frozen corpus or baseline. Do not run product writers concurrently. p5c07ff/gpt-6-astra implementation and independent review; record any native fresh-thread limit deviation.
- Scope direct OKF sourceKey re-sync only. No CodeWiki, new search/approval system, automatic semantic dependency inference or automatic publication.
- Preserve live identity/Space boundaries, explicit Space gateway routing, page/tree baselines, human review and historical evidence. No user data uploads, production migration, push/merge/release/deploy.
- Identity→Space advisory→Space→Source locks; sorted Source locks. Worker never advances head. Historical null is unknown.
- Own schema/Redis/ports/process/home only. Additive migration independently reviewed before approved digest changes or DB execution; never edit old migrations or bypass integrity guard.

### Task 1: Accepted source head and guarded review publication

**Files:**
- Modify `agentwiki/apps/server/prisma/schema.prisma`; create one additive migration under `prisma/migrations/`.
- Create `agentwiki/apps/server/src/knowledge-pipeline/source-head.ts` and `.spec.ts` for shared lock/validation contracts, not a second service framework.
- Modify `knowledge-pipeline/knowledge-sync.service.ts`, `source.service.ts` and matching specs.
- Modify `review/review.service.ts`, `review/page-update-publication.ts`, associated review/publication-conflict/page-publication specs.
- Modify `core/page/page.service.ts`, matching specs for human edits/restores.
- Modify `integrations/obsidian/push-session.service.ts`, `sync-v3-push-session.service.ts`, `content-tree/content-tree.service.ts`, `attachments/attachment.service.ts` and corresponding tests for actual content mutations.
- Modify `scripts/backfill-sync-v1.mjs`, `scripts/recover-legacy-document-data.mjs` and existing matching tests to invalidate actual body/source-pointer changes; do not execute these migration scripts on user data.
- Create small `core/page/source-generation.ts` pure invalidation helper and specs if useful. Extend `core/authorization/authorization.service.ts`/spec only as needed to lock and recheck personal credential along with human User before Space; current lockLiveHumanPrincipal locks User only.
- Only after independent SQL review: update exact approved corpus constants in `agentwiki/scripts/folder-test-database.mjs`, `content-tree-core-db.test.mjs`, `collaboration-schema-db.test.mjs` as applicable; add dedicated `source-freshness-db.test.mjs` using the existing protected wrapper.

**Interfaces:**
```ts
type SourceHead = { sourceId: string; sourceVersionId: string; generation: number };
// Caller already holds identity and Space mutation lock.
async function lockSourceHead(tx: Prisma.TransactionClient, sourceId: string, spaceId: string): Promise<SourceHead | null>;
function assertSourceHeadMatches(head: SourceHead | null, input: { sourceId: string; sourceVersionId: string | null; generation: number | null }): void;
// null historical head is not current; tracked head requires exact positive generation and version.
```
Use a distinct `SOURCE_VERSION_CONFLICT` BusinessException for superseded inputs, with a concise regenerate instruction. Register it in existing business-error codes if required. `lockSourceHead` checks active Source, same Space and SourceVersion ownership; null return means historical untracked head, not authorization success.

- [ ] Add failing tests for accepted-head semantics before code. Test A1→B2→A3 keeps A versionId but increments generation; same current input concurrent/replayed does not increment; same idempotency key cannot roll head backward. Assertions:
```ts
expect(a3.sourceVersionId).toBe(a1.sourceVersionId);
expect(a3.inputSourceGeneration).toBe(3);
expect(() => assertSourceHeadMatches(headA3, inputA1)).toThrow();
expect(() => assertSourceHeadMatches(headA3, inputB2)).toThrow();
```
- [ ] Add schema fields Source.currentSourceVersionId/currentSourceGeneration, IngestRun.inputSourceGeneration, Page.sourceGeneration, nullable relation to SourceVersion and backrelation. Add SourceSyncReceipt with id, sourceId, idempotencyKey, inputHash, sourceVersionId, inputSourceGeneration (nullable for historical Run replay), resultStatus, runId nullable, createdAt, and unique[sourceId,idempotencyKey]. Store runId as an immutable receipt reference (not a mutable SetNull relation); Source deletion may cascade. Migration has no backfill, destructive SQL or global setting. FK delete may null head without resetting generation; constraints: nonnegative Source generation, nonnull head needs positive generation, nullable Run/Page/receipt generation positive if set.
- [ ] Refactor createSync intake to correct identity/advisory/Space ordering: Agent uses lockLiveAgentWriteAccessAcrossSpaceBoundary; human explicitly locks User and, for personal credentials, same-user ApiKeyCredential (active/not expired), then revision writer advisory/Space lock, then live human Space/PAT recheck. Existing lockLiveHumanPrincipal locks User only, so explicitly add the PAT row protection before Space. Apply same human sequence to worker's currently unlocked requester read using existing requestedCredentialId/requestedCredentialType. JWT has no personal credential row; do not invent one. Lock Source before version/head/receipt/run decisions. Preserve contentHash identity and confirmed/audit behavior. Positive Int overflow rejects. Restrict same-content reuse to current generation; A→B→A and historical-null create a new fixed Run. Save receipt even for reused/noop result; read receipt before modifying head, reject same-key different inputHash, return recorded source/version/run tuple with replay status existing (or noop for originally no-run outcome), never queued again; do not mutate the recorded original outcome. Honor pre-migration Run keys without inventing missing historical noop receipts. Resolve concurrent winner only through the durable receipt/legacy exact key with fresh authorization, never a generic matching version that lacks this request key. Test A/K1→A/K2(noop)→B/K3→K2 replay and human/PAT revocation races.
- [ ] Source createRun for OKF snapshots validated current head under the same locks; retry keeps original input generation. New Run after published/reverted prior Run gets current fixed head through explicit new-run flow, never silent retry upgrade.
- [ ] Worker verifies fixed input after existing identity/Space lock, before creating ChangeSet. Include generation in every source-bound page payload, including archive; compare Page.sourceGeneration when detecting unchanged content so missing/new generation still produces review candidate. Run-level guard protects relation-only accepted items too.
- [ ] Disable scoped-auto-publish for tracked OKF changes. In publication transaction, after identity/Space locks, lock sorted Sources, validate candidate payload against Run input and head before Page/Approval mutation. Missing generation under a tracked head rejects. Preserve tree/page baseline and all-or-nothing transaction semantics. Publication with autoPublishContext rejects tracked OKF even if already approved.
- [ ] Persist Page.sourceGeneration on published create/update/restored-create only from server-validated pinned Run/head, never trust direct payload or changes.sourceGeneration. Pass validated SourceHead explicitly into shared publication helper; ordinary/collaboration proposals without this proof clear generation on actual content changes. Include generation in before, restore in revert branches; missing old before means null. Inventory all Page content/format writers with rg and record decisions. Human actual changes (not same-value fields), both Local Sync/Obsidian push services, attachment link rewrites and PageVersion restoration clear generation; title/placement-only edits preserve. Add no-Run proposal and Local Sync regression tests, plus forged source-generation payload rejection. Never modify Source head during publish/revert.
- [ ] Apply invalidation at actual final normalized mutation points: SyncV1 applyPageChanges, SyncV2 ContentTreeService.publishSyncV2BatchLocked (not only its delegating controller), SyncV3 applyLiveChanges, AttachmentService.rename, backfill-sync-v1.migratePages. Record generation in V1 revertSnapshot. recover-legacy-document-data.writeJobRecoveryPlan clears generation when source/version/path association actually changes. Pure path/order/deletion/embedding writes preserve it. Generic new pages/templates default null. Compare each page individually in mixed batches; do not use batch-level changed as a shortcut.
- [ ] Run focused unit tests plus Prisma generate/server build; commit SQL/backend changes without updating digest. Submit exact SQL/schema diff for independent review. After review receipt, compute new corpus hash with existing inspector and update reviewed constants; apply through protected random-schema test wrapper only.
- [ ] Add/run real DB races and vertical publication assertions: two same inputs advance once; late A/B worker and candidate cannot publish; source archived blocks; partially rejected pages remain old generation; manual edit/restore/revert; failed later accepted item rolls back Page and Approval; null historical records remain unknown. Preserve public inventory and cleanup receipts. Commit follow-up verification and report exact commits/results.

### Task 2: Authorized Agent read state and human review visibility

**Files:**
- Create `agentwiki/apps/server/src/core/source-freshness/source-freshness.service.ts`, module and specs (batch read projection only).
- Add shared DTO in `agentwiki/packages/shared/src/index.ts` or focused exported source file.
- Modify `agentwiki/packages/local-sync/skill/SKILL.md` for general source/citation semantics; retain existing installation-byte verification in `src/agent-clients.spec.ts`.
- Modify `core/page/page.service.ts`, `page.controller.ts`, `page.module.ts`; `core/search/search.controller.ts`, `search.module.ts`; `mcp/mcp.service.ts` and corresponding tests/module imports.
- Modify `review/review.service.ts` read projection and matching specs; no change to Task1 mutation guards.
- Modify `core/knowledge/knowledge.service.ts`, controller/module/spec for graph node status and authorized relation evidence; reuse the same projection/allowlist instead of parallel privacy logic.
- Modify `core/authorization/authorization.service.ts`/spec and `knowledge-pipeline/source.controller.ts`/spec only for a shared personal sources:read check used by source projection and direct Source list/detail; no global REST or device-authorization rewrite.
- Modify `agentwiki/apps/client/src/features/page/PagePreview.tsx`, `features/space-workspace/PageInfoPanel.tsx`, `features/review/ReviewPage.tsx`, their specs and existing locale files; reuse existing components/styles.

**Interfaces:**
```ts
type PageSourceStatus = {
  status: 'untracked' | 'unknown' | 'unavailable' | 'needs_review' | 'current';
  reason: 'no_source' | 'unverified_source' | 'source_unavailable' | 'source_changed' | 'page_changed' | 'reviewed_source';
  sourceId?: string;
  reviewedSourceVersionId?: string; currentSourceVersionId?: string;
  reviewedSourceVersion?: number; currentSourceVersion?: number;
  reviewedSourceGeneration?: number; currentSourceGeneration?: number;
};
// Use already page-authorized immutable Page snapshots from the same response.
// Never reread Pages by ID and merge a newer source status onto older content.
SourceFreshnessService.forPages(pages: SourceBoundPageSnapshot[], principal: Principal): Promise<Map<string, PageSourceStatus>>;
// Share the underlying source/version/generation comparator with create candidates (no Page ID).
// Published page responses expose sourceStatus. Review candidates use same DTO vocabulary
// against pinned Run/payload, with server publish check remaining authoritative.
```

- [ ] Add failing projection tests for untracked, null-head unknown, same-version+generation current, generation mismatch needs_review (including A→B→A), cleared Page generation page_changed, archived unavailable, denied/cross-Space source redaction. Assert authorization-denied/corrupt-association output has no source identifiers/names/versions/links, including legacy raw Page source fields, not only new DTO. Archived-but-authorized historical evidence remains readable.
- [ ] Implement bounded batch source/version lookup from already-read Page snapshots with per-Source authorization and explicit same-Space/ownership checks. Expected authorization denial becomes redacted state; infrastructure errors must not masquerade as successful current state. Only minimum version fields, no content/config/metadata blobs. Personal credentials require live sources:read or * as well as membership, both in projection and direct Source list/detail; pages-only PAT retains authorized Page body but no source/evidence/run details. Cover JWT and allowed PAT controls without altering generic device semantics.
- [ ] Public findOne receives Principal from REST, MCP get_page and page resource. Internal existence checks stop invoking rich public read without Principal. Public REST/MCP list/search and hierarchy paths carrying Page body attach sourceStatus, using the batch projector; do not change ranking or corpus facts.
- [ ] Replace Evidence include with explicit allowed fields and per-Source authorization; retain authorized quote/location/confidence, version ID/number, minimal source identity, at most3 file paths and supported commit metadata. Never return SourceVersion.content or arbitrary metadata. For directly bound OKF evidence, mark historical if it does not match Page's published version+generation; untracked evidence state is unknown. Remove provenance.run.source when source denied, and do not reveal inaccessible link targets.
- [ ] Apply the same source authorization and allowlist to graph relation evidence/sourceInfo/sourceMetadata and Review detail evidence; unknown metadata blobs cannot bypass through another read path. Graph nodes receive sourceStatus via batch page projection. REST graph controller and MCP list_graph pass Principal. Do not infer indirect semantic invalidation of unrelated edges.
- [ ] Review list/detail and every mutation returning loadChangeSet show pinned vs current source state; unauthorized source fields/payload source references are redacted there too. Page mutations returning Page data use the same response projection, including PagePreview checkbox updates. Validate access before generating per-item source links or notices. Keep original reviewer scope and membership requirements.
- [ ] Add visible PagePreview needs-review notice, details/version differences and historical evidence labels in PageInfoPanel, current/expired source indication in ReviewPage. “当前来源已复核” must not imply factual correctness; unknown differs from current. Hide irrelevant untracked notice on ordinary human pages. Follow existing locale and accessibility conventions, and client project design rules.
- [ ] Extend shipped Local Sync skill with generic citation precision: every answer comparing/rejecting an obsolete or distracting source cites both that source and the applicable authority; sourceId, sourceVersionId and version number are distinct and must retain their actual labels. Describe sourceStatus needs_review/unknown/unavailable without claiming unverified truth. No fixture IDs/questions/answers in guidance; synchronization consent suffix remains byte-identical. Cover installed skill bytes through existing distribution test. This closes the independently observed strict-citation/SourceId-label gaps from the corrected retrieval comparison, not a new retrieval framework.
- [ ] Run targeted server projection/controller/MCP/review tests, client specs/typecheck/build, and API+Worker Nest module-graph tests. Commit and report. Independent review checks redaction, coverage and no read-service dependency cycles before acceptance.

### Task 3: Real source-change workflow and independent acceptance

**Files:**
- Add `agentwiki/scripts/source-freshness-acceptance.mjs` if automation is useful; reuse protected DB and owned runtime utilities from retrieval task without changing corpus.
- Create `agentwiki/docs/verification/knowledge-capabilities-20261007/source-freshness-acceptance.md` plus sanitized evidence index/result JSON.

**Interfaces:** fixed reviewed build/commit, synthetic OKF v1/v2/v3 inputs, actual API+worker+MCP and built frontend, fresh real-model consumers, human review through actual UI.

- [ ] Build fixed candidate in owned runtime and record migration/tree/build hashes, corpus and source/run/change/page IDs; secret-bearing state0600 outside committed docs. Verify protected inventory before running.
- [ ] Import v1 through real confirmed sync API, process actual worker, human review/publish. Send v2 same sourceKey with one changed fact and one unchanged unrelated page outside this Source. Assert source-linked pages need review immediately, formal content unchanged and unrelated page unaffected; capture actual search/list/get_page state.
- [ ] Fresh real Agent consumer A must identify old fact as needs_review using actual gateway returns and cite basis. Keep prompt neutral, raw answers and read traces; fixture only seeds facts, never supplies model output. Match frozen retrieval consumer model/effort if available; report actual provider separately.
- [ ] Use built UI to read notice, inspect old/new evidence and candidate, accept only one of two updates and reject another; verify only accepted page becomes current. Regenerate rejected item with existing run action. Publish replacement and verify a fresh Agent B reads new conclusion while old basis remains labeled historical.
- [ ] Exercise superseding v3 before publication, A→B→A, human edit conflict, source archive and live permission revocation via actual APIs, plus focused UI checks for disabled/error feedback. Old candidate must not become current. Verify page restore and ChangeSet rollback freshness separately.
- [ ] Inspect layout at1280/1600/390 with source notice, long article/wide table and existing sidebar/TOC; use own browser only, no other chat runtime. Record real UI observations separately from unit/DB/fixture results.
- [ ] Rerun the frozen eight retrieval questions with two fresh actual consumers against the integrated reviewed candidate using the same persistent facade/protocol, corpus/questions/model/budget. Record any harness identity change caused by the separately reviewed migration-corpus constants; do not call those runtime hashes identical. Preserve corrected baseline; separately document any new sourceStatus fields for historical fixture rows (unknown, never fabricate accepted heads). Confirm citations use real source/version labels, compare strict citation coverage without regrading old output, and retain provider retries/cost limits.
- [ ] Whole-branch independent review from165c207b through actual candidate, fix material findings, run relevant changed checks only. Clean own resources and verify inventory/ports/credentials. Archive result with local implementation, review, UI, realprovider/fixture, ACP unchanged interface-only, and no deployment; update task current state honestly.
