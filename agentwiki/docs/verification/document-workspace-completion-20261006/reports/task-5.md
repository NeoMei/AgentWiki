# Task 5 implementation report

Status: **source frozen; ready for controller commit and independent review.**
Base supplied by controller: `e46939e0`.

## Actual inherited route

- Session `01a1109f-e226-7eb2-99df-699732669e73`, agent `/root/completion_table_design`.
- Actual latest implementation `turn_context`: `2026-10-06T10:45:00.589Z`, turn `01a110d1-15fc-7e40-96b8-d71241da839e`, model `p5c07ff/gpt-6-astra`, effort `ultra`.
- No model override, fallback, child agent, commit, production/API mutation, global editor EOL change or new dependency.

## Exact product/test ownership

New files:

- `agentwiki/apps/client/src/components/markdown-tools/tableEditing.ts`
- `agentwiki/apps/client/src/components/markdown-tools/tableEditing.spec.ts`
- `agentwiki/apps/client/src/components/markdown-tools/TableEditor.tsx`
- `agentwiki/apps/client/src/components/markdown-tools/TableEditor.spec.tsx`

Modified files:

- `agentwiki/apps/client/src/components/markdown-tools/DocumentTools.tsx`
- `agentwiki/apps/client/src/components/MarkdownWorkspace.tsx`
- `agentwiki/apps/client/src/components/MarkdownWorkspace.spec.tsx`
- `agentwiki/apps/client/src/features/page/PageEditor.tsx`
- `agentwiki/apps/client/src/features/page/PageEditor.spec.tsx`
- `agentwiki/apps/client/src/index.css`

No modifications to DocumentTools' server search behavior, existing hooks, backend, ContentTree, package/lockfile, plan, project memory or runtime. Controller-owned documentation changes visible in the shared checkout were not touched.

## Product behavior

- Source-based table detection uses existing remark-GFM offsets. Parsed locations are memoized by source; selection movement only locates a previously parsed range. Supported top-level rectangular GFM tables expose **Edit table / 编辑表格**; nested, ragged, oversized or cross-table selections expose **Table source / 表格源码** with a visible explanation on invocation. Fenced lookalikes do not expose the action.
- Reuses `ModalDialog` for inert background, focus trap, Escape and editor focus return. Labelled single-line textarea cells edit Markdown source, with explicit row/column add/remove/move and per-column alignment. Header stays fixed and at least one column remains; limits are 100 rows including header and 30 columns. The dialog uses its own bounded horizontal/vertical scroll region and wrapping controls for 390px.
- Multiline paste is prevented before textarea modification; a visible alert preserves the current draft. The change handler also rejects newline-bearing input, and Enter does not silently add or normalize a newline. No `type=text` newline stripping shortcut.
- Untouched rows and cells retain exact source bytes. A cell edit splices only its content range; alignment-only edits change only the affected separator token. Row moves preserve raw row formatting; column structure changes canonicalize only target-table rows. Clearing an edge cell in a table without outer pipes necessarily adds explicit row boundaries so the empty column is not lost.
- Escaped-pipe splitting uses backslash parity, including within inline code because GFM table parsing precedes inline parsing. Only new/edited unescaped pipes are escaped. Existing escapes, Markdown, Unicode whitespace, indentation, optional outer pipes and untouched alignment tokens are preserved.
- Open captures whole source, table span, active EditorView, immutable Text object and identity. Apply rechecks source, view, live readonly/editable facets, identity, mounted state and current table-edit permission. A source change followed by undo is conservatively stale too. There is one isolated CodeMirror table-range dispatch only after successful validation; unchanged/cancel paths dispatch nothing and create no history entry. Explicit Save remains separate.
- Minimal PageEditor wiring passes `notesWritable && !saving && !remoteUpdate && !unresolvedSocketRevisionRef.current` as `tableEditingEnabled`; the guard is live, not captured once. Permission loss and remote conflict while the dialog is open close it and invalidate late Apply.

## CRLF boundary: production refusal versus raw helper fidelity

