# Task 1 independent review

## Spec Compliance

- ✅ **Spec compliant for the frozen correction range.** Reviewed `fd9b97967aafe2b18c6bc762a6014530d9139718..f4325942c53101e8c628cd68fc1b7f23f07ae5cd` from the supplied package, including all five changed paths. No missing requirement, unauthorized scope expansion, or blocking defect found in this correction.
- ✅ Complete session event proof is validated before transition eligibility: candidate/event ID sets, duplicate event IDs, current saved version, every local annotation's body/quote/version, and anchor resolution against canonical source. Successful-send credential and supersedes proof remain separate checks (`agentwiki/apps/client/src/features/page/usePersonalNotes.ts:80-115`).
- ✅ Regeneration reopens only unresolved IDs, preserves the complete binding ID set, and returns without changing an all-Resolved batch. The existing transition function dispatches only Pending notes and fences all later transitions by task ID (`agentwiki/apps/client/src/features/page/usePersonalNotes.ts:118-122`; `agentwiki/apps/client/src/features/page/reviewComments.ts:42-51`).
- ✅ Route recovery accepts historical Resolved context only after canonical proof validation, requires at least one current-task note and current-task ownership of every unresolved note, and computes coverage only for notes owned by that task (`agentwiki/apps/client/src/features/page/usePersonalNotes.ts:88-90,124-148`).
- ✅ The added component regression covers both acceptance orders, partial acceptance, a clearly labeled byte-exact Undo model, unrelated manual tails, Conflict/Regenerate, explicit Send, failed-send retry, remount after receipt consumption, actual candidate application, and unchanged private/Resolved records. The reverse case performs another regeneration while the Resolved note retains the original task (`agentwiki/apps/client/src/features/agent-session/AgentSessionNotes.spec.tsx:206-268`).
- ✅ Negative and coverage cases include all-Resolved, wrong old/current unresolved task, missing note, immutable body/quote/source/version mismatch, incomplete event/candidate sets, missing canonical annotations, wrong identity/page, unchanged records on rejection, and late old ready/accept/fail/discard events (`agentwiki/apps/client/src/features/page/usePersonalNotes.spec.tsx:145-247`). Accepting an unrelated hunk is explicitly insufficient before accepting the unresolved note's own coverage (`agentwiki/apps/client/src/features/page/usePersonalNotes.spec.tsx:220-225`).
- ⚠️ **Actual browser/native acceptance of `f4325942` remains a separate gate.** The regression deliberately models Undo with a body reset (`agentwiki/apps/client/src/features/agent-session/AgentSessionNotes.spec.tsx:227-230`); it is not a keyboard/editor UI receipt. The parent's reported real-CUA failure on old `1735f341` is defect evidence, not acceptance of this candidate. No external runtime, provider or browser verification was performed in this review.

## Strengths

- The change fixes the eligibility predicate without broadly reopening historical notes. Full-context validation occurs first, then only eligible unresolved notes are reopened; the existing dispatch/ready/accept transition rules remain authoritative (`agentwiki/apps/client/src/features/page/usePersonalNotes.ts:81-122`; `agentwiki/apps/client/src/features/page/reviewComments.ts:42-51`).
- Mixed context retains its complete canonical identity rather than filtering the event payload to the unresolved subset. This closes the incomplete-event acceptance case and allows correct reconstruction after route remount (`agentwiki/apps/client/src/features/page/usePersonalNotes.ts:88-90,122-129`; `agentwiki/apps/client/src/features/page/usePersonalNotes.spec.tsx:189-247`).
- The regression uses the real Panel, registry, notes hook and `applyCandidateToDraft`; only transport/auth identity and the editable body are fixtures (`agentwiki/apps/client/src/features/agent-session/AgentSessionNotes.spec.tsx:5-23`). Its assertions verify the entire historical note record and exact final Markdown, not merely counts or status labels (`agentwiki/apps/client/src/features/agent-session/AgentSessionNotes.spec.tsx:225-268`).
- No dependency, persistence schema, editor history, Save, budget, provider, or deployment changes appear in the five-path correction package. The source changes are limited to note proof/eligibility/recovery plus canonical event annotation transport.

