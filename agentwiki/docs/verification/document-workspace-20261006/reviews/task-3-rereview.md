### Spec Compliance

- ✅ Scoped I1 fix is compliant. The slash menu now uses a fixed body portal (`agentwiki/apps/client/src/components/MarkdownWorkspace.tsx:827`, `agentwiki/apps/client/src/index.css:70`) and measured viewport placement with a below/above decision, horizontal/top clamps and available-height/width constraints (`components/markdown-tools/menuPosition.ts:10-24`). This resolves the original unconditional below-caret placement in source.
- ✅ Placement uses actual rendered width and natural scroll height plus border; layout effect remeasures on document/window scroll, window resize and menu ResizeObserver, and cleans up all listeners/observer (`components/MarkdownWorkspace.tsx:436-461`).
- ✅ Up/Down selection is kept visible by adjusting only the menu's scrollTop from the selected option's measured bounds (`components/MarkdownWorkspace.tsx:463-471`). Existing source command dispatch, Escape/source preservation, focus recovery and composition guards are unchanged by this patch (`MarkdownWorkspace.tsx:473-482,827-838`).
- ⚠️ Actual bottom-edge desktop/narrow browser acceptance remains the controller's gate. This approval verifies the scoped repair and its tests, not a fresh live viewport run.

### Strengths

- The placement helper is small and deterministic and does not guess a fixed menu height (`components/markdown-tools/menuPosition.ts:3-26`). Tests reproduce the controller's 273px menu, a short fitting menu, narrow oversize menu and offscreen anchor (`menuPosition.spec.ts:4-17`).
- Mounted workspace tests verify portal containment, measured flip, resize/scroll recalculation, visible keyboard selection and unchanged source (`components/MarkdownWorkspace.spec.tsx:173-219`).

### Issues

#### Critical (Must Fix)

- None found.

#### Important (Should Fix)

- None found in this repair. Original I1 is resolved at the code/test gate; controller browser acceptance is pending.

#### Minor (Nice to Have)

- None reported.

### Assessment

**Task quality:** Approved for the scoped I1 repair.

**Reasoning:** The measured fixed portal addresses clipping by the viewport and ancestors, supports constrained scrolling and keeps keyboard feedback visible. No introduced source/undo/composition regression is evident in the patch.

### Review Evidence and Bounds

- Reviewed the fixed `c773037f..4dd0294a` package once and the updated Task 3 report. Scope was I1 placement plus introduced regressions only; no outside-source crawl, git commands, tests, code/index mutations or subagents. Only this report was written.
- Read `/tmp/document-task3-menu-verified.log`: 3 suites, 83 tests passed, 2.14s, no warnings. Did not rerun existing successful checks.
- `/tmp/document-task3-menu-final-typecheck.log` still records the historical sibling `assistTargets.ts:21` Array.at target error, not a passing rerun. The controller reports that Task 5's owner subsequently fixed this and obtained 51 passing tests plus clean typecheck. That newer result is controller evidence, not independently reverified here, and is outside the scoped Task 3 patch.
