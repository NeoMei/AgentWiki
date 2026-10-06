# Agent Sessions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** 阅读和编辑页共享可恢复的多轮 Agent 对话，显式引用和笔记可以生成安全的修改候选。

**Architecture:** 新 AssistSession 关联现有 AssistTask 轮次，复用租约队列和 OpenCode 路由。前端使用独立、极小会话注册表及懒加载侧栏，复用现有候选/笔记逻辑；本机 ACP 只定义独立适配器边界。

**Tech Stack:** React 18、TypeScript、NestJS、Prisma 5、PostgreSQL、Redis、现有 OpenCode CLI、Vitest/Jest。

**Spec:** `docs/superpowers/specs/2026-10-06-agent-sessions.md`

## Global Constraints

- 所有路径相对 agentwiki。工作树 `/Users/neomei/.codex/worktrees/document-workspace/AgentWiki ` 有尾空格；所有 git 操作显式 `--work-tree` 或仅对 SDD 脚本设置 task 专用 GIT_WORK_TREE，不修改 core.worktree。
- 基线 ee9348839924fd7566ff3b67fa72beb6090a77ea；只本地提交，不 push/merge/release/deploy，不改原主目录。
- 所有实现/审查使用用户指定 p5c07ff/gpt-6-astra。独立审查，实施者不派子代理。
- 复用依赖，不增加 UI 框架/字体/依赖；首屏 JS 550000 字节上限不变。UI/实现懒加载。
- 一份原始 Markdown、读写互斥，Agent 候选接受到草稿，Save 另行校验；不能绕过权限、expectedUpdatedAt、原文或 scoped target 守护。
- 问答/提案权限分离；数据按账号+Space 隔离；历史中所有原文来源授权失效后不得返回/重放。未明确发送的私人笔记不得上传，发送不等于解决。
- 中文/英文、桌面/390px、真实状态与可访问名称；不伪造工具执行/本机 ACP 支持。
- 每个任务写报告、指定路径提交。临时 UI/runtime 测试报告在 `/tmp/agentwiki-sessions-20261006/`。

### Task 1: Durable conversations, safe execution and runtime port

**Files:**
- Create: `apps/server/src/assist/assist-session.service.ts`, `assist-session.controller.ts`, `assist-session.types.ts`, `agent-runtime.port.ts` (同目录)。
- Modify: `apps/server/prisma/schema.prisma`; create `apps/server/prisma/migrations/20261006200000_assist_sessions/migration.sql`。
- Modify: `apps/server/src/assist/assist.module.ts`, `assist.service.ts`, `assist.queue.ts`, `opencode.types.ts`, `opencode.runner.ts`, `opencode.router.ts`, `apps/server/src/core/collaboration/collaboration.gateway.ts`。
- Test: `apps/server/src/assist/assist-session.service.spec.ts`, `assist-session.controller.spec.ts`, existing `assist.queue.spec.ts`, `opencode.runner.spec.ts`, `opencode.router.spec.ts`, relevant gateway spec。
- Create: `docs/architecture/agent-runtime-adapter.md`。

**Interfaces:**
- Consumes: `AssistInput`, `OpencodeRunner.run(task): Promise<AssistRunResult>`, existing Prisma/authorization/queue; existing target validation.
- Produces: exact API and `AgentSessionSummary`, `AgentTurnRequest`, `AgentTurnView`, `AgentSessionDetail` from spec. `AgentSessionDetail` is flat summary + `turns`, not `{session,tasks}`. New public types in `assist-session.types.ts`; document response examples for Task 2.
- Produces: `AgentRuntimeCapabilities { questions: boolean; proposals: boolean; cancellation: boolean; tools: boolean; permissions: boolean; resume: boolean }` and `AgentRuntimePort` boundary with `run(input: AssistInput): Promise<AssistRunResult>`; `AssistInput` gains mode/context/history/signal without breaking legacy fields. Only built-in implementation capabilities enabled.
- POST `/assist/tasks/:id/cancel` resides in session controller with non-conflicting prefix and requester guard; legacy tasks API remains compatible and must not bypass session authorization.

- [x] Add failing behavioral tests using current Jest mock patterns. Explicit assertions:
```ts
expect(turn.mode).toBe('question');
expect(turn.result?.changes).toBeUndefined();
expect(secondTask.id).toBe(firstTask.id); // same clientRequestId
await expect(sendDifferentWhileActive()).rejects.toMatchObject({ status: 409 });
await expect(readAsAnotherUser()).rejects.toThrow();
await expect(readAfterReferenceDeleted()).rejects.toThrow();
expect(modelInput.history.at(-1).answer).toBe(previousAnswer);
expect(cancelledTask.status).toBe('cancelled');
expect(doneWriteAfterCancel.count).toBe(0);
```
  Tests must also cover cross-Space IDs, read-only user question success/proposal denial, live permission loss during run, stale snapshot, duplicate races, bounds, malformed question changes and old proposal parser behavior.
