# AgentWikiQ remediation verification — 2026-08-19

## Scope and result

This is the single final verification record for the AgentWikiQ remediation and its independent-review follow-up. Verification ran on the isolated branch `codex/agentwikiq-remediation`; no production account, production data, deployment, package publication, database migration, or marketplace submission was used.

All validated Important and Minor findings are closed. The fresh final gate run passed with 1,232 tests, 39 environment-dependent skips, and 0 failures.

## Final remediation coverage

### Space listing and creation

- `GET /spaces` now supports an opaque keyset cursor bound to `(createdAt, id)` and returns `nextCursor`, `hasMore`, `revision`, and `resetRequired`. Server ordering is `createdAt desc, id desc`.
- The cursor revision is calculated from the complete accessible active-Space key set inside a repeatable-read transaction. A stale cursor resets to the authoritative first page, including insert/delete combinations whose total count is unchanged.
- Existing `skip`/`take` callers remain supported; `take` is capped at 100. Request/response DTOs and client response types cover both contracts.
- Dashboard server snapshots and local optimistic creations are separate. An unconfirmed creation is removed when a response confirms its ID, when a causally newer authoritative first page omits it, or when its five-minute safety TTL expires.
- A Space already observed by a GET response is not added again when an older POST response completes. Local mutations invalidate in-flight continuation pages instead of inferring consistency from UI counts or offsets. A timer removes an unconfirmed overlay at its safety TTL even if no later list request completes. A cursorless continuation retries as an authoritative reset. List and deletion errors use separate state, so a successful current GET clears an earlier list error without hiding a newer destructive-action failure.
- The create modal uses the shared accessible modal component: `aria-modal`, label association, initial focus, focus trap, inert background, Escape dismissal, and opener focus restoration. During POST, X, Cancel, Escape, and backdrop dismissal are all disabled, while a failed POST remains visible in the dialog.

### URL ingestion safety and diagnostics

- The pinned DNS lookup implements the Node `LookupFunction` contract for both scalar and `{ all: true }` callbacks. Redirect-hop DNS validation, private-network blocking, and `proxy: false` remain enforced.
- Real local HTTP and HTTPS Agent integration tests exercise Axios without mocking Axios or the Agent and no longer produce `ERR_INVALID_IP_ADDRESS` on the supported Node contract.
- Failed ingestion Runs retain the existing safe error string and now persist structured `result.failure.stage`, `result.failure.code`, and allowlisted source metadata. Diagnostic URLs discard userinfo, query strings, and fragments before persistence; the Runs UI applies the same defensive sanitization. Signed-redirect persistence, Run retrieval, and rendered-UI tests cover that response model.

### Review, authentication, and stable errors

- Publish/revert requests against already-published, publishing, reverted, reverting, or otherwise stale states return HTTP 409 with `CHANGESET_INVALID_STATE`. Only genuinely unapproved draft/pending publication attempts return `APPROVAL_REQUIRED`.
- Service and real controller/filter HTTP integration tests cover the 409 envelope. The client refreshes detail and list after a 409 and renders the newly valid action.
- Password-reset integration uses real bcrypt hashing/comparison across reset, persisted hash, temporary-password login, `mustChangePassword`, forced change, and subsequent login. Reusing the temporary password is rejected with `AUTH_PASSWORD_POLICY`.
- Client error mapping accepts the stable `RESOURCE_CONFLICT` code and retains `CONFLICT` compatibility.

The earlier AgentWikiQ findings remain covered by their existing authentication, guide, source upload, authorization, editor, assist-task, version-preview, review-count, ordering, compare-and-swap, rollback, and fixed-toast regression suites. This follow-up did not weaken those behaviors.

## Fresh automated gates

