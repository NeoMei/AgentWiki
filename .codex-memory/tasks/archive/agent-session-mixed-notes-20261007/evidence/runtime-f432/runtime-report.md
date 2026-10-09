# f432 Independent AgentWiki Acceptance Runtime

Status: **cleaned — owned services/schema/credential file removed**. Final cleanup verified 2026-10-06T18:26:09.171Z. Earlier sections record completed acceptance, not live runtime state. Exact product candidate **f4325942c53101e8c628cd68fc1b7f23f07ae5cd**. Own server/client builds are served from candidate-f4325942c531/agentwiki; old runtime artifacts and credentials were not reused. Root independently controls the UI; this runtime agent has not operated any browser.

## Entry and credential boundary

- Main read: http://127.0.0.1:51914/pages/6105526d-fbad-462c-b686-f9bc70f2adb7; edit: same URL plus /edit.
- Sibling long page: http://127.0.0.1:51914/pages/d8be02bb-5ca0-4885-a26a-60b23998557c; edit: same URL plus /edit.
- Reference IDs: e91da461-9c6d-4e43-8434-95271d51acb1, 7d7f2fc2-49b5-4500-b155-e07bca528c5e.
- Space cmuwzlfob001gr527htz23tm0; main 6105526d-fbad-462c-b686-f9bc70f2adb7; sibling d8be02bb-5ca0-4885-a26a-60b23998557c.
- New fixture account email/password exist only in runtime-f432/runtime.json, mode 0600. Root can read fields directly into its CUA variable and fill inputs without printing. Two long Chinese documents contain headings, code, wide tables and lists; two references are seeded.
- Owner agentwiki-independent20261007f432; launchd com.agentwiki.independent20261007f432.a78caba1; schema folder_test_e2e02011abbe4a17a7a3a42b343baa9f; API http://127.0.0.1:51913/api; UI http://127.0.0.1:51914; own Redis loopback port 53467. API/UI ports were checked free before launch. New random schema and Redis data directories belong only to this runtime.

## Current fresh verification

- Seven own archive/build/typecheck steps exit 0; shared generated Prisma client was never regenerated. Schema tokens match exactly (differences are formatting whitespace only).
- Migration corpus still 61 files with unchanged reviewed helper gate 39e27b72da1e030c676cb858b642c3f231d6ddc4d5f531b7f4749f45c9ced7a5. Protected inventory before/after isolated migration and startup remains unchanged; inventory digest e447573064bbbfc1fbeae49340e519e8b40478a9992ccfaf92e35cfbc93350c0.
- pre-accept API/DB checkpoint confirms both official pages exactly match initial title/content/updatedAt.
- verify-candidate.mjs rechecks all archived source and built artifact files. It passed before startup and after startup. Credential file mode verified 0600.
- External FIXTURE_TWO_NOTES fixture retains original marker/default behavior. Six pure-function guard checks pass; fixture SHA 6e05595bec0c220991f9beeba28c8f496d3dee23be6c88b2095eaa19332cf2b4. New marker changes only first 零散的信息 → 分散的信息 and first 逐渐建立 → 逐步建立 within allowed assistTarget.
- This is deterministic fixture acceptance, **not real provider acceptance**. No provider credentials are loaded. Production API and independent worker run with owned HOME/TMPDIR/uploads; all CLI source travels through stdin and event logs contain hashes.

## Provenance

| Artifact | SHA-256 |
|---|---|
| git archive bytes | 202fcd1be16000ce1abab081507e20ac44ddfe2f669e6e831ed87fe95f8f0a1d |
| archived source manifest | 7f1de8aed57ed10d4ea14762ad12ca1f4d7a21612ecbd67b03fe5a29cd3351de |
| server dist (763 files) | 9ab2d70c604084f2a34072f35a581fd48cc29f3a61dde47251f0d4d169b2634d |
| client dist (364 files) | ba3d3cea0d1d5e3341f82d5c635f131069805b1a9d33b0be8b097578834a659b |
| shared dist | f018a2cda8d1a260d50e10521f1129c08a1d3e3eccd00b7ca08b9a88bc5fcf09 |
| sync protocol dist | c277ef9048bba6490834780a8143ed111e2f610e00f5a698e3805950087ebe79 |

