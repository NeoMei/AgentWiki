# AgentWiki 0.9.0 / Sync Protocol 0.6.0 local release preparation

Date: 2026-09-06

Status: **local source and package candidate verified; not published, released, deployed, or UI-accepted**.

## Candidate scope

- AgentWiki root, server, client, Local Sync, active onboarding/install surfaces, and current fixtures are pinned to `0.9.0`.
- `@neomei/agentwiki-sync-protocol` and Local Sync's exact protocol dependency are pinned to `0.6.0`.
- Composite templates still require an explicit Space ID. This preparation does not add wildcard rollout, automatic privilege expansion, product behavior, permission, template-content, or migration changes.
- Historical verification records and compatibility fixtures unrelated to the current Local Sync release remain unchanged.
- The retired external-compiler contract now scans only active product/install surfaces and explicitly targets this worktree. Its regression proves an active instruction is retained for rejection while historical preservation inventory is ignored.

## RED and recovery evidence

The version expectations were updated before the release surfaces. The focused runtime command was:

```bash
node --test scripts/node-runtime-contract.test.mjs
```

It failed as expected on the still-`0.8.0` application/Local Sync surfaces and still-`0.5.1` protocol surfaces: 32 tests, 27 passed, 5 failed. One of those five failures also exposed a pre-existing test-harness false positive against a preserved historical `OpenWiki` inventory mention. The historical record was not edited. After the bounded harness correction and version edits, the same command passed 33/33. Logs:

- `.superpowers/sdd/2026-09-06-composite-v090-release/logs/task-1-red-runtime.log`
- `.superpowers/sdd/2026-09-06-composite-v090-release/logs/task-1-green-runtime.log`
- `.superpowers/sdd/2026-09-06-composite-v090-release/logs/task-1-harness-regression.log` (2/2)

The first full-suite run reached the database phase and reported 172 passed / 3 failed. All three failures were the same release-fixture defect: the compiled server still enforced the escaped DTO regex for `0.8.0`, so the collaboration real-client harness, composite acceptance startup, and attachment HTTP lifecycle rejected their new `0.9.0` installation requests. Updating that active DTO pin fixed the root cause. The three focused database files then passed 10/10, and a fresh full suite passed on the corrected final tree. Logs:

- `.superpowers/sdd/2026-09-06-composite-v090-release/logs/task-1-test-full.log`
- `.superpowers/sdd/2026-09-06-composite-v090-release/logs/task-1-focused-full-failures.log`
- `.superpowers/sdd/2026-09-06-composite-v090-release/logs/task-1-test-full-final.log`

## Local verification

Dependency and build gates:

```bash
pnpm install --lockfile-only
pnpm install --frozen-lockfile
pnpm --filter shared build
pnpm --filter @neomei/agentwiki-sync-protocol build
pnpm typecheck
pnpm lint
pnpm build
```

All exited 0. The production build emitted Vite's existing large-chunk advisory; dependency installation emitted deprecation/update advisories and recovered from one transient optional-package registry retry. Logs use the matching `task-1-pnpm-*`, `task-1-build-*`, `task-1-typecheck.log`, and `task-1-lint.log` names in the SDD log directory.

The final full-suite command used only the dedicated loopback PostgreSQL and Redis containers (`agentwiki-composite-69d8-db` on port 50415 and `agentwiki-composite-69d8-redis` on port 50416):

```bash
DATABASE_URL=postgresql://postgres@127.0.0.1:50415/agentwiki_composite_test \
FOLDER_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:50415/agentwiki_composite_test \
MARKDOWN_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:50415/agentwiki_composite_test \
COLLABORATION_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:50415/agentwiki_composite_test \
PAGE_TEMPLATE_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:50415/agentwiki_composite_test \
SYNC_V3_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:50415/agentwiki_composite_test \
TEST_REDIS_URL=redis://127.0.0.1:50416/0 \
PG_DUMP_BIN=/opt/homebrew/opt/postgresql@16/bin/pg_dump \
PSQL_BIN=/opt/homebrew/opt/postgresql@16/bin/psql \
AGENTWIKI_PSQL_BIN=/opt/homebrew/opt/postgresql@16/bin/psql \
pnpm test:full
```

