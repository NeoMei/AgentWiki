# Task 3 implementation receipt

2026-10-06. Implemented after controller activation at baseline `83c990b7`; source frozen for independent review. No commit, subagent, runtime lifecycle change, full-client/full-repo suite, build-budget change, or unassigned product edit.

## Actual route

`/root/completion_runtime`, thread `01a1109e-9099-77c2-ab80-4b0b922e58b3`. This implementation turn's actual `turn_context` at `2026-10-06T10:13:12.968Z` reports `p5c07ff/gpt-6-astra`, effort `ultra`, turn `01a110b3-fa55-7530-82e3-0c3c287fa75f`. No explicit model override or fallback.

## Product behavior

- Added backward-compatible optional outlineOpen/outlineWidth/collaborationOpen/collaborationTab/collaborationWidth to the existing user+Space v1 preference record and in-memory registry. Missing outlineOpen remains automatic; desktop defaults to open only at >=1600. Widths are finite and clamped to outline 200–360 and collaboration 320–520. The writer explicitly serializes only recognized UI fields; candidate/note/source/request payloads are not persisted.
- Outline explicit desktop close/open survives pages, modes, remount and viewport changes. Below 1024 it begins as a closed temporary drawer; its mobile open/dismiss never overwrites desktop choice or width. Empty headings and collaboration suppression hide the UI without writing closed preference. Escape while headings are absent does not intercept unrelated UI or erase the choice. Suppressed Contents trigger is disabled with bilingual explanation.
- Collaboration restores desktop tab/open/width only for matching user+Space and live authorized page, and suppresses notes/actions immediately on permission loss. Mobile opening/closing is temporary. Reading leaves the editor-specific preference available for returning to edit.
- Replaced overlapping assist/notes visibility setters with deliberate open/close actions. Notes-only also suppresses outline. The existing candidate panel remains mounted when closed or switching tabs, while route/user/Space identity still resets candidate/request lifecycle. Restoring display preferences does not submit a task, accept a candidate, mutate Markdown or Save.
- Added one small shared PanelResizeHandle with left-edge grip, pointer capture, correct right-panel resize direction, wrong-pointer/cancel/lost-capture handling, ArrowLeft/ArrowRight/Home/End, and separator ARIA metadata. Desktop panel dimensions also cap against viewport/document left edge; forced display clamp is not persisted. Below 1024 no resize grip is present. When there is insufficient desktop space for minimum panel plus exposed document allowance, it behaves as an overlay without a resize grip.
- Document canvas width/typography and CodeMirror source transactions are unchanged. Collaboration uses an inner scrolling element so the resize grip remains reachable; mobile panels stay within viewport bounds.

## Assigned files changed

`apps/client/src/`:

- `features/space-workspace/workspacePreferences.ts` and `.spec.tsx`
- `features/space-workspace/SpaceWorkspaceContext.tsx`
- `features/space-workspace/ArticleContentsPopover.tsx` and `.spec.tsx`
- New `features/space-workspace/PanelResizeHandle.tsx` and `.spec.tsx`
- `features/page/PageEditor.tsx` and `.spec.tsx`
- `features/page/PagePreview.tsx` — only outline Space identity wiring
- `components/MarkdownWorkspace.tsx` — only outline Space/suppression wiring
- `index.css` — scroll wrapper/grip styles

Controller's preexisting plan/project-memory/research changes were not modified.

## RED and validation

Commands ran from `/Users/neomei/.codex/worktrees/document-workspace/AgentWiki /agentwiki` (literal trailing space before `/agentwiki`). Logs are under this task's scratch directory.

1. **Meaningful RED:** initially added old-record/new-field expectations, explicit outline close across page/viewport, and scoped collaboration tab/width restoration before implementation. Running preferences/outline/PageEditor returned **3 failures / 137 passes**, matching those gaps. Log `task-3-red.log`.
2. First implementation run exposed an outline first-mount placement problem: default-open state was true before heading discovery and the position effect did not rerun when the trigger became available. Fixed by tracking heading count/readiness. Initial client tsc caught missing explicit PanelPreferences annotation for empty fallback; corrected without weakening types.
3. Expanded focused validation: **6 suites / 266 tests passed**, 5.44s (`task-3-focused.log`, 18:25:31 local). Covers preferences/context, outline, resize, PageEditor, PagePreview and MarkdownWorkspace. The permission-loss regression uses the real NavigationGuardProvider/data router so existing dirty-navigation behavior remains asserted; no guard was relaxed.
4. A final narrow correction prevents Escape interception while outline headings are absent. Its affected outline suite was rerun: **17/17 passed**, 0.674s (`task-3-outline-final.log`, 18:26:42 local). This overlaps the 266 and is not an additive test total.
5. Final `pnpm --filter @agentwiki/client exec tsc --noEmit` passed, exit 0 (`task-3-typecheck.log`).
6. Final scoped ESLint passed, exit 0 (`task-3-eslint.log`), covering all changed TS/TSX files. `git --work-tree='…/AgentWiki ' diff --check` passed.

Focused command:

```sh
pnpm --filter @agentwiki/client exec vitest run \
  src/features/space-workspace/workspacePreferences.spec.tsx \
  src/features/space-workspace/ArticleContentsPopover.spec.tsx \
  src/features/space-workspace/PanelResizeHandle.spec.tsx \
  src/features/page/PageEditor.spec.tsx \
  src/features/page/PagePreview.spec.tsx \
  src/components/MarkdownWorkspace.spec.tsx
```

New behavior coverage includes account/Space isolation/remount and storage failure; malformed/missing widths/tab/open; explicit outline close and headings absent; mobile->desktop preference preservation; suppression without overlap; keyboard/pointer resize bounds and cancellation; actual overlay clamp without stored-width overwrite; remembered notes permission revocation; candidate DOM mount continuity and page identity reset; no automatic task submission/source edit/save.

## Remaining controller gates

Independent Task3 review, final integrated review, full-client/static/build gates, unchanged initial bundle budget, and actual desktop/390px browser acceptance belong to controller. No browser or final build success is claimed here. Runtime remains running and untouched during this implementation turn.
