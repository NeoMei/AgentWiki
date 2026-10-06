# Task 1 implementer report

Status: DONE. Candidate: `f4325942c53101e8c628cd68fc1b7f23f07ae5cd` — `fix(agent-session): preserve unresolved mixed-note regeneration linkage`.

Base: `fd9b97967aafe2b18c6bc762a6014530d9139718`. Worktree: `/Users/neomei/.codex/worktrees/document-workspace/AgentWiki ` (literal trailing space), branch `codex/document-workspace`. The commit contains only the five source/test paths listed below. Parent-owned memory, plans and acceptance documents were not included.

## Change and lifecycle

The original hook rejected an entire successful regeneration receipt if any context note was Resolved. After remount, its separate coverage recovery also required every context note to belong to the new task. Both prevented an unresolved note from following the new proposal when the same explicit context retained a previously resolved annotation.

The hook now checks the complete session event identity and all annotations before deciding transition eligibility. Candidate and event note IDs must match exactly, with no duplicate event IDs; each local annotation must still have the same body, quote and saved version and resolve in the canonical base source. Missing or changed Resolved context fails the batch just like missing or changed unresolved context. The immutable successful-send receipt still independently validates request IDs, annotation set, source/title/version, target and credential scope; supersedes still validates its full original ID/annotation/source/title/version proof and the unresolved note's old-task ownership. No changes to receipt authorization or registry persistence were made.

Only unresolved IDs are reopened after a valid explicit regeneration receipt. The normal pending-only dispatch transition then binds them to the new task. Resolved notes keep their entire stored record, including historical task ID, unchanged. If all context notes are Resolved, dispatch returns without rebinding. Ordinary dispatch still rejects an already resolved/dispatched batch without supersedes.

Bindings retain the **whole event ID set**, rather than narrowing the context to eligible IDs. Coverage calculations and state transitions retain the existing per-note task fence. Route recovery requires complete canonical event proof, at least one current-task local linkage, and current-task ownership of every unresolved member. Valid Resolved context can retain an earlier historical task, including across turn 1 → turn 2 → turn 3. This allows restored ready/accept events to reach unresolved notes without widening ownership for a wrong-task unresolved note.

## Event interface and self-review

`AssistNotesEvent.annotations` is optional at the shared type level for legacy Assist compatibility. Every session event now supplies it from the canonical turn in `session.detail` through the single `AgentSessionPanel.emit` helper. Audited all helper callers: successful receipt dispatch; historical/current ready; provider failure/cancellation fail; guarded application failure; accepted candidate; explicit discard. Session mode requires this proof for every event, including dispatch, and does not fall back to a local composer or missing annotations. Existing registry fresh authorization and `matchesReceipt` checks remain unchanged.

Legacy Assist leaves `stageForSession=false`, so its event shape and previous same-task recovery rules continue to work. No new persistence mechanism, dependencies, page PATCH, scope expansion, automatic reopen, editor history changes or save behavior were added. Existing single-note late callback tests were updated to include genuine canonical annotation proof so they still exercise the task fence rather than being rejected merely for missing proof.

Self-review found one test-only TypeScript target mismatch (`Array.at` is outside the configured library); changed it to ordinary indexed access, then reran the component regression, tsc, scoped lint and final focused checks. No remaining correctness concerns identified. Independent review is still required and belongs to the parent.

## Tests and TDD evidence

All commands below ran from `/Users/neomei/.codex/worktrees/document-workspace/AgentWiki /agentwiki/apps/client` unless otherwise stated. Logs: `/tmp/agentwiki-mixed-notes-20261007/`.

### RED before production edits

`pnpm exec vitest run src/features/agent-session/AgentSessionNotes.spec.tsx -t 'regenerates mixed Document'`

`red-panel.log`: **2 failed, 25 skipped**. Both forward and reverse acceptance orders failed at the corrected product expectation: unresolved note should be `{ status: 'dispatched', taskId: 'regenerated-turn' }`; actual was `{ status: 'awaiting-review', taskId: 'sent-turn' }`. These are production Panel/registry/notes/helper assertions, not a passing defect characterization.

`pnpm exec vitest run src/features/page/usePersonalNotes.spec.tsx -t 'mixed-note'`

