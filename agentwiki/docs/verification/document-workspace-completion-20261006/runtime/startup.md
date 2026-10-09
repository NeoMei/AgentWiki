# Third-round browser runtime receipt

2026-10-06. Runtime support only; no product source edit, commit, worker, browser action, provider invocation, or full test run.

## Route verification

Actual session metadata identifies `/root/completion_runtime`, thread `01a1109e-9099-77c2-ab80-4b0b922e58b3`. Its latest inherited turn_context at `2026-10-06T09:49:50.528Z` reports `p5c07ff/gpt-6-astra`, effort `ultra`. No model override/fallback.

## Ready environment

- Production Vite preview: `http://127.0.0.1:51894`; isolated API: `http://127.0.0.1:51893/api`. Preview serves existing `apps/client/dist`; root can rebuild assets and cold-reload without restarting this fixture.
- Main page: `bc629872-1c82-4fd3-8234-961f5f20b023`; editor URL: `http://127.0.0.1:51894/pages/bc629872-1c82-4fd3-8234-961f5f20b023/edit`.
- CRLF table page: `5d18a5f5-f5aa-48b0-a947-0de314af1c4f`; sibling: `073956a4-9296-42e2-b695-270a48d0aacb`; root-directory late page: `40e8b44e-ac6e-4cea-8f80-d33304e4aacd`.
- Space: `cmuwianxa001gvurs904obufo`; main folder: `cmuwianz3001svurs59tch4sw`.
- Search target: `0ccbf382-2c8f-4cbf-8316-6debf2d82a33`, titled `远古星河手册 · 跨百页链接目标`, query `远古星河`.
- Real API fixture has 130 pages. `/pages?spaceId=…&take=100` excludes the old target; `/search?spaceId=…&q=远古星河&limit=20` returns that target with `matchType=text`. The lexical index used unchanged API/index code; missing provider credentials terminate embedding attempts before HTTP requests.
- Main Markdown includes front matter, two GFM tables (one with Markdown/escaped pipe content), exact-spacing unknown/custom blocks, fenced code, task list, same-loopback image, reverse-selection sentence, and 60 long-body paragraphs. Separate CRLF page retains CRLF source through actual create API.
- Human login credentials exist only in `runtime.json` (mode 0600, runtime directory 0700). Read `email`/`password` privately; never print/copy runtime.json into durable reports.

## Isolation

`scripts/folder-test-database.mjs` created only `folder_test_80ca0cd918da46e8b39f1529acb54ed0` inside existing loopback `agentwiki_folder_test`. Reviewed migration digest remained `4fa1e4a38a70ea63e2e7c62d24913edfb3f9fa499bb98d43463bc639acd11767`. Protected public inventory before/after startup is identical, digest `e447573064bbbfc1fbeae49340e519e8b40478a9992ccfaf92e35cfbc93350c0`.

Launchd one-shot job `com.agentwiki.completion20261006.14db4e4eb4` has RunAtLoad=true / KeepAlive=false. Harness PID 88693 has PPID 1; owned Redis PID 88732 on 127.0.0.1:55477 (not 6379), API PID 88735, preview PID 88796. All Redis persistence/uploads/private TMPDIR resources are under owned runtime `owned-9jHMNx`. API process receives an explicit minimal environment and uses that empty owned directory as cwd, so it does not load repository .env/provider credentials. No worker starts. Redis AOF is enabled; health confirms DB, Redis, durable audit, and attachment storage.

Three initial startup attempts were completely rolled back: attachment-path test naming, health timeout too short for AOF check, and relative image reference rejected by the attachment guard. Test path and probe window were corrected; same-loopback absolute image URL satisfies the existing source validator. Each failed attempt's cleanup receipt confirms schema/children/owned files absent and unchanged public inventory. No product workaround was applied.

## Read-only post-browser persistence check

Run from this runtime directory:

```sh
node verify-pages.mjs
```

This compares only the owned main and CRLF pages' title, content, and updatedAt with the immutable API-returned `page-snapshots-before.json`, writes a sanitized `no-save-receipt.json`, and fails on any change. The initial pre-browser run passed for both pages; rerun after actual interactions for final browser acceptance. This is not itself a browser test.

## Required cleanup after browser acceptance

From this runtime directory:

```sh
node cleanup.mjs
```

The driver verifies harness ownership, sends SIGTERM, waits for its safe finally (children stop before helper drops schema), verifies all child PIDs absent, unloads only the owned launch job and deletes its plist. It independently checks the protected public inventory against `inventory-before.json`, schema absence, owned uploads/Redis directory absence, and removal of all credential fields from runtime.json. It writes `cleanup-receipt.json`. Do not delete runtime scratch while the job is active. Root must copy sanitized startup/cleanup/no-save reports before deleting only this task's scratch.

Current status: ready and intentionally running for root's real-browser acceptance. Cleanup has not yet been requested.
