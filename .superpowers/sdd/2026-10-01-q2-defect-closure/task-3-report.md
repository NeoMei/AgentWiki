# Task 3 implementation report

Status: DONE

## Implemented

- SpaceView load/restore/move/archive, SpaceSettings load/save, SpaceMembers load/role changes/removal, and AddSpaceMemberDialog list/add failures now use `apiErrorMessage`; raw server English/database details are no longer exposed by these entries. Shared permission guidance tells the user to ask a Space owner/admin to check their member role, with Chinese and English equivalents.
- Agent addition now localizes Reader/Editor/Publisher using the existing role catalog. Member policy text and existing role descriptions are localized. Agent names remain exactly user supplied.
- TaskPanel translates system Todo names, accessible labels, and visible count through the same proven system-template provenance guard used for task names/objectives. Added 78 exact built-in Todo display mappings. Copied/custom templates, unknown/edited strings, and Agent names remain untouched.
- Localized source runtime stage/status, source detail run status, and collaboration artifact status with a bounded shared runtime-label helper. Changed Chinese Todo UI copy to 待办 and 人工门 to 人工审核; removed raw waiting_human/paused presentation from resume guidance.
- 管理协作模板 now links to `/spaces/:id/collaboration?tab=manage`, a real separately selected management tab. It presents copy/edit/upgrade/archive/new-template operations, focuses its heading after data loading, hides run-launch controls, and denies the management view to nonmembers/viewers. Existing template editor routes remain the actual edit/create destinations.
- Removed 管理页面模板 from collaboration entry. Renamed creation to 新建协作模板 / New collaboration template, preserving compatibility, copying, editing, launch from the catalog, and custom workflow upgrade behavior.
- Reused existing components and React/Vite/CSS. No component library, server authorization, protocol version, production Assist, memory, daily Vault, release, or deployment changes.

## TDD evidence

RED command (before production edits):

```sh
pnpm --filter @agentwiki/client exec vitest run src/features/collaboration/CollaborationWorkspace.test.tsx src/features/collaboration/components/TaskPanel.spec.tsx src/features/space/SpaceSettings.spec.tsx src/features/space/AddSpaceMemberDialog.spec.tsx src/features/source/RunsPage.spec.tsx
```

Output: 5 files failed; 10 tests failed, 69 passed (79). Failures were expected behavioral assertions: actual management navigation/heading/focus in both languages, localized Agent role options, sanitized denied member creation and Space loading in both languages, runtime stage labels in both languages, and localized Chinese system Todo accessible label/count. Log: `/tmp/q2-task3-red.log`.

GREEN final command:

```sh
pnpm --filter @agentwiki/client exec vitest run src/features/collaboration/CollaborationWorkspace.test.tsx src/features/collaboration/components/TaskPanel.spec.tsx src/features/collaboration/systemTemplateText.spec.ts src/features/collaboration/RunDashboard.test.tsx src/features/collaboration/TemplateEditor.test.tsx src/features/collaboration/RunStartWizard.test.tsx src/features/space/SpaceSettings.spec.tsx src/features/space/AddSpaceMemberDialog.spec.tsx src/features/space/SpaceMembers.spec.tsx src/features/space/SpaceView.spec.tsx src/features/source/RunsPage.spec.tsx src/features/source/SourcesPage.spec.tsx src/api/error-message.spec.ts
```

Output: 13 test files passed; **266/266 tests passed**, clean output. Log: `/tmp/q2-task3-finaltests.log`.

The five provenance-coverage tests import the actual server built-in definitions and exercise every task Todo from all five seeds against both-language presentation and custom/copied preservation. Navigation tests exercise actual query-backed component transitions and verify existing edit/new hrefs and heading focus. Existing dashboard/start/editor/copy/archive/upgrade/Space/source regression tests passed.

Additional checks:

- `pnpm --filter @agentwiki/client exec tsc --noEmit`: exit 0, no diagnostics (`/tmp/q2-task3-finaltypes.log`).
- `git --work-tree='/Users/neomei/.codex/worktrees/d35c/AgentWiki ' diff --check`: exit 0.
- Controller instructed targeted Task3 checks to suffice here; whole-branch/full-client gates belong to the controller final validation.

## Files changed

Under `agentwiki/apps/client/src/`:

- `features/collaboration/CollaborationWorkspace.tsx`, `.test.tsx`
- `features/collaboration/components/TaskPanel.tsx`, `.spec.tsx`
- `features/collaboration/components/ArtifactPanel.tsx`
- `features/collaboration/systemTemplateText.spec.ts`
- `features/source/RunsPage.tsx`, `.spec.tsx`
- `features/source/SourcesPage.tsx`, `.spec.tsx`
- `features/space/AddSpaceMemberDialog.tsx`, `.spec.tsx`
- `features/space/SpaceMembers.tsx`
- `features/space/SpaceSettings.tsx`, `.spec.tsx`
- `features/space/SpaceView.tsx`
- `i18n/messages.ts`, `system-collaboration-messages.ts`, `runtime-label.ts`

Plus this report.

## Self-review and boundaries

- Verified no raw response message use remains in exposed Space feature code, all Todo maps are presentation-only, and no author content is rewritten or persisted during localization.
- Management can be deep-linked and uses real operations; it is neither a current-tab no-op nor a fake focus destination. Actual human Space membership still controls management; platform role is never elevated to owner.
- Changed two previous assertions to new intended copy: network failure is the shared localized network message; graph-management guidance now uses Chinese human role names. Updated an old legacy-create assertion to the new clear label.
- No known Task3 requirement remains deferred. Browser/live acceptance and whole-branch validation are separate controller gates, not claimed by unit DOM assertions.
