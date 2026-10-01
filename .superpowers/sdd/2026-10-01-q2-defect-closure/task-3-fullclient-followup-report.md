# Task 3 full-client followup

Base: `5ad37040` (Task6 committed; Task7 held). Status: DONE.

## Scope and implementation

- Replaced only the 77 Todo entries' repeated source-name/key/English/Chinese literals in `system-collaboration-messages.ts` with a fixed ordered `[english, chinese]` tuple list. Existing exports `systemCollaborationKeys` and `systemCollaborationMessages` retain every key, every display value, and insertion order. Keys remain `collaboration.systemTodo.0..76`. Existing non-Todo system copy remains unchanged. No lazy loading, budget increase, copy reduction, or provenance changes.
- Updated the four old copy assertions across App.spec, PagePreview.spec, and SpaceWorkspace.spec to the actual `apiErrorMessage` safe copy. The same behavior/control/layout assertions remain: mounted page/section content, Retry, navigation removal on auth loss, no edit controls, and no leaked server text. Tests now additionally reject raw 503 and raw Space permission text. No product error logic changed.
- Controller explicitly expanded scope to mechanically replace `let terminal = false` with `let terminal: boolean;` in `useBoundedPolling.ts`. Both try and catch already assign the value before reading it. Poll budget, scheduling, disposal, cancellation, and termination behavior are unchanged; covered by existing polling/source/review tests. No mirrored implementation test added.
- Correct actual Todo count is 77 (earlier Task3 report said 78). No live server/remote/publishing operations, no subagents, and no changes to Task6/Task7 or controller dirty docs/memory.

## Evidence and exact commands

All commands executed from `/Users/neomei/.codex/worktrees/d35c/AgentWiki /agentwiki`. Log paths below are relative to `.superpowers/sdd/2026-10-01-q2-defect-closure/evidence/task-3-fullclient-followup/` in the repository root.

RED before any scoped edits:

```sh
pnpm --filter @agentwiki/client exec vitest run src/App.spec.tsx src/features/page/PagePreview.spec.tsx src/features/space-workspace/SpaceWorkspace.spec.tsx
pnpm --filter @agentwiki/client build
```

- `red.log`: exit 1, 3 files failed, **4 failed / 63 passed (67)**. The four failures were exact old-copy matches. Rendered controls and content already reflected the intended sanitized localized behavior.
- `build-red.log`: exit 1, **initial JavaScript 554817 > 550000 bytes**.

Catalog verification uses an esbuild-loaded snapshot of the original exports (`catalog-before.json`, source SHA `12434952e8b1eb523bf0178727832a53e41b8ab03c0b96f1eac9dfdef44cb65d` in `catalog-before.log`). Reproducible comparison:

```sh
node '../.superpowers/sdd/2026-10-01-q2-defect-closure/evidence/task-3-fullclient-followup/verify-catalog.mjs'
```

`catalog-equality.log`: exit 0, exact deep equality of keys and both-language messages and their key iteration order, **196 entries each, 77 Todo tuples**. Existing full-client tests also verify current seed coverage and unknown/copied/custom values stay untouched.

GREEN on the final implementation:

```sh
pnpm --filter @agentwiki/client test
pnpm --filter @agentwiki/client exec tsc --noEmit
pnpm --filter @agentwiki/client lint
pnpm --filter @agentwiki/client build
git --work-tree='/Users/neomei/.codex/worktrees/d35c/AgentWiki ' diff --check
```

- `fullclient-final.log`: exit 0, **116 test files / 1618 tests passed**.
- `typecheck-final.log`: exit 0, no diagnostics.
- `lint-green.log`: exit 0, no errors or warnings.
- `build-final.log`: exit 0, **initial JavaScript 546154 / 550000 bytes**; 3846 bytes below budget and 8663 bytes smaller than the RED candidate. Existing Mermaid circular-chunk and upstream lazy parser size warnings remain visible; no warning suppression or budget change.
- `diffcheck-final.log`: exit 0, no whitespace errors.

The first whole-client lint run (`lint.log`) reported exactly one unrelated `no-useless-assignment` error at useBoundedPolling.ts:15; the mechanical hunk above was authorized to resolve it. Scoped changed-file lint before that expansion (`scoped-lint.log`) exited 0. Existing behavior checks after the expanded mechanical hunk:

```sh
pnpm --filter @agentwiki/client exec vitest run src/features/source/useBoundedPolling.spec.tsx src/features/source/SourcesPage.spec.tsx src/features/source/RunsPage.spec.tsx src/features/review/ReviewPage.spec.tsx
```

`polling-focused.log`: exit 0, **4 files / 79 tests passed**. Earlier full-client/production build outputs (`fullclient.log`, `build-green.log`) are retained as intermediate evidence; final same-code gates above are authoritative.

## Self-review

Only the dictionary representation, four tests' stale text expectations, and the authorized one-line polling declaration changed. Snapshot comparison proves the i18n public API and content were preserved exactly. User/source/Agent names and custom values still bypass the system-only presentation map. No known scoped requirement remains deferred. Independent review and production/live acceptance remain controller responsibilities.
