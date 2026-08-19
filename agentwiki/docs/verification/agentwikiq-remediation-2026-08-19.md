# AgentWikiQ remediation verification — 2026-08-19

## Scope

Findings 1–18 from `测试报告/AgentWikiQ/问题清单.md`. Verification was performed on the isolated branch `codex/agentwikiq-remediation`; no production account, production data, deployment, package publication, or marketplace submission was used.

## Automated gates

| Command | Result | Evidence |
| --- | --- | --- |
| `pnpm test` | PASS | Runtime 66 passed / 39 PostgreSQL-dependent skipped; server 553 passed; client 175 passed; sync protocol 22 passed; local sync 358 passed. Total: 1,174 passed, 0 failed. |
| `pnpm typecheck` | PASS | Server, client, sync protocol, and local sync TypeScript checks exited 0. |
| `pnpm lint` | PASS | ESLint exited 0 for server, client, and local-sync sources. |
| `pnpm build` | PASS | Shared, sync protocol, Nest server, Vite client, and local-sync production builds exited 0. |
| `git diff --check` | PASS | No whitespace errors. |

The final gate run was repeated after the landing-page login localization audit fix.

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
| 1 | Reset response identifies the exact account, copies labeled credentials, generates a random policy-compliant password, hashes it, and forces password change. | `AdminPage.spec.tsx` “keeps the exact account email visible…”; `platform-admin.service.spec.ts` “issues a different cryptographically-random temporary password…”; existing Auth/guard suites verify credential validation and `mustChangePassword` propagation. | Reset dialog retained the exact email and displayed labeled email and temporary password together after confirmation. |
| 2 | Both the standalone and actual landing-page login forms map stable auth/rate-limit/network outcomes through i18n instead of rendering server prose. | `Login.spec.tsx`; `ProductPage.spec.tsx` “localizes authentication errors on the actual landing-page login form”; `error-message.spec.ts`. | Chinese and English invalid-login messages were verified on the real `/` login entry. |
| 3 | The guide no longer depicts the retired one-click connection screen. | `UsageGuide.spec.tsx`; `GatewayGuidePreview.spec.tsx`. | Current public guide remained accessible in both languages; no credential-bearing legacy UI is rendered by the preview. |
| 4 | Unified gateway guide preview matches the current card structure and actions. | `GatewayGuidePreview.spec.tsx` “shows the current unified gateway card without credentials”; `UsageGuide.spec.tsx`. | Public navigation exposed the current Guide route in both languages. |
| 5 | Obsidian guide states official review is pending and gives GitHub Release manual installation files and path. | `ObsidianGuide.spec.tsx` “states that community review is pending and gives exact manual files”. | No second marketplace submission was made; the guide is a public route and does not require an account. |
| 6 | File mode has a named chooser, selected filename state, an explicit upload action, name autofill, and disabled-before-selection behavior. | `SourcesPage.spec.tsx` “shows an explicit selected file and upload button”. | Chinese and English source forms showed the explicit chooser and upload button; disabled-before-selection state was visible. |
| 7 | Upload boundary repairs Latin-1-decoded UTF-8 filenames, preserves correct names, and rejects invalid UTF-8; uploaded bytes are decoded strictly. | `source-upload.spec.ts` three filename/UTF-8 tests; `SourcesPage.spec.tsx`; source pipeline regression suite. | Chinese source UI was readable; selected-file transition is covered by the component test because browser file-chooser automation was unavailable. |
| 8 | URL ingestion supports public redirects and readable HTML extraction while revalidating every hop and rejecting private-address redirects/binary media. | `remote-source.spec.ts`; `source.service.spec.ts` “revalidates every redirect and returns extracted HTML” and private-hop rejection tests. | Safe diagnostics are rendered by the run/source UI; no external URL was fetched during isolated browser acceptance. |
| 9 | Review submission/publish conflicts map business codes to localized messages and never display the English server message. | `ReviewPage.spec.tsx` “shows a localized fixed toast and refreshes stale detail on a CAS conflict”; `error-message.spec.ts`. | Chinese stale action showed `审核状态已变化，已为你刷新`; raw `Change set is not pending review` was absent. |
| 10 | Human Space admins satisfy editor content gates, while Agent grants and owner-only review gates remain unchanged. | `authorization.service.spec.ts` human-admin, Agent-admin-shaped, and owner-only tests; `source.service.spec.ts` queued human-admin test. | Authorization behavior is server-enforced and was not emulated as a browser-only assertion. |
| 11 | CodeMirror edit mode enables line wrapping. | `MarkdownWorkspace.spec.tsx` “enables CodeMirror line wrapping in edit mode”; `PageEditor.spec.tsx`. | The local editor rendered the CodeMirror edit surface with the tested line-wrapping extension. |
| 12 | Historical assist tasks display history only; only tasks submitted during the current mount may auto-apply, and only once. | `AgentAssistPanel.spec.tsx` historical/no-apply and current-mount/apply-once tests; `PageEditor.spec.tsx` state-safety regressions. | Browser acceptance avoided submitting any external Agent job; the state transition is deterministically covered by component tests. |
| 13 | Each historical version offers a Markdown preview modal independent of restore. | `PageVersionHistory.spec.tsx` “previews a historical Markdown version without restoring it”. | Chinese and English preview dialogs opened at the unchanged `/versions` URL; no restore dialog or request occurred. |
| 14 | Navbar uses a count endpoint and refreshes on mount, focus, visibility, a review-change event, route changes, and a 5-second poll. | `Navbar.spec.tsx` “refreshes the pending badge on focus, custom event, and polling”; server `countPending` test. | Badge `1` was visible immediately after the synthetic run state was presented, without manual page refresh. |
| 15 | Server sorts pending, then approved, then historical states; newest first within a state. | `review.service.spec.ts` “orders pending and approved work before historical states, newest first within status”. | Pending row appeared above the published history row in the review DOM. |
| 16 | Approve-only is disabled until all candidates are decided; actions coalesce, refresh list/detail, announce count changes, and show success/error feedback. | `ReviewPage.spec.tsx` disabled/helper, refresh, duplicate-action, failure, and conflict tests; Review service CAS tests. | Pending approve-only was disabled with a visible reason; a stale action refreshed to approved and exposed `发布`. |
| 17 | Publishing a create candidate restores an archived page with the same source identity; active or raced duplicates return stable `CHANGESET_CONFLICT`. | `review.service.spec.ts` archived restoration, concurrent restore CAS, active duplicate, and P2002 race tests. | Database identity behavior is transaction-level and was verified through the service harness, not mocked browser state. |
| 18 | Review errors use a fixed viewport toast with a close action, so long-page failures do not require scrolling. | `Toast.spec.tsx`; `ReviewPage.spec.tsx` localized fixed-toast test. | Chinese and English error elements included fixed viewport classes and remained at the top-right while the expanded review content stayed in place. |

## Residual environment notes

- The 39 skipped runtime tests require a configured real PostgreSQL `DATABASE_URL`; the skip count is unchanged and no new skip was introduced by this remediation.
- Existing jsdom limitations emit non-failing CodeMirror geometry and canvas warnings during client tests. All affected suites pass and the warnings are unrelated to these findings.
- Vite reports a pre-existing large-chunk advisory for `PageEditor`; production build still exits 0.
