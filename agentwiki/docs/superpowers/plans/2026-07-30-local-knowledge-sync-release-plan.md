# Bidirectional Local Knowledge Sync and 0.2.0 Release Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Join the local orchestrator to authoritative Space revisions, add safe Pull/Push and Agent-authored three-way merge proposals, migrate setup and guides to the zero-configuration flow, and prove a release-ready `0.2.0` across Agents and machines.

**Architecture:** `SyncEngine` pulls Snapshot/Delta into the atomic Space workspace and submits only a fresh validated preview. A deterministic three-way diff auto-merges non-conflicting fields and emits bounded semantic conflict work items for the connected Agent; user confirmation gates the final submission. Installation explicitly migrates a selected `0.1.x` connection, creates every readable Space workspace, and leaves old retired external compiler previews inert.

**Tech Stack:** Node.js 26, TypeScript/ESM, stdio MCP, Vitest, NestJS API, React/Vite/Vitest, local PostgreSQL/Redis E2E, real Codex/Claude Code/OpenCode acceptance.

## Global Constraints

- Pull never overwrites uncommitted local changes; it merges or stops with a conflict.
- Push always refreshes the remote head before diffing and rejects a stale confirmation nonce.
- Conflict choices are not made automatically for a concurrently changed field or delete/modify pair.
- Confirmation binds job ID, bundle hash, base revision, remote head, Space, counts, and expiry.
- Installation never scans or uploads; adapter installation occurs only after a source job is requested and local paths are confirmed.
- Existing `0.1.1` installations remain functional but are labelled legacy; only explicit `upgrade --version 0.2.0` migrates them.
- Production claims and screenshots must reflect a real successful build, not mock or deformed UI.
- npm publish, Git push, deployment, and GitHub Release remain separate externally mutating actions requiring explicit authorization at execution time.

---

### Task 1: Revision-aware AgentWiki HTTP client

**Files:**
- Modify: `packages/local-sync/src/agentwiki-client.ts`
- Modify: `packages/local-sync/src/agentwiki-client.spec.ts`

**Interfaces:**
- Produces: `getRevisionHead`, `getSnapshot`, `getDelta`, `submitKnowledge`, `getSubmission`.

- [ ] **Step 1: Write failing request/response tests**

```ts
await client.getDelta(connection, apiKey, 'space 1', 'rev/1');
expect(request).toHaveBeenCalledWith(
  'https://wiki.test/api/spaces/space%201/knowledge-revisions/delta?from=rev%2F1',
  expect.objectContaining({ headers: { Authorization: 'Bearer test-token' } }),
);
```

Use a non-secret fixture token that does not match production prefixes. Assert ETag handling, 304 behavior, JSON Content-Type, idempotency and confirmation headers, typed stale-base error, response-size ceiling, retry only for GET network/502/503/504, and no retry for POST.

- [ ] **Step 2: Verify failure**

Run: `pnpm --filter @neomei/agentwiki-local-sync test -- agentwiki-client.spec.ts`

Expected: FAIL because revision methods do not exist.

- [ ] **Step 3: Implement exact client contracts**

```ts
export interface RevisionHead { revisionId: string; sequence: number; contentHash: string; }
export interface RevisionSnapshot extends RevisionHead { schemaVersion: string; recipeVersion: string; bundle: KnowledgeBundle; }
export interface RevisionDelta { fromRevision: string; toRevision: string; revisions: Array<{ revisionId: string; sequence: number; contentHash: string; delta: KnowledgeDelta }>; }
export interface KnowledgeSubmissionResult { status: 'pending_review' | 'published' | 'noop' | 'existing'; submissionId: string; changeSetId: string | null; currentRevision: string; }

getRevisionHead(connection: LocalSyncConnection, apiKey: string, spaceId: string): Promise<RevisionHead>;
getSnapshot(connection: LocalSyncConnection, apiKey: string, spaceId: string, revisionId?: string): Promise<RevisionSnapshot>;
getDelta(connection: LocalSyncConnection, apiKey: string, spaceId: string, fromRevisionId: string): Promise<RevisionDelta>;
submitKnowledge(connection: LocalSyncConnection, apiKey: string, spaceId: string, bundle: KnowledgeBundle, idempotencyKey: string, confirmationHash: string): Promise<KnowledgeSubmissionResult>;
getSubmission(connection: LocalSyncConnection, apiKey: string, spaceId: string, submissionId: string): Promise<KnowledgeSubmissionResult>;
```

