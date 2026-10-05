# Document Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Improve AgentWiki document reading, manual Markdown editing, tree navigation, and safe human/Agent editing using the approved OpenKnowledge study.

**Architecture:** Keep one Markdown source and existing pageId/Space/permission/version boundaries. Extend the current CodeMirror workspace with shared document surfaces and tools; stage Assist output as reviewed candidates. Preserve the existing backend and evaluate visual editing separately against a Markdown fidelity corpus.

**Tech Stack:** React 18, TypeScript, CodeMirror 6, Tailwind, NestJS, Prisma, Vitest.

**Spec:** `agentwiki/docs/research/openknowledge-20261006/借鉴分析与改造建议.md` (approved by user 2026-10-06).

## Global Constraints

- Worktree: `/Users/neomei/.codex/worktrees/document-workspace/AgentWiki ` (literal trailing space). All Git commands MUST set `--work-tree` explicitly or `GIT_WORK_TREE` to this path. Never change core.worktree.
- Branch: `codex/document-workspace`, baseline `c7b89567e50c3749a87b70034357c7e9de226f81`.
- Single document canvas; editing and preview mutually exclusive. Preserve existing brand, component system, attachment/Obsidian/Markdown semantics and bilingual copy via useLanguage.
- User/Space/page scope all cached state. Respect revoked permissions; preserve expectedUpdatedAt and treeRevision. Do not automatically publish drafts or Agent output.
- Never copy OpenKnowledge GPL code. No CRDT migration, production data edits or deployment in this implementation.
- Implementation agents own only assigned files, do not spawn agents or commit. Controller stages/commits exact files sequentially and arranges independent task and final review.
- Meaningful behavior tests RED then GREEN. Pure visual styling is verified in browser, not brittle class assertions. Run focused tests during implementation; final controller runs full appropriate checks once.
- Commands from `agentwiki`: `pnpm --filter @agentwiki/client exec vitest run <src paths>`; `pnpm --filter @agentwiki/client exec tsc --noEmit`. Server tests use existing harness / node specs.

### Task 1: Stage and review Assist candidates safely

**Files:** Modify `apps/client/src/features/page/AgentAssistPanel.tsx`, `PageEditor.tsx` and their specs. Create `features/page/assistCandidate.ts`, `AssistCandidateReview.tsx`, and focused specs; a reusable text-diff helper/component may live in `components/markdown-diff/`.

**Interfaces:** Consume existing task snapshot {title,content,updatedAt}, result {summary,changes}. Produce candidate {taskId,pageId,spaceId,baseContent,baseUpdatedAt,content,status} and explicit accept/discard. Preserve extensibility for target range in Task 5. Reusable Markdown diff consumes before:string, after:string; line add/remove/unchanged with accessible textual labels, bounded processing on long inputs.

- [x] Add tests proving streaming/done does not call onApply automatically; failure leaves document unchanged; stale base prevents replacement; accept is one undoable document change; duplicate completion does not reapply; page navigation/permission loss invalidates apply.
- [x] Run tests RED using existing AgentAssistPanel/PageEditor test harness.
- [x] Store streams inside panel candidate state. Snapshot the exact draft/revision on submit, not callback render time. Render generating/result/diff states and explicit bilingual Accept to draft / Discard. Preserve an empty result as explicit no-op/error (never erase implicitly). Do not broadcast generated partials through PageEditor.
- [x] Acceptance checks latest page identity, permission, content and baseline. If local or remote edits make it stale, keep candidate viewable and explain regenerate, never overwrite. No force replace button.
- [x] Run targeted suites and typecheck, record evidence, self-review. Controller commits and independent reviewer checks before downstream PageEditor work.

Representative regression contract:
```ts
expect(editorTextAfterStream).toBe(original);
expect(editorTextAfterConcurrentTypingAndAccept).toBe(humanDraft);
expect(candidateState).toBe('conflict');
```

### Task 2: Directory state and direct operations

**Files:** `features/content-tree/ContentTree.tsx`, `contentTreeApi.ts` if needed; `features/space-workspace/SpaceDirectory.tsx`, `SpaceWorkspaceContext.tsx`, `useSpaceDirectory.ts`; `features/space/SpaceView.tsx`; related specs. Create `workspacePreferences.ts` and tests.

**Interfaces:** Consume current tree/page/folder APIs and preconditions. Extend browsing state with directoryWidth:number and directoryCollapsed:boolean, persisted by userId + spaceId. Inline mutation uses existing API validators and tree revisions. No PageEditor or MarkdownWorkspace edits.

