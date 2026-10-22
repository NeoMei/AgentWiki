# Migration corpus review — 2026-10-23

The `full_test_triage` reviewer independently inspected the committed SQL before updating the test corpus lock. This review approves the exact migration bytes below for the existing protected test-database wrappers. It does not certify production deployment or the complete runtime suite.

## Exact inputs

- Candidate: `cec79c4e4ddbe0923df8d321a0f84db3ac1d2fa9`.
- Previous approval: `05373af7816851706a259b8a99daabee99042af7`, 65 files, corpus SHA-256 `e66aaf3fbf082ffc2948df9a400da9ab4e2a366e0c2f18ba407613676fca412c`.
- Current corpus: 66 files, SHA-256 `91187a50faf4b7128751a33b199fcbeafd4642eae5d0963651c3aaec60095d78`.
- Only added file: `apps/server/prisma/migrations/20261021120000_page_note_notifications/migration.sql`, committed by `9f34961e4b014253b3bb49a106586ddb7cbc9993`.
- Added file SHA-256: `46380e25eb8de376195ce7f04ca60d2d01fe9f5a505934277bbffa427bcca60c`.

Read-only Git blob comparison found all previous 65 files unchanged and the working-tree migration corpus identical to HEAD. No ignored files, generated output, or uncommitted SQL changes contributed to the mismatch. Hash calculation used the inspector's byte-sorted relative paths, NUL-separated content hashes, and CRLF-to-LF canonicalization.

## SQL review

The added 33-line migration contains only two new tables (`PageNoteRecipient` and `UserNotification`), four indexes, and foreign keys to existing same-schema `PageNote`, `User`, and `Page` tables. Column types, nullability, indexes, and delete behavior match the corresponding Prisma models. The composite Page foreign key retains the Page/Space relationship; notification deduplication and note-recipient uniqueness are enforced by unique indexes.

All relations and indexes use unqualified quoted identifiers and therefore remain in the test wrapper's selected schema. There is no explicit public-schema target, extension, database/role configuration, search-path mutation, function, trigger, destructive DDL, or write to existing rows. The two pre-existing global fragments and their separately locked source hashes are unchanged.

The update changes only the four expected corpus digests and links this receipt. It preserves rejection of unknown files, byte-modified migrations, forged captures, and all protected-inventory/cleanup checks. Neither migration SQL nor the production schema is modified.

## Regression evidence

Before updating the lock, the focused existing corpus tests produced 6 tests / 2 passed / 4 failed / 0 skipped. Failures showed the exact old/new corpus mismatch. Command:

```sh
node --test --test-name-pattern='^Folder migration safety boundary|^Folder sanitized bundle' scripts/content-tree-core-db.test.mjs
```

After the lock update, the same command passed 6/6 with 0 failures and 0 skipped. This includes unknown-file and modified-byte rejection, captured-byte integrity, both reviewed global-fragment substitutions, and cleanup after setup failure. `git diff --check` and `node --check` for the three changed registration-fixture scripts also passed.

The earlier full-test log contained 76 failures: 74 from this corpus mismatch (including the direct digest assertion), plus two Sync HTTP tests rejected during fixture registration by the existing `AUTH_NAME_POLICY`. Fixture names in Sync v1/v3 and the real-client harness are changed to contain no whitespace; authentication behavior and HTTP assertions remain unchanged. The real-client fixture was behind the corpus failure and has the same incompatible registration input.

The next full run reached 239 runtime database tests: 238 passed, 1 failed, 0 skipped. The corpus mismatch was absent, and the Sync v1/v3 and real-client tests passed. The remaining failure was `composite-template-e2e-db.test.mjs`: its startup fixture still registered `Composite acceptance owner`, which correctly received `AUTH_NAME_POLICY`.

A subsequent scan of every `auth/register` reference in the repository, including paths without a leading slash and the arguments passed to registration helpers, found the same incompatible positive-fixture input in ten scripts and eight browser E2E files. These registration names are now whitespace-free. Space names, Agent names, device names, page titles, mock-only registration feedback, duplicate-email and whitespace-policy negative tests are unchanged. No production authentication, test harness, SQL, or guard implementation changed in this follow-up.

The follow-up changed registration names in these files:

- `scripts/composite-template-e2e.mjs`
- `scripts/source-freshness-acceptance.mjs`
- `scripts/knowledge-retrieval-harness.mjs`
- `scripts/test-space-agent-member.mjs`
- `scripts/ui-route-smoke.mjs`
- `scripts/onboarding-e2e.mjs`
- `scripts/assist-routing-e2e.mjs`
- `scripts/cross-machine-e2e.mjs`
- `scripts/smoke-test.mjs`
- `scripts/collaboration-workflows-e2e.mjs`
- `apps/client/e2e/local-sync.spec.ts`
- `apps/client/e2e/markdown-attachments.spec.ts`
- `apps/client/e2e/markdown-core.spec.ts`
- `apps/client/e2e/editor-language.spec.ts`
- `apps/client/e2e/onboarding-device.spec.ts`
- `apps/client/e2e/collaboration.spec.ts`
- `apps/client/e2e/space-folders.spec.ts`
- `apps/client/e2e/page-templates.spec.ts`

All ten script syntax checks, eight TypeScript parse checks, and `git diff --check` passed. The existing related pure harness tests passed 78/78 with 0 skipped:

```sh
node --test scripts/onboarding-e2e.test.mjs scripts/knowledge-retrieval-harness.test.mjs scripts/source-freshness-acceptance.test.mjs scripts/composite-template-e2e.test.mjs scripts/assist-routing-e2e.test.mjs
```

These pure checks do not constitute real HTTP or browser acceptance. The controller will rerun the unchanged `pnpm test:full` provisioning path to verify the remaining composite startup test with dedicated PostgreSQL databases, Redis, API, worker, and Vite. This follow-up did not launch another full run or modify that harness to introduce a filter.
