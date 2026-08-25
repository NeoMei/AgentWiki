# Collaboration Agent Preparation Acceptance

Local acceptance was completed on 2026-08-25 (Asia/Shanghai) against isolated local services only.

## Final remediation acceptance

This section supersedes the earlier commit and test counts below while retaining them as historical acceptance evidence.

- Final product commits: `7418b4e` reconciles authoritative Agent eligibility and connection state, request/route races, mutation retries, deterministic create idempotency, and atomic audit persistence; `ab49860` restores focus through a live fallback ref when the original preparation opener is removed.
- Final test-contract commits: `9abcdcc` awaits asynchronous modal focus restoration, `a6e0bbe` preserves Owner/Admin guidance across the 3-second authoritative poll after a 403, and `2392223` replaces the fallback DOM in the same close batch so the regression distinguishes the old snapshot implementation from the live-ref fix.
- Fresh full gates on final code: PASS. Lint, four workspace typechecks, five workspace builds, and `git diff --check` exited 0. The repository passed 2,358 tests with 54 existing environment-gated skips and 0 failures. The existing Vite chunk-size advisory was the only build warning.
- Isolated PostgreSQL gates: PASS. Collaboration schema/migration passed 2/2, workflow scenarios passed 10/10, and concurrent Agent-create idempotency plus audit rollback passed 1/1. The DB spec fails closed unless `DATABASE_URL` exactly equals `COLLABORATION_TEST_DATABASE_URL`, the database name contains `test`, and the schema is a random `collaboration_test_*` name.
- Real Browser acceptance: PASS on desktop and 390×844. It covered no executable Agents, inline create/enable/Editor Grant, connect later, external connection auto-clear, direct selection of an unconnected Agent, real Owner-to-Editor permission loss with 403, and focus restoration after the opener disappeared. At 390 px the document `scrollWidth` remained 390 and Browser console error/warn remained empty.
- Permission persistence: after a real 403, the dialog closed, all six preparation actions disappeared, executable Agent options remained, and Owner/Admin guidance persisted after a further 4.7-second wait spanning the authoritative poll. A prior apparent disappearance was correlated exactly with Vite HMR invalidation during shared development and did not reproduce after HMR became quiet.
- Focus restoration: after “Prepare first Agent” → authorize an existing Agent → Connect later, the opener and dialog were gone and `document.activeElement` was the Step 2 mapping `H2` with `tabIndex=-1`; the accessibility tree also marked the heading active.
- Independent final review: Critical 0 / Important 0 / Minor 0. The only review note was the weak first version of the fallback test, which `2392223` corrected before this conclusion.
- Final cleanup: PASS. The Browser tab was closed and viewport reset; API/Vite stopped, ports 3000/5173 were free, the service PID was absent, all four relevant Redis key classes were empty while Redis still returned PONG, the exact random schema was absent, the count of every `collaboration_test_*` schema was 0, and the temporary health artifact was absent.
- External release boundary: no push, npm publish, production deployment, production data write, or production configuration change was performed during this remediation.

- Browser/runtime product tested commit: `e83d1530aa4d93c5a22104360e0dbef193750a2a` (Browser flow began from clean feature HEAD `5594a171d91f8bb67fbfc6bbec9c878af0df9a04`; the only subsequent product change was the verified worker relay fix in `e83d153`).
- Final automated gate commit: `658538ced957f683b7e6131d688c5c0a41bb7590`; this follow-up added two contract tests only, then reran the complete automated gates. It did not change product runtime code or rerun Browser acceptance.
- Focused server/client tests: PASS, server 3 suites / 66 tests and client 5 files / 103 tests; server and client focused typechecks also exited 0.
- Full lint/typecheck/test/build: PASS, lint 1 scope, typecheck 4 workspaces, 2,304 tests passed and 53 existing environment-dependent tests skipped, build 5 workspaces; `git diff --check` exited 0. The existing Vite chunk-size advisory was the only build warning.
- Real create -> Grant -> installation -> onboard -> auto-detect -> map: PASS, one `Acceptance Writer` Agent was created with Editor access, onboarded with pinned Local Sync `0.6.1` in an isolated HOME, automatically detected without reload, and selected only for the target Planner slot. Local Sync doctor reported 10/10 checks passing.
- Pending connection warning in mapping and review: PASS, a second Agent was mapped before connection, both warnings remained visible, and Start remained enabled.
- Owner/Admin, Editor, Super Admin permission cases: PASS, Owner and Admin each completed a real preparation mutation; Editor saw no mutation action plus the Owner/Admin instruction; platform Super Admin completed preparation with 0 `SpaceMember` rows.
- Desktop and 390px, scrollWidth equality: PASS, desktop completed empty -> prepare -> onboard -> map -> review -> join -> dashboard; mobile repeated empty, dialog, long instruction, copied/retry, mapping-pending, and review-pending states with `document.documentElement.scrollWidth === 390` in 7/7 assertions.
- Browser console: no error/warn worth fixing; the AgentWiki page identity was visible, content was non-blank, no framework error overlay was present, and the same Browser tab selected by `getForUrl(http://127.0.0.1:5173/)` was reused throughout.
- Cleanup: PASS, isolated schema, 4 users, 3 Spaces, 4 Agents, 5 Grants, 1 credential, 4 runs, API/worker/client processes, 4 Redis installation keys, isolated connection config, scripts, logs, and 18 temporary screenshots were removed. Post-cleanup checks were schema `false`, ports 3000/5173 free, 4/4 PIDs absent, Redis keys `0`, and both temporary and Trash paths absent.
- Production: read-only reproduction only; no deployment, push, npm publish, production data write, or production configuration change was performed.

