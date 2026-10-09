# Task 1 implementation report

Status: Implementation and focused verification complete; ready for controller commit and independent review. No commits or subagents created.

## Files changed

- `agentwiki/apps/client/src/components/markdown-diff/MarkdownDiff.tsx`
- `agentwiki/apps/client/src/components/markdown-diff/MarkdownDiff.spec.tsx`
- `agentwiki/apps/client/src/features/page/AssistCandidateReview.tsx`
- `agentwiki/apps/client/src/features/page/AssistCandidateReview.spec.tsx`
- This report only, beside the brief.

## Implementation

Shared MarkdownDiff now starts at changed lines plus three neighboring unchanged lines on each side. Long unchanged runs become native buttons with `aria-expanded`, allowing individual expand/collapse; a separate `aria-pressed` toggle shows the entire bounded preview and returns to focus mode. Memoized input snapshot identity resets full/expanded presentation immediately for changed before/after inputs. Every preview row remains reachable. Added/removed line counts include textual labels; truncated counts explicitly say Preview. Complete identical inputs say No changes; identical bounded prefixes say No changes in the displayed portion. Existing lineDiff limits and escaped React source rendering are unchanged.

Candidate review now has a compact heading, accepted/total progress counting only actual plan edit IDs, and numbered independent edit cards. Supported independent edits appear first; the duplicate overall comparison is inside a closed native details/summary disclosure. Both complete Markdown downloads and the long-preview warning remain outside that disclosure. An exported shared warning component keeps wording identical without dependencies or another theme. Indivisible/unsupported candidates retain the single primary shared diff. Existing indivisible scoped accept actions are preserved beside that diff, without a second copy of its content.

Acceptance callbacks, disabled/status rules, whole accept/discard visibility, candidate application and state-machine code remain unchanged. No changes to lineDiff algorithm, assistCandidate, assistTargets, AgentAssistPanel, PageEditor, backend, schema, dependency, theme, or bundle budget.

## Regression and verification evidence

All commands executed from `/Users/neomei/.codex/worktrees/document-workspace/AgentWiki /agentwiki` unless explicit work-tree arguments are shown.

1. Before MarkdownDiff implementation: `pnpm --filter @agentwiki/client exec vitest run src/components/markdown-diff/MarkdownDiff.spec.tsx` exited 1; 3 existing passed / 3 new failed. Failures demonstrated missing focused context, reset control, and preview count/honesty text.
2. Before candidate hierarchy implementation: `pnpm --filter @agentwiki/client exec vitest run src/features/page/AssistCandidateReview.spec.tsx --reporter=dot` exited 1; 5 passed / 2 failed for absent heading/progress hierarchy and duplicated indivisible diff.
3. First integrated run found 2 AgentAssistPanel failures because existing disabled indivisible scoped accept buttons were removed. Restored those original actions beside the primary diff; no panel/state changes.
4. Final command: `pnpm --filter @agentwiki/client exec vitest run src/components/markdown-diff/MarkdownDiff.spec.tsx src/features/page/AssistCandidateReview.spec.tsx src/features/page/AgentAssistPanel.spec.tsx src/features/review/ReviewPage.spec.tsx` exited 0: 4 files passed, 77 tests passed, 0 failed (2026-10-06 14:16 Asia/Shanghai; duration 1.12s).
5. `pnpm exec eslint apps/client/src/components/markdown-diff/MarkdownDiff.tsx apps/client/src/components/markdown-diff/MarkdownDiff.spec.tsx apps/client/src/features/page/AssistCandidateReview.tsx apps/client/src/features/page/AssistCandidateReview.spec.tsx` exited 0, no output.
6. `git --git-dir='/Users/neomei/.codex/worktrees/document-workspace/AgentWiki /.git' --work-tree='/Users/neomei/.codex/worktrees/document-workspace/AgentWiki ' diff --check -- agentwiki/apps/client/src/components/markdown-diff/MarkdownDiff.tsx agentwiki/apps/client/src/components/markdown-diff/MarkdownDiff.spec.tsx agentwiki/apps/client/src/features/page/AssistCandidateReview.tsx agentwiki/apps/client/src/features/page/AssistCandidateReview.spec.tsx` exited 0, no output.

Coverage includes late change after an 80-line prefix; exactly three context lines each side; reversible individual gaps/full mode; new-input resets; line and character truncation no-change honesty; preview-only counts; escaped HTML; English/Chinese labels; numbering/progress; accepted and conflict/read-only disabled actions; one callback per explicit acceptance; indivisible/unsupported primary diff; reversible full-comparison disclosure; warning/download visibility outside disclosure; downloaded Blob contents and filenames matching complete untouched inputs. Existing AgentAssistPanel and ReviewPage tests also pass.

## Self-review and remaining gates

- Diff/source audit confirms assigned-file-only product edits and original callback/disabled/status predicates preserved.
- All hidden preview rows are reachable through native controls; copy says full preview, never full document for truncated rows. The overall disclosure says full-document comparison while its content and warning explicitly remain bounded.
- Rendering continues to use `<code>{line.text}</code>`; no HTML injection API added.
- No known implementation concerns. Browser visual/keyboard acceptance, final client typecheck/build and bundle-budget verification remain controller gates; no claim of those checks is made here. The existing ~2.7 KB JS headroom was communicated, and code remains confined to the two small components.
