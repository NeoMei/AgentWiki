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

Production deployment remains pending SSH authentication at release preparation time.
