# Task5 client phase1 — frozen at controller ownership gate

Implemented phase1 only; no commit, no agents, no production/dependency/schema changes. No edits to PageEditor, AgentAssistPanel, AssistCandidateReview, assistCandidate or MarkdownWorkspace.

## Files

- `agentwiki/apps/client/src/features/page/assistTargets.ts` + spec: UTF16 selection/section/document capture (same parsed outline, fenced headings ignored); <=256 contextual quotes; exact base target validation and full candidate outside-target preservation; unique live anchor application; ambiguous/orphan/overlap rejection. Source-line LCS retains separators, produces independent edit items, with bounded 300-line/100k character work and indivisible long rewrite fallback. Each acceptance rebuilds expected source including prior accepted hunks, recalculates live context, and requires unique unchanged anchor. Accepted id ledger prevents reapplication and handles reverse order/insertions/deletions/CRLF.
- `agentwiki/apps/client/src/features/page/reviewComments.ts` + spec: private browser storage isolated by user/Space/page, record scope/range validation, corrupt/unavailable states, retained original quote; selected pending notes require valid live anchor. `dispatch` -> `dispatched`, `ready` -> `awaiting-review`, matching explicit `accept` -> `resolved`; failure/discard/reopen -> pending. Never resolve at dispatch/completion.
- `agentwiki/apps/client/src/features/page/PersonalNotesPanel.tsx` + spec: controlled bilingual private notes queue with passage add, selected pending batch send, orphan quote display/disabled dispatch, honest storage failure label and reopen actions. Uses existing native/Tailwind controls, no second component library.
- `agentwiki/apps/client/src/features/review/ReviewPage.tsx` + spec: update_page loads authorized current page, checks returned id/Space, renders bounded reusable MarkdownDiff. Exact expectedUpdatedAt match is labelled Current document (matches proposal base version), never historical snapshot. Mismatch/missing baseline labels current-vs-candidate with explicit stale/version warning. Failed/unauthorized read shows candidate only. Full current/candidate downloads available; other proposed fields retained. No approval/decision API/precondition changes.

## Verification

`cd agentwiki/apps/client`

- `pnpm exec vitest run src/features/page/assistTargets.spec.ts src/features/page/reviewComments.spec.ts src/features/page/PersonalNotesPanel.spec.tsx src/features/review/ReviewPage.spec.tsx`: **52 passed / 4 files** (11 target + 5 notes + 2 UI + 34 review).
- `pnpm exec tsc --noEmit`: passed.
- `pnpm exec eslint src/features/page/assistTargets.ts src/features/page/reviewComments.ts src/features/page/PersonalNotesPanel.tsx src/features/review/ReviewPage.tsx`: passed.
- Explicit-work-tree `git diff --check`: passed.
- Tests observed failing before implementation for target helpers, note helpers, UI, and update-page diff. Malformed persisted range test failed before final validation hardening.

## Phase2 integration contract / remaining work

- `captureAssistTarget(source,kind,from,to,baseUpdatedAt)` returns null for invalid/empty selection; section starts nearest parsed heading and ends at next same/shallower heading. Attach result to existing snapshot.assistTarget. Document remains default.
- `applyScopedCandidate(base,fullCandidate,target,live)` -> applied/content or invalid-target/out-of-scope/conflict/ambiguous.
- `createCandidateEdits(base,fullCandidate,target)` -> ready {base,target,edits,indivisible}; `acceptCandidateEdit(live,plan,id,acceptedIds)` -> applied/content/acceptedIds or refusal. Caller must persist acceptedIds with candidate and atomically update source and ledger; identity/current permission/server version/remote conflict guards remain caller responsibilities. Hunk helper permits unrelated local draft edits, not stale server versions.
- PersonalNotesPanel is controlled. Parent supplies scoped loaded notes and callbacks, disables during send, and keys the panel by user/Space/page to reset input/checkbox selection. `savePersonalNotes` reports unavailable; retain in-memory notes and show storageUnavailable. Task response/event linkage is by taskId and selected note ids. Resolve only linked accepted edits; outstanding/discarded edits reopen remaining notes. `notesForDispatch` fails closed for missing/ambiguous passages; original quote stays visible.
- Remaining authorized Task5 work is editor scope selector/context chips/selection Add note action, request transport, task note linkage and candidate hunk UI, live atomic source integration and its behavioral tests. Wait for explicit controller release of shared Task3/4 files.
- Browser/native acceptance and independent review are not claimed at this phase. Existing review API currently exposes no historic baseline content; current server GET at matching exact version is the only verifiable proposal base in this client implementation.

