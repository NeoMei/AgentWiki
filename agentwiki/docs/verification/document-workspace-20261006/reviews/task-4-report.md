# Task 4 report — Phase 1 storage foundation

Status: **Phase 1 + Phase 2 implementation complete and frozen for independent review.**

## Owned changes

- `agentwiki/apps/client/src/features/page/localDrafts.ts`
- `agentwiki/apps/client/src/features/page/localDrafts.spec.ts`

No PageEditor, AuthContext, MarkdownWorkspace, dependencies, or commits were changed by this agent. Task 3 retains editor ownership until the controller explicitly releases its independent-review gate.

## Implemented contract

- Version-1 records contain only `schemaVersion`, `userId`, `spaceId`, `pageId`, `baseUpdatedAt`, `title`, `content`, `savedAt`. `savedAt` is an integer Unix timestamp in milliseconds, advanced monotonically per stored page when same-clock writes occur.
- Keys encode every identity component. Reads validate both the schema/field types and the identity inside the record. Invalid/foreign records are never returned for restoration. There is no global draft cache.
- `readDraft(scope)` returns `found` with the record, or `absent` / `invalid` / `unavailable`; it performs no writes. `loadDraft` is a record-or-null convenience API; status UI should use `readDraft`.
- `saveDraft(scope, input, authorizedRemotePage, savedAt?, storage?)` checks identity, edit authorization and exact baseline version. It refuses a snapshot equal to the server title/content, regardless of a conservative dirty flag. An unchanged snapshot does not erase a pending recovery offer on mount. It returns `saved` with the exact written record, or explicit `unchanged` / `invalid` / `stale` / `unauthorized` / `quota-exceeded` / `unavailable` statuses.
- `compareDraft` / `canRestoreDraft` require matching user/Space/page, a valid record, edit authorization, and the same server `updatedAt`. Stale drafts remain loadable for authorized preview/export but are never directly restorable.
- `clearDraftIfExact(scope, submittedRecord)` removes only a record matching every field, including baseline and savedAt. An older save completion preserves newer source, title, baseline or timestamp versions. Clear failure is explicit, and the record remains loadable.

## RED / GREEN evidence

Commands run from the exact worktree's `agentwiki` directory:

```sh
pnpm --filter @agentwiki/client exec vitest run src/features/page/localDrafts.spec.ts
pnpm --filter @agentwiki/client exec eslint src/features/page/localDrafts.ts src/features/page/localDrafts.spec.ts
```

- Initial missing-module run was a harness resolution error, not accepted as behavior RED.
- Typed empty implementation: **19 failed / 2 passed**, with real assertions failing for persistence, scope/schema validation, authorization, stale rejection and exact clearing.
- First implementation: **21 passed**.
- Additional same-clock version and malformed in-memory recovery tests: **2 failed / 22 passed**; fixed timestamp uniqueness and strict recovery validation/boolean authorization.
- Final focused run: **24 passed**, exit 0. Focused ESLint: exit 0.

Covered behavior: Unicode/source bytes preserved; reload reads exact records; user/Space/page and key collision isolation; malformed JSON/schema/fields; unchanged baseline and title-only edits; explicit read/write/quota/remove failures; stale/unauthorized recovery rejection; exact clear; newer typing and same-clock identical writes preserved; pending offer not overwritten by mounting baseline bytes.

## Phase 2 integration plan after Task 3 gate