Final result: **5,213 passed, 3 skipped, 0 failed** across the repository runtime (258 passed / 1 skipped), database (175 passed), server (2,499 passed / 1 skipped), client (1,264 passed), Sync Protocol (140 passed), and Local Sync (877 passed / 1 skipped) phases.

## Package evidence and publication order

```bash
pnpm test:package:local-sync-clean-install
pnpm test:release:sync-v3-registry
npm view @neomei/agentwiki-sync-protocol@0.6.0 version --registry=https://registry.npmjs.org/
```

- Clean install passed from paired local tarballs: Local Sync `0.9.0`, Sync Protocol `0.6.0`, CLI help runnable. The protocol tarball contained 69 files with shasum `27ab0950815f6a908aced1c176ddda8e24a0b048`; Local Sync contained 153 files with shasum `25bd00921741dbd2f205146dc19fdd873b796a53`.
- The fail-closed registry collision gate reported Local Sync `0.9.0` available.
- The explicit protocol lookup returned npm `E404`, proving Sync Protocol `0.6.0` absent at that check. A network failure would not have counted as absence.

The source protocol manifest intentionally retains its `prepack` gate. To create the allowed publication artifact, the controller must run the source `prepack` through `npm pack`, extract that verified tarball into an isolated staging directory, remove only `scripts.prepack` from the staged `package.json`, and run `npm pack --ignore-scripts` on the staged package. The post-publication parity gate deliberately normalizes exactly this one source-vs-registry manifest difference while comparing every other manifest field and every non-manifest file byte-for-byte.

Controller-only publication, after authenticated production preflight and review, must be ordered as follows:

1. Publish the staged Sync Protocol `0.6.0` artifact.
2. Run `pnpm test:release:sync-protocol-registry-parity` against the public registry.
3. Run `pnpm test:package:local-sync-registry-protocol` against the public protocol and current Local Sync candidate.
4. Publish Local Sync `0.9.0` only after the candidate registry-protocol clean install passes.
5. In fresh empty install and cache directories, run `npm install --prefix <empty-install-dir> --cache <empty-cache-dir> --registry=https://registry.npmjs.org/ --ignore-scripts --no-audit --no-fund @neomei/agentwiki-local-sync@0.9.0`, then `<empty-install-dir>/node_modules/.bin/agentwiki-local-sync --help`, to verify the actual public Local Sync artifact separately.
6. Only then proceed separately to source push/tag/GitHub Release, production deployment, and browser/UI acceptance.

No npm publication, Git push/tag/release, production write, deployment, or UI acceptance was performed here. Direct BatchMode production SSH authentication is currently blocked, so production preflight and deployment remain controller blockers after independent review.

## Reviewed candidate and execution checkpoint

Reviewed candidate: `d474b13c7caeb0cfa1b35cb0b9c3c5899eb7becd` on
`codex/composite-page-group-agent-collaboration`. Version preparation commit is
`0ad6593a347e20bb2a3cc367ec79144a36e94cc9`; the final correction changes only
three release guides and their ordering regression test.

Independent task review found one publication-order issue; its scoped fix review
approved the corrected order with 14/14 ordering tests and 33/33 runtime contracts.
The final whole-release-delta review approved Spec and Quality: Critical 0,
Important 0, Minor 1 (the already documented build/dependency advisories).
The full 5,213-pass evidence applies to the unchanged executable product tree;
the final documentation/test-only correction has its separate focused evidence.

Controller checks confirmed a clean candidate, no migration/template/permission
changes in release preparation, and dedicated test DB cleanup: public tables 0,
generated test schemas 0, other connections 0. Main checkout remains `7c969d6b`;
no main checkout merge, push or submodule modification was performed in this attempt.

**Local candidate: GO. Actual release: BLOCKED_ENVIRONMENT.** The production SSH
control socket is absent, and noninteractive authentication (including the normal
macOS Keychain-backed attempt) was denied. Existing public health remained all ok;
that is the previous deployment, not acceptance of 0.9.0. User release authorization
is already granted; restoring SSH login is the missing prerequisite, not another
request for publication permission.

