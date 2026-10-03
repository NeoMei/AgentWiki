# AgentWiki v0.12.10

Error toast notifications now dismiss automatically after three seconds, matching success notifications. Manual dismissal remains available. Changing the message or notification kind restarts the timer; callback-only rerenders use the latest callback without extending the lifetime, and unmounting cancels the timer.

- Production change: remove the success-only timer guard in `Toast.tsx`.
- Replace Toast tests with 11 cases covering both notification kinds, timing boundaries, callback updates, message/kind replacement, manual close and unmount cleanup.
- Align application, server and client versions to 0.12.10. Local Sync remains 0.10.0 and sync protocol remains 0.6.0. No dependency, lockfile or database migration changes.

Validation:

- RED: 4 failed / 7 passed, matching the four expected error-toast lifetime failures.
- GREEN: 11 / 11 Toast tests passed.
- Client suite: 111 files / 1526 tests passed; client lint and build passed.
- Full application build, workspace typecheck and lint passed. Lint retains one warning in unchanged project-taskboard code; frontend build reports circular/large chunks.
- Node runtime/version contract: 33 passed.
- Root `pnpm test` exited 1 during runtime database gates: 24 passed / 14 failed / 95 skipped in that phase, due to missing dedicated test database URLs and the existing Folder migration-corpus hash mismatch. Root test did not reach subsequent phases; full-repository acceptance is not claimed.
- Initial direct server suite: 152 suites / 2663 tests passed, 5 suites / 26 tests skipped; one suite failed to load `PrismaClient`. After standard Prisma Client generation during package-manager setup, the failing MCP suite passed separately (3 tests). Final direct server-suite rerun passed: 153 suites / 2666 tests passed, 5 suites / 26 tests skipped.

Production deployment (2026-10-01, Asia/Shanghai):

- Deployed at approximately 02:06 to `/root/agentwiki` on `113.249.120.24`. Application/server/client manifests report 0.12.10; API, Worker and Frontend are active.
- Applied the eight-file release patch from commit `484e3f16318573dbe56d9a84dfca7e342eeed499` to a staged copy of production. This preserves production Assist fixes absent from the release baseline; the complete deployed tree is therefore the previous production tree plus this release patch, not a byte-identical checkout of the GitHub tag.
- Built shared, sync protocol, server and client in staging. The final Local Sync build step failed because the production dependency tree lacks an SDK module; Local Sync is not served by this application deployment. Its partial staged `dist` was quarantined, preserving the previous absence of that directory. No sync package was published.
- OpenCode runtime preflight passed at 1.18.12; three existing Assist source-file SHA-256 values remain identical before/after. Migration trees are byte-identical and no database migration was executed.
- Verified coordinated PostgreSQL/attachment backup: `/var/backups/agentwiki/toast-v01210-20261001020626`; database dump SHA-256 `2323af5d1d16a320890a32e7a55901d756502e8f8ca408f0db1894b22ada5378`; manifest SHA-256 `7158ee8a357959889476c82588d66afe33bb8d6ff4d1da929a049d5f8858235b`.
- Previous application retained at `/root/agentwiki-previous-toast-20261001020626`. Existing frontend assets were preserved for open browser tabs.
- Public `/api/health`: status, database, redis, auditPersistence and attachmentStorage all `ok`. Public HTML serves `index-DHD-CzB0.js`, which references the new `Toast-CauaP4rv.js`; its SHA-256 matches the server artifact (`9899b03815b716c47f5f3f23666b4009971ab724b7ca68176d175459569caff5`). The published Toast bundle includes the three-second timer with no success-only guard.
- Live logged-in reproduction of the collaboration wizard has not been performed. Existing tabs need a page refresh to load the new entry bundle.