Keep legacy OKF methods until migration tests pass, but do not call them from new MCP tools.

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm --filter @neomei/agentwiki-local-sync test -- agentwiki-client.spec.ts && pnpm --filter @neomei/agentwiki-local-sync typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/local-sync/src/agentwiki-client.ts packages/local-sync/src/agentwiki-client.spec.ts
git commit -m "feat(local-sync): call knowledge revision API"
```

### Task 2: Deterministic three-way diff and conflict bundles

**Files:**
- Create: `packages/local-sync/src/three-way-merge.ts`
- Create: `packages/local-sync/src/three-way-merge.spec.ts`

**Interfaces:**
- Produces: `mergeBundles(base, local, remote)`, `ConflictBundle`, `applyConflictResolution`.

- [ ] **Step 1: Write the full failing merge matrix**

```ts
expect(mergeBundles(base, unchangedLocal, changedRemote)).toEqual({ merged: changedRemote, conflicts: [] });
expect(mergeBundles(base, changedTitleLocal, changedBodyRemote).conflicts).toHaveLength(0);
expect(mergeBundles(base, changedBodyLocal, changedBodyRemote).conflicts[0]).toMatchObject({ itemId: 'page-1', conflictingFields: ['content'] });
expect(mergeBundles(base, deletedLocal, changedRemote).conflicts[0]).toMatchObject({ conflictKind: 'delete-modify' });
```

Cover add/add same and different content, local-only change, remote-only change, different-field merge, same-field conflict, delete/delete, delete/modify, relation endpoint conflict, memory expiry conflict, reorder-only page updates, and tombstone non-resurrection.

- [ ] **Step 2: Verify failure**

Run: `pnpm --filter @neomei/agentwiki-local-sync test -- three-way-merge.spec.ts`

Expected: FAIL because merge code is absent.

- [ ] **Step 3: Implement exact conflict types and pure merge**

```ts
export interface ConflictBundle {
  id: string; itemId: string; itemKind: 'page' | 'memory' | 'relation';
  conflictKind: 'add-add' | 'field' | 'delete-modify';
  base: KnowledgeItem | null; local: KnowledgeItem | null; remote: KnowledgeItem | null;
  provenance: ProvenanceRecord[]; conflictingFields: string[];
}
export interface MergeResult { merged: KnowledgeBundle; conflicts: ConflictBundle[]; }
export function mergeBundles(base: KnowledgeBundle, local: KnowledgeBundle, remote: KnowledgeBundle): MergeResult;
export function applyConflictResolution(result: MergeResult, conflictId: string, resolved: KnowledgeItem | DeletionProposal, provenance: ProvenanceRecord[]): MergeResult;
```

Compare normalized values field by field; never compare timestamps as winners. Conflict IDs are hashes of item ID, base hash, local hash, and remote hash. Resolution must still pass protocol and provenance validation.

- [ ] **Step 4: Run merge tests**

Run: `pnpm --filter @neomei/agentwiki-local-sync test -- three-way-merge.spec.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/local-sync/src/three-way-merge.ts packages/local-sync/src/three-way-merge.spec.ts
git commit -m "feat(local-sync): merge knowledge revisions safely"
```

### Task 3: Atomic Pull and materialization

**Files:**
- Create: `packages/local-sync/src/sync-engine.ts`
- Create: `packages/local-sync/src/sync-engine.spec.ts`
- Modify: `packages/local-sync/src/space-workspace.ts`

**Interfaces:**
- Produces: `SyncEngine.pullSpace(spaceId)`, `SyncEngine.refreshJob(jobId)`.

- [ ] **Step 1: Write failing Pull tests**

Assert first connection downloads Snapshot; clean workspace applies Delta; invalid Delta falls back to Snapshot; interrupted write keeps prior revision; dirty local plus changed remote returns a `MergeResult` without materializing; permission revocation stops; hash/schema mismatch fails closed; and ETag 304 is a noop.

- [ ] **Step 2: Verify failure**

Run: `pnpm --filter @neomei/agentwiki-local-sync test -- sync-engine.spec.ts`

Expected: FAIL because `SyncEngine` is absent.

- [ ] **Step 3: Implement Pull**

```ts
export interface PullResult {
  status: 'current' | 'materialized' | 'conflict';
  previousRevision: string; currentRevision: string; conflicts: ConflictBundle[];
}
export class SyncEngine {
  pullSpace(spaceId: string): Promise<PullResult>;
  refreshJob(jobId: string): Promise<{ job: KnowledgeJob; conflicts: ConflictBundle[] }>;
}
```

Detect dirty local state by hashing `readLocalBundle()` and comparing `manifest.localBundleHash`. For clean state, apply Delta in a temporary bundle, validate every intermediate content hash, then call `workspace.materialize`. For dirty state, load `.state/base/bundle.json`, fetch remote, call `mergeBundles`, save a draft, and leave `wiki/` unchanged until conflicts are resolved and previewed.

- [ ] **Step 4: Run Pull tests**

Run: `pnpm --filter @neomei/agentwiki-local-sync test -- sync-engine.spec.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/local-sync/src/sync-engine.ts packages/local-sync/src/sync-engine.spec.ts packages/local-sync/src/space-workspace.ts
git commit -m "feat(local-sync): pull authoritative revisions"
```

### Task 4: Confirmation-bound Push and submission polling

**Files:**
- Modify: `packages/local-sync/src/sync-engine.ts`
- Modify: `packages/local-sync/src/sync-engine.spec.ts`
- Modify: `packages/local-sync/src/job-state.ts`
- Modify: `packages/local-sync/src/orchestrator.ts`

**Interfaces:**
- Produces: `previewPush(jobId)`, `confirmAndPush(jobId, nonce, confirmed)`, `refreshSubmission(jobId)`.

- [ ] **Step 1: Write failing confirmation tests**

Assert Push first refreshes head; conflicts block preview; preview summary includes Space, base/head, page/memory/relation/deletion counts, byte size, adapters, `review-required` list, bundle hash, expiry; wrong/expired/reused nonce fails; modified bundle after preview fails; network failure remains pending; pending review does not update local base; published response pulls and materializes the returned revision.

- [ ] **Step 2: Verify failure**

Run: `pnpm --filter @neomei/agentwiki-local-sync test -- sync-engine.spec.ts orchestrator.spec.ts`

Expected: FAIL because Push is absent.

- [ ] **Step 3: Implement confirmation binding**

```ts
export interface PushPreview {
  jobId: string; spaceId: string; baseRevision: string; remoteRevision: string;
  bundleHash: string; counts: { pages: number; memories: number; relations: number; deletions: number };
  uploadBytes: number; adapters: string[]; reviewRequiredArtifactIds: string[];
  nonce: string; expiresAt: string;
}
previewPush(jobId: string): Promise<PushPreview>;
confirmAndPush(jobId: string, nonce: string, confirmed: true): Promise<KnowledgeSubmissionResult>;
```

Compute `confirmationHash = sha256(jobId + nonce + bundleHash + baseRevision + remoteRevision + spaceId + expiresAt)`. Store only its hash in the checkpoint. Claim nonce atomically before POST; on transport error release it to pending, but on an accepted server response consume it permanently. Use `jobId:bundleHash` as the idempotency key.

- [ ] **Step 4: Run Push tests**

Run: `pnpm --filter @neomei/agentwiki-local-sync test -- sync-engine.spec.ts orchestrator.spec.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/local-sync/src/sync-engine.ts packages/local-sync/src/sync-engine.spec.ts packages/local-sync/src/job-state.ts packages/local-sync/src/orchestrator.ts
git commit -m "feat(local-sync): push confirmed knowledge proposals"
```

### Task 5: Conflict work items and final MCP surface

**Files:**
- Modify: `packages/local-sync/src/mcp.ts`
- Modify: `packages/local-sync/src/mcp-orchestrator.spec.ts`
- Modify: `packages/local-sync/skill/SKILL.md`
- Modify: `packages/local-sync/src/cli.ts`
- Modify: `packages/local-sync/src/cli.spec.ts`

**Interfaces:**
- Produces final tools `pull_space`, `resolve_conflict`, `confirm_and_push` in addition to core-plan tools.

- [ ] **Step 1: Write failing MCP behavior tests**

Assert `pull_space` never asks for upload confirmation; `resolve_conflict` accepts only the current conflict and requires provenance; unresolved conflicts prevent validation/preview; `confirm_and_push` requires literal `confirmed: true` and current nonce; tool outputs redact credentials and absolute paths; Skill says the Agent must display preview and ask the user before calling Push.

- [ ] **Step 2: Verify failure**

Run: `pnpm --filter @neomei/agentwiki-local-sync test -- mcp-orchestrator.spec.ts cli.spec.ts`

Expected: FAIL because final tools are absent.

- [ ] **Step 3: Register exact final contracts**

```ts
pull_space: { spaceId: z.string().min(1) }
resolve_conflict: { jobId: z.string().uuid(), conflictId: z.string().min(1), resolvedItem: KnowledgeItemSchema.optional(), deletion: DeletionProposalSchema.optional(), provenance: z.array(ProvenanceRecordSchema).min(1) }
confirm_and_push: { jobId: z.string().uuid(), nonce: z.string().uuid(), confirmed: z.literal(true) }
```

Enforce exactly one of `resolvedItem` or `deletion`. Update CLI commands to `pull --space`, `job --id`, `preview --id`, and `push --job --nonce --confirm`; keep legacy commands namespaced under `legacy-okf` only for explicit `0.1.x` recovery.

- [ ] **Step 4: Run MCP/CLI tests**

Run: `pnpm --filter @neomei/agentwiki-local-sync test -- mcp-orchestrator.spec.ts cli.spec.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/local-sync/src/mcp.ts packages/local-sync/src/mcp-orchestrator.spec.ts packages/local-sync/skill/SKILL.md packages/local-sync/src/cli.ts packages/local-sync/src/cli.spec.ts
git commit -m "feat(local-sync): expose bidirectional sync tools"
```

### Task 6: Explicit 0.1.x to 0.2.0 connection migration

**Files:**
- Modify: `packages/local-sync/src/config.ts`
- Modify: `packages/local-sync/src/config.spec.ts`
- Modify: `packages/local-sync/src/agent-clients.ts`
- Modify: `packages/local-sync/src/agent-clients.spec.ts`
- Modify: `packages/local-sync/src/cli.ts`
- Modify: `packages/local-sync/src/cli.spec.ts`
- Modify: `packages/local-sync/package.json`
- Modify: `packages/local-sync/README.md`

**Interfaces:**
- Produces config v2, explicit migration command, and pinned `0.2.0` MCP registration.

- [ ] **Step 1: Write failing migration tests**

Assert a `0.1.1` config loads read-only, ordinary startup does not mutate it, `upgrade --version 0.2.0` backs it up, migrates only the selected connection, registers exact `@neomei/agentwiki-local-sync@0.2.0`, creates/pulls every readable granted Space, and rolls back config/MCP on any failure. Assert old `.okf.json` previews are moved under `.state/legacy-okf/` and never submitted as new bundles.

- [ ] **Step 2: Verify failure**

Run: `pnpm --filter @neomei/agentwiki-local-sync test -- config.spec.ts agent-clients.spec.ts cli.spec.ts`

Expected: FAIL because config v2/migration is absent.

- [ ] **Step 3: Implement config v2 and migration**

```ts
export interface LocalSyncConfigV2 {
  version: 2; defaultConnectionId?: string;
  connections: Record<string, LocalSyncConnection & { protocolVersion: 'knowledge-sync@1'; migratedFrom?: string }>;
}
```

After exchange or explicit upgrade, call access discovery. Create and Pull a workspace only for grants whose effective scopes include all unified read scopes (`pages:read`, `memory:read`, and `graph:read`); report other granted Spaces as unavailable for unified local materialization without leaking their content. Installation stops and reports per-Space failures without scanning local sources. Set package version, MCP server version, server examples, and README to `0.2.0` only in the release commit, not earlier feature commits.

- [ ] **Step 4: Run migration tests**

Run: `pnpm --filter @neomei/agentwiki-local-sync test -- config.spec.ts agent-clients.spec.ts cli.spec.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/local-sync/src/config.ts packages/local-sync/src/config.spec.ts packages/local-sync/src/agent-clients.ts packages/local-sync/src/agent-clients.spec.ts packages/local-sync/src/cli.ts packages/local-sync/src/cli.spec.ts packages/local-sync/package.json packages/local-sync/README.md
git commit -m "feat(local-sync): migrate connections to protocol v2"
```

### Task 7: AgentWiki installation UI and concise usage guide

**Files:**
- Modify: `apps/client/src/config/localSync.ts`
- Modify: `apps/client/src/features/agent/LocalSyncInstallCard.tsx`
- Modify: `apps/client/src/features/agent/LocalSyncInstallCard.spec.tsx`
- Modify: `apps/client/src/features/about/LocalSyncGuideSection.tsx`
- Modify: `apps/client/src/features/about/LocalSyncGuideSection.spec.tsx`
- Modify: `apps/client/src/i18n/messages.ts`
- Modify: `apps/server/src/core/agent/local-sync-installation.service.ts`
- Modify: `apps/server/src/core/agent/local-sync-installation.service.spec.ts`
- Modify: `.env.example`
- Modify: `apps/server/.env.example`

**Interfaces:**
- Produces one pinned 0.2.0 instruction and accurate bilingual zero-config guidance.

- [ ] **Step 1: Write failing UI/instruction tests**

Assert generated instruction pins `0.2.0`, says installation performs connection/doctor/initial Pull but no scan/upload, does not mention retired external compiler/provider/model key/MCP JSON/port/daemon, names Codex/Claude Code/OpenCode as examples rather than exclusive clients, and tells the Agent to report Space Pull results. UI copy must distinguish the explicitly selected local path, review-required acknowledgement, and final upload confirmation without adding a redundant local-read confirmation dialog.

- [ ] **Step 2: Verify failure**

Run: `pnpm --filter @agentwiki/server test -- local-sync-installation.service.spec.ts && pnpm --filter @agentwiki/client test -- LocalSyncInstallCard.spec.tsx LocalSyncGuideSection.spec.tsx`

Expected: FAIL on old version/retired external compiler copy.

- [ ] **Step 3: Update server instruction and client UI**

Server instruction must remain one copyable command:

```text
npx --yes @neomei/agentwiki-local-sync@0.2.0 connect --server <safe-api-url> --code <one-time-code> --agent auto
```

The surrounding instruction asks the local Agent to execute it, report identity, granted Spaces, initial Pull status, and adapter readiness. Client guide shows four core actions only: connect, choose local source, review local knowledge preview, confirm submission/pull published result. Advanced details stay collapsed.

- [ ] **Step 4: Run UI and server tests**

Run: `pnpm --filter @agentwiki/server test -- local-sync-installation.service.spec.ts && pnpm --filter @agentwiki/client test`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/client/src/config/localSync.ts apps/client/src/features/agent/LocalSyncInstallCard.tsx apps/client/src/features/agent/LocalSyncInstallCard.spec.tsx apps/client/src/features/about/LocalSyncGuideSection.tsx apps/client/src/features/about/LocalSyncGuideSection.spec.tsx apps/client/src/i18n/messages.ts apps/server/src/core/agent/local-sync-installation.service.ts apps/server/src/core/agent/local-sync-installation.service.spec.ts .env.example apps/server/.env.example
git commit -m "feat: present zero-config local knowledge sync"
```