1. Construct scope only from active `user.id` and the successfully authorized `page.id` / `page.spaceId`. Bind it to a route/account generation. Load and show a recovery offer only after authorized load; never replace title/content on mount. Account switches and 401/403/404/deletion/edit-capability loss cancel draft timers and clear in-memory records/offers; no recovery is exposed without reauthorization.
2. Add local persistence scheduling to explicit human title/content handlers and accepted-candidate changes. Do not use a generic `content`/`isDirty` effect: `adoptRemoteDraft` marks dirty for WebSocket snapshots and must not persist those snapshots. Candidate streams remain inside Assist state and never enter persistence.
3. Debounce with a captured scope/baseline and latest actual editor source. Flush only authorized local edits on pagehide/unmount/route switch, before route state reset; invalidate outstanding callbacks so a previous page cannot write under the next scope. Compare actual title/content against server baseline, including accept→undo equality. Clear only the record written by this editor session when undo returns exactly to baseline; do not erase a pending recovery offer merely because the page mounted unchanged.
4. Render bilingual separate local status (pending/saved/quota/unavailable) and explicit Recover/Discard. Recheck live authorization, scope and latest known remote version on every Recover. Existing `remoteUpdate` conflicts also block direct restoration. Recovery content uses `MarkdownWorkspaceHandle.replaceDocument` for a single undoable transaction; restore title explicitly as needed. Stale records get view/export and exact discard only.
5. At Save submission, flush/capture the exact submitted local record and preserve the existing `expectedUpdatedAt` / `expectedTreeRevision` logic. On success clear only that record. If typing continued during the request, persist the latest changed draft against the newly saved server baseline, preserving its title/content; never let an old completion clear it. Failed server saves retain drafts and never display server success.
6. Add PageEditor behavior tests for explicit recovery/no auto replacement, authorization/account/page switches, timer/navigation safety, stream exclusion/accepted candidate recovery, exact baseline undo, stale preview-only behavior and asynchronous Save/new typing. Run focused persistence/PageEditor tests plus client `tsc --noEmit` after integration; then controller arranges full Task 4 independent review.

## Self-review / limitations

- Equality uses exact strings; no Markdown normalization or dirty-flag inference.
- Storage is only local browser persistence; it is not server Save or shared collaboration. Successful read/write tests are not browser acceptance.
- The module validates identity and supplied capability but cannot fetch authorization itself; integration must supply a freshly authorized page and clear offers on invalidation.
- This phase deliberately has no editor/UI import, debounce hook, automatic restore, export UI or lifecycle integration. Client typecheck and full Task 4 review remain Phase 2 gates.


## Phase 2 final integration receipt

Task 3 gate released at `4dd0294a`; editor ownership passed to Task 4. Exact owned/frozen code files:

- `agentwiki/apps/client/src/features/page/localDrafts.ts`
- `agentwiki/apps/client/src/features/page/localDrafts.spec.ts`
- `agentwiki/apps/client/src/features/page/useLocalDraft.ts`
- `agentwiki/apps/client/src/features/page/LocalDraftNotice.tsx`
- `agentwiki/apps/client/src/features/page/PageEditor.tsx`
- `agentwiki/apps/client/src/features/page/PageEditor.spec.tsx`

Implemented explicit recovery offer after authorized page load; exact source restoration through `replaceDocument` and one CodeMirror undo; stale/known newer remote/socket states permit preview/export/discard only. Bilingual UI separates device draft status from explicit server Save. Source equality suppresses unchanged recoverable drafts after candidate accept→undo, independent of the conservative existing dirty flag.

Persistence is scheduled only from human title/content handlers, explicit candidate acceptance through CodeMirror onChange, and explicit recovery. A provenance flag excludes remote-only WebSocket snapshots even if a server Save is attempted. A 500ms debounce flushes on pagehide, visibility hidden, unmount and old-page route cleanup. Captured identity/baseline is rechecked; account changes cancel rather than flushing the prior identity; 401/403/404/edit capability/deletion invalidation clears in-memory offers and pending writes.

Server Save retains its `expectedUpdatedAt` and title-change `expectedTreeRevision` preconditions. It captures a fresh exact local record for the submitted source even if earlier debounce already finished. Success advances the server baseline without setting current title/content to submitted values, clears only that exact record, and persists newer human title/body against the saved version. If subsequent typing returns exactly to submitted bytes, only this editor's last exact equal record is removed, so no false recoverable unchanged draft remains. Failed saves retain drafts; authorization failure additionally invalidates offers/pending writes.

### Phase 2 RED/GREEN and final commands

