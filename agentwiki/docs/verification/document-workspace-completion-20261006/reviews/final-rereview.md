# Consolidated fix scoped re-review

Status: **final and frozen**. Initial fix `bd83b1b7..18626a37` and its minimal follow-up `18626a37..213a2aae` have been reviewed. This approves the scoped source fix wave `bd83b1b7..213a2aae`; final production acceptance remains the controller's separate gate.

## Finding Verdicts

- **Automatic preview positioning discards an unchanged selection — ADDRESSED.** `agentwiki/apps/client/src/features/page/PageEditor.tsx:591-596` now preserves the original cursor/bookmark unless preview reports deliberate movement. `MarkdownWorkspace.tsx:519-565,685-686` separates gesture-plus-scroll from automatic geometry and carries explicit outline/anchor targets. The controller confirms real forward 0→23 and reverse 23→0 selection roundtrips now pass, with zero CodeMirror editors in preview and one after return; explicit outline navigation to the long-document section returns a collapsed cursor at that heading.
- **Wrapped mobile toolbar is covered by CodeMirror — ADDRESSED.** `agentwiki/apps/client/src/index.css:84-87` replaces absolute negative placement with a normal-flow tool row inside a flow-root, reserving the actual wrapped height instead of raising z-index over the editor. The controller's 390px hit test now resolves to the button and its click opens the table dialog; no-op and Escape leave Save disabled, Escape returns focus to CodeMirror, and a mobile cell edit plus one undo restores exact source.
- **Real page navigation loses directory reveal across loading unmount — ADDRESSED.** `agentwiki/apps/client/src/features/space-workspace/SpaceWorkspaceContext.tsx:45-58,133` retains session-only selection state by user+Space and `features/space/SpaceView.tsx:648` supplies it to the directory. `SpaceDirectory.tsx:95-96,139-155` compares destination selection against that surviving state. The actual asynchronous SpaceWorkspace/SpaceView route regression at `SpaceWorkspace.spec.tsx:319-388` covers forward navigation, Back, same-page manual scroll and fresh-provider reload; `:135-158` verifies account/Space separation and persistence exclusion. The controller reports real Back navigation from tree scroll 5157 now reveals the row at y355–395 with scroll 178; a separately chosen manual scroll 2338 survives reload.
- **Keyboard page navigation is ignored while the preview toolbar retains focus — ADDRESSED by the same-wave follow-up.** `agentwiki/apps/client/src/components/MarkdownWorkspace.tsx:528-541` now admits article paging keys from the editor toolbar, while rejecting typing controls, contenteditable, menu/dialog controls, button Space activation and non-navigation keys. `:542-545` still requires actual movement of an article ancestor; directory/collaboration targets remain excluded. Actual-focus End/PageDown regressions start at `MarkdownWorkspace.spec.tsx:1389`; input/modal/menu/Enter/Space exclusions start at `:1411`. `PageEditor.spec.tsx:1172-1189` verifies a focused toolbar End that cannot scroll still retains both selection directions and history. The controller's final `213a2aae` production retest passes: focus stays on Return to edit, End moves scroll 608 → 2979.5, and return collapses the cursor at paragraph 47 in the new viewport. A no-navigation reverse 23→0 roundtrip on the same build still preserves the complete selection; copied source matches the baseline and Save remains disabled.

## New Breakage in the Fix Diff

- None remaining. The first fix's keyboard-focus P2 was confirmed by the controller (End scrolled 608 → 3148.5 but restored the old selection), then closed by the minimal follow-up reviewed above. No additional Critical, Important or Minor breakage was found in that incremental diff.

## Out-of-Scope Observations

- None. No untouched-code review was reopened.

## Checks and Evidence

- Own resumed `turn_context` verified at `2026-10-06T11:20:36.852Z`, session `01a110e0-4940-7f93-bef8-a581e2a97b1d`, model `p5c07ff/gpt-6-astra`, effort `ultra`; no override/fallback.
- Read the scoped re-review instructions, prior three findings, `final-fix-report.md` and supplied 963-line fix package once in three sequential sections. No Git commands, product/test edits, commits or subagents.
- Read actual final-fix-focused.log: 7 files / 316 tests passed, no warnings; final-fix-tsc.log and final-fix-lint.log are clean. These were reviewed logs, not repeated suite runs. The controller separately reports build/typecheck passed and initial JS 548,576 / 550,000 with budgets unchanged.
- Requested one concrete browser check for the keyboard-focus risk rather than rerunning a suite; the controller's real focus/scroll/selection observations confirmed the new P2.
- Read only `review-18626a37..213a2aae.diff` and the fix-report addendum for the final increment, without repeating the initial fix or whole-delta review. Read actual keyboard GREEN log: 18 passed / 220 skipped across the two targeted suites; keyboard tsc/eslint logs are clean. The report records two meaningful RED tests before that patch. No suite or static check was rerun by this reviewer.
- Controller browser observations above validate the original three reproduced defects and the final production keyboard scenario. The controller reports final `213a2aae` client validation at 135 suites / 2,006 tests and production build at 548,576 / 550,000 initial JS. These are controller results, not independent reruns. No-save API readback and runtime cleanup remain controller-owned and are not claimed complete here.

## Verdict

**Fix round: All findings addressed, no new Critical/Important breakage.** Original three P2 findings and the same-wave keyboard-focus P2 are closed in the reviewed source. Scoped quality is **Approved**; final runtime acceptance remains a separate gate.