### Task 8: Automated two-home E2E and privacy verifier

**Files:**
- Replace: `scripts/local-sync-e2e.mjs`
- Modify: `scripts/local-sync-e2e.test.mjs`
- Create: `scripts/local-sync-privacy-audit.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces repeatable destructive opt-in verification with cleanup.

- [ ] **Step 1: Write failing harness tests**

Test opt-in, loopback-only default, secret redaction, two temporary homes, process cleanup, cleanup on assertion failure, and privacy audit rejection when raw fixture markers appear in request bodies, bundles, job state, previews, logs, or server revisions.

- [ ] **Step 2: Verify failure**

Run: `node --test scripts/local-sync-e2e.test.mjs`

Expected: FAIL on missing v2 harness functions.

- [ ] **Step 3: Implement the E2E scenario**

The script must:

1. Register user, Space, Agent, grants, and one-time installation.
2. Connect temporary home A and initial Pull revision `0`.
3. Run fixture adapters and drive deterministic fixture Agent outputs to Preview.
4. Confirm Push; approve/publish if Space policy requires; poll submission; Pull revision 1.
5. Connect home B and prove full Snapshot matches home A.
6. Make a local-only change on A and remote-only change through B; prove automatic merge.
7. Change the same page field on both; prove ConflictBundle, submit fixture resolution, preview, confirm, publish, and Pull convergence.
8. Propose deletion offline, publish tombstone, reconnect an old base, and prove it cannot resurrect the item.
9. Revoke grant and prove Pull/Push fail closed while local files remain unchanged.
10. Scan all captured payloads/state/logs for raw-source sentinel strings and credential patterns; fail if found.
11. Delete test user/Space/credentials and both temporary homes in `finally`.

- [ ] **Step 4: Run automated E2E**

Run:

```bash
pnpm build
AGENTWIKI_LOCAL_SYNC_E2E=1 pnpm test:e2e:local-sync
```

Expected: PASS with a structured JSON report for all eleven stages.

- [ ] **Step 5: Commit**

```bash
git add scripts/local-sync-e2e.mjs scripts/local-sync-e2e.test.mjs scripts/local-sync-privacy-audit.mjs package.json
git commit -m "test(local-sync): verify two-home revision sync"
```

### Task 9: Real Agent acceptance, screenshots, and release gate

**Files:**
- Create: `apps/client/public/screenshots/local-sync-installation-zh.png`
- Create: `apps/client/public/screenshots/local-sync-installation-en.png`
- Create: `apps/client/public/screenshots/local-sync-agent-preview-zh.png`
- Create: `apps/client/public/screenshots/local-sync-agent-preview-en.png`
- Create: `apps/client/public/screenshots/local-sync-agent-success-zh.png`
- Create: `apps/client/public/screenshots/local-sync-agent-success-en.png`
- Create: `apps/client/public/screenshots/local-sync-published-page-zh.png`
- Create: `apps/client/public/screenshots/local-sync-published-page-en.png`
- Modify: `packages/local-sync/README.md`
- Modify: `README.md`
- Create: `docs/verification/local-sync-0.2.0-acceptance.md`
- Update project `.codex-memory/current.md` and active task files after verification.

**Interfaces:**
- Produces evidence required to authorize release; no publish occurs in this task without a new explicit user authorization.

- [ ] **Step 1: Run all repository gates**

Run:

```bash
pnpm test:runtime
pnpm --filter @neomei/agentwiki-local-sync test
pnpm --filter @agentwiki/server test
pnpm --filter @agentwiki/client test
pnpm typecheck
pnpm lint
pnpm build
git diff --check
```

Expected: all exit `0`.

- [ ] **Step 2: Perform real Codex, Claude Code, and OpenCode setup**

For each Agent, use a newly generated one-time instruction and a separate temporary home/config. Record exact client version, install output, identity, granted Spaces, initial Pull, and MCP tool list. Revoke every temporary credential after the run and verify it returns 401.

- [ ] **Step 3: Perform real source and cross-machine scenarios**

Use codebase-memory on a small real code repository, MarkItDown on one real PDF/DOCX directory, and two separate local homes. Confirm no manual init/model key/port/daemon, Preview before Push, published revision convergence, same-field conflict resolution, interruption recovery, and raw-data privacy audit.

- [ ] **Step 4: Capture real cropped screenshots through the browser**

Capture only the relevant card/panel at native layout width: generated install instruction, local Agent Preview awaiting confirmation, successful sync report, and resulting published page. Capture all four states separately in Chinese and English using the eight exact filenames above; `LocalSyncGuideSection` selects the matching language assets. Do not use mock UI or full-screen distorted images. Remove references to the legacy unversioned screenshot filenames.

- [ ] **Step 5: Write the acceptance report and update docs**

The report contains commands, versions, pass/fail table, sanitized evidence paths, known limitations, credential revocation evidence, and an explicit statement that raw source and secrets were not uploaded. README and guide claims must not exceed this report.

- [ ] **Step 6: Run final review and package dry-run**

Run:

```bash
pnpm --filter @neomei/agentwiki-local-sync pack --dry-run
npm view @neomei/agentwiki-local-sync versions --json
git status --short
```

Expected: tarball includes runtime code, Skill, README, LICENSE, and executable `dist/cli.js`; excludes tests, fixtures, credentials, local workspaces, `.state`, and screenshots not referenced by the client. Registry does not already contain `0.2.0`.

- [ ] **Step 7: Commit release candidate**

```bash
git add apps/client/public/screenshots packages/local-sync/README.md README.md docs/verification .codex-memory
git commit -m "docs: verify local knowledge sync 0.2.0"
```

- [ ] **Step 8: Stop for release authorization**

Report the clean gate results, exact tarball contents, registry state, and commit SHA. Ask separately for authorization before `npm publish`, Git push, deployment, or GitHub Release. Do not infer that authorization from approval of this implementation plan.