## Isolated runtime

- Client: `http://127.0.0.1:5173/`; API: `http://127.0.0.1:3000/api`; Redis: `127.0.0.1:6379`.
- PostgreSQL database: `agentwiki_collaboration_test`; schema: `collaboration_test_task6_mt7qlzv7_6e15acb6`.
- The database URL and schema name were validated as test-only before migration and again before the exact schema drop. PostgreSQL `public` was never migrated, dropped, cleaned, or used for fixtures.
- API health returned all 4 expected healthy fields; the worker remained running without a restart loop.

## Browser interaction evidence

At 1280 px, the built-in Coding template opened at Step 2 with no executable Agent and showed the first-Agent preparation action. The dialog created `Acceptance Writer`, granted Editor access, generated the one-time instruction, copied it, and observed the isolated Local Sync onboarding transition from waiting to connected without a page reload. Only Planner was automatically mapped. `Acceptance Pending` then used the connect-later path; mapping and review warnings were visible while Start remained usable. Completing the remaining mappings and accepting the separation-risk acknowledgement produced the existing join instructions and a Running dashboard.

The instruction copy contained the complete three-line user-facing block, while the execution harness extracted only the strict pinned command line. The one-time installation code stayed inside the intended instruction/onboarding boundary and was not written to application source, committed artifacts, or retained shell logs.

At 390 x 844, seven authoritative states each returned `scrollWidth === 390`; the long instruction panel itself had `clientWidth === scrollWidth === 358`. Buttons remained reachable and the dialog content remained scrollable. Eighteen screenshots were inspected outside the repository and deleted during cleanup; no temporary screenshot is committed.

Permission checks used disposable accounts and Spaces in the isolated schema. An Editor had 0 preparation buttons in a Space with existing Agents and 0 mutation buttons in an empty Space, where the UI said to ask a Space Owner or Admin. An Admin performed a real Agent create/Grant/installation flow. A platform Super Admin with no human membership row saw all six preparation entries and performed the same real flow.

## Defect found and fixed during acceptance

The first real worker run repeatedly logged `Cannot read properties of null (reading 'in')` while relaying collaboration run hints. Systematic debugging traced this to `CollaborationGateway.onModuleInit()` subscribing inside the headless worker even though only the API owns a Socket.IO server. A regression test first failed with two worker subscriptions, then commit `e83d153` made the worker skip those API-only relay subscriptions. The original focused gateway suite passed 20/20 after the product change. Follow-up commit `658538c` added explicit contracts for unset-role API defaults and worker assist publishing; mutation proof made each new test fail against its targeted wrong implementation, the restored suite passed 22/22, and the complete repository suite then passed 2,304 tests. A rebuilt real worker had already received no relay subscription: publishing a valid isolated run hint reported exactly one Redis subscriber (the API), and the worker log remained free of relay errors. The follow-up did not recreate the schema or services.

## Cleanup evidence

Before dropping the schema, the resolved target was `agentwiki_collaboration_test|neomei|true`; the exact validated drop removed 64 schema-owned objects and the follow-up existence query returned `false`. API PID 42391, original worker PID 42502, client PID 42610, and regression worker PID 47112 were all absent. Ports 3000 and 5173 had no listener. The four exact Redis installation keys returned an aggregate `EXISTS` count of 0. The isolated HOME and all acceptance artifacts were permanently removed from both `/tmp` and the user Trash and are not recoverable.