Per-file manifest receipts and candidate-build-receipt.json are retained. Actual product diff from prior accepted backend candidate contains five client source/test files and one planning doc, no server/migration change. Fresh server dist is byte-identical to prior 1735f341 server dist. Prior runtime/http-db-receipt.json's 13 HTTP/DB gates belong to **1735f341**, not this candidate, and were **not rerun here**. Current fresh claims are limited to the checks listed above and root's separately captured UI results.

## Prepared root-requested checkpoints

All commands run inside /tmp/agentwiki-independent-acceptance-20261006.4eB3KG/runtime-f432/.

- Before explicit Save: node verify-pages.mjs --checkpoint=pre-save.
- After explicit Save: node verify-pages.mjs --checkpoint=post-save --page-id=<main-or-sibling-owned-id> --expected-content-file=<precise-owned-UTF8-draft>. It verifies exact expected bytes, intended page version advancement, unchanged sibling/main as appropriate, and API/DB agreement. Defaults to main if page-id omitted.
- UI marker history readback: node capture-final-two-notes.mjs. It compares final two FIXTURE_TWO_NOTES task snapshots and annotations via HTTP/DB, stores task IDs and hashes, and verifies quotes occur in their recorded snapshots.
- Prepared authorization revocation check: node verify-auth-revocation.mjs. It is syntax checked, **not executed yet**. On root request it creates fresh separate accounts/Space inside this runtime, checks viewer proposal denial, starts actual blocking fixture, revokes viewer membership, verifies CLI stopped/result suppressed/session403/legacy null and its disposable page unchanged. Browser account/Space is not modified.
- Inventory/provenance: node verify-inventory.mjs. It rechecks protected catalog, candidate source/dist and secret file mode.
- Wait for root to authorize each further checkpoint and final cleanup. No premature shutdown. After root confirms logout/tab closure: node cleanup.mjs validates owner/PID/start identity, removes only owned schema/files/job and verifies protected inventory unchanged. Then independently verify released ports and delete stripped runtime.json, retaining sanitized state/receipts.

## Browser storage boundary

Root may reuse the test-only origin. Prior local notes/preferences can remain in origin storage; page IDs and account/Space are new. This agent has not cleared browser storage or altered other runtime/browser resources. No other services, schemas, shared dependencies or worktree files were changed.

At 2026-10-06T18:06:42.325Z, read-only staged-before-send receipt confirms root CUA Space has 0 sessions and 0 turns in DB, and 0 sessions via HTTP. This proves no server send existed at that checkpoint; it does not inspect private browser note storage.

## Fresh authorization revocation checkpoint

At 2026-10-06T18:06:43.578Z, verify-auth-revocation.mjs ran on root request and passed for exact f432 candidate. It created a separate disposable account pair and Space (cmuwzq467002ur5270lz4nagc); root CUA Space was not modified. Viewer proposal returned 403, viewer question started real fixture PID 59213, removing membership stopped it in 541 ms with no published result. Session read denied, legacy task read null, disposable official page unchanged. Receipt: auth-revocation-receipt.json. This is a fresh focused checkpoint, not a rerun of the old 13-case gate.

## Final UI readback before cleanup

At 2026-10-06T18:12:23.501Z, root requested a final two-marker-turn API/DB history readback. Page persistence checkpoints are recorded separately; this readback does not infer whether Save occurred. final-ui-inventory-receipt.json confirms protected inventory, candidate source and all built artifact hashes unchanged. final-ui-two-notes-http-db-receipt.json records the final two explicit marker turns with API/DB agreement for snapshot and annotations, using hashes rather than secret/source dumps. Runtime remains active pending root logout/tab-close confirmation.

## Explicit Save persistence checkpoint