## Direct integration review and named risk checks

### Risk: optional annotations silently missing on a session event path

**Checked:** the full `AgentSessionPanel.emit` call chain, because the diff adds a shared event field required by the session notes consumer.

- The only session emitter derives annotations from `session.detail.turns` by the candidate's task ID (`agentwiki/apps/client/src/features/agent-session/AgentSessionPanel.tsx:45-47`).
- Receipt dispatch is inside a loop over that same canonical detail; it first checks receipt session, user, Space, page and `matchesReceipt` before emitting (`agentwiki/apps/client/src/features/agent-session/AgentSessionPanel.tsx:61-74`). `matchesReceipt` compares sent source/title/version and exact note/annotation evidence (`agentwiki/apps/client/src/features/agent-session/AgentSessionPanel.tsx:14-21`).
- Historical/current ready and failed events use the same emitter from the same canonical turn iteration (`agentwiki/apps/client/src/features/agent-session/AgentSessionPanel.tsx:76-83`). Cancelled/provider-failed turns become failed candidates through `candidateFromTurn` (`agentwiki/apps/client/src/features/agent-session/agentSessionCandidate.ts:5-14`).
- Guarded application failure, accepted application and explicit discard also use this emitter (`agentwiki/apps/client/src/features/agent-session/AgentSessionPanel.tsx:87-104`). Their UI callbacks originate from rendered canonical turns (`agentwiki/apps/client/src/features/agent-session/AgentSessionPanel.tsx:159-178`).
- **Result:** no omitted production session event path found. Missing annotations fail closed in session mode (`agentwiki/apps/client/src/features/page/usePersonalNotes.ts:88-90`), without a fallback to mutable composer state.

### Risk: the new event proof weakens authorization or crosses a remount/session boundary

**Checked:** the receipt lifecycle in `useAgentSession`, immutable candidate reconstruction and current editor bridge. This is direct integration checking, not a rerun of the archived whole-feature review.

- Successful current-bridge POST data enters canonical detail before the next render delivers the receipt (`agentwiki/apps/client/src/features/agent-session/useAgentSession.ts:149-168`). A late response retains its registry receipt and requires the current bridge's read; only receipts present when that authorized read starts can be cleared for delivery (`agentwiki/apps/client/src/features/agent-session/useAgentSession.ts:53-60,87-94,153-167`).
- Reads retain lifetime/epoch, selected-session, returned-session and Space fences; access failure clears candidates and receipts (`agentwiki/apps/client/src/features/agent-session/useAgentSession.ts:52-66`). The event change does not modify these gates.
- Immutable candidate source and scoped target still come from the original turn. Remount binding checks identity, permission, version, title and expected draft content; historical acceptance is used in expected content and is not reset (`agentwiki/apps/client/src/features/agent-session/agentSessionCandidate.ts:5-25`).
- The editor supplies the notes hook's identity from current user/Space/page only when notes are writable, uses session mode, and gates Panel callbacks on loaded notes (`agentwiki/apps/client/src/features/page/PageEditor.tsx:255,1352-1365`).
- Existing final-suite coverage includes the explicit current-bridge 403 case: old-mount receipt does not bind notes and the turn is not exposed (`agentwiki/apps/client/src/features/agent-session/AgentSessionNotes.spec.tsx:329-344`).
- **Result:** no new authorization bypass or cross-task transfer found. The hook's old-task fence plus the complete mixed recovery predicate preserve ownership (`agentwiki/apps/client/src/features/page/usePersonalNotes.ts:101-115,126-148`).

### Risk: an eligible subset accidentally mutates historical Resolved notes or resolves by unrelated coverage

**Checked:** the remainder of `onNotesEvent` because the supplied diff ends mid-function, and the unchanged `transitionPersonalNotes` helper it calls.

