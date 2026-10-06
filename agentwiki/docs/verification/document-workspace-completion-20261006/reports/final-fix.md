# Consolidated integration fix report

Status: product and test source frozen; ready for controller commit, scoped independent re-review, production build/budget and actual browser acceptance. No commit or browser/runtime mutation performed by this implementer.

Base: `bd83b1b73b35f78e399418329fad8a3841447a52`.
Actual route: session `01a110e6-ddf8-7692-af71-0646a759b927`, turn_context `2026-10-06T11:08:48.978Z`, model `p5c07ff/gpt-6-astra`, effort `ultra`. No override/fallback.

## Three findings addressed

1. **Selection through preview.** Nearest rendered-block geometry was treated as navigation even when automatic positioning, clamping or layout made a different block nearest. MarkdownWorkspace now reports a separate preview navigation flag. Wheel/touch/scroll-key/scrollbar gestures arm only the article and its scroll ancestors; a real changed scroll position is required. Directory, dialog and sibling-panel input do not arm it. Programmatic scroll/resize alone do not count. Outline clicks report the exact source target through a minimal optional intent callback while retaining the existing default outline scrolling. In-document anchors similarly identify explicit navigation. PageEditor retains the original cursor/bookmark when no deliberate navigation occurred; a deliberate different paragraph/heading still wins. Existing source and identity WeakMap proof and no-history selection restoration are unchanged.
2. **Mobile toolbar entry.** The negative absolutely positioned 38px tool row could wrap to 67px while reserving no extra source space. It now participates in normal document flow inside a flow-root. A 38px row still occupies the shared header gap; any wrapped height pushes source downward. No z-index overlap workaround, extra control width or source mutation. Actual 390px hit-test/click verification is the controller's production-browser gate, not a CSS-declaration mirror test.
3. **Directory reveal across loading unmount.** The selected page and independent desktop/drawer pending flags now live in a session-only provider registry keyed by user + Space, passed through SpaceView. Transient authorized-Space loading can remove/recreate Directory without losing that state. The same reveal logic still waits for authorized rows and measurable surfaces. A fresh provider/reload starts without transition state and respects persisted nonzero scroll. Preferences continue writing only the existing whitelist; neither the transition state nor source text is persisted. Same-page manual scrolling does not trigger reveal.

## Changed files

Under `agentwiki/apps/client/src/`:
- `components/MarkdownWorkspace.tsx`, `components/MarkdownWorkspace.spec.tsx`
- `features/page/PageEditor.tsx`, `features/page/PageEditor.spec.tsx`
- `features/space-workspace/ArticleContentsPopover.tsx`, `features/space-workspace/ArticleContentsPopover.spec.tsx`
- `features/space-workspace/SpaceDirectory.tsx`
- `features/space-workspace/SpaceWorkspaceContext.tsx`, `features/space-workspace/SpaceWorkspace.spec.tsx`
- `features/space-workspace/workspacePreferences.ts`
- `features/space/SpaceView.tsx`
- `index.css`

## Validation

- RED before product changes: both forward/reverse clamped preview roundtrips failed (`final-fix-selection-red.log`); actual SpaceWorkspace + SpaceView asynchronous page identity/unmount test failed to reveal the destination (`final-fix-directory-red.log`).
- First GREEN: the two selection cases, real wheel+scroll semantic paragraph navigation and asynchronous directory navigation/Back/reload/manual-scroll regression all passed (`final-fix-first-green.log`).
- Final focused validation: 7 suites / 316 tests passed (`final-fix-focused.log`). Includes forward/reverse selection and unchanged undo depth; keyboard/touch/wheel/scrollbar gesture plus actual movement; automatic and clamped scrolling; non-article gesture isolation; explicit clamped outline target; existing source/scope/permission and table guards; actual directory loading unmount on normal navigation and Back; initial reload/nonzero saved scroll and same-page manual scrolling; user/Space registry isolation and storage exclusion; existing directory/menu/ancestry coverage.
- Client `tsc --noEmit`: passed (`final-fix-tsc.log`).
- Scoped ESLint on all 11 changed TypeScript/TSX files: passed (`final-fix-lint.log`).
- Explicit-work-tree `git diff --check`: passed.
- jsdom lacks browser scrolling APIs. The new real-route test explicitly stubs and restores window.scrollTo/window.scrollBy; the explicit-outline test stubs its heading scrollIntoView and window.scrollBy. Production code was not changed for test-environment limitations.

## Remaining controller gates and boundaries

No full client suite, production build, budget adjustment, deploy, Save or browser actions performed here. Controller owns final build against unchanged budgets, scoped review and exact desktop/mobile reproductions of the three failures. No added dependency or changes to permission, treeRevision/expectedUpdatedAt, candidate application, table transaction, source-EOL fallback or persisted preference schema.

## Scoped review addendum: focused toolbar scroll keys

Base `18626a37`. The production browser exposed a remaining intent boundary: after Preview, focus stays on the mode toolbar button; End/PageDown scrolls the document from that focused button. The initial gesture filter excluded buttons and siblings of the article, so the scroll was ignored.

The minimal follow-up admits document scroll keys from the editor's main toolbar while still requiring a changed article/ancestor scroll position. Inputs, textareas, selects, editable controls, dialog/menu controls, button Space activation and non-navigation keys such as Enter remain excluded. Sibling directory/collaboration input remains outside the accepted surfaces. No source, identity proof or selection transaction behavior changed.

Only three incremental files changed: `MarkdownWorkspace.tsx`, `MarkdownWorkspace.spec.tsx`, `PageEditor.spec.tsx`. Two actual-focus + document-scroll regressions (End/PageDown) failed before the patch (`final-fix-keyboard-red.log`); 18 named focused cases now pass without warnings (`final-fix-keyboard-green.log`), including unchanged forward/reverse selection when the focused button's End key causes no scroll, excluded input/modal/menu/Enter/Space controls and prior paragraph navigation. Client tsc, three-file ESLint and explicit-work-tree diff-check passed. Logs: `final-fix-keyboard-tsc.log`, `final-fix-keyboard-lint.log`. No full suite, build, commit or browser operation performed by the implementer. All product and test source is frozen again for the same scoped review.
