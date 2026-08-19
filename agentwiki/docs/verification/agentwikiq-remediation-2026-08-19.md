# AgentWikiQ remediation verification — 2026-08-19

## Scope

Findings 1–18 from `测试报告/AgentWikiQ/问题清单.md`. Verification was performed on the isolated branch `codex/agentwikiq-remediation`; no production account, production data, deployment, package publication, or marketplace submission was used.

## Automated gates

| Command | Result | Evidence |
| --- | --- | --- |
| `pnpm test` | PASS | Runtime 66 passed / 39 PostgreSQL-dependent skipped; server 559 passed; client 179 passed; sync protocol 22 passed; local sync 358 passed. Total: 1,184 passed, 0 failed. |
| `pnpm typecheck` | PASS | Server, client, sync protocol, and local sync TypeScript checks exited 0. |
| `pnpm lint` | PASS | ESLint exited 0 for server, client, and local-sync sources. |
| `pnpm build` | PASS | Shared, sync protocol, Nest server, Vite client, and local-sync production builds exited 0. |
| `git diff --check` | PASS | No whitespace errors. |

The final gate run was repeated after the independent code-review findings were fixed, including async response ordering, review publication compare-and-swap guards, URL proxy bypass prevention, and exact archived-state rollback.

## Browser acceptance environment

The production client bundle and then the local Vite client were exercised against an isolated loopback mock API. Test identities and content were synthetic. Chinese and English states were both checked. The browser file chooser itself was unavailable to automation, so selected-file behavior is backed by the component test; the visible chooser, filename state, and explicit upload button were inspected in both languages.

Observed browser evidence:

- Chinese invalid login displayed `邮箱或密码错误`; English displayed `Incorrect email or password`; neither exposed `Invalid credentials`.
- A successful synthetic login opened `/dashboard`, where the pending-review badge displayed `1` without route refresh.
- Password reset kept `billy_7609@test-agentwiki.com` visible and showed labeled login email plus `Temp_Aa1!` in the same dialog.
- Source forms displayed `选择文件` / `上传文件` and `Choose file` / `Upload file`, with upload disabled until selection.
- Historical version preview opened as a modal at the unchanged versions URL, without a restore confirmation or mutation.
- Review listed the pending change before the published history row; `仅批准` was disabled while an item remained pending and the reason was visible.
- A simulated stale review action refreshed the expanded row from pending to approved, exposed the next valid `发布` action, and showed `审核状态已变化，已为你刷新` in an element with fixed viewport positioning.
- English review failure displayed `Failed to update change set` in the same fixed notification surface.

## Finding matrix

