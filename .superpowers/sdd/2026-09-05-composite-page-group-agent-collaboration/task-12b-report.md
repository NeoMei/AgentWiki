# Task 12b report — template management, Folder snapshot save, and explicit legacy upgrade UI

## Outcome

Implemented the client-side Task 12b slice on base `5b037b4b9bcbbfaaed4c4c0cf9ac0f091eb41c2b`.

The UI purpose is one guided path for reusable Page structures: owners/admins can save a real Folder snapshot, manage single-Page and composite templates in one bounded catalog, and explicitly upgrade an old custom collaboration workflow by choosing a real Folder and mapping every Markdown task to a retained Page.

The UI skeleton reuses the existing `ContentTree` action row, `ModalDialog`, Tailwind styles, `TemplateTreePreview`, and `FlowStepEditor`. `CompositeDefinitionEditor` is the only new bounded shared editor: it preserves stable node IDs, real parents/order, localized Folder/Page fields, explicit task targets, and surfaces broken workflow/human-gate references. Upgrade mode keeps the canonical legacy workflow read-only; composite new-version mode may edit it through the existing structured `FlowStepEditor`. No canvas or second component system was added.

## Implemented behavior

- Added composite client API/types for the unified bounded catalog, exact management reads, CAS writes, Folder preview/save/provenance, canonical legacy source, preview/upgrade, and existing Page/Folder binding seams.
- Kept the exact management-read shape (`templateId/version`) distinct from composite mutation results (`id/resultVersion`) per the Task 12a fix contract.
- Added `SaveFolderAsTemplateDialog`:
  - server-persisted Markdown and server `sourceToken` are the source of truth;
  - authoritative full runtime-ID inventory survives prune → refresh → reinclude;
  - `SOURCE_CHANGED` refresh reconciles by actual IDs, preserves surviving exclusions/duties, and reports disappeared IDs;
  - structure-only, explicit simple-Page duties, exact composite origin, and selected legacy workflow sources;
  - exact origin is discovered automatically and disabled/explained when absent;
  - legacy source uses the existing template catalog, canonical source read, and task-to-retained-Page selects—no raw version/template/task mapping fields;
  - attachment/resource non-copy warning requires acknowledgment; Agent/grant/credential/Run IDs are never authored into the definition.
- Added owner/admin/super-admin Folder-row entry in `ContentTree`/`SpaceView`, passing the exact Folder and opener for modal focus return. Editor/viewer do not receive the action.
- Added `UpgradeWorkflowTemplateDialog` with a real Folder snapshot, canonical legacy version/hash, explicit task targets, preserved human-gate validation issues, read-only legacy workflow, and exact `resultVersion` display on replay.
- Marked old custom collaboration templates “Pending upgrade”, added the explicit upgrade action, and retained their existing legacy Start and edit/archive paths.
- Extended `PageTemplateManager` to consume the unified catalog with independent kind/scope/category/search/archive filters and bounded pagination, including authoritative unified refresh if a page makes no progress.
- Composite metadata/version/archive/restore use the composite CAS APIs. New versions preserve the nested definition and mappings instead of flattening through `sourcePageId`. Archived composite definitions can be inspected; system templates remain read-only. Existing single-Page management behavior remains covered.
- Added stable English and Simplified Chinese copy and mappings for Task 12b conflict/not-found/warning business codes.

## TDD evidence

Focused RED/GREEN loops:

1. `pnpm --filter @agentwiki/client exec vitest run src/features/page-templates/compositeTemplateApi.spec.ts`
   - RED: 3 failed / 4 passed (missing API seams).
   - GREEN: 7/7.
2. `pnpm --filter @agentwiki/client exec vitest run src/features/page-templates/SaveFolderAsTemplateDialog.spec.tsx`
   - RED: missing dialog, then 2 failed / 5 passed for raw-ID source controls.
   - Additional RED: 2 failed / 6 passed for automatic exact-origin disable/explanation.
   - GREEN: 8/8.
3. `pnpm --filter @agentwiki/client exec vitest run src/features/page-templates/compositeDefinitionEditor.spec.tsx`
   - RED: missing editor.
   - GREEN: 3/3.
4. `pnpm --filter @agentwiki/client exec vitest run src/features/page-templates/UpgradeWorkflowTemplateDialog.spec.tsx`
   - RED: missing dialog.
   - GREEN: 3/3.