- [x] Add behavioral tests: refresh restores expand/scroll/width; users/Spaces isolated; malformed/unavailable localStorage degrades; menus have names and keyboard activation; Escape cancels inline rename; successful rename keeps current page and tree selection; permission denial leaves source untouched.
- [x] Implement accessible text menus replacing icon-only popup, inline folder/page rename and folder creation at intended parent; newly created page gets inline title when practical using existing creation flow (template chooser stays available).
- [x] Add resize separator with pointer and keyboard interaction, clamp width 220..420, desktop only. Persist preferences, never content, robust against storage failure.
- [x] Add local filter with accurate scope. Prefer complete authorized Space search API if present; otherwise explicitly label loaded-items filter and preserve ancestor context, with no claim of whole-Space coverage. Clear filter restores expansion. Disable reorder while filtered to avoid ambiguous destinations. Add reveal current document control.
- [x] Run focused tree/workspace tests and typecheck; record RED/GREEN and self-review. Controller commit + independent review.

```ts
expect(readPreferences(userB, spaceA).expandedFolderIds).toEqual([]);
expect(readPreferences(userA, spaceA).directoryWidth).toBe(320);
```

### Task 3: Continuous document canvas and manual Markdown tools

**Files:** `components/MarkdownWorkspace.tsx`, `features/page/PagePreview.tsx`, `PageEditor.tsx` presentation only, `features/space-workspace/ArticleContentsPopover.tsx`; CSS in current stylesheet. Create focused `components/markdown-tools/` modules for commands, toolbar and outline; specs.

**Interfaces:** Extend MarkdownWorkspaceHandle with captureSelection(): {from:number,to:number,text:string} and restore/focus selection as needed. Add optional onSelectionChange and onRequestAssist to connect Task 5. Shared outline derived from Markdown AST, stable slug/id + source offset; excludes fenced-code pseudo-headings and supports duplicate headings.

- [x] Test command transformation through real EditorState transactions: wrap selected text, empty selection caret, table/code insertion, undo, link insertion; IME composition never triggers slash menu. Test outline code fences and duplicate headings.
- [x] Align read/write document width, title/body start, typography and paragraph spacing; keep one canvas and current position restoration. Compact toolbars; don't remove page history, permissions, image upload or preview actions.
- [x] Add accessible selection format toolbar (bold/italic/link/code) and slash insert menu (headings/list/task/quote/table/code/image where existing upload supports it). Keyboard Up/Down/Enter/Escape, focus recovery, bilingual labels. Maintain a plain source interaction path.
- [x] Page-link picker searches authorized pages passed to existing workspace, shows scope, inserts existing supported link format, handles duplicates by identity. Tool operations must be single undoable transactions and not change unrelated source.
- [x] Add shared outline in edit and read: wide screen collapsible side panel, narrow screen popover/drawer, active heading and click navigation; do not squeeze central content when Assist is open.
- [x] Run focused editor, Markdown, position and outline suites, typecheck; browser checks handled by controller. Commit + independent review.

