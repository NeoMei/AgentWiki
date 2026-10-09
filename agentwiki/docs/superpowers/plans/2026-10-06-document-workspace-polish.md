# Document workspace polish — second round

Goal: continue the approved OpenKnowledge-inspired document workspace with readable candidate review and a practical private note queue.
Spec: existing approved `agentwiki/docs/research/openknowledge-20261006/借鉴分析与改造建议.md`; user requested continuing optimization. These are bounded UI refinements within that scope.
Baseline: `28e07dbd14dfe49ecfbb3ce503debf073d573241`, branch `codex/document-workspace`.

## Global Constraints

- Active root `/Users/neomei/.codex/worktrees/document-workspace/AgentWiki ` has a literal trailing space. Use explicit Git work-tree, never change core.worktree.
- Keep existing single Markdown canvas, brand and components. All new UI copy bilingual through useLanguage, keyboard accessible, narrow-screen usable. No new dependency or theme.
- Preserve raw Markdown source and bounded diff processing (300 lines / 100,000 characters). Incomplete previews and their statistics must remain explicitly partial. Do not claim invisible changes are absent.
- Agent output remains a candidate. Existing identity, scope, version, permission, exact-anchor and isolated undo checks remain authoritative. No auto-accept/save, no schema/backend changes.
- Personal notes stay browser-local, user/Space/page scoped. Preserve status and conservative note-resolution logic; only selection/filter UI state may change.
- Implementers edit only their task files, do not commit or spawn agents. Controller commits exact files and arranges independent reviews.
- Add meaningful behavioral regression tests; visual styles checked in browser, not class-assertion tests. Do not raise bundle budgets.

### Task 1: Focused diff and candidate review hierarchy

Files: `agentwiki/apps/client/src/components/markdown-diff/MarkdownDiff.tsx`, adjacent focused helper/spec if useful; `agentwiki/apps/client/src/features/page/AssistCandidateReview.tsx` and spec. No changes to diffLines algorithm, assistCandidate application/state machine, AgentAssistPanel or PageEditor.

- [x] Default preview focuses on changes with three neighboring unchanged lines on each side. Represent omitted unchanged runs with keyboard-accessible expand controls; provide full-preview/context toggle, keeping all rows reachable. No-change complete input says no changes; truncated prefix with no visible changes must say no changes in the displayed portion, not entire document.
- [x] Show added/deleted preview counts with textual labels and preserve escaped source rendering. Full context is the bounded preview, never mislabel truncation as full document. Reset expansion/mode when before/after changes to avoid stale presentation.
- [x] Candidate review has a compact heading, accepted/total change progress for supported independent edits, and clearly numbered change cards. Present those edits first without repeating an expanded whole-document diff; offer the full-document comparison behind a disclosure. Indivisible/unsupported candidate still uses primary shared diff.
- [x] Keep both original/candidate downloads reachable, existing accepted/disabled/status rules intact, whole accept/discard visible, one accept callback per explicit action. Downloads and long-preview warnings never hidden solely by the optional disclosure; ensure truncation visible for indivisible candidate.
- [x] Tests: late change after long unchanged prefix visible initially, expanded context reversible, rerender fresh state, preview-only count/no-change honesty, HTML escaped, independent accepted progress/disabled action, indivisible and conflict/read-only behavior. Run affected MarkdownDiff, AssistCandidateReview, AgentAssistPanel and ReviewPage tests.

### Task 2: Usable private note queue

Files: `agentwiki/apps/client/src/features/page/PersonalNotesPanel.tsx`, `PersonalNotesPanel.spec.tsx`; existing `PageEditor.spec.tsx` integration assertions select All before checking resolved notes. No hook/state machine/storage/PageEditor product API change.

- [x] Add lightweight All / Open / Resolved filters with counts (Open includes pending, dispatched, awaiting-review); default Open. Give meaningful empty states, state badges and existing privacy/storage warnings.
- [x] Make eligible pending selection usable: select all eligible notes in the visible filter and clear selection; show actual selected eligible count and move batch action above the long list. Switching filter clears selection to avoid invisible sending.
- [x] Reconcile stale selection after note status/removal/source changes so dispatched, resolved, removed or unanchored notes cannot poison later batches or silently become selected on reopen. Existing notesForDispatch remains the final guard, and dispatch still contains only explicit selected eligible ids. Permission-disabled controls remain disabled. Clearing or selecting must never call onDispatch.
- [x] Keep quote composer accessible and compact: hide textarea when no target and no unfinished body, show selection guidance; don't erase typed body when selection changes. Preserve orphan quote visibility/reason and reopen actions. Keep long body/quote bounded/wrapped without horizontal overflow.
- [x] Tests: choose/send A, A becomes dispatched, choose/send B; removal/stale source then reopen doesn't resurrect selection; filter change cannot send hidden notes; select-all skips disabled/stale/status-ineligible notes; no auto-dispatch; disabled/empty and bilingual state/selection feedback. Run PersonalNotesPanel, usePersonalNotes, reviewComments and PageEditor suites.

## Final acceptance

- [x] Independent task review after each implementation, strongest-model final whole-branch review including this round and first-round context.
- [x] Full client tests, repo typecheck/lint, client production build with unchanged budget gate.
- [x] Isolated local API + disposable fixtures; real UI desktop and 390px, review candidate late edit + expand context + accept/undo; note add/filter/select/send/reopen as feasible. Simulated Agent output explicitly labelled; do not claim live provider.
- [x] Preserve reviewed receipts/screenshots and project handoff, cleanup own runtime/auth/scratch; no merge/push/deploy.
