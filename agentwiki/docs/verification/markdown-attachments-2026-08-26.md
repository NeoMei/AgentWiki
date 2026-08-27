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
  PostgreSQL `16.14` (Homebrew)
- CodeGraph was consulted first. Its index did not expose the new deployment/database
  harnesses and reported other indexed application files stale, so review continued
  against current on-disk source and focused tests.

No SSH, push, npm publish, GitHub release, public endpoint write, production deploy or
production database probe was performed.

## TDD and focused evidence

- Deployment contract RED: all six new assertions failed before configuration and
  runbook work. GREEN: `node --test scripts/attachment-deployment-contract.test.mjs`
  passed 6/6, including preflight ordering, persistent-root safety, semantic health,
  Compose/systemd sharing, Nginx `11m`, and bounded environment defaults.
- Editor preview context RED: two focused failures showed the authoritative page and
  Space were not reaching preview resource resolution. GREEN: the focused
  `MarkdownWorkspace` + `PageEditor` run passed 73/73 after the minimal pass-through.
- Exact libpq Unix-socket URL RED: the WHATWG parser rejected
  `postgresql://neomei@/agentwiki_collaboration_test?host=/tmp`. GREEN narrowly
  normalizes only an empty-authority URL with one absolute socket `host`, while
  preserving user, database, query and schema/test guards.
- The exact database probe returned
  `agentwiki_collaboration_test|neomei|true`; the dedicated gate passed 7/7 with no
  skips and asserted `inet_server_addr() IS NULL` inside the callback. Every generated
  `markdown_test_*` schema was removed.

## Isolated real-browser acceptance

The final joint run used only task-owned local resources:

- Schema: `markdown_test_browser_20260828021644_24051`
- Attachment root: `/tmp/agentwiki-attachment-test-zQjYmY1f`, canonical
  `/private/tmp/agentwiki-attachment-test-zQjYmY1f`
- Redis: loopback port `6387`, AOF enabled, temporary root
  `/tmp/agentwiki-redis-test-LGXZWMqw`
- API/Vite/Redis PIDs: `24093` / `24129` / `24084`
- Semantic health:
  `{"status":"ok","database":"ok","redis":"ok","auditPersistence":"ok","attachmentStorage":"ok"}`

With one worker, `markdown-attachments.spec.ts` and `markdown-core.spec.ts` passed 4/4
in 13.4 seconds. The browser covered scoped resolver and Viewer Blob rendering,
Owner/Editor picker-paste-coordinate-drop flows, authoritative filename suffixes,
save/reload source, protected Blob URLs, live page/section refresh, cycles, depth/count/
character limits, version provenance, heading/block anchors, task checkboxes and
390-pixel layout. Console warnings/errors and non-loopback requests were asserted
empty. Screenshots were written only beneath the test's OS-temporary artifact root and
removed by teardown.

Before schema teardown, active User/Space/Page/Attachment counts were `0|0|0|0`.
The final trap then proved the exact schema count and all
`markdown_test_browser_%` schema count were zero, both temporary storage roots were
absent, and ports `3000`, `5173`, and `6387` had no listeners. Playwright output,
trace and report directories were removed. Failed orchestration attempts used the
same cleanup checks and never touched a shared schema or service.

## Full repository gates

- `pnpm test:runtime`: 113 passed, 55 environment-gated skips, 0 failed.
- `pnpm test`: runtime above; server 1,397 passed / 4 skipped; client 994 passed;
  sync protocol 42 passed; local-sync 748 passed; 0 failed.
- `pnpm lint`: passed.
- `pnpm typecheck`: passed for server, client, sync protocol and local-sync.
- `pnpm build`: passed for shared, sync protocol, server, client and local-sync.
  Vite reported only its non-failing existing large-chunk advisory.
- `git diff --check`: passed.

## Release-state separation

- Local branch: implementation and evidence exist only on the task branch at the time
  of this record.
- GitHub / `origin/master`: no fetch, push, PR, tag or release; the ref above is only
  the checkout's cached local observation.
- npm: no package was packed or published as a release artifact.
- Production: not deployed, not updated and not probed; no server claim is made.