```ts
expect(formatSelection('中文段落', 0, 2, 'bold').text).toBe('**中文**段落');
expect(outlineFor('# A\n```md\n# fake\n```\n# A').map(x=>x.id)).toEqual(['a','a-1']);
```

### Task 4: Recoverable local drafts

**Files:** New `features/page/localDrafts.ts` + tests; PageEditor integration/spec; AuthContext cleanup only if necessary.

**Interfaces:** Record {schemaVersion:1,userId,spaceId,pageId,baseUpdatedAt,title,content,savedAt}. Storage key scoped to identity; restore only after authorized page load. Explicit recover/discard; stale base is preview/export only, no silent replace. Keep server save preconditions.

- [x] Test reload offers same user's draft, no overwrite on mount, other users/Spaces cannot see it, stale remote blocks direct restore, successful save clears only submitted version, newer typing during save remains recoverable, quota failure not shown as saved, permission loss clears memory/offers no restore.
- [x] Debounce local persistence of human draft and explicitly accepted candidate only; candidate streams never enter draft storage. Avoid persisting read-only remote snapshots.
- [x] Show honest separate local-draft status and explicit page Save. Recover to editor undo transaction, discard exact current draft, handle tab switch/lifecycle without saving one page into another.
- [x] Run focused persistence/PageEditor tests and typecheck, self-review, commit + independent review.

```ts
expect(loadDraft({userId:'other',spaceId,pageId})).toBeNull();
expect(canRestore(draft, remoteNewer)).toBe(false);
```

### Task 5: Scoped Agent edits, review comments and real proposal diff

**Files:** `PageEditor.tsx`, `AgentAssistPanel.tsx`, candidate modules; new `features/page/assistTargets.ts`, `reviewComments.ts` and UI/specs; `apps/server/src/assist/assist.service.ts`, `opencode.runner.ts`, associated specs; `features/review/ReviewPage.tsx` and tests.

**Interfaces:** Assist target {kind:'selection'|'section'|'document',from,to,quote,prefix,suffix,baseUpdatedAt}, validated against submitted full snapshot content. Existing runner returns full markdown; for scoped requests prompt limits to target and application verifies outside-target prefix/suffix unchanged, rejecting output outside scope. Human local review notes carry original quote/context; use Space/user/page scoped storage explicitly labelled personal until shared backend exists. State pending → dispatched → awaiting-review → resolved, never resolve on send alone.

- [x] Test selected/section scope capture, original quote mismatch, duplicated quote ambiguity, outside-target changes refused, unrelated concurrent changes preserved by exact anchored application, overlapping changes rejected. Apply each accepted candidate/hunk once with source unchanged elsewhere.
- [x] Wire selection toolbar Ask Agent and scope selector, context chips and bilingual instructions. Preserve document default. Bind server task to current user, page+Space+base version; validate target shape/limits and authorization at execution through existing queue guards.
- [x] Add personal anchored notes (select passage → add comment; list/check batch → send); retain orphan quote; failed send keeps notes; dispatched differs from solved; acceptance resolves linked notes, discard/reopen returns pending. Label private/local storage accurately and isolate accounts. No database schema migration hidden in this task.
- [x] Support per-independent-change acceptance via candidate diff or equivalent explicit edit items. Recompute against live draft before every apply; changed context/ambiguous anchor cannot force apply. Whole-document rewrites may remain one indivisible candidate when no safe decomposition exists, clearly represented.
- [x] Replace update_page JSON-only review with real before/after text diff using authoritative proposal baseline if available. If baseline unavailable, explicitly show candidate vs current and stale warning, never call current content historical baseline. Keep approval API preconditions unchanged.
- [x] Run client and server focused regression, typecheck; independent task review. Do not broaden external Agent permissions.

```ts
expect(applyScopedCandidate(base, changedOutsideRange, target)).toMatchObject({status:'out-of-scope'});
expect(commentAfterSuccessfulDispatch.status).toBe('dispatched');
```

### Task 6: Visual editor feasibility, integration and acceptance

**Files:** `docs/verification/document-workspace-20261006/`; relevant bug fixes belong to fresh implementation task and scoped review. Report file `visual-editor-spike.md` from independent probe.

- [x] Run isolated Tiptap Markdown conversion probe without adding production dependency. Corpus: Chinese/GFM/escaped tables/images/relative attachments/wiki links/callouts/block embeds/Mermaid/KaTeX/YAML/unknown syntax. Record exact package versions, source bytes and semantic changes. Evidence determines adoption; failed fidelity means keep current engine and document specific blockers, not a silent scope reduction.
- [x] Run full client tests, relevant server tests, repository checks/typecheck/lint/build; diagnose regressions, no repeated full runs absent changes.
- [x] Start isolated local app/services with disposable fixtures. Use real browser to create/read/edit rich Markdown, use toolbar/slash/tree rename/filter/resize, restore draft, preview candidate and keep human edits; test desktop and narrow viewport. Simulated Agent output allowed only explicitly labelled fixture, never claim live provider success.
- [x] Independent whole-branch review checks integrated behavior, role/version/cache isolation, fidelity and deferred observations; fix with one consolidated subagent then scoped re-review.
- [x] Preserve code, commit receipts, screenshots and task state. Report implemented scope, verified gates and remaining visual-editor blockers separately. No publish/deploy unless user subsequently authorizes it.

## Completion receipt

2026-10-06: all six tasks complete at product candidate `897aa3f8`; [acceptance](../../verification/document-workspace-20261006/acceptance.md), independent task/final reviews and screenshots preserved. Tiptap was evaluated and rejected for production adoption on current fidelity evidence. External provider/native IME/Windows/stress were not claimed. No merge/push/release/deployment performed.