5. `pnpm --filter @agentwiki/client exec vitest run src/features/collaboration/CollaborationWorkspace.test.tsx -t "marks custom legacy"`
   - RED: pending-upgrade marker/action absent.
   - GREEN: 1/1.
6. `pnpm --filter @agentwiki/client exec vitest run src/features/page-templates/PageTemplateManager.composite.spec.tsx`
   - RED: 3/3 composite catalog/management tests failed against the old manager.
   - GREEN after implementation: 4/4, including the added pagination recovery case.
7. `pnpm --filter @agentwiki/client exec vitest run src/features/content-tree/ContentTree.spec.tsx src/features/space/SpaceView.spec.tsx`
   - RED: 3 failed / 20 passed (Folder save entry absent).
   - GREEN: 23/23.
8. `pnpm --filter @agentwiki/client exec vitest run src/features/page-templates/PageTemplateManager.composite.spec.tsx -t 'refreshes through the unified catalog'`
   - RED: expected 3 unified calls, received 2 because the recovery path incorrectly called the legacy list API.
   - GREEN: 1/1 (3 skipped by focus).
9. `pnpm --filter @agentwiki/client exec vitest run src/api/error-message.spec.ts -t 'maps Task 11 code'`
   - RED: 4 translated Task 12b business codes fell through to the generic error.
   - GREEN: 15 passed / 16 skipped by focus.
10. Self-review locale fix: `pnpm --filter @agentwiki/client exec vitest run src/features/page-templates/compositeDefinitionEditor.spec.tsx -t 'uses the active locale'`
   - RED: task-target Page options used the English label while the editor was in `zh-CN`.
   - GREEN: full editor suite 4/4 after passing the active locale into the shared task-target selector; the test also keeps the other Page locale intact.

Final focused regression:

```text
pnpm --filter @agentwiki/client exec vitest run \
  src/features/page-templates/compositeTemplateApi.spec.ts \
  src/features/page-templates/compositeDefinitionEditor.spec.tsx \
  src/features/page-templates/SaveFolderAsTemplateDialog.spec.tsx \
  src/features/page-templates/UpgradeWorkflowTemplateDialog.spec.tsx \
  src/features/page-templates/PageTemplateManager.composite.spec.tsx \
  src/features/page-templates/PageTemplateManager.spec.tsx \
  src/features/collaboration/CollaborationWorkspace.test.tsx \
  src/features/content-tree/ContentTree.spec.tsx \
  src/features/space/SpaceView.spec.tsx \
  src/api/error-message.spec.ts

10 files passed, 144/144 tests passed (fresh after the self-review fix).
```

## Full client and static verification

- `pnpm --filter @agentwiki/client test`
  - 92 files passed, 1192/1192 tests passed.
  - This full run preceded the one-test self-review locale addition; the affected suite was then rerun 4/4 and the complete 10-file focused set rerun 144/144 on the final code.
- `pnpm --filter @agentwiki/client exec tsc --noEmit`
  - exit 0.
- `pnpm --filter @agentwiki/client lint`
  - exit 0.
- `pnpm --filter @agentwiki/client build`
  - exit 0; 4753 modules transformed and Vite built successfully.
  - Known warning only: existing Rollup/Vite warning that some minified chunks exceed 500 kB.
- `git --work-tree='/Users/neomei/.codex/worktrees/69d8/AgentWiki ' diff --check`
  - clean.

## Integration hooks and boundaries

- Task 12c can continue using `listCompositeTemplates` and the unified template records; old custom collaboration cards now expose their explicit upgrade entry while preserving legacy Start.
- The resulting composite template is returned through `onUpgraded` with the immutable `resultVersion`; the dialog displays that exact version even if `currentVersion` has advanced.
- The Folder save entry is intentionally limited to owners/admins/platform super-admins, matching server management capability. The server remains authoritative.
- This task verified component/code behavior only. It did not run real Chrome, external-Agent, production, push, or npm acceptance and does not claim those gates.

## Self-review / concerns