## Phase1 gate1 repair — frozen

Independent review P2 verified: context-local normalization hid malformed original offsets. Added `Number.isSafeInteger` for original `target.from/to`, explicit nonnegative/ordered range checks BEFORE context normalization in `reviewComments.ts`.

Only notes helper/spec changed for code repair (+2 validation lines, +21 test lines). New load AND save cases cover fractional, numeric-string, mixed string/number, negative, reversed, unsafe integer, positive/negative infinity and NaN offsets; persisted invalid bytes remain untouched. Fractional/string/mixed/unsafe cases failed as `loaded` against prior implementation, then passed after validation.

Verification: 27/27 across reviewComments (14), assistTargets (11), PersonalNotesPanel (2); client tsc passed, notes helper/spec eslint passed, explicit-work-tree diff-check passed. No commit or shared editor integration. Re-freeze pending independent rereview/controller release.

## Phase2A panel / candidate integration — frozen

Owned `AgentAssistPanel.tsx/spec`, `assistCandidate.ts/spec`, `AssistCandidateReview.tsx` plus new review component spec. Did not edit PageEditor, MarkdownWorkspace, phase1 helpers or notes UI. No commit/agents.

Behavior: optional exact `snapshot.assistTarget` transport; bilingual document/selection/section selector, selected source context and explicit review instructions. Invalid or stale selected source refuses submission before POST. Optional request seeds intent/scope and selected note ids; successful task response emits dispatch and acknowledges request, failed POST retains request/intent without transitioning notes. Task completion builds validated independent edit plan; empty/outside-target output emits fail. Every accept recalculates against live snapshot, locks candidate synchronously, calls parent, then records accepted edit ids only on true apply. Repeated hunk clicks/polling cannot replay; partial candidate remains ready, final acceptance becomes accepted. Failure/permission loss/discard/eviction emits fail/discard for linked notes.

Parent compatibility: `supportsScopedApply` defaults false. Scoped candidate accept is DISABLED unless explicit parent opt-in; per-hunk UI only exposed on opt-in. Legacy requests without target retain original one-argument `onApply(candidate)` and exact full-source/draft revision guards. New `onApply(candidate, editId?)` never bypasses live parent checks.

Phase2B exact interface:

- `AssistSnapshot`: optional `assistTarget`, `remoteConflict` now included, existing title/content/updatedAt/draftRevision/remoteRevision retained.
- Panel optional props: `assistTargets={{selection,section}}`, `assistRequest={id,intent,assistTarget?,noteIds?}`, `onRequestHandled(id)`, `supportsScopedApply`, `onNotesEvent(event)`.
- `AssistNotesEvent` = `{event:'dispatch'|'ready'|'accept'|'fail'|'discard',taskId,noteIds,candidate,editId?,acceptedEditIds?}`. Dispatch from successful task creation, ready only from usable completed candidate. Accept supplies the accepted ledger so parent resolves ONLY notes whose covered changes have all been accepted; partial acceptance must not resolve outstanding notes. Failure/discard reopens only unresolved task-linked notes. POST failure emits no task event; notes stay pending.
- `completeAssistCandidate(candidate,content,summary?)` validates server result/scope and builds bounded source-preserving edit plan.
- `applyCandidateToDraft(candidate,current,editId?)` returns `{status:'applied',content,acceptedEditIds}` or refused. Current must include userId/pageId/spaceId/canEdit/title/content/updatedAt/draftRevision/remoteRevision/remoteConflict. Use this helper again inside parent onApply, synchronously update editor content/ref/revision and normal accepted-draft persistence; return true only after source update. Panel owns accepted-id ledger and passes updated candidate on subsequent calls. Parent must not alter candidate content or silently use full result when editId supplied.
- Guards: exact identity, permission, saved updatedAt, original title, remote revision and remoteConflict always mandatory. Scoped edits permit independent local draft changes only if live contextual anchor stays unique; legacy full document requires exact baseContent and draftRevision. Whole scoped document accept remains indivisible if full source diverged; individual hunks revalidate context. No stream/done source changes.

