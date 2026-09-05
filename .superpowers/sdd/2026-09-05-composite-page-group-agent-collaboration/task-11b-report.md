# Task 11b implementation report

## Status

DONE

## Base and scope

- Base: `075ff7ee7deabc33c25cb3f534ea4699d33a7743`.
- Implemented only the Task 11 client UI: unified composite creation, optional collaboration configuration, result handoff, late Page/Folder binding, shared Run join prompts, i18n, error mapping, and focused tests.
- Reused the existing `ModalDialog`, Tailwind language, `RoleBindingEditor`, `AgentPreparationDialog`, and the original `buildAgentJoinInstructions` prompt and role-merging algorithm. `RunStartWizard` retains its old helper export while new consumers import the extracted shared module directly.
- Did not implement Task 12 template management/review/upgrade UI or Task 13 policy/effects/real-Agent acceptance. No server, schema, worker, attachment, Sync, npm, push, deploy, or production changes are included.

## Result

- `NewPageDialog` now presents independently server-filtered scope and kind choices, bounded catalog pagination (`take=100` plus load-more), complete semantic hierarchy preview, explicit locale/root name, and ordinary blank-page fallback when both catalogs fail.
- The composite phase reducer owns legal `select -> preview -> configure -> submitting -> result` transitions; legacy blank/single-page creation keeps the isolated `legacy-details` compatibility branch. Collaboration stays off by default and the off payload omits `collaborationInputs`, `roleBindings`, and `enabledTaskNodeIds`.
- Collaboration-on configuration renders required workflow inputs, enabled task selection, disabled ineligible Agent options with translated reasons, Agent preparation, task-to-role binding conversion, and the authoritative deduplicated participant preview. Human Space members are excluded from Agent option lists.
- Instantiation uses the preview `treeRevision`, exact version/locale/parent, and a guarded idempotency key. Double submit is blocked. A transport failure before the result is known preserves the exact payload/key; edits invalidate the key. Close/Escape abort only the local wait and never claim rollback.
- The result remains in the dialog until the user opens/closes it, distinguishes a created Run from Agents not yet awakened, and renders one copyable instruction per server `joinInstructions` participant. The legacy `roleBindings` merge remains only the shared helper's compatibility fallback.
- `SpaceView` deliberately handles either the legacy page ID or a composite creation result. A created group opens its server-returned root Folder; a single Page opens its editor; a collaboration result is not closed before instructions are displayed.
- Existing Pages and Folders expose late-binding entry points only in editable UI. `PageAgentBindingDialog` discovers Folder membership on the server, shows exact Page IDs/titles and binding versions, keeps immediate start off by default, supports bind/change/unbind, and uses Task 11a's atomic save-and-start endpoint rather than sequential save then start.
- Stable Task 11 API error codes map through shared zh-CN/en messages. All added visible UI copy has Chinese/English key parity. Cards are keyboard buttons, template hierarchy uses nested tree semantics, dialogs use existing focus/Escape behavior, and layouts collapse to one column at 390 px.

## Task 11a HTTP interfaces consumed

- `GET /spaces/:spaceId/templates` with `locale`, `scope`, optional `kind`, `archived=active`, `skip`, and `take`.
- `POST /spaces/:spaceId/templates/:templateId/preview` and `POST .../instantiate`.
- `GET|PUT|DELETE /spaces/:spaceId/pages/:pageId/agent-binding`.
- `POST /spaces/:spaceId/folders/:folderId/agent-bindings/preview` and `POST .../agent-bindings`.
- `POST /spaces/:spaceId/pages/:pageId/collaboration-runs` and `POST /spaces/:spaceId/folders/:folderId/collaboration-runs`.
- Existing `GET /spaces/:spaceId/members` and `GET /spaces/:spaceId/collaboration/runs/:runId` for Agent eligibility and server-authoritative join instructions.