- [x] Run scoped Jest and record red failures caused by missing behavior, not syntax/import mistakes.
- [x] Add AssistSession with mandatory user+Space relation and timestamps/title. Extend AssistTask with nullable sessionId/clientRequestId, mode default proposal, context, progressText/progressVersion; unique session request key, active-turn transaction serialization. Reuse one queue.
- [x] Implement API contract with ownership/live authorization, bounded history (100 turns/session, 50 summaries), server-owned reference snapshots (≤5), explicit snapshot/intent/total context limits. Keep all public result fields whitelisted. Read/get/cancel use current permissions before returning any content. Old assist task list/get/socket paths must not expose unvalidated session context.
- [x] Build prompts from canonical previous completed turns (last 10 within 120000 chars) and explicitly provided current context; question outputs summary with absent/empty changes, proposal outputs strict nonempty changes and preserves scope enforcement. No fake editing task for a question.
- [x] Add AbortSignal through router and CLI. Worker periodically observes cancellation/authorization/lease loss, aborts its child, persists progress with running/owner/unexpired fence, and cannot overwrite cancelled or publish after permission loss. Session task progress contains normalized answer text only; suppress session events on legacy sockets and use REST polling as canonical progress.
- [x] Define runtime capability/port document: embedded server provider now, local ACP v1 connector later; map new/prompt/update/cancel and future tool/permission events, user+Space session binding and capability gating. No native executable connection/permission UI this stage.
- [x] Run server focused tests/typecheck/build and migration static checks; self-review authorization, concurrency and progress race paths. Commit only Task 1 files and report API examples, red/green checks, full commit, migration digest computation instructions. Do not update approved DB digest until independent review approves migration.

### Task 2: Unified conversation sidebar and document integration

**Files:**
- Create: `apps/client/src/features/agent-session/AgentSessionRegistry.tsx`, `AgentSessionPanel.tsx`, `useAgentSession.ts`, `agentSessionTypes.ts`, `agentSessionCandidate.ts`, `AgentReferencePicker.tsx` and focused `.spec.ts(x)` siblings; read-selection source mapping helper and focused tests colocated with page features.
- Modify: `apps/client/src/App.tsx`, `features/page/PageEditor.tsx`, `features/page/PagePreview.tsx`, their specs, `index.css` under client src; existing `usePersonalNotes.ts`/`PersonalNotesPanel.tsx` for read authorization and staging, `components/Markdown.tsx` for opt-in precise source annotations if required.
- Reuse: `features/page/AssistCandidateReview.tsx`, `assistCandidate.ts`, `assistTargets.ts`, `PersonalNotesPanel.tsx`; existing navigation and authorized search APIs.

**Interfaces:**
- Consumes: flat session API/types in spec and Task 1 report; existing `AssistSnapshot`, `AssistCandidate`, `AssistRequest`, `AssistNotesEvent`; `onApply(candidate,editId?): boolean` from PageEditor remains synchronous.
- Produces: `AgentSessionRegistryProvider({userId,children})`, stable user+Space session selection/store across route changes; lazy real panel implementation, no eager socket/API/editor imports.
- Produces: `AgentSessionPanel` document bridge props `pageId`, `spaceId`, `pageTitle`, `snapshot(): AssistSnapshot`, `canEdit`, optional `canAccept`, `onApply`, `assistTargets`, `assistRequest`, `onRequestHandled`, `onNotesEvent`, `supportsScopedApply`, `acceptUnavailableReason`; match legacy names so editor wiring preserves behavior. Session state is separate from workspace preferences.

- [x] Add failing interaction tests using real context/provider and mocked transport. Explicit assertions:
```tsx
expect(await screen.findByText('Earlier answer')).toBeVisible();
rerenderPage('page-b', 'read');
expect(screen.getByText('Earlier answer')).toBeVisible();
expect(sent.referencePageIds).toEqual(['page-b']);
expect(sent.snapshot.content).toBe('unsaved current draft');
expect(applyToWrongPage).not.toHaveBeenCalled();
expect(savePage).not.toHaveBeenCalled();
expect(screen.getByRole('button', {name: 'Stop'})).toBeEnabled();
```
  Also cover session switch, account/Space clear, refresh restoration, overlapping fetch race, failed send retains composer, empty/new history, viewer question/no proposal, private-note explicit dispatch and returned candidate linkage, identity-safe cancellation, candidate exact-byte rebind and stale rejection.