Checks: focused panel/candidate/review suite 57/57; phase1 + phase2A + ReviewPage combined **118/118 / 7 files**; client tsc, focused six-file eslint and explicit-work-tree diff-check passed. New tests cover exact request transport, no resolve on ready, hunk once/source changes, old parent disabled, stale-target POST refused, send failure retained, failed parent apply/discard note events, out-of-scope output refused, scoped identity/remote guard matrix. Browser and independent integrated review remain pending Phase2B.

## Phase2B complete — frozen for independent integrated review

New `usePersonalNotes.ts/spec` provides generation-bound account/Space/page/write-permission isolation; authorized local storage loading/saving with in-memory retention and honest unavailable status; live-source add/anchored batch request construction; explicit post-reload reopen; pending/dispatched/awaiting-review/resolved transitions. Task binding exists only for a successful matching in-session dispatch request. At ready, note passage is located in submitted base and mapped to overlapping candidate edit ids; partial accept resolves a note only after EVERY mapped edit is accepted. No mapped edit -> never resolved. Discard/failure reopen unresolved notes only. Old route/account/permission callbacks and latest-source stale UI callbacks refuse writes. Intent over existing 10k API bound refuses while preserving notes. No APIs/schema/dependencies.

Final `PageEditor.tsx/spec` wiring:

- Captures source offsets through existing `onSelectionChange` and `onRequestAssist`, handles selected Ask Agent; bilingual selector passes current selection/current section and explicit document default snapshots.
- Personal notes toolbar opens immediately in the existing fixed `document-assist-layer`. Candidate queue and notes queue share that visible drawer; switching keeps Assist mounted, preserving in-session candidate/ledger. Close control included. No offscreen-after-document UI and no CSS/MarkdownWorkspace edits.
- Select passage + add note; check note batch + Send directly creates task (autoSubmit only explicit selected-note request id; once per id). Failed send retains intent/request and pending notes; manual Run task retries. Lifecycle events bind to controller; notes are never resolved at send/done.
- Scoped parent `onApply(candidate,editId?)` calls `applyCandidateToDraft` against latest `currentValue()`, saved page version, account authorization, permissions, title, remote revision and both remoteUpdate/unresolvedSocketRevisionRef. Saved version latest ref mismatch also refuses.
- Parent accepted task map stores per-hunk ledger, rejects duplicate ids or ledger drift, permits remaining independent changes. Single `replaceDocument` uses existing isolated undo transaction; existing handleContentChange synchronously schedules accepted content via Task4 localDraft provenance path. No rollback/rework of Task4 remote adoption, recovery or persistence gates.
- Panel duplicate helper call removed; parent still does independent fresh source validation. Whole-document full acceptance preserves Task1 exact draftRevision guard; individual contextual hunks allow unrelated human draft changes. Streaming/done never write source.

Files in Phase2B delta: `PageEditor.tsx/spec`, `AgentAssistPanel.tsx` (explicit note autoSubmit opt-in and redundant validation removal), `assistCandidate.ts/spec` (full document exact draft revision guard), new `usePersonalNotes.ts/spec`. Phase1/2A changes previously committed by controller remain intact. No commit/subagents.

Final checks:

- Combined Task1/3/4/5 focus command covers PageEditor, AgentAssistPanel, assistCandidate, AssistCandidateReview, assistTargets, reviewComments, PersonalNotesPanel, usePersonalNotes, localDrafts, LocalDraftNotice, MarkdownWorkspace, markdown-tools, markdown-diff, ReviewPage: **354 passed / 17 files**, no skips/failures.
- PageEditor itself **111 passed**, including real CodeMirror selected transport + unrelated typing + undo, notes direct dispatch + hunk-related resolution + separate undo + once ledger, and current-section/default-document requests.
- Notes hook **6 passed**: persistence, quote/context batch, identity/permission delayed events, reload explicit reopen, orphan refusal, source-refresh stale callbacks, unavailable storage retention, multi-hunk note resolution, request bounds.
- Client `pnpm exec tsc --noEmit`: pass. Focused 10-file Phase2A/2B eslint: pass. Explicit-work-tree diff-check: pass.
- Browser acceptance and independent integrated review are controller next gates; not claimed here. No production or external Agent permission changes.

## Integrated review repair — frozen, product writes complete

Verified both P2 findings against `dfd4bbba`/`eb83dd83`; new reproduction tests failed before repairs. Code delta limited to `PageEditor.tsx/spec` and `usePersonalNotes.ts/spec`; no other product modules, Task4 guard changes, commit or agents.

1. Drawer lifetime: `assistMounted` is scoped/reset with editor account/page lifecycle. Opening Assist mounts its controller; closing drawer only hides its wrapper, while candidate state, accepted ids, socket/poll updates and autoSubmit attempted-id Set survive. Switching notes/candidate queue still preserves controller. Route/account lifecycle still clears it. Real CodeMirror tests cover generating, ready and partially accepted candidate close/reopen, failed selected-notes POST close/reopen, and delayed first POST response while hidden/reopened. Each request auto-submits once and partially accepted hunk remains disabled with other hunk usable.
2. Note coverage: ignore line/container extent alone. For each edit, remove exact unchanged common prefix/suffix, check intersection with actual changed source, and conservatively refuse resolution if the overlapping original excerpt survives in the edit result. Pure insertion counts only strictly inside quote; deletion with removed excerpt counts. If correspondence is ambiguous/retained, keep awaiting review even if a broader hunk is accepted. Tests cover same-line notes (only one quote changes), long indivisible edit retaining another quote, changed ends with unchanged interior quote, insertion and deletion. This deliberately favors unresolved notes over false resolution.

Verification: **364 passed / 17 files**, no failures/skips across same combined Task1/3/4/5 command. PageEditor **116**, notes hook **11**. Client tsc and four touched-file ESLint pass. Explicit-work-tree diff-check pass. Product files frozen; notified controller to resume stateful browser acceptance. Independent rereview/browser acceptance remain controller gates.

## Integrated rereview fixround2 — frozen

Confirmed remaining P2 probe `one\nkeep\ntwo` -> `ONE\nkeep\nnew two old` with one note spanning 0..12: prior boolean classification dropped edit-2 and resolving edit-1 falsely solved note. Added tri-state source-change evidence (`unchanged`/`changed`/`uncertain`). Both changed and uncertain edit ids remain dependencies; per-note uncertain set blocks automatic resolution even after all ids accepted, retaining explicitly reviewable state. No uncertain dependency is silently filtered out. The reproducer checks first-hunk acceptance stays awaiting-review, all-hunk acceptance remains conservative, discard returns pending. Existing same-line/indivisible/insert/delete/unchanged-interior cases remain green.

Code changes only `usePersonalNotes.ts/spec`. Existing drawer repair untouched. Notes hook 12/12; combined Task1/3/4/5 **365/365 / 17 files**, no failures/skips. Client tsc, notes helper/spec ESLint, explicit-work-tree diff-check passed. No commit or agents. Product writes complete/frozen; controller informed for browser continuation and independent rereview.
