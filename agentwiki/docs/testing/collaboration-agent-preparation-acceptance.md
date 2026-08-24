# Collaboration Agent Preparation Acceptance

Local acceptance was completed on 2026-08-25 (Asia/Shanghai) against isolated local services only.

- Tested local commit: `e83d1530aa4d93c5a22104360e0dbef193750a2a` (Browser flow began from clean feature HEAD `5594a171d91f8bb67fbfc6bbec9c878af0df9a04`; the only subsequent product change was the verified worker relay fix in `e83d153`).
- Focused server/client tests: PASS, server 3 suites / 66 tests and client 5 files / 103 tests; server and client focused typechecks also exited 0.
- Full lint/typecheck/test/build: PASS, lint 1 scope, typecheck 4 workspaces, 2,302 tests passed and 53 existing environment-dependent tests skipped, build 5 workspaces; `git diff --check` exited 0. The existing Vite chunk-size advisory was the only build warning.
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

The first real worker run repeatedly logged `Cannot read properties of null (reading 'in')` while relaying collaboration run hints. Systematic debugging traced this to `CollaborationGateway.onModuleInit()` subscribing inside the headless worker even though only the API owns a Socket.IO server. A regression test first failed with two worker subscriptions, then commit `e83d153` made the worker skip those API-only relay subscriptions. The focused gateway suite passed 20/20 after the change. A rebuilt real worker then received no relay subscription: publishing a valid isolated run hint reported exactly one Redis subscriber (the API), and the worker log remained free of relay errors.

## Cleanup evidence

Before dropping the schema, the resolved target was `agentwiki_collaboration_test|neomei|true`; the exact validated drop removed 64 schema-owned objects and the follow-up existence query returned `false`. API PID 42391, original worker PID 42502, client PID 42610, and regression worker PID 47112 were all absent. Ports 3000 and 5173 had no listener. The four exact Redis installation keys returned an aggregate `EXISTS` count of 0. The isolated HOME and all acceptance artifacts were permanently removed from both `/tmp` and the user Trash and are not recoverable.
