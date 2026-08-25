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
- The original inline create state/handler/overlay were replaced. Tree flattening/rendering, move/reorder, deletion, existing errors, and created-page navigation remain on their prior paths; the later review fix below deliberately hardens Space fetch identity and stale-response handling.

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
- Verified `SpaceView`'s move/delete/tree behavior remains unchanged outside removal of the old create handler and overlay; route fetch state was intentionally changed by the review fix below to bind results and permissions to the current Space identity.
- No server, database, package-version, push, publish, deployment, or release action was performed.

## Concerns

- None identified within Task 8 scope.

---

## Review fix: catalog and route identity isolation

Review fix date: 2026-08-25

Review-fix starting commit: `354c1ec484088111cb677f75e473319ad3eed204`

### Root cause

- The dialog kept catalog, selected template, step, title, parent, and create error as untagged state. The catalog effect's `active` guard stopped unfinished old requests, but a completed old catalog and form remained renderable after `spaceId` or language changed.
- Retry generations also shared an untagged catalog value, so a render between incrementing the generation and the next effect could still expose the prior generation.
- `SpaceView` kept `loading`, Space, pages, and membership authorization as separate untagged state. Route changes therefore rendered the previous Space while the new request was pending, and a late old response could overwrite the new route.

### TDD RED

The review tests were added before production changes and use controlled deferred promises.

```bash
cd agentwiki
pnpm --filter @agentwiki/client exec vitest run \
  src/features/page-templates/NewPageDialog.spec.tsx \
  src/features/space/SpaceView.spec.tsx
```

Observed RED: 2 files failed, 5 tests failed.

- Completed Space and language catalogs remained on step 2 with the old Space template ID and edited title.
- Owner A's create trigger remained visible while Viewer B was unresolved.
- An already open A dialog survived the route change to B.
- A late Owner A response replaced the completed Viewer B response and restored A's create permission on the B URL.

### Remediation

- `NewPageDialog` now keys its stateful session by `(spaceId, language)`. Those identity changes synchronously remount a blank step-1 session, clearing catalog/capability, selection, title, parent, and create error before a new request resolves.
- Catalog load state is tagged with `reloadKey`. Only the current generation can render loading, success, error, catalog cards, or `canManage`; the existing effect cleanup still blocks unfinished old responses.
- Retry is deliberately not part of the form-session key. A user who entered a blank-page title and parent, returned to step 1, and retried a failed catalog keeps that input after the current generation loads.
- `SpaceView` now tags fetch state with the requested route ID and a monotonically increasing request sequence. Route changes immediately show loading, clear the old Space/tree/action state, close the old dialog, and invalidate previous requests.
- Membership authorization additionally requires the resolved `space.id` to equal the live route `id`. Owner/Editor/Super Admin permissions cannot be borrowed from the previous route.
- The reorder rollback still calls the same `fetchData()` path without route-resetting tree state; page flattening, move calculation, delete behavior, and created-page navigation were not changed.
- Pending creation coverage now directly verifies that close, cancel, back, Escape, backdrop close, and duplicate submit remain locked until the POST settles.

### Review-fix GREEN and final verification

Focused Task 8 gate:

```text
Test Files  4 passed (4)
Tests       28 passed (28)
```

Fresh brief/full-client command (the package script runs the complete client suite):

```text
Test Files  63 passed (63)
Tests       602 passed (602)
```

Additional gates:

- Client `tsc --noEmit`: exit 0.
- Client ESLint: exit 0.
- `git diff --check`: exit 0.

### 390px browser verification boundary

- Component structure and class-level mobile constraints remain covered here (`w-full`, viewport-bounded height, one-column cards below `sm`, wrapping actions, and no oversized fixed width).
- A real browser run at exactly 390px is intentionally deferred to Task 12 as requested. This Task 8 review fix does not claim browser-rendered 390px evidence.