The user can restore the authenticated session in a local terminal:

```sh
ssh -M -S /tmp/agentwiki-release-ssh/control -o ControlPersist=2h root@113.249.120.24
```

No passwords should be sent in chat. After login, revalidate the production target,
migrations, private paired backup/restore procedure and explicit Space rollout,
then continue the publication order above. Registry artifacts, GitHub release,
deployment and real public browser acceptance are still unperformed. The isolated
worktree, local commits and this plan's review/log evidence are retained for resume.

## Public npm publication — 2026-09-06 resumed execution

This checkpoint supersedes the earlier unperformed-publication status, without
changing the historical local-test evidence above.

- User browser authentication succeeded. Sync Protocol `0.6.0` publication exited
  0; public parity reports `identical`. Published SHA1 is
  `31939262b7683a664fa9f7b524a286f64f0da772` (only staged prepack normalization).
- Candidate registry-protocol clean install passed, including source prepack
  tests: 877 passed, 1 skipped. Local Sync `0.9.0` publication exited 0.
- npm initially reported processing and exact version lookup/install returned
  E404/ETARGET. No duplicate publication was attempted. Subsequent public metadata
  confirms Local Sync `0.9.0`, exact protocol dependency `0.6.0` and SHA1
  `25bd00921741dbd2f205146dc19fdd873b796a53`, identical to the tested candidate.
- Separate actual-public installation in fresh install/cache directories added
  96 packages and exited 0. Installed versions, exact dependency and CLI `--help`
  were asserted successfully in `/tmp/agentwiki-v090-public-verified.aLUwgR`.
  Logs are retained in the release SDD workspace: `protocol-registry-parity.log`,
  `local-sync-registry-protocol.log`, `public-local-sync-install.log` (initial
  processing failure), and `public-local-sync-install-final.log`.

SSH was restored long enough to verify the live target read-only, but its control
session has now expired; BatchMode authentication is denied. No production backup,
restart, migration or deployment has occurred. No source push/tag/GitHub Release
has occurred in this attempt. Production and browser acceptance remain pending.

Operational review closed failure-stop cleanup and sanitized-error issues. The
restore operator lock instructions now fail closed. Old-dump restore readiness
still needs closure: new composite schema objects prevent an old archive's plain
`pg_restore --clean` from restoring successfully. An isolated PG16/vector experiment
proved transactional schema reset plus complete SQL restore and failure rollback;
before implementing the production-specific variant, refresh actual database,
schema/ACL and extension ownership/version plus local postgres socket identity.
The manual disaster procedure is not approved to execute and is never automatic.

## Refreshed integration gate — 2026-09-06 15:44 CST

The same complete dedicated-database command above ran again before source
publication and exited 0: runtime 258 passed / 1 skipped, DB 175 passed / 0 skipped,
server 2,499 passed / 1 skipped, client 1,264 passed, protocol 140 passed, local-sync
877 passed / 1 skipped; total 5,213 passed, 3 skipped, 0 failed. Log:
`.superpowers/sdd/2026-09-06-composite-v090-release/final-prepublish-full.log`.

SSH master was re-established and live 0.8.0 read-only preflight confirmed the same
target and healthy services. Recovery implementation/re-review and actual deployment
remain separate gates. Only release-owned public-API fixture bootstrap has occurred:
new composite/legacy test Spaces; no existing user pages were changed.

## Released and deployed — 2026-09-06 16:04 CST

Source and immutable `v0.9.0` tag target:
`d8bddc3528bf719d1d03abede58e0fdd46db4fac`. Local master was fast-forwarded and
remote master/tag verified; the main checkout's before/after uncommitted status was
identical (user submodules and untracked files retained). GitHub Release:
https://github.com/NeoMei/AgentWiki/releases/tag/v0.9.0 .

### Operations and recovery evidence

- Independent operational review closed all findings, C0/I0/M0. A subsequent actual
  read-only production check caught PostgreSQL's `inet` text `/32` suffix; the narrow
  `host(inet_server_addr())` fix passed real TCP regression, scoped re-review and live
  same-cluster/ownership/extension verification before service shutdown.