- Pure table helper tests preserve CRLF, final-newline boundaries and all outside bytes. This does **not** mean production CRLF visual editing is supported.
- Current UIW/CodeMirror normalizes raw CRLF to an LF document; no global lineSeparator/display/navigation behavior was changed. Detection uses a normalized read-only copy so the current CM cursor still finds the table, but opening compares the untouched parent raw source to the live CM document.
- On mismatch, no table grid opens and no source transaction is dispatched. Visible bilingual feedback says this document's line endings cannot be preserved by the table editor and directs the user to Markdown source editing.
- Real Workspace tests cover both all-CRLF and mixed EOL input, asserting visible fallback, no onChange and no increase from the initial CM history depth. The existing UIW controlled initialization can already create a normalization history entry, so the test compares the baseline rather than incorrectly claiming initial history depth zero. The raw parent value remains untouched by this action.
- Controller still needs the planned production check: click the table action in a CRLF fixture, confirm visible fallback, Save still disabled and stored API source unchanged. No browser or API acceptance is claimed by this report.

## RED / GREEN and final checks

1. Helper behavior tests first ran against explicit unimplemented stubs: **26 failed** at 18:47:09 (+08:00), demonstrating missing detection, edits, refusal and corpus fidelity. Implemented helper: **26 passed** at 18:48:05. A preceding missing-import run was only setup failure, not counted as behavioral RED.
2. Dialog tests first ran against a nonrendering component: **4 failed** at 18:49:19; implementation then produced **30 passed** across helper/dialog at 18:50:33.
3. Workspace integration tests before wiring: **9 failed** at 18:51:44. Initial integration exposed incorrect test assumptions about existing CRLF initial history depth; corrected to assert no increase/no callback. Added readonly, source-reparse and unsupported-table tests: **12 passed** at 18:52:42.
4. PageEditor permission loss / remote conflict after opening: **2 passed** at 18:53:54. Static checks caught test-only `String.replaceAll` exceeding the ES2020 lib; changed tests to regex replacement without altering compiler settings.
5. Added Unicode/edge-cell, backslash parity/indentation and column/header bounds. Empty edge cells without outer pipes produced a meaningful RED at 18:55:31; bounded affected-row fallback fixed it. Helper now **29 passed**, including all 17 source fixtures.
6. Final no-op/cancel regression additionally spies on real view.dispatch and observes zero calls. A real CM isolated undo test proves exact restoration with prior human typing retained.

Final commands from `/Users/neomei/.codex/worktrees/document-workspace/AgentWiki /agentwiki`, final tests started **2026-10-06 18:58:02 +08:00**:

```text
pnpm --filter @agentwiki/client exec vitest run src/components/markdown-tools/tableEditing.spec.ts src/components/markdown-tools/TableEditor.spec.tsx src/components/markdown-tools/DocumentTools.spec.tsx src/components/MarkdownWorkspace.spec.tsx src/features/page/PageEditor.spec.tsx
PASS: 5 files, 264 tests. No final warnings/errors.

pnpm --filter @agentwiki/client exec tsc --noEmit
PASS

pnpm exec eslint apps/client/src/components/markdown-tools/tableEditing.ts apps/client/src/components/markdown-tools/tableEditing.spec.ts apps/client/src/components/markdown-tools/TableEditor.tsx apps/client/src/components/markdown-tools/TableEditor.spec.tsx apps/client/src/components/markdown-tools/DocumentTools.tsx apps/client/src/components/MarkdownWorkspace.tsx apps/client/src/components/MarkdownWorkspace.spec.tsx apps/client/src/features/page/PageEditor.tsx apps/client/src/features/page/PageEditor.spec.tsx
PASS

git --work-tree='/Users/neomei/.codex/worktrees/document-workspace/AgentWiki ' diff --check
PASS
```

No full-client rerun or build performed; no bundle-budget change. Remaining independent review, production desktop/390px cell/add-row/add-column/cancel/undo/fallback checks, full validation and branch integration belong to controller.
