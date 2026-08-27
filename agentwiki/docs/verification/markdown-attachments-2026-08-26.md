# Markdown attachments and embeds verification

This record keeps the specification filename date while recording the actual local
verification performed on 2026-08-28 (Asia/Shanghai). It proves only the isolated
checkout and disposable local resources described below.

## Scope and environment

- Branch: `codex/markdown-rendering-attachments`
- Starting commit: `2b458e12d7c591dba75b43bd386ab6aa9da9c797`
- Cached local `origin/master` ref: `27eee7ab576476aa241e8241730f4fbf8467e284`
  (not fetched during this task)
- Node.js `v24.18.0`; pnpm `11.9.0`; Playwright `1.61.1`;
  PostgreSQL `16.14` (Homebrew); Redis `8.8.0`
- CodeGraph was consulted first. Its index did not expose the new deployment/database
  harnesses and reported other indexed application files stale, so review continued
  against current on-disk source and focused tests.

No SSH, push, npm publish, GitHub release, public endpoint write, production deploy or
production database probe was performed.

## TDD and focused evidence

- Initial deployment contract RED: all six original assertions failed before
  configuration and runbook work. Formal-review follow-up RED then reproduced four
  failures in the nine-test suite: the fresh-volume mountpoint was not provisioned,
  the complete preflight boundary was not proven, optional `apps/server/.env` could
  abort strict-shell deployment, and the database identity helper was absent.
  GREEN: `node --test scripts/attachment-deployment-contract.test.mjs` passed 10/10.
  It now executes optional-env selection and the lossless JSONL backup manifest,
  mutation-tests preflight reordering and destructive `rm`/`mv`/`chown`, and rejects
  same-size content changes, missing/extra entries, symlinks and FIFOs.
- Docker static source contract proves the image creates
  `/var/lib/agentwiki/attachments` as `node:node` mode `0700` before `USER node`.
  The local host has no Docker CLI (`command not found`), so no fresh named-volume
  runtime was executed or claimed.
- Editor preview context RED: two focused failures showed the authoritative page and
  Space were not reaching preview resource resolution. GREEN: the focused
  `MarkdownWorkspace` + `PageEditor` run passed 73/73 after the minimal pass-through.
- Exact libpq Unix-socket URL RED: the WHATWG parser rejected
  `postgresql://neomei@/agentwiki_collaboration_test?host=/tmp`. GREEN narrowly
  normalizes only an empty-authority URL with one absolute socket `host`, while
  preserving user, database, query and schema/test guards.
- Second-review portability RED reproduced the username-less CI URL returning
  `role: ""`; GREEN makes an expected role optional when the URL has no username.
  Such runs still require a non-empty, control-character-free `current_user`, while
  explicit usernames retain exact equality. Restore-contract RED also reproduced
  the missing selected/rollback variable separation. GREEN locks and verifies the
  selected historical bundle before maintenance, captures rollback into a distinct
  directory, and mutation-rejects a rollback tree substituted into selected staging.
- Third-review restore RED failed both focused contract cases: database restore still
  read the operator-selected path and no verified attachment candidate was promoted.
  GREEN restores only the staged dump, validates live/staged roots and their shared
  device, atomically preserves/promotes the attachment tree, re-manifests the promoted
  pair, and starts/stops a private one-shot API before normal writers. The paired
  rollback handler restores the fresh rollback database plus a separately staged
  attachment tree and leaves writers stopped. Mutations prove missing promotion,
  wrong dump source, and promotion/manifest/health reordering all fail.
- Markdown-core artifact cleanup RED proved a simulated API-cleanup failure left its
  layout directory behind. GREEN uses a `finally` removal and an executable Playwright
  case proves the cleanup error is preserved while the directory is absent. Four exact
  earlier Task 9 temporary screenshot directories were deleted with explicit paths;
  each is absent and the deletion is not recoverable.
- The exact database probe returned
  `agentwiki_collaboration_test|neomei|true|true`; the dedicated gate passed 8/8 with
  no skips and asserted `inet_server_addr() IS NULL` inside the callback. Generic
  identity expectations are derived from each supplied test URL; a legal CI TCP URL
  is covered without local role/database/socket constants. Every generated
  `markdown_test_*` schema was removed.

## Isolated real-browser acceptance

The final joint run used only task-owned local resources:

