# Task 8 Report: Accessible two-step new-page dialog

Date: 2026-08-25

Branch: `codex/page-template-library`

Starting commit: `1921e9e547c954d50113266f799fe7f588237f71`

Worktree: `/Users/neomei/项目/codexprojects/AgentWiki /.worktrees/page-template-library`

## Requirement mapping

- Added `NewPageDialog` on top of the existing `ModalDialog`, page-template API, title interpolation, API error translation, language context, and router primitives.
- Step 1 always exposes a selected blank-page button, loads the localized System/Space catalog, filters it client-side, renders the management link only for `capabilities.canManage`, and preserves blank creation plus a retry action when loading fails.
- Catalog effects use an `active` cleanup guard, so responses from an old Space/language/retry request cannot replace the current catalog.
- System default titles interpolate the injected/local current date; Space default titles remain literal even if they contain `{date}`, `{year}`, or `{week}`.
- Step 2 contains the selected-template summary, required title, optional parent, back/cancel/create actions, inline translated API errors, and focus transfer to the title field.
- Page creation trims the title and sends only `title`, `spaceId`, optional `parentId`, and optional exact template provenance. It never sends `content` or `format` from the client.
- A failed POST retains template, title, and parent state. While a POST is pending, duplicate submits, Escape, backdrop close, close, cancel, and back actions are blocked.
- Modal teardown returns focus to the opener. The dialog uses a one-column card grid below `sm`, wrapping actions, viewport-bounded height, `w-full`, and no fixed width that can overflow a 390px viewport.
- `SpaceView` now derives create visibility from the fetched Space's live membership plus the current authenticated user: Owner, Editor, and platform Super Admin can create; Space Admin and Viewer cannot.
- Only the old inline create state/handler/overlay were replaced. Fetching, tree flattening/rendering, move/reorder, deletion, existing errors, and created-page navigation remain on their prior paths.

## Data-shape preflight

- `GET /spaces/:id` delegates to `SpaceService.findOne()`, whose response includes `members` selected with `userId` and `role`.
- Existing `useAuth().user` consumers already use both `id` and `platformRole`; its current `any`-backed shape did not conflict with this task.
- No Space-membership or auth-shape blocker was found.

## TDD evidence

### Initial RED

Tests were created before `NewPageDialog` or `SpaceView` production changes. Running the brief command:

```bash
cd agentwiki
pnpm --filter @agentwiki/client test -- src/features/page-templates/NewPageDialog.spec.tsx
```

exited 1 with the expected missing-module failure:

```text
Failed to resolve import "./NewPageDialog"
```

Because the current package script expands to `vitest run -- <paths>`, Vitest also ran the complete client suite. The new `SpaceView` tests independently demonstrated the old behavior: Space Admin and Viewer still saw the trigger, and the old inline overlay had no two-step `下一步` action.

### Focus RED

After the base dialog was green, an additional keyboard-flow test advanced to step 2 and expected the title input to receive focus. It failed with focus remaining on the dialog close button. Adding `autoFocus` to the already required `data-modal-autofocus` title input made this regression pass without changing `ModalDialog`.

### GREEN

Focused dialog, Space integration, Modal, move, and bilingual-copy suites:

```text
Test Files  5 passed (5)
Tests       124 passed (124)
```

Fresh final brief command:

```bash
cd agentwiki
pnpm --filter @agentwiki/client test -- \
  src/features/page-templates/NewPageDialog.spec.tsx \
  src/features/space/SpaceView.spec.tsx \
  src/components/ModalDialog.test.tsx \
  src/features/space/applyMove.spec.ts
```

Result:

```text
Test Files  63 passed (63)
Tests       595 passed (595)
```

## Additional verification

```bash
pnpm --filter @agentwiki/client exec tsc --noEmit
pnpm --filter @agentwiki/client lint
git diff --check
```

- Client TypeScript check: exit 0.
- Client ESLint: exit 0.
- `git diff --check`: exit 0 with no output.

## Files

- Created `agentwiki/apps/client/src/features/page-templates/NewPageDialog.tsx`.
- Created `agentwiki/apps/client/src/features/page-templates/NewPageDialog.spec.tsx`.
- Modified `agentwiki/apps/client/src/features/space/SpaceView.tsx`.
- Created `agentwiki/apps/client/src/features/space/SpaceView.spec.tsx`.
- Modified `agentwiki/apps/client/src/i18n/messages.ts` with the dialog-specific bilingual `pageTemplate.next` label.
- Modified `agentwiki/apps/client/src/i18n/page-template-messages.spec.tsx` to keep the bilingual page-template copy contract exact.
- Created `.superpowers/sdd/page-template-library/task-8-report.md`.

## Self-review

- Verified blank catalog failure/retry, stale response suppression, System interpolation, Space literal titles, exact template and blank POST shapes, state retention, pending-request guards, filter/management behavior, step focus, Escape/focus return, responsive classes, membership roles, Super Admin access, and created-page navigation through tests.
- Verified no `content` or `format` field is constructed by the dialog.
- Verified `SpaceView`'s move/delete/fetch/tree bodies are unchanged outside removal of the old create handler and overlay.
- No server, database, package-version, push, publish, deployment, or release action was performed.

## Concerns

- None identified within Task 8 scope.
