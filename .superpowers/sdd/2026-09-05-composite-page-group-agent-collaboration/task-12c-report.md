# Task 12c report — unified collaboration entry, frozen participants, and Page-result review UI

## Outcome

Implemented the Task 12c client slice on base `96265970ece1c50c2d337dd9ccba6d7ec172d19a`.

The UI purpose is one understandable Page collaboration path: create Pages through the existing `NewPageDialog`, explicitly choose whether collaboration is enabled, start a later Folder Run from either its exact original workflow provenance or an explicitly selected simple-Page source, and review Page publications inside the collaboration Run without a second human approval path.

The UI skeleton reuses the existing collaboration workspace, `NewPageDialog`, `PageAgentBindingDialog`, three-column `RunDashboard`, `ReviewPanel`, ordinary `ReviewPage`, `ModalDialog`, shared API/error helpers, and `buildAgentJoinInstructions`. The Run response remains bounded: a Page comparison is fetched only after the reviewer opens one review, and only that single comparison is held in dashboard state. The existing non-Page Artifact review flow remains available and unchanged in purpose.

## Implemented behavior

- Unified collaboration entry:
  - the workspace Page action opens the same `NewPageDialog` used by the Space Page flow;
  - Page-only creation and collaboration-enabled creation have distinct destinations and copy;
  - the legacy workflow path remains available but is clearly labeled, while template management routes to the unified Page template catalog;
  - modal close/creation restores focus to the opener.
- Existing Page/Folder follow-up Runs:
  - exact Folder collaboration provenance is discovered from the server and uses the original `sourceInstantiationId`, original runtime Page IDs, and current tree CAS revision;
  - when exact provenance exists, the user explicitly chooses “original workflow” or “simple Pages”; the UI never silently changes source kind;
  - a mandatory server preview shows authoritative tasks and participants and blocks Start if preview issues exist or any source/agent choice has changed;
  - no Page, Folder, template instantiation, or runtime identity is copied to start the next Run;
  - Page binding edits remain explicit and use the existing tree-revision and per-Page update-time guards.
- Frozen execution display:
  - task cards display the persisted `assigneeAgentId` from each Run task and only resolve its human-readable name from the member catalog;
  - current Page bindings are not inferred as Run assignments;
  - shared join instructions are built per execution stage; `waiting_human` and `paused` do not produce wake instructions, and resume copy requires an explicit manual action.
- Page-result review:
  - the dashboard does not preload Page Artifact/full-body content;
  - opening one Page review fetches one comparison with target Page link, exact nullable baseline/current version IDs and hashes, proposed Markdown, current Markdown, and linked ChangeSet;
  - the server comparison’s `canDecide` is the sole Page-decision authority;
  - conflict recovery exposes regenerate/adopt-current only for the active candidate conflict and submits CAS values from the currently displayed comparison;
  - a stale conflict reloads the newest comparison, so a retry cannot reuse the old version/hash;
  - `adopted_current` is rendered as current Page truth rather than as an unpublished candidate;
  - missing/archived/deleted comparison failures render a retryable read-only state with no decision controls.
- Ordinary review compatibility:
  - collaboration-linked ChangeSets show their collaboration Run link and hide item decisions, approve, reject, and publish actions, preventing a second approval path;
  - an already published linked ChangeSet retains Revert;
  - ordinary non-Page Artifact reviews still fetch and render their Artifact/evidence and retain their existing decision flow.
- Async identity guards:
  - Space/Run changes invalidate member, history, Artifact, and comparison requests;
  - switching reviews aborts the prior comparison and request epochs prevent late success/error from reviving controls;
  - Run event-sequence changes clear the selected comparison;
  - conflict completion is ignored after review/Run navigation and reloads the exact active review after CAS failure.
- Added stable English and Simplified Chinese copy for the new entry, source choice, preview, comparison, read-only, conflict-recovery, and linked-review states.

## TDD evidence

Focused RED started before implementation:

```text
4 focused files: 6 expected failures, 57 passing tests.
The failures covered the unified New Page entry, exact Folder-source preview/start,
single Page comparison/review authority, and linked ordinary-review bypass prevention.
```

The first implementation GREEN checkpoint reached 67 focused passing tests. Additional navigation/race assertions then proved that an old review/Run comparison response is aborted and cannot revive Approve after the active identity changes.