Folder start in this task is intentionally the approved historical simple `page_selection` flow. Task 12 still owns authoritative original-instance/Run provenance discovery, legacy canonical hash, Folder source-node mapping for snapshot pruning, and template management/review surfaces.

## TDD evidence

### Unknown network result and pagination

Command:

```text
pnpm --filter @agentwiki/client exec vitest run src/features/page-templates/NewPageDialog.composite.spec.tsx
```

- RED: the unknown-result assertion received the generic network fallback instead of the required unknown-result recovery, and the new catalog had no bounded load-more action.
- GREEN after preserving the exact signature/key and adding server pagination: `1 file passed; 8 tests passed`.

### Stable error mapping

Command:

```text
pnpm --filter @agentwiki/client exec vitest run src/api/error-message.spec.ts
```

- RED: `CONTENT_TREE_CONFLICT` and `RESOURCE_NOT_FOUND` fell through the Task 11 recovery map (`2 tests failed`).
- GREEN: `1 file passed; 27 tests passed`.

### Shared helper compatibility

Command:

```text
pnpm --filter @agentwiki/client exec vitest run src/features/collaboration/RunStartWizard.test.tsx
```

- RED after the pure extraction test restored the original import: `1 file failed; 1 failed, 63 passed`; exact error was `buildAgentJoinInstructions is not a function`.
- GREEN after the one-line old-entry re-export: `1 file passed; 64 tests passed`.

### Agent-only choices

Command:

```text
pnpm --filter @agentwiki/client exec vitest run src/features/page-templates/CollaborationSettingsPanel.spec.tsx
```

- RED with one human and one Agent member: `1 file failed; 1 failed, 1 passed`; expected two options but received three and React warned about the undefined human option key.
- GREEN after filtering non-Agent rows in the shared editor, followed by the compatibility command for the panel/editor/legacy wizard: `3 files passed; 70 tests passed`.

### Hidden filtered selection

Command:

```text
pnpm --filter @agentwiki/client exec vitest run src/features/page-templates/NewPageDialog.composite.spec.tsx -t "filters kind and scope"
```

- RED: `1 failed, 7 skipped`; the default blank selection was hidden by the page-group filter but Next was still enabled.
- GREEN: `1 passed, 7 skipped`; Next now requires a selection present in the filtered result.

### Focused Task 11b regression

Command:

```text
pnpm --filter @agentwiki/client exec vitest run \
  src/features/page-templates/NewPageDialog.spec.tsx \
  src/features/page-templates/NewPageDialog.composite.spec.tsx \
  src/features/page-templates/TemplateTreePreview.spec.tsx \
  src/features/page-templates/CollaborationSettingsPanel.spec.tsx \
  src/features/page-templates/PageAgentBindingDialog.spec.tsx \
  src/features/page-templates/compositeTemplateApi.spec.ts \
  src/features/content-tree/ContentTree.spec.tsx \
  src/features/space/SpaceView.spec.tsx \
  src/features/page/PageEditor.spec.tsx \
  src/features/collaboration/RunStartWizard.test.tsx \
  src/features/collaboration/components/RoleBindingEditor.test.tsx \
  src/i18n/page-template-messages.spec.tsx \
  src/api/error-message.spec.ts
```

Output before the last filtered-selection assertion: `13 files passed; 336 tests passed; 2.93s`. The later full suite includes that final assertion.

## Fresh final verification

```text
pnpm --filter @agentwiki/client exec vitest run --reporter=dot
```

Output: `88 files passed; 1157 tests passed; 12.92s`; exit 0.

```text
pnpm --filter @agentwiki/client exec tsc --noEmit
pnpm --filter @agentwiki/client lint
pnpm --filter @agentwiki/client build
git --work-tree='/Users/neomei/.codex/worktrees/69d8/AgentWiki ' diff --check
```

Output: TypeScript exit 0 with no output; client ESLint exit 0; production build exit 0 (`4750 modules`, `4.52s`); diff check exit 0. Vite reports the repository's existing `>500 kB` chunk warning. The helper extraction removed the earlier additional static/dynamic `RunStartWizard` import warning; no Task 11b bundle refactor was attempted.