| # | Fix | Automated evidence | Browser evidence |
| --- | --- | --- | --- |
| 1 | Reset response identifies the exact account, copies labeled credentials, generates a random policy-compliant password, hashes it, forces password change, and locks the snapshotted action target while the request is in flight. | `AdminPage.spec.tsx` covers exact account display plus delayed-response/double-submit protection; `platform-admin.service.spec.ts` verifies a different cryptographically-random temporary password; existing Auth/guard suites verify credential validation and `mustChangePassword` propagation. | Reset dialog retained the exact email and displayed labeled email and temporary password together after confirmation. |
| 2 | Both the standalone and actual landing-page login forms map stable auth/rate-limit/network outcomes through i18n instead of rendering server prose. | `Login.spec.tsx`; `ProductPage.spec.tsx` “localizes authentication errors on the actual landing-page login form”; `error-message.spec.ts`. | Chinese and English invalid-login messages were verified on the real `/` login entry. |
| 3 | The guide no longer depicts the retired one-click connection screen. | `UsageGuide.spec.tsx`; `GatewayGuidePreview.spec.tsx`. | Current public guide remained accessible in both languages; no credential-bearing legacy UI is rendered by the preview. |
| 4 | Unified gateway guide preview matches the current LocalSync installation card: package/version, npm link, supported clients, auto-publish control/help, generate action, install-only path, and documentation link. | `GatewayGuidePreview.spec.tsx` verifies the current card fields without credentials; `UsageGuide.spec.tsx`. | Public navigation exposed the current Guide route in both languages. |
| 5 | Obsidian guide states official review is pending and gives GitHub Release manual installation files and path. | `ObsidianGuide.spec.tsx` “states that community review is pending and gives exact manual files”. | No second marketplace submission was made; the guide is a public route and does not require an account. |
| 6 | File mode has a named chooser, selected filename state, an explicit upload action, name autofill, disabled-before-selection behavior, and sends the editable display name to the upload endpoint. | `SourcesPage.spec.tsx` verifies the selected file, explicit upload button, and custom `FormData.name`; controller tests and type checks cover the server boundary. | Chinese and English source forms showed the explicit chooser and upload button; disabled-before-selection state was visible. |
| 7 | Upload boundary repairs Latin-1-decoded UTF-8 filenames, preserves correct names, and rejects invalid UTF-8; uploaded bytes are decoded strictly. | `source-upload.spec.ts` three filename/UTF-8 tests; `SourcesPage.spec.tsx`; source pipeline regression suite. | Chinese source UI was readable; selected-file transition is covered by the component test because browser file-chooser automation was unavailable. |
| 8 | URL ingestion supports public redirects and readable HTML extraction while revalidating every hop, disabling environment proxies after DNS pinning, and rejecting private-address redirects, binary media, and hexadecimal IPv4-mapped IPv6 private addresses. | `remote-source.spec.ts`; `source.service.spec.ts` verifies redirect revalidation, `proxy: false`, private-hop rejection, and mapped-IPv6 forms. | Safe diagnostics are rendered by the run/source UI; no external URL was fetched during isolated browser acceptance. |
| 9 | Review submission/publish conflicts map business codes to localized messages and never display the English server message. | `ReviewPage.spec.tsx` “shows a localized fixed toast and refreshes stale detail on a CAS conflict”; `error-message.spec.ts`. | Chinese stale action showed `审核状态已变化，已为你刷新`; raw `Change set is not pending review` was absent. |
| 10 | Human Space admins satisfy editor content gates, while Agent grants and owner-only review gates remain unchanged. | `authorization.service.spec.ts` human-admin, Agent-admin-shaped, and owner-only tests; `source.service.spec.ts` queued human-admin test. | Authorization behavior is server-enforced and was not emulated as a browser-only assertion. |
| 11 | CodeMirror edit mode enables line wrapping. | `MarkdownWorkspace.spec.tsx` “enables CodeMirror line wrapping in edit mode”; `PageEditor.spec.tsx`. | The local editor rendered the CodeMirror edit surface with the tested line-wrapping extension. |
| 12 | Historical and collaborator assist tasks display history/stream status only; only tasks submitted during the current page mount may stream into or auto-apply to the editor, and only once. | `AgentAssistPanel.spec.tsx` historical/no-apply, collaborator-stream rejection, and current-mount/apply-once tests; `PageEditor.spec.tsx` state-safety regressions. | Browser acceptance avoided submitting any external Agent job; the state transition is deterministically covered by component tests. |
| 13 | Each historical version offers a Markdown preview modal independent of restore. | `PageVersionHistory.spec.tsx` “previews a historical Markdown version without restoring it”. | Chinese and English preview dialogs opened at the unchanged `/versions` URL; no restore dialog or request occurred. |
| 14 | Navbar uses a count endpoint and refreshes on mount, focus, visibility, a review-change event, route changes, and a 5-second poll; request sequencing prevents a late response from overwriting a newer count. | `Navbar.spec.tsx` verifies refresh triggers, polling, and out-of-order response protection; server `countPending` test. | Badge `1` was visible immediately after the synthetic run state was presented, without manual page refresh. |
| 15 | Server sorts pending, then approved, then historical states; newest first within a state. | `review.service.spec.ts` “orders pending and approved work before historical states, newest first within status”. | Pending row appeared above the published history row in the review DOM. |
| 16 | Approve-only is disabled until all candidates are decided; actions coalesce, refresh list/detail, announce count changes, and render mutually exclusive success/error feedback. | `ReviewPage.spec.tsx` covers disabled/helper, refresh, duplicate-action, failure-after-success, and conflict paths; Review service CAS tests cover the write boundary. | Pending approve-only was disabled with a visible reason; a stale action refreshed to approved and exposed `发布`. |
| 17 | Publishing page/relation candidates uses compare-and-swap guards; create candidates restore archived pages with the same source identity; active or raced changes return stable `CHANGESET_CONFLICT`; revert restores the complete pre-publication archived state. | `review.service.spec.ts` covers archived restoration and full rollback, page/relation CAS loss, concurrent restore CAS, active duplicate, and P2002 races. | Database identity behavior is transaction-level and was verified through the service harness, not mocked browser state. |
| 18 | Review errors use a fixed viewport toast with a close action, so long-page failures do not require scrolling. | `Toast.spec.tsx`; `ReviewPage.spec.tsx` localized fixed-toast test. | Chinese and English error elements included fixed viewport classes and remained at the top-right while the expanded review content stayed in place. |

## Residual environment notes

- The 39 skipped runtime tests require a configured real PostgreSQL `DATABASE_URL`; the skip count is unchanged and no new skip was introduced by this remediation.
- Existing jsdom limitations emit non-failing CodeMirror geometry and canvas warnings during client tests. All affected suites pass and the warnings are unrelated to these findings.
- Vite reports a pre-existing large-chunk advisory for `PageEditor`; production build still exits 0.

## Space creation regression