Fresh final focused regression on the final code:

```text
pnpm --filter @agentwiki/client exec vitest run \
  src/features/page-templates/compositeTemplateApi.spec.ts \
  src/features/page-templates/PageAgentBindingDialog.spec.tsx \
  src/features/collaboration/RunDashboard.test.tsx \
  src/features/collaboration/CollaborationWorkspace.test.tsx \
  src/features/review/ReviewPage.spec.tsx --reporter=dot

5 files passed, 76/76 tests passed.
```

This focused set includes the preserved ordinary Artifact review, exact-vs-simple Folder source choice, mandatory authoritative preview, one-comparison-on-demand behavior, nullable version/hash rendering, stale comparison suppression, CAS conflict refresh/retry, adopted-current rendering, frozen assignees, manual-resume copy, and collaboration-linked ReviewPage restrictions.

## Full client and static verification

Fresh, sequential verification after the final implementation:

- `npm test` from `agentwiki/apps/client`
  - exit 0;
  - 92/92 test files passed;
  - 1211/1211 tests passed;
  - duration 12.96s.
- `npx tsc --noEmit` from `agentwiki/apps/client`
  - exit 0, no diagnostics.
- `npm run lint` from `agentwiki/apps/client`
  - exit 0, no ESLint findings.
- `npm run build` from `agentwiki/apps/client`
  - exit 0;
  - TypeScript and Vite production build passed;
  - 4753 modules transformed, built in 4.63s;
  - known warning only: existing minified chunks larger than 500 kB.
- explicit-work-tree `git diff --check`
  - clean.

The first recovered full-client PTY (`90884`) was no longer available after the host authentication interruption (`Unknown process id 90884`), so only that missing full-client evidence was rerun once. Focused/navigation tests were not repeated during recovery.

## Self-review and boundaries

- Reviewed the main Run payload boundary: Page baseline/candidate/current Markdown exists only in the dedicated single-review comparison request and is not added to `CollaborationRun`.
- Reviewed decision authority: Page decisions require the loaded server comparison’s `canDecide`; the presence of an Artifact alone cannot enable Page approval. Non-Page Artifact decisions preserve the prior `review.canDecide` contract.
- Reviewed conflict CAS: both actions use the active comparison’s exact current `pageVersionId` and `contentHash`; stale responses reload before any second action.
- Reviewed identity races: comparison, conflict, Artifact, member, and history callbacks are gated by the current Space/Run and request epoch. Tests cover old-review and old-Run response suppression.
- Reviewed source fidelity: exact provenance submits the original instantiation ID and runtime Page IDs; simple Page selection remains an explicit user choice.
- Reviewed responsive/accessibility fit: the existing stacked mobile layout and responsive grids remain intact; new actions use native buttons/links, visible status/alert roles, disabled busy states, and opener focus restoration.
- No known functional blocker remains in this UI slice. The build chunk-size warning is pre-existing/non-blocking.
- This task did not perform real Chrome, external-Agent, production, push, npm, protected Sync, attachment, or Markdown-image-rewrite acceptance. Real browser and external Agent end-to-end acceptance remains Task 13b and is not claimed here.

## Fix round 1 — existing Folder next Run

Base: `bf16adecf8ca69009d5bc6ec496afda5304e3f48`.

The exact original Task 12c RED command was not retained in the recovered session evidence, so it remains unavailable rather than being reconstructed. This fix round recorded a new exact behavioral RED:

```text
npm exec vitest -- run \
  src/features/page-templates/PageAgentBindingDialog.spec.tsx \
  src/features/page-templates/compositeTemplateApi.spec.ts \
  src/features/page-templates/CollaborationSettingsPanel.spec.tsx \
  --reporter=verbose

Exit 1. 3 files: 6 failed / 15 passed.
Expected failures: explicit keep-vs-bulk binding controls were absent; heterogeneous
defaults were collapsed into bulk edits; required workflow inputs and role overrides
had no controls; matched preview revision 19 was not used over initial revision 18;
and clearing a numeric input produced 0 instead of removing the value.
```

Focused GREEN after the minimal implementation and test-locator correction:

```text
npm exec vitest -- run \
  src/features/page-templates/PageAgentBindingDialog.spec.tsx \
  src/features/page-templates/compositeTemplateApi.spec.ts \
  src/features/page-templates/CollaborationSettingsPanel.spec.tsx \
  --reporter=dot

Exit 0. 3/3 files passed; 21/21 tests passed in 802ms.
```

