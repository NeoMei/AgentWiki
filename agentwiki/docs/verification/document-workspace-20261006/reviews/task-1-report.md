# Task 1 implementation report

## Outcome

Assist streaming and completed output now stay in panel-local candidate state. Only an explicit **Accept to draft / 接受到草稿** changes the document, and only if the current user, Space, page, title, source, page version, draft revision and observed remote revision still match the submitted snapshot. Discard and accept decisions survive duplicate completion/polling; an empty result or failure never erases the draft. No server Save or publication is triggered by candidate acceptance.

Implementation baseline: controller-provided c7b89567 initial product baseline; controller committed plan/probe only while this task ran, current product-parent head a31620bf. No commits made by this agent. All Git commands used explicit work-tree with the literal trailing space.

## Exact owned changed files

Paths relative to repository root:

1. `agentwiki/apps/client/src/features/page/AgentAssistPanel.tsx`
2. `agentwiki/apps/client/src/features/page/AgentAssistPanel.spec.tsx`
3. `agentwiki/apps/client/src/features/page/PageEditor.tsx`
4. `agentwiki/apps/client/src/features/page/PageEditor.spec.tsx`
5. `agentwiki/apps/client/src/features/page/assistCandidate.ts` (new)
6. `agentwiki/apps/client/src/features/page/assistCandidate.spec.ts` (new)
7. `agentwiki/apps/client/src/features/page/AssistCandidateReview.tsx` (new)
8. `agentwiki/apps/client/src/components/markdown-diff/lineDiff.ts` (new)
9. `agentwiki/apps/client/src/components/markdown-diff/lineDiff.spec.ts` (new)
10. `agentwiki/apps/client/src/components/markdown-diff/MarkdownDiff.tsx` (new)
11. `agentwiki/apps/client/src/components/markdown-diff/MarkdownDiff.spec.tsx` (new)
12. `agentwiki/apps/client/src/components/MarkdownWorkspace.tsx` (controller-approved narrow extension)
13. `agentwiki/apps/client/src/components/MarkdownWorkspace.spec.tsx` (narrow undo regression)
14. `agentwiki/apps/client/package.json` (controller-approved exact existing dependency)
15. `agentwiki/pnpm-lock.yaml` (client importer only)
16. `.superpowers/sdd/2026-10-06-document-workspace/task-1-report.md` (this report)

Other modified tree/workspace/spec/docs files belong to the controller or parallel Task 2 agent and were not edited by this agent.

## Behavior and interfaces

- `AssistCandidate` carries task/user/page/Space identity, immutable submitted title/content/version, local and observed remote revisions, full candidate source, summary and status. It is compatible with later range-target extensions without implementing Task 5.
- API submission still sends only the existing `snapshot: {title, content, updatedAt}` wire shape; draft/remote revisions are local safety tokens.
- Candidate state is scoped to the current identity and retained only in this mounted panel. Historical/collaborator tasks are viewable but cannot be accepted without an exact captured local baseline.
- Poll/task/post results check a generation token after await. Page/Space/user change, unmount and permission transitions invalidate older requests, including navigation away and back to the same identity.
- Permission loss changes generating/ready candidate status to conflict; returning permission does not resurrect eligibility.
- Streaming extracts partial Markdown into the candidate only; raw runner log/provider errors are no longer presented as streaming source. `onStreamUpdate` and both editor auto-apply paths are removed.
- The panel guards at accept, then PageEditor independently rechecks authoritative refs and current CodeMirror document immediately before replacement. Concurrent human edits, even edits undone back to identical text, make the whole-document candidate stale. Remote changes increment a token even when the user keeps the local draft, so rejecting the remote prompt cannot force a stale candidate to apply.
- Synchronous terminal marking prevents duplicate click/completion reapplication. Parent returns false if guarded application fails; candidate stays reviewable as conflict, with regenerate guidance and no force button.
- Reusable `MarkdownDiff` renders literal source with textual Added/Removed/Unchanged labels in both languages; HTML is escaped. Bounded LCS operates on at most 300 lines / 100,000 characters per input, with at most 600 rows. Incomplete previews are labelled honestly; full original/candidate downloads support manual review.
- `MarkdownWorkspaceHandle.replaceDocument(next): boolean` is a real whole-document CodeMirror transaction using `Transaction.addToHistory.of(true)` and `isolateHistory.of('full')`; it returns false without a mounted editing view. Same-content acceptance is an explicit no-op.
- Controller approved review-only preview mode: candidate Accept is disabled with bilingual return-to-edit guidance. Switching back to edit does not apply automatically. During Save, the disabled acceptance reason explicitly says to wait for Save.
- Existing expectedUpdatedAt/treeRevision/save/attachment behavior and Markdown source semantics are untouched.

## RED/GREEN evidence

Commands ran from `/Users/neomei/.codex/worktrees/document-workspace/AgentWiki /agentwiki`.

1. RED core behavior: `pnpm --filter @agentwiki/client exec vitest run src/features/page/AgentAssistPanel.spec.tsx src/features/page/PageEditor.spec.tsx src/components/MarkdownWorkspace.spec.tsx`.
   - Valid RED receipt `/tmp/document-task1-red-valid.log`: **6 failed, 145 passed**, three failed suites; missing Accept/Discard, live partial raw stream contract, snapshot conflict handling, and missing replaceDocument were expected failures.
   - Earlier `/tmp/document-task1-red.log` included two module-resolution errors for the missing direct commands dependency; these are not counted as behavior RED. Dependency repair enabled valid RED above.