- Deployment wrapper SHA256:
  `f388ab4431447af0372682b06d57c07be89d1de38eab1ae0c0a810dd4d013de4`.
  Recovery module SHA256:
  `888ff26aadb00bf787fa515f52663c1131d9f75d82681af8d8abd73260c5d4d6`.
  Four sibling helpers and operator instructions are retained privately on the host
  under `/root/agentwiki-release-tools-v090/`.
- Staged build and OpenCode runtime preflight passed before downtime. The three
  services were confirmed inactive before capturing the custom PostgreSQL dump,
  attachment tree/manifest, old application archive and unit/drop-in archive.
- Verified paired backup: `/var/backups/agentwiki/composite-v090.ISRh9s`.
  Manifest SHA256 `2618e396fc2f0fd8d40bd4a80abe0fafb82b8bd818fcc38d2b04a58cfd63afb2`.
  Previous application: `/root/agentwiki-previous-20260906155937`.
  These are recovery references, not authority to discard post-backup writes.
- Only pending migration `20260905120000_composite_templates` applied. Final history:
  55 successful migrations, no unresolved failures; historical resolved attempts kept.
- Deployment exited 0. All three services are active with NRestarts 0; existing
  exact-runtime bind drop-ins/security hardening remain. Source parity checked 1,030
  deployed input files with zero mismatches. Public health reports status/database/
  Redis/audit/attachmentStorage all `ok` after cleanup and restart.
- Final feature allowlist contains **only NeoMei-Space**
  `cmt024s4808nm3gmnko5v9gj5`; it is not a wildcard/global rollout. Temporary fixture
  allowlisting was removed, original env snapshots retained at
  `/root/agentwiki-release-tools-v090/allowlist-env-before.kWEpN9`.

### Public API and browser acceptance

Browser plugin unavailable; used repository Playwright with installed Chrome against
`https://agentwiki.quukk.com`, desktop 1440×900 and mobile 390×844. No product UI was
changed during this release verification. Evidence directory:
`/tmp/agentwiki-v090-browser.NCobO4` (private fixtures, screenshots and results).

| Check | Observed result |
| --- | --- |
| Authenticated API smoke | 32 checks passed; its own fixtures cleaned |
| Page identity / meaningful render / framework overlay | AgentWiki page, meaningful content, no overlay |
| Single/multi template categories | Filter controls respond; project workspace appears under multi-page |
| Collaboration off | One project creates 11 nested nodes; zero Runs; edit/save/API readback/reload agree |
| Late Page binding | Binding survives reload; selected single-page Run has exactly its one Agent |
| Participation boundary | Agent bound to a different Page is excluded; rebinding does not change active Run assignee |
| Collaboration on | 7 tasks, 2 deduplicated participants; UI result and authoritative Run agree |
| Legacy creation | Non-allowlisted Space retains old entry and creates an ordinary editable Page |
| Protected attachment | Upload, authenticated exact byte readback and browser blob image render passed |
| Console / runtime | No page errors or relevant console errors in completed journeys |
| Mobile layout | Normal-length fixture name fits; existing long-name breadcrumb overflow reproduced |

Known non-blocking issue: a ~70-character Space name expands the existing content
breadcrumb to 510px on a 390px viewport. `ContentBreadcrumbs.tsx` is byte-identical to
the previous production source `e0f7acaf`; the original failed screenshot/DOM and widths
were retained. Rechecking with a normal-length fixture name passed without modifying
product code. This is **not** an all-input/mobile-layout pass.

Test cleanup cancelled two fixture Runs, revoked two fixture Agents, soft-deleted two
fixture Spaces, and deleted the fixture user. Only release-owned records were targeted;
soft-deleted content/audit and archived attachments follow normal retention. Existing
user data and permissions were not widened. All test Space allowlisting was removed.

Boundary: this production run verifies creation/binding/participant freezing and public
API publication smoke, not a fresh end-to-end external-model multi-client execution.
Earlier local real-Agent evidence remains historical. No disaster restore was executed.

**Outcome: source + npm + GitHub Release + production deployment complete; core public
business acceptance passed, with the explicitly retained pre-existing mobile layout issue.**