Self-review regression RED/GREEN for explicit bulk unbind:

```text
npm exec vitest -- run src/features/page-templates/PageAgentBindingDialog.spec.tsx \
  -t 'allows an explicit Folder bulk unbind' --reporter=dot

RED: exit 1, 1 failed / 8 skipped because the new no-Agent guard also blocked
the existing save-only bulk-unbind operation.
GREEN: exit 0, 1 passed / 8 skipped in 793ms after limiting that guard to Start.
```

Final focused and adjacent shared-control regression:

```text
npm exec vitest -- run \
  src/features/page-templates/PageAgentBindingDialog.spec.tsx \
  src/features/page-templates/compositeTemplateApi.spec.ts \
  src/features/page-templates/CollaborationSettingsPanel.spec.tsx \
  src/features/page-templates/NewPageDialog.composite.spec.tsx \
  src/features/page-templates/NewPageDialog.spec.tsx \
  src/features/collaboration/components/RoleBindingEditor.test.tsx \
  src/i18n/page-template-messages.spec.tsx --reporter=dot

Exit 0. 7/7 files passed; 189/189 tests passed in 2.55s.
```

Task-choice persistence RED after review of the preview lifecycle:

```text
npm exec vitest -- run src/features/page-templates/PageAgentBindingDialog.spec.tsx \
  -t 'keeps disabled task choices' --reporter=dot

Exit 1. 1 failed / 9 skipped: after a second preview returned only the enabled
task, the disabled `Polish` task disappeared and could not be selected again.
```

Task-choice persistence GREEN:

```text
npm exec vitest -- run src/features/page-templates/PageAgentBindingDialog.spec.tsx \
  -t 'keeps disabled task choices' --reporter=dot

Exit 0. 1 passed / 9 skipped in 780ms. The settings panel retains the current
source's complete task-option catalog while the authoritative preview remains the
server-returned enabled subset; switching source resets that catalog and Run-only settings.
```

Fresh focused and adjacent regression after the task-option fix:

```text
npm exec vitest -- run \
  src/features/page-templates/PageAgentBindingDialog.spec.tsx \
  src/features/page-templates/compositeTemplateApi.spec.ts \
  src/features/page-templates/CollaborationSettingsPanel.spec.tsx \
  src/features/page-templates/NewPageDialog.composite.spec.tsx \
  src/features/page-templates/NewPageDialog.spec.tsx \
  src/features/collaboration/components/RoleBindingEditor.test.tsx \
  src/i18n/page-template-messages.spec.tsx --reporter=dot

Exit 0. 7/7 files passed; 190/190 tests passed in 1.53s.
```

Fresh full-client regression on the fix1 tree:

```text
npm test

Exit 0. 92/92 files passed; 1218/1218 tests passed in 11.93s.
Full output: /tmp/task12c-fix1-client-test.log
```

```text
npx tsc --noEmit

Exit 0, no diagnostics. Output: /tmp/task12c-fix1-types.log
```

```text
npm run lint

Exit 0, no ESLint findings. Output: /tmp/task12c-fix1-lint.log
```

```text
npm run build

Exit 0. TypeScript and Vite production build passed; 4753 modules transformed,
built in 4.74s. Known chunk-size warning only. Full output:
/tmp/task12c-fix1-build.log
```

```text
git --git-dir='/Users/neomei/.codex/worktrees/69d8/AgentWiki /.git' \
  --work-tree='/Users/neomei/.codex/worktrees/69d8/AgentWiki ' diff --check

Exit 0, clean.
```

Fix1 self-review confirms:

- default Folder next-Run payloads omit `bindingEdits` and preserve heterogeneous
  Page defaults; only the explicit bulk mode sends versioned per-Page edits;
- save-only explicit bulk unbind remains available, while bulk Start without an
  execution Agent remains blocked;
- workflow inputs, Run-only role overrides, and explicit task scope are previewed
  and sent without persisting role overrides into Page bindings;
- Start uses the exact latest matching preview `treeRevision`; bulk binding edits
  keep their independent `expectedUpdatedAt` CAS values;
- task options survive subset previews so a disabled task can be re-enabled, and
  source changes reset the source-specific task catalog and Run settings.