## Files

New:

- `agentwiki/apps/client/src/features/collaboration/agentJoinInstructions.ts`
- `agentwiki/apps/client/src/features/content-tree/ContentTree.spec.tsx`
- `agentwiki/apps/client/src/features/page-templates/CollaborationSettingsPanel.spec.tsx`
- `agentwiki/apps/client/src/features/page-templates/CollaborationSettingsPanel.tsx`
- `agentwiki/apps/client/src/features/page-templates/NewPageDialog.composite.spec.tsx`
- `agentwiki/apps/client/src/features/page-templates/PageAgentBindingDialog.spec.tsx`
- `agentwiki/apps/client/src/features/page-templates/PageAgentBindingDialog.tsx`
- `agentwiki/apps/client/src/features/page-templates/TemplateTreePreview.spec.tsx`
- `agentwiki/apps/client/src/features/page-templates/TemplateTreePreview.tsx`
- `agentwiki/apps/client/src/features/page-templates/compositeTemplateApi.spec.ts`
- `agentwiki/apps/client/src/features/page-templates/compositeTemplateApi.ts`
- `agentwiki/apps/client/src/features/page-templates/compositeTemplateTypes.ts`

Modified:

- `agentwiki/apps/client/src/api/error-message.spec.ts`
- `agentwiki/apps/client/src/api/error-message.ts`
- `agentwiki/apps/client/src/features/collaboration/RunDashboard.tsx`
- `agentwiki/apps/client/src/features/collaboration/RunStartWizard.tsx`
- `agentwiki/apps/client/src/features/collaboration/components/RoleBindingEditor.test.tsx`
- `agentwiki/apps/client/src/features/collaboration/components/RoleBindingEditor.tsx`
- `agentwiki/apps/client/src/features/content-tree/ContentTree.tsx`
- `agentwiki/apps/client/src/features/page-templates/NewPageDialog.spec.tsx`
- `agentwiki/apps/client/src/features/page-templates/NewPageDialog.tsx`
- `agentwiki/apps/client/src/features/page/PageEditor.spec.tsx`
- `agentwiki/apps/client/src/features/page/PageEditor.tsx`
- `agentwiki/apps/client/src/features/space/SpaceView.spec.tsx`
- `agentwiki/apps/client/src/features/space/SpaceView.tsx`
- `agentwiki/apps/client/src/i18n/messages.ts`
- `agentwiki/apps/client/src/i18n/page-template-messages.spec.tsx`
- `.superpowers/sdd/2026-09-05-composite-page-group-agent-collaboration/task-11b-report.md`

## Self-review and gates

- Re-read the Task 11 parent brief, Task 11a report including fix round 1, and the frontend integration notes. Checked the implemented payloads against the current controller/DTO rather than the preflight draft.
- Verified the StrictMode session effect restores its active ref on each setup, catalog filtering is server-side and paginated, independent reads use `Promise.all`, user writes remain in event handlers, and the phase reducer rejects illegal transitions.
- Verified binding defaults remain distinct from Run participation; start-now is off; the Folder scope comes from bounded server discovery and is submitted with exact IDs/tree/binding versions; save-and-start is a single server call.
- Verified PageEditor viewers never render the edit toolbar because the existing `canEdit=false` path redirects to the read-only route. Template-management permission is deliberately not required for an otherwise editable Page binding entry.
- Verified only the listed client/report files are intended for the commit. Controller-owned `.codex-memory/current.md`, `.codex-memory/tasks/index.md`, and `.codex-memory/tasks/active/...` remain untracked/unstaged by this task.
- Real Chrome layout/focus, real HTTP integration, and real external Agent execution are not proven by jsdom/build. They remain the explicit Task 13b business-acceptance gate. Task 11a/controller owns the server and real PostgreSQL regression evidence.
