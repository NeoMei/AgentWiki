# Task 1 review — 40b83a7b..37efdab7

## Spec Compliance

- ✅ Task 1 safety requirements are implemented in the reviewed diff: panel-local streams and explicit acceptance (`agentwiki/apps/client/src/features/page/AgentAssistPanel.tsx:261`, `:312`), exact identity/draft/version guard (`agentwiki/apps/client/src/features/page/assistCandidate.ts:30`), authoritative editor recheck (`agentwiki/apps/client/src/features/page/PageEditor.tsx:769`), and an isolated undoable replacement (`agentwiki/apps/client/src/components/MarkdownWorkspace.tsx:564`). The approved dependency and editor-interface extensions are narrow; Task 5 scope is not required here.
- ⚠️ Browser/native acceptance and unchanged server permission enforcement are not verified by this task diff. Reported automated evidence is not a browser acceptance receipt.

## Strengths

- `AgentAssistPanel.tsx:145-179,183-188,334-360`: request generation invalidation covers delayed submission/polling across identity and permission transitions; permission restoration does not revive ready/generating candidates.
- `AgentAssistPanel.tsx:201-213,312-325`: completion only advances generating candidates; synchronous terminal marking prevents duplicate acceptance and completion from reapplying.
- `PageEditor.tsx:294,769-782`: observed remote revision changes invalidate acceptance even after keeping the local draft; the final replacement checks current CodeMirror source and local edit revision synchronously.
- `MarkdownWorkspace.spec.tsx:132-144` and `PageEditor.spec.tsx:303-333`: real CodeMirror undo restores the human draft, and duplicate completion after undo does not reapply. This tests behavior rather than only callback invocation.
- `components/markdown-diff/lineDiff.ts:3-33` and `MarkdownDiff.tsx:9-15`: bounded line/character processing, literal source rendering, textual bilingual labels, and an honest incomplete-preview notice support review without executing generated HTML.

## Issues

### Critical

- None found.

### Important

- **Submission failures are silently swallowed.** `agentwiki/apps/client/src/features/page/AgentAssistPanel.tsx:357-360`: a rejected `/assist/tasks` POST reaches an empty catch and merely re-enables the button. No candidate exists yet, so `AssistCandidateReview`'s failed state cannot render; users receive no visible or accessible indication that their request failed. Preserve the unchanged draft, but show a bilingual, sanitized submission error and allow retry. Scope that error to the same identity/generation guards, and add a rejected-POST regression proving feedback, retry availability, and no `onApply` call. Do not expose raw provider/server errors.

### Minor

- None.

## Assessment

**Task quality: Needs fixes.** Candidate application and stale-state protection are well implemented. The newly swallowed submission error is a user-visible failure-handling gap that should be fixed before this task is approved.

**Checks:** Read the immutable supplied diff; recovered its middle section after tool-output truncation, without rereading changed workspace files. Inspected the report's existing `/tmp/document-task1-verified-tests.log` (6 suites, 185 passed, no warnings) and `/tmp/document-task1-verified-typecheck.log` (empty). No tests rerun, no code outside the diff inspected, and no Git operations performed.