The regression was caused by the dashboard's default 20-record page combined with a missing deterministic server order. Creating a Space and then replacing the current page from a fresh list request could therefore omit the newly created row even though creation succeeded. The server now orders accessible Spaces by `createdAt desc, id desc`; the client treats the POST response as the immediate truth, prepends it, and exposes explicit 20-record pagination with ID de-duplication and stale-response guards.

Permission behavior was not tightened. Space creation does not require an existing Space-level `edit` grant: an authenticated human super admin remains allowed to create a Space, while Agent principals remain rejected. `SpaceService.create` creates the human caller's membership in the same write with role `owner`.

Final post-review automated evidence:

| Command | Result | Exact evidence |
| --- | --- | --- |
| `pnpm test` | PASS | Runtime 66 passed / 39 PostgreSQL-dependent skipped; server 563 passed; client 187 passed; sync protocol 22 passed; local sync 358 passed. Total: 1,196 passed, 39 skipped, 0 failed. |
| `pnpm typecheck` | PASS | Server, client, sync protocol, and local-sync TypeScript checks exited 0. |
| `pnpm lint` | PASS | ESLint exited 0 for server, client, and local-sync sources. |
| `pnpm build` | PASS | Shared, sync protocol, Nest server, Vite client, and local-sync production builds exited 0. |
| `git diff --check` | PASS | No whitespace errors. |

Regression-specific automated tests:

- `SpaceController.create > lets a human super admin create a Space as themselves`
- `SpaceController.create > continues to reject Agent principals`
- `SpaceService.findAll pagination > returns the requested page in deterministic newest-first order`
- `SpaceService.create ownership > creates the human caller as the Space owner in the same write`
- `Dashboard Space pagination and creation > prepends the POST response without depending on a second list request`
- `Dashboard Space pagination and creation > loads and de-duplicates the next page when more Spaces exist`
- `Dashboard Space pagination and creation > realigns from page one when an external insertion shifts the offset boundary`
- `Dashboard Space pagination and creation > realigns combined local and external total drift without losing the POST response`
- `Dashboard Space pagination and creation > preserves a creation made while an older page request is in flight`
- `Dashboard Space pagination and creation > discards an older page response and realigns the first page after deletion`
- `Dashboard Space pagination and creation > keeps pagination locked and ignores a stale load failure during deletion realignment`
- `Dashboard Space pagination and creation > shows a localized creation failure inside the open dialog`

Browser acceptance used the Codex in-app Browser at `http://127.0.0.1:5173/dashboard` against an isolated loopback mock API seeded with 25 synthetic Spaces; no production account or data was read or changed. At a 1280×720 desktop viewport, the initial page contained 20 cards and a `Load more` control. After the independent-review fixes, submitting `Post Review Created 26` closed the dialog and immediately rendered 21 cards with the POST response first and exactly once. Reload returned 20 cards with that persisted mock record still first. Loading more produced 26 cards with 26 unique names, retained the created record once at the top, appended `Mock Space 05` through `Mock Space 01` in order, and removed the exhausted control. A forced HTTP 500 kept the creation dialog open, displayed only the localized `Failed to create space` alert inside it, did not expose the mock server's raw message, and did not add a failed card.

Page identity was `AgentWiki` at `/dashboard`; the DOM contained the `My Spaces` heading and meaningful card content. No Vite or Next.js framework overlay was present, and the final console inspection contained 0 warnings and 0 errors. Browser screenshots captured the initial first page, the newly created first card, the appended older records, and the localized failure dialog; they were emitted as ephemeral Browser evidence and were not committed. This acceptance validates the rendered client against a deterministic mock contract, not a real PostgreSQL database or production authentication stack; those server boundaries remain covered by the automated controller/service suites above.

The independent review of `0000f11..28bd1ee` initially reported three Important findings and no Critical or Minor findings. The first remediation added external-`total` realignment, monotonic request ownership across success/error/completion, deletion/reset pagination locking, and a direct owner-membership service assertion. A later task review correctly found that the first drift guard was still restricted by `!listMutated`: an in-flight load-more combined with a local POST creation and a separate external top insertion could therefore suppress realignment. The earlier statement that all concurrency findings were closed was premature.

The final remediation compares a load-more response against both the request-time `total` and the current `total` that already includes local mutations. A response matching neither known state triggers page-one realignment even when `listMutated` is true. Locally POST-created Spaces remain in an unconfirmed-created set until a server response includes their IDs; a reset prepends any still-unconfirmed POST response instead of overwriting it. The explicit three-event regression was observed RED because `外部新空间` never appeared while `本地新空间` remained; after the minimal production change it passed with both items present and a third `skip=0,take=20` request. Final focused evidence is Dashboard `8/8` and controller/service `13/13`; the complete gate totals above supersede the earlier counts.