- Initial integration behavior RED: 5 failures (missing recovery UI, absent persistence, save rebase, quota and permission behavior).
- Initial GREEN: 120 focused tests; client typecheck exit 0 at 06:21.
- Additional meaningful RED caught Save authorization not invalidating drafts, remote-only Save incorrectly persisting snapshots, Save-in-flight return-to-submitted bytes leaving a false record, and dismissed socket conflict allowing direct recovery. All fixed and rerun.
- Final focused command `pnpm --filter @agentwiki/client exec vitest run src/features/page/PageEditor.spec.tsx src/features/page/localDrafts.spec.ts`: **129 passed**, exit 0 (06:27).
- Focused ESLint on the six owned files: exit 0.
- `pnpm --filter @agentwiki/client exec tsc --noEmit`: earlier exit 0 before concurrent Task 5 edits. Latest final attempt failed only at concurrent `AgentAssistPanel.tsx:383` (`AssistTarget | null | undefined` cannot assign to `AssistTarget | undefined`). No Task 4 compiler error. Controller must rerun after Task 5 finishes.

### Browser integration finding and fix

Controller live native click proved initial notice placement overlapped Task 3's negative-offset tool row: recovery button center hit the Italic/Bold tool, so recovery was not invoked. Fixed in owned PageEditor layout by putting notices and conflict/status blocks before `document-header`; the existing header gap now remains immediately adjacent to MarkdownWorkspace. No CSS or MarkdownWorkspace changes. Controller confirmed new recovery-center hit-test returns the recovery button, real click restores exact stored source and clears offer, and one undo equals server source. Fresh clean Chinese draft end-to-end repetition remains controller-owned acceptance evidence; see browser acceptance record.

### Final self-review / remaining gates

Preserved Task 1 candidate checks, Task 3 toolbar/selection/outline/page-link/image handles and source semantics. Did not touch AuthContext, Task 5 helpers/ReviewPage/Assist code, CSS or dependencies; no commits or subagents. Unit/integration tests cover source restoration and undo, delayed load, stale preview/export/discard, account/Space/page isolation, permission loss, debounce/pagehide/reload/unmount/navigation, server-save exact clearing/newer title+body rebase/equality, remote streams and remote snapshot provenance, quota errors, and latest remote/socket conflict gating. Independent Task 4 review, whole-branch validation and final browser acceptance remain controller gates.


## Independent review 1 fixes / refreeze

Read `task-4-review.md` findings P1/P2 against `3873c954..53e5c574`. Changed only existing owned `useLocalDraft.ts`, `PageEditor.tsx`, and `PageEditor.spec.tsx`.

- **P1:** Extracted `refreshOffer` (read/update recovery offer only). The exact-discard `different` branch refreshes its offer without cancelling timers or changing pending/written/human provenance. Added two real editor regressions: old offer D → A debounced to storage → B pending → discard D → pagehide or failed server Save. Both now preserve recoverable B and live editor B while leaving A untouched until B is explicitly persisted.
- **P2:** Separated latest loaded server `updatedAt` from `unresolvedSocketRevisionRef`. Normal focus/periodic GET may refresh the server value but cannot erase an unresolved socket revision. Direct recovery requires both matching server base and no unresolved socket revision. Actual scope reset, adoption of an authoritative server page, or successful Save clears the socket state. Added full socket → Keep local → original-baseline focus refresh test plus a separate actual 30s periodic fake-clock test; both retain preview/export-only behavior.

Meaningful RED before fixes: **3 failed** assertions (focus reenabled Recover, pagehide/failed-save persisted A rather than B). GREEN after fixes: 131 passed. Added separate periodic timer regression and final focused persistence/PageEditor run: **132 passed**, exit 0 (06:32:46). The first periodic test setup switched clocks after real interval creation and failed because fake time did not advance the real timer; replaced with fake timers before mount, which observes the production interval/API behavior.

Client typecheck: exit 0 at 06:31 after both production fixes. A repeat at 06:32 was blocked only by concurrently added `usePersonalNotes.spec.tsx` TS7006 implicit-any `n` lines 15/22/24/26/28; no Task 4 compiler errors. Focused ESLint and git diff check on the three changed files exit 0. Controller must rerun whole-branch checks after Task 5 completes. No commits, subagents, or non-owned code changes. Frozen again for controller exact commit and independent rereview.