- Reviewed source serialization: Folder save sends only selection, server source token, warning acknowledgments, metadata, and role abstractions; no client Markdown or concrete Agent/grant/credential/Run state is serialized.
- Reviewed upgrade serialization: `LegacyWorkflowUpgradeInput` contains canonical version/hash plus nodes/taskTargets and never a modified workflow; the workflow editor is disabled in upgrade mode.
- Reviewed manager compatibility: all 39 existing single-Page manager tests pass alongside 4 composite tests; archived exact-version inspection and CAS writes use the Task 12a routes.
- Self-review found and fixed one localization defect in task-target Page option labels; the focused editor, TypeScript, lint, build, and final focused regression were rerun on the fix.
- No known functional blocker remains. The build chunk-size warning is pre-existing/non-blocking. Independent code review is requested separately before controller integration.

## Fix round 1 — independent review findings 1–4

Base: `0a85b9ba955709dc19a413d68d3d62ea85853401`. Finding 5 was withdrawn after controller verification because artifact-only/research Markdown tasks may legally remain unmapped in generic composite definitions; no blanket mapping rule was added.

Implemented:

- Folder-save refresh now fetches the full runtime-ID inventory with an independent `structure_only` preview, so a stale legacy mapping cannot prevent reconciliation. Excluding or losing a mapped Page clears that mapping and the stale preview/token; re-including the Page still requires explicit remapping before save.
- Composite conflict reload follows the stale response's `currentVersion` to its exact immutable definition, replaces the local draft only on that explicit user action, and accepts the result only when `version === currentVersion`. If the head moves again during the bounded two-read reload, the original draft/conflict remains and another explicit reload is required.
- Composite detail, create-version, and conflict-reload work is guarded by Space + template ID + dialog epoch. Opening/closing/switching dialogs invalidates earlier success/error callbacks, including same-Space A→B races.
- Legacy canonical reload replaces the read-only workflow with the newly fetched definition, preserves task targets only for matching task IDs, removes stale task targets, and visibly lists added/removed canonical tasks.

TDD evidence:

```text
pnpm --filter @agentwiki/client exec vitest run \
  src/features/page-templates/SaveFolderAsTemplateDialog.spec.tsx \
  src/features/page-templates/PageTemplateManager.composite.spec.tsx \
  src/features/page-templates/UpgradeWorkflowTemplateDialog.spec.tsx

Initial behavioral RED: 4 failed / 15 passed, one failure per review finding.
The initial CAS test needed one locator/timing correction (`Reload` -> actual `Reload template`, and await rejected create/rendered conflict) before it represented the intended semantic failure; it then proved the old implementation could pair the stale definition with a newer CAS head.
Final GREEN: 3 files passed, 20/20 tests passed.
```

Fresh final verification after all fix-round changes:

- `pnpm --filter @agentwiki/client exec vitest run src/features/page-templates/PageTemplateManager.spec.tsx src/features/page-templates/PageTemplateManager.composite.spec.tsx src/features/page-templates/SaveFolderAsTemplateDialog.spec.tsx src/features/page-templates/UpgradeWorkflowTemplateDialog.spec.tsx src/features/page-templates/compositeDefinitionEditor.spec.tsx src/i18n/messages.spec.ts`
  - 5 discovered files passed (`src/i18n/messages.spec.ts` does not exist and is not discovered), 63/63 tests passed; this includes all 39 existing single-Page manager tests.
- `pnpm --filter @agentwiki/client test`
  - 92 files passed, 1198/1198 tests passed in 12.23s.
- `pnpm --filter @agentwiki/client exec tsc --noEmit`
  - exit 0.
- `pnpm --filter @agentwiki/client lint`
  - exit 0.
- `pnpm --filter @agentwiki/client build`
  - exit 0; 4753 modules transformed, built in 5.18s.
  - Known warning only: existing Vite warning for minified chunks over 500 kB.
- `git --work-tree='/Users/neomei/.codex/worktrees/69d8/AgentWiki ' diff --check`
  - clean before commit.

Fix-round self-review found one local state issue introduced by the epoch guard: successful composite creation invalidated the dialog epoch before `finally` could clear `submitting`. The success path now clears it before catalog invalidation; focused, full-client, type, lint, and build verification above include this correction.

No additional scope or backend API was added. Verification remains code/component tests and static build only; no real Chrome, external-Agent, production, push, or npm acceptance is claimed. Task 12c hooks remain the unified `listCompositeTemplates` catalog and explicit legacy upgrade entry/result.