- Schema: `markdown_test_browser_20260828035503_57354`
- Attachment root: `/private/tmp/agentwiki-attachment-test-N5ikMzbH`
- Redis: loopback port `6387`, AOF enabled, temporary root
  `/private/tmp/agentwiki-redis-test-h3v5aCpH`
- API/Vite/Redis PIDs: `57393` / `57429` / `57392`
- Semantic health:
  `{"status":"ok","database":"ok","redis":"ok","auditPersistence":"ok","attachmentStorage":"ok"}`

With one worker, `markdown-attachments.spec.ts` and `markdown-core.spec.ts` passed 6/6
in 13.5 seconds. The browser covered scoped resolver and Viewer Blob rendering,
Outsider direct attachment-content denial, a real Owner active-to-archived-to-active
lifecycle, Owner/Editor picker-paste-coordinate-drop flows, authoritative filename
suffixes, save/reload source, live page/section refresh, cycles, depth/count/character
limits, version provenance, heading/block anchors, task checkboxes, desktop
editor/dialog layout and 390-pixel layout. Every tracked browser context was closed
before the final assertions. Warning/error console output and non-loopback requests
were asserted empty. All actual console message types plus the complete DOM and
attributes, visible text, and current/resource/image URLs were scanned against every
fixture token and Bearer form. An isolated close-time fixture proves the same scanner
rejects late log/info/debug token records after its context closes.
Screenshots were layout evidence only, not pixel-level secret scans; they were written
only beneath the test's unique OS-temporary artifact root. The executable failure-path
cleanup case and final postflight proved all run-specific core artifact children were
removed even if API cleanup fails.

Before schema teardown, active User/Space/Page/Attachment counts were `0|0|0|0`.
Intentional soft-deleted/archived audit rows were recorded separately as
User/Space/Page/Attachment `7|3|19|5` and then removed with the isolated schema.
The final trap then proved the exact schema count and all
`markdown_test_browser_%` schema count were zero, all three orchestration temporary
roots were absent, and ports `3000`, `5173`, and `6387` had no listeners. Playwright output,
trace and report directories were removed. This review discarded one setup that
failed before schema creation on identity-output formatting, one on the empty-authority
Prisma URL before service start, and two after isolated migration on missing test-only
tmpdir/startup variables. Every attempt failed closed and was cleaned to the same zero
schema/port/root/artifact postflight; none is counted as acceptance.

## Full repository gates

- `pnpm test:runtime`: 120 passed, 55 environment-gated skips, 0 failed.
- `pnpm test`: runtime above; server 1,397 passed / 4 skipped; client 994 passed;
  sync protocol 42 passed; local-sync 748 passed; 0 failed.
- `pnpm lint`: passed.
- `pnpm typecheck`: passed for server, client, sync protocol and local-sync.
- `pnpm build`: passed for shared, sync protocol, server, client and local-sync.
  Vite reported only its non-failing existing large-chunk advisory.
- `git diff --check`: passed.

## Fresh self-review passes

1. Deployment and persistence: re-read the final Dockerfile, deploy heredoc,
   deployment contract and restore runbook. Confirmed the full mode/write/free-space/
   persisted-env preflight precedes extraction, build, service stop and migration;
   the runtime remains non-root; the persistent root is not release-swapped; rollback
   capture has an independent locked variable and cannot overwrite the selected
   historical bundle or execute the backup-only writer restart; and the executable
   manifest binds the complete allowed tree while rejecting special entries.
   Promotion now validates the live/candidate/rollback trees and common device before
   database mutation; private health refuses an occupied loopback port and passes all
   required runtime environment explicitly through `sudo`. `bash -n deploy.sh` and the
   12/12 contract suite re-passed. No further defect was found.
2. Database, browser and evidence: re-read URL normalization/identity expectations,
   all new role/lifecycle/credential/overflow assertions and cleanup accounting.
   Confirmed generic username-less TCP test identity is not coupled to the local
   socket account, archived content follows the documented recoverable-byte contract,
   every context closes before all-type console and inspectable-surface token scans,
   screenshots carry layout-only claims, failure-path artifact removal is executable,
   and active versus retained rows are reported separately. Exact schema counts,
   artifacts and ports remained clean. No further defect was found.

## Release-state separation

- Local branch: implementation and evidence exist only on the task branch at the time
  of this record.
- GitHub / `origin/master`: no fetch, push, PR, tag or release; the ref above is only
  the checkout's cached local observation.
- npm: no package was packed or published as a release artifact.
- Production: not deployed, not updated and not probed; no server claim is made.