- [x] Run focused Vitest red and record expected behavior gaps.
- [x] Add registry adjacent to existing SpaceWorkspaceProvider under authenticated user key; minimal eager shell. Store active session/candidate/composer only in memory per user+Space; server history authoritative. Poll active session every ~800ms while running (backoff on failure), abort/ignore stale identity responses; initial refresh recovers durable history. Do not persist messages in panel preference localStorage.
- [x] Build neutral full-height sidebar: Agent title, new/session selector, scrollable turns, context chips, question/proposal selector, multiline composer, Send/Stop, actionable errors. Add explicit reference picker via authorized `/search` or `/pages` with same-Space filter and read permission. Display queued/running/answer progress honestly.
- [x] Mount same lazy panel from PagePreview and PageEditor; add Agent button and Cmd/Ctrl+L. Preserve full-page canvas and existing panel resizing/notes tabs as appropriate, mobile close/focus and no overflow. Reading can ask; proposal review offers target edit navigation. Current-page source supplied only on send.
- [x] Add read-selection private-note entry to PagePreview. Resolve selected rendered text to a unique raw Markdown range inside the article; preserve quote/context/version guards and show actionable edit-mode fallback for ambiguous or unmappable selections. Private local annotation and question use read authorization; proposal still uses edit authorization. Do not treat opening chat as completion of the reading annotation flow. Extend tests for selected-text note creation and explicit note+reference send.
- [x] Stage selected notes as explicit composer attachments (`annotations` from spec) before Send, allowing reference selection and further intent. Private notes become dispatched only when the real turn is created; composer cancellation retains pending notes. Viewer question wording must not use the legacy instruction to rewrite. Persist immutable quote/comment in server turn through annotations, not by looking up local noteIds on refresh.
- [x] Show immutable per-turn source title/version, selected quote/comment and reference titles/versions from the turn snapshot. Do not substitute current-page source for old turns after navigation/refresh. Add readable conflict explanation and explicit regenerate action preserving requested intent/target/ref context; never silently overwrite human edits.
- [x] Wire editor snapshot and existing apply callback/target selector/note callbacks. Restore historical candidate using original source/version; local revision rebinding only after exact title/content/version match and no conflict, never replace authorization/source guards. Maintain acceptance/discard ledger within session registry across doc changes; do not mark notes resolved merely because response arrived or send succeeded.
- [x] Run focused tests, client typecheck/build/budget, scoped eslint; then full client tests once candidate stable. Self-review cross-user/Space request races and keyboard/focus/390px layout. Commit exact Task 2 files; report behavior, checks, screenshots only if actual browser run performed, limitations.

### Task 3: Integration acceptance, migration gate and handoff

**Files:**
- Modify after independent migration approval: `scripts/folder-test-database.mjs` and `scripts/content-tree-core-db.test.mjs` reviewed corpus hash; no allowlist or gate logic change.
- Create: `.codex-memory/tasks/active/agent-sessions-20261006/{brief,decisions,refs}.md` (repo root, maintained by coordinator), update current/tasks index.
- Runtime artifacts: `/tmp/agentwiki-sessions-20261006/` only.

**Interfaces:**
- Consumes: Task 1 migration and API, Task 2 production UI. Independent task reviewer must approve migration before adding its hash to reviewed gate.
- Produces: acceptance.md with exact commit, runtime owner IDs/ports/schema, API fixtures, actual provider fixture boundary, desktop/mobile screenshots, console results, unchanged-page readback and cleanup receipt; final independent review report for ee934883..HEAD.

- [x] Review migration SQL and gate manifest independently; extend approved digest only after receipt. Run dedicated DB concurrency/idempotency/isolation and schema compatibility checks against isolated schema. Keep other migration checks intact.
- [x] Build server and client production artifacts; run focused backend suite plus full server/client tests and appropriate typecheck/lint once stable. Preserve logs and exact counts without treating mocks as external-provider verification.
- [x] Start isolated API+worker+Redis using deterministic fake CLI outside repository. Validate POST question→poll answer→follow-up includes history, proposal candidate, Stop terminates a blocked CLI, repeated request ID does not duplicate, another user/Space/ref deletion denied. Capture formal pages before/after.
- [x] Root uses CUA/browser for real rendered product: reading selection→private note→explicit reference→send→follow-up→review two or more edits→accept draft→explicit Save. Interleave manual edits, prove safe scoped accept preserves them, conflict refuses unsafe apply with regenerate path, and each acceptance undoes separately. Read API unchanged before Save, then match expected content/new version after explicit Save in the isolated fixture. Verify cross-page/read-edit/refresh history including original quote/source versions.
- [x] At 1280/1600/390 combine long Markdown, wide GFM table, directory and Agent panel. Verify independent scroll, directory navigation, input/close, accessible toolbar and keyboard/focus. Final report separates actual UI, fixture scope, real-provider result or concrete untested reason, ACP contract-only, undeployed state and remaining gates.
- [x] If acceptance finds regression, dispatch one bounded implementation fix task with exact failing behavior and tests, followed by independent scoped review; never patch security guards to make fixtures pass.
- [x] Run final independent whole feature-range review plus integration checks; reconcile all material findings. Update task handoff/current with verified facts, archive completed task, commit docs. Clean only owned fixture processes/schema/files; preserve review/acceptance artifacts outside repo and local branch.

## Completion receipt

Completed at product1735f341. Task/whole-feature independent reviews all APPROVED, no remaining findings. Server2877pass/26existing skips; client full2091 at3cc1d78c plus final260focused/static/build at1735f341. ActualAPI/DB/worker13gates and productionCUA including finalF1/F2 passed; explicitfixtureSave exact3589 and sibling unchanged. Ownedruntime cleanup independently verified. Source and deployment boundaries, rulings and review receipts: `.codex-memory/tasks/archive/agent-sessions-20261006/` relative to repository root; full scratch evidence `/tmp/agentwiki-sessions-20261006/sdd/`. Local branch/worktree retained; no push/merge/release/deploy.