`red-hook.log`: **3 failed, 21 passed, 25 skipped**. The valid mixed regeneration and valid mixed remount could not advance; the incomplete event subset incorrectly resolved a note. Remaining negative cases already passed under the old blanket refusal. All these runs preceded production edits.

### GREEN and final validation

`pnpm exec vitest run src/features/agent-session/AgentSessionNotes.spec.tsx src/features/page/usePersonalNotes.spec.tsx`

`green-notes.log`: **2 files, 76 passed**, no failures or warnings.

`pnpm exec vitest run src/features/agent-session src/features/page/usePersonalNotes.spec.tsx src/features/page/PersonalNotesPanel.spec.tsx src/features/page/reviewComments.spec.ts src/features/page/assistCandidate.spec.ts src/features/page/assistTargets.spec.ts src/features/page/AssistCandidateReview.spec.tsx src/features/page/PageEditor.spec.tsx src/components/MarkdownWorkspace.spec.tsx`

`focused.log`: **12 files, 427 passed**. Final frozen-candidate repetition in `final-focused.log` also records **12 files, 427 passed, 0 failed**, in 14.44 seconds after the test-only indexed-access correction. This includes existing F1 pending-send/fresh authorization, selection/document regeneration, candidate application/coverage, legacy note behavior and editor/Undo regressions. No unrelated full-client or server suite was rerun.

`pnpm exec vitest run src/features/agent-session/AgentSessionNotes.spec.tsx -t 'regenerates mixed Document'`

`final-panel.log`: **2 passed, 25 skipped** after the TypeScript compatibility correction. The new regression covers both hunk orders, and the reverse order additionally exercises a second regeneration while the Resolved note retains turn 1 ownership. Each uses the production Document scope, explicit Send, failed-send retry, real route/hook remount after receipt consumption, actual candidate application helper and final exact body assertions. A third unselected private note remains byte-for-byte unchanged. The actual accepted hunk must cover the unresolved note; accepting a different hunk is insufficient. No PATCH is emitted.

The hook matrices also cover all-Resolved, wrong superseded task, missing local note, changed Resolved and unresolved annotation, changed old annotation/source, stale version, incomplete event/candidate, missing canonical proof, wrong scope/page, wrong unresolved task on remount, and late old ready/accept/fail/discard events. Failure requires preserving all prior local records rather than silently transferring a subset.

`pnpm exec tsc --noEmit` → exit 0, `tsc.log` empty.

From the `agentwiki` app root:

`pnpm exec eslint apps/client/src/features/agent-session/AgentSessionNotes.spec.tsx apps/client/src/features/agent-session/AgentSessionPanel.tsx apps/client/src/features/page/AgentAssistPanel.tsx apps/client/src/features/page/usePersonalNotes.ts apps/client/src/features/page/usePersonalNotes.spec.tsx` → exit 0, `eslint.log` empty.

`pnpm build` → exit 0, `build.log`. Production entry: `dist/assets/index-DXqBseLb.js`; HTML: `dist/index.html`; editor chunk: `dist/assets/PageEditor-B_1FXt-P.js`. Budget output: **Initial JavaScript: 548914/550000 bytes; lazy parser exceptions: 1**. No budget/config change. Vite retains the known large lazy Mermaid parser warning (690.86 kB bounded exception); this is not an initial-load budget failure.

`git --work-tree='/Users/neomei/.codex/worktrees/document-workspace/AgentWiki ' diff --check` → exit 0.

## Exact committed paths

- `agentwiki/apps/client/src/features/page/usePersonalNotes.ts`
- `agentwiki/apps/client/src/features/page/usePersonalNotes.spec.tsx`
- `agentwiki/apps/client/src/features/page/AgentAssistPanel.tsx` (event type only)
- `agentwiki/apps/client/src/features/agent-session/AgentSessionPanel.tsx` (canonical event annotations only)
- `agentwiki/apps/client/src/features/agent-session/AgentSessionNotes.spec.tsx`

## Evidence limits

These are component/hook and production build checks. In the mixed regression, a byte-exact body reset models standard Undo; it is explicitly not a browser interaction receipt. API transport and identity are test fixtures, while the production panel, registry, notes hook and apply helper remain real. This report does not claim actual external provider or native/browser UI acceptance. External independent acceptance on 51913/51914 was neither accessed nor changed. No runtime or credentials were manipulated, and there was no push, merge, release or deploy.