| Command | Result | Exact evidence |
| --- | --- | --- |
| `pnpm test` | PASS | Runtime: 66 passed / 39 PostgreSQL-dependent skipped; server: 583 passed; client: 203 passed; sync protocol: 22 passed; local sync: 358 passed. Total: **1,232 passed, 39 skipped, 0 failed**. |
| `pnpm typecheck` | PASS | Server, client, sync protocol, and local-sync TypeScript checks exited 0. |
| `pnpm lint` | PASS | ESLint exited 0 for server, client, and local-sync sources. |
| `pnpm build` | PASS | Shared, sync protocol, Nest server, Vite client, and local-sync production builds exited 0. |
| `git diff --check` | PASS | No whitespace errors after the final code and documentation changes. |

Focused RED-to-GREEN evidence:

| Area | RED before implementation | GREEN after implementation |
| --- | --- | --- |
| Space keyset/revision service and DTO | 4 failures; review later identified two missing contract locks | Service 15/15; controller 4/4 |
| Source lookup, real HTTP/HTTPS Agents, failed Run result | 4 failures / 18 passes; signed-redirect leak later failed 1 focused test | 23/23 |
| Review stale service and HTTP envelope | 4 failures / 38 passes; draft/pending exception coverage was then added | Service + HTTP 46/46 |
| Real bcrypt reset/login/change flow | 1 failure / 1 pass | 2/2 |
| Dashboard cursor/overlay/modal/accessibility | 10 failures across initial focused groups; autonomous TTL, failed-reset retry, and cross-operation error ownership each added one later RED | 22/22 |
| Run diagnostic UI defense | Raw credential-bearing URL rendered in 1 focused RED | 2/2 |
| Stable client error mapping | 1 failure | 4/4 |
| Review client 409 refresh | Existing behavior already passed the stronger rendering assertion | Review page 9/9 |

## Browser acceptance

The Codex in-app Browser exercised the local Vite client at `http://127.0.0.1:5173/dashboard` against an isolated loopback mock API at a 1280×720 viewport. All identities and Spaces were synthetic.

- Initial keyset page: 20 cards. Continuation: 25 cards, 25 unique names, `Space 01` first and `Space 25` last, with the exhausted control removed.
- Net-zero external drift: the mock deleted the old head and tail and inserted two new head records while total remained 25. Using the old cursor produced an authoritative reset with 20 unique cards, `External Head A/B` first, and neither deleted record present. Continuing from the new cursor produced 25 unique cards with no ghost or duplicate.
- Accessible modal: `aria-modal="true"`, `aria-labelledby="create-space-title"`, `Name *` resolved to `create-space-name`, initial focus landed on that input, the background was inert, Tab wrapped from the last control to Close, Escape closed the idle dialog, and focus returned to New space.
- Delayed POST: Close, Cancel, and submit were disabled. Escape and a real backdrop click both left the dialog open. When the delayed response completed, `Immutable Browser Created` appeared first immediately and exactly once.
- Reload: the mock-persisted `Immutable Browser Created` remained first and appeared exactly once, confirming reconciliation from the server snapshot.
- Failure: an HTTP 409 with `RESOURCE_CONFLICT` kept the modal open and displayed `This item conflicts with an existing resource.` After failure, closing controls were re-enabled and focus restoration still worked.
- Run diagnostics: the mock deliberately returned `https://viewer:password@example.com/article?token=top-secret#private-fragment`; the rendered page displayed only `https://example.com/article` and contained none of the password, token, or fragment.
- Final Browser inspection found 0 warning/error console entries, 0 Vite error overlays, and 0 React error surfaces.

## Residual environment notes

- The 39 skipped runtime tests require a configured real PostgreSQL `DATABASE_URL`; this remediation introduced no new skip.
- Existing jsdom limitations emit non-failing CodeMirror geometry and canvas warnings during client tests. All affected suites pass.
- Vite reports the pre-existing large-chunk advisory for `PageEditor`; the production build exits 0.
- Browser acceptance validates the rendered client against a deterministic isolated API contract. Database transaction behavior, real bcrypt, controller envelopes, and real local HTTP/HTTPS Agents are verified by the automated server suites rather than the Browser mock.