At 2026-10-06T18:13:18.544Z, after root's actual UI Save, post-save API/DB check passed. Main page 6105526d-fbad-462c-b686-f9bc70f2adb7 matches ui-final-expected.md exactly; title unchanged and persisted version advanced from 2026-10-06T18:03:04.563Z to 2026-10-06T18:12:49.412Z. Saved content SHA-256 92f3a56e666ed73e482e66137e3ea83a0334e7886582ae76eaa338b56055662a. Sibling title/content/version remain exactly baseline. Receipt: page-checkpoint-post-save.json. This run intentionally includes an explicit Save and must not be described as whole-run no-save. Runtime remains active for root's remaining cross-page/responsive/stop/failure UI checks.

## Root UI stop and source history checkpoint

At 2026-10-06T18:19:21.358Z, four browser turns were independently checked through API/DB plus actual fixture process-event logs. Turn 3 runs on the sibling page while actual worker input retains immutable main-page snapshots and their pre-Save source versions from turns 1/2; all reference hashes/versions and annotations agree. Turn 4 cmuwzzxlf005cr527300ir904 is cancelled with null result/empty progress, fixture PID 63306 terminated by SIGTERM at 2026-10-06T18:14:34.983Z, and PID/start identity readback proves the original process absent. No completion event or late publication exists at readback; status/version remain stable over a second 1500ms check. Active queued/running AssistTask rows in owned schema: 0. Receipt: final-stop-history-receipt.json. Runtime services remain active pending root's browser completion.

Final stop checkpoint also re-read official pages: main remains byte-exact ui-final-expected.md at the same explicit Save version; sibling still original baseline. Source, built artifacts, 61-file migration gate and protected inventory remain unchanged. Receipts: final-stop-page-receipt.json and final-stop-inventory-receipt.json. No runtime cleanup has run.

## Root UI authorization-revocation fixture

At 2026-10-06T18:23:47.997Z, on root's explicit request, only UI user cmuwzlfnz001fr527cerzhxa6's SpaceMember row for cmuwzlfob001gr527htz23tm0 was deleted in owned schema. Platform role was user (no super_admin read bypass). Because it was the only owner, the product API's last-owner guard would reject normal member removal; this is explicitly an isolated authorization-loss fixture injection, not a last-owner API-flow acceptance. User account/status/auth version, Space, all 4 page content/version rows, and every other membership were unchanged. Original token now receives 403 for main/sibling page, loaded session, and Space session-list endpoints. Content and session data are retained for DB evidence; runtime remains active. Receipt: ui-space-access-revocation-receipt.json. Subsequent page checks must expect HTTP403 and use owned DB for content equality, rather than the earlier HTTP200 checkpoint.

## Final cleanup complete

At 2026-10-06T18:26:09.171Z, after root confirmed actual lost-access UI behavior, logout, network/viewport restoration and own tab closure, cleanup validated exact owner/PID/start identities and stopped only this runtime. Own schema folder_test_e2e02011abbe4a17a7a3a42b343baa9f is absent by SQL readback; protected inventory remains unchanged (e447573064bbbfc1fbeae49340e519e8b40478a9992ccfaf92e35cfbc93350c0). Own launchd job/plist, uploads, Redis persistence and temporary HOME/TMPDIR were removed. All 5 recorded fixture child process identities are absent. Loopback binding verified API/UI/Redis ports 51913, 51914, 53467 released. runtime.json was stripped by the harness, then deleted and absence verified; only sanitized runtime-final-state.json remains. Candidate source/build hashes were checked once more and preserved, along with all receipts and this report.

Root's actual UI findings include mixed-note acceptance, real undo/redo, explicit Save, cross-page history/reload, stop, responsive layouts and access-loss clearing; this agent's own evidence covers API/DB/process/provenance boundaries. The UI failure-input exercise did not create a fifth server turn at the revocation checkpoint (4 turns remained). Test-only origin notes/preferences may remain; no other browser/resource or old runtime evidence was cleared.