- Reopen is called only with unresolved IDs; dispatch changes only Pending records; ready/accept/fail/discard are task-fenced and fail/discard retain Resolved records (`agentwiki/apps/client/src/features/page/usePersonalNotes.ts:118-120`; `agentwiki/apps/client/src/features/page/reviewComments.ts:42-51`).
- Coverage is calculated only for local records bound to the current event task. Accept requires non-uncertain actual coverage and every covering edit ID to be accepted (`agentwiki/apps/client/src/features/page/usePersonalNotes.ts:133-148`).
- The component test confirms both the first-generation Resolved record and the private note remain byte-for-byte equal across retry, remount and repeated regeneration, with exact body/tail preservation and no PATCH (`agentwiki/apps/client/src/features/agent-session/AgentSessionNotes.spec.tsx:225-268`).
- **Result:** full canonical proof and eligible-subset transition are correctly separated; no automatic Save or historical reopening introduced.

### Risk: shared event-interface change breaks legacy Assist

**Checked:** `AgentAssistPanel.emitNotes`, default hook mode and the mode-dependent recovery predicate.

- `annotations` remains optional in the shared type (`agentwiki/apps/client/src/features/page/AgentAssistPanel.tsx:12`). Legacy emission still provides its prior event shape (`agentwiki/apps/client/src/features/page/AgentAssistPanel.tsx:149-150`).
- Hook session mode defaults to false; the new canonical annotation requirement is explicitly session-only (`agentwiki/apps/client/src/features/page/usePersonalNotes.ts:24,88-90`). With session mode false, recovery still requires every note to have the same current task; the new `some` condition is redundant with that nonempty `every` condition (`agentwiki/apps/client/src/features/page/usePersonalNotes.ts:126-129`).
- **Result:** legacy event compatibility is preserved.

## Issues

### Critical (Must Fix)

None found in the frozen correction range.

### Important (Should Fix)

None found in the frozen correction range.

### Minor (Nice to Have)

No new source or test-quality finding. Production build retains a reported large lazy-chunk warning; this is recorded below and is not treated as a newly introduced defect or as pristine build output.

## Verification evidence inspected

- Read the supplied diff once, in bounded chunks after the initial combined output was truncated. Inspected surrounding source only for the named integration risks above and the truncated `onNotesEvent` function; no Git state, product source, index, runtime, browser, credentials or external 51913/51914 changes.
- RED panel log records both orders failing at unresolved rebinding: expected `dispatched/regenerated-turn`, actual `awaiting-review/sent-turn` (`/tmp/agentwiki-mixed-notes-20261007/red-panel.log:168-175,348-355,371-374`). Hook RED records 3 failed, 21 passed, 25 skipped (`/tmp/agentwiki-mixed-notes-20261007/red-hook.log:108-112`).
- Final mixed-panel receipt: 2 passed, 25 skipped (`/tmp/agentwiki-mixed-notes-20261007/final-panel.log:5-8`). Final focused receipt: 12 files, 427 tests passed, no warning/error output (`/tmp/agentwiki-mixed-notes-20261007/final-focused.log:2-8`).
- `tsc.log` and `eslint.log` were inspected as zero-byte files; their successful exit status is recorded in the implementation report rather than independently reproduced by this review.
- Build receipt reports initial JavaScript **548914/550000 bytes**, one lazy parser exception (`/tmp/agentwiki-mixed-notes-20261007/build.log:9`). The 690.86 kB lazy chunk and Vite warning remain visible, followed by successful build completion (`/tmp/agentwiki-mixed-notes-20261007/build.log:362-368`). No budget relaxation appears in the correction package.
- Did not rerun existing suites. The focused source checks resolved the concrete integration concerns; no unanswered concern justified an additional probe.

## Assessment

**Task quality: Approved.**

**Correction integration review: Approved for parent integration, with the separate real-UI acceptance gate still open.**

The correction validates complete canonical note context before selecting unresolved notes for task transfer, and preserves the existing task/coverage/authorization guards. The changed event contract is supplied consistently by all session paths while legacy Assist remains compatible; component and build receipts support this scoped code verdict, not full product UI completion.