2. RED diff behavior: `/tmp/document-task1-diff-red.log`: **4 failed** assertions against an empty interface stub, proving source lines, bounded processing and literal long source behavior were absent.
3. Core GREEN `/tmp/document-task1-green3.log`: **175 passed**, five suites.
4. Additional race RED `/tmp/document-task1-identity-red.log`: **2 failed, 9 passed**; permission restoration resurrected acceptance, and delayed POST survived navigation ABA. Generation invalidation and conflict transition fixed both. A final self-review RED `/tmp/document-task1-submit-red.log` (1 failed, 14 passed) exposed a disabled fresh-submission button after revocation during POST; resetting submitting on revocation fixed it and the final suite covers recovery.
5. Final focused verification: `pnpm --filter @agentwiki/client exec vitest run src/features/page/AgentAssistPanel.spec.tsx src/features/page/PageEditor.spec.tsx src/components/MarkdownWorkspace.spec.tsx src/components/markdown-diff/lineDiff.spec.ts src/components/markdown-diff/MarkdownDiff.spec.tsx src/features/page/assistCandidate.spec.ts`.
   - `/tmp/document-task1-verified-tests.log`: **6 suites passed, 185 tests passed**, 3.41 seconds, exit 0.
   - Includes real CodeMirror undo-depth + undo restoration, no stream dirty/save activity, duplicate completion after undo never reapplying, keep-human/keep-remote protection, preview no implicit application, empty output, permission restoration, page/Space identity and navigation ABA, bounded/literal/bilingual diff, pure guard matrix.
6. `pnpm --filter @agentwiki/client exec tsc --noEmit`: `/tmp/document-task1-verified-typecheck.log`, **exit 0** (empty log).
   - Earlier `/tmp/document-task1-typecheck.log` included two Task 1 issues fixed here (ES target `.at` and queued-status inference) and three sibling Task 2 transient interface errors. Those were concurrent implementation errors, not preexisting baseline defects. Final typecheck is clean.
7. `git --work-tree='/Users/neomei/.codex/worktrees/document-workspace/AgentWiki ' diff --check`: exit 0.

## Dependency receipt

Added exact `@codemirror/commands: 6.10.4`, already installed transitively and already present in package/snapshot lock sections. Only client importer adds three lock lines; no version or package-resolution upgrades. This supplies the required history-isolation annotation and real undo test command. Offline `pnpm add` attempted broad workspace metadata resolution and failed on unrelated opencode metadata; exact package/importer entries were then added, and `pnpm install --offline --frozen-lockfile` succeeded (`/tmp/document-task1-dependency.log`).

## Review pointers / remaining gates

- Review identity/generation checks in panel and atomic current-source checks in PageEditor together.
- Review remote revision increment before dirty conflict offering, including keep-local semantics.
- Review terminal candidate state handling across socket/poll events and synchronous parent boolean acknowledgement.
- Review added history isolation method and real undo tests; Task 3 must preserve this interface.
- Whole-document candidate conflict is intentionally conservative; safe scoped hunk application is Task 5, not introduced here.
- Candidate state is not recoverable after panel close/reload; recoverable human/accepted drafts belong to Task 4.
- The diff is explicitly incomplete beyond bounds, requiring full-source downloads for long reviews; acceptance uses full exact source and is never based on clipped content.
- Unit/component tests and typecheck are verified. Browser/native visual acceptance, independent task review, whole-branch review, server/full-repository checks, and integration commits remain controller-owned gates. No provider live success or deployment is claimed.

## Independent review 1 correction — submission feedback

Fix baseline: `37efdab7`. Independent reviewer identified an Important issue: rejected `/assist/tasks` POST had no candidate yet and was silently swallowed, so users lacked visible submission failure feedback. Scoped correction changes only `agentwiki/apps/client/src/features/page/AgentAssistPanel.tsx`, its existing spec, and this report. No commits or unrelated task changes made.

- Submission failures now render a sanitized bilingual `role="alert"`: “Could not submit the task. Your draft is unchanged. Please retry.” / “任务提交失败，草稿未改动。请重试。” No server/provider message is interpolated.
- Error state stores the request identity and generation; both catch and render enforce these guards. Navigation/user/Space changes, permission transitions and unmount prevent stale failures from leaking, including navigation-away-and-back and permission-loss-and-restoration.
- Failure retains the intent and re-enables submission. Starting a retry clears the current error; success clears the intent. Candidate/document application remains unchanged and never runs on submission failure.

RED command from `agentwiki`: `pnpm --filter @agentwiki/client exec vitest run src/features/page/AgentAssistPanel.spec.tsx`.

- `/tmp/document-task1-review-fix-red.log`: **1 suite failed; 4 failed, 17 passed**, 4.327 seconds of test execution. Failures are missing accessible feedback for English/Chinese and inability to first observe an error before testing context reset; expected review reproduction. Delayed-error nonleak guards already passed before the fix.

GREEN same command:

- `/tmp/document-task1-review-fix-green.log`: **1 suite passed; 21 tests passed**, 521 ms total, exit 0. Added six cases cover both languages, sanitized feedback, retained intent/retry availability, successful retry clearing, delayed navigation/permission errors and existing-error invalidation.
- `pnpm --filter @agentwiki/client exec tsc --noEmit`: `/tmp/document-task1-review-fix-typecheck.log`, exit 0, empty log.
- `git --work-tree='/Users/neomei/.codex/worktrees/document-workspace/AgentWiki ' diff --check -- apps/client/src/features/page/AgentAssistPanel.tsx apps/client/src/features/page/AgentAssistPanel.spec.tsx`: exit 0.

Only the changed panel covering suite reran; the prior six-suite 185-test acceptance/undo receipt remains the wider Task 1 evidence. Scoped independent re-review and controller commit remain next gates.
