# Embedded Agent reliability — v0.12.62

Published and deployed as [v0.12.62](https://github.com/NeoMei/AgentWiki/releases/tag/v0.12.62), frozen commit `2635bc66dd669d94f00650d3488f62e455719cab`. The annotated tag and non-draft, non-prerelease latest GitHub Release resolve to this exact deployed commit. This includes the full embedded-Agent audit in `ee955c72` plus the follow-up same-worker lease fencing fix `1a6de6c8`.

## Changes

- Decode UTF-8 incrementally so split pipe buffers cannot corrupt Chinese or emoji. Use the final assistant step in question/proposal modes; reject a final empty, truncated, invalid or unfinished tool response instead of recovering an earlier answer.
- Fence overlapping history reads, cancellation and access loss so stale successes or failures cannot restore old content. Recognize directory source-loss responses and preserve other conversations’ save receipts when only one source disappears.
- Clear abandoned progress/results during queue recovery and show progress only while running. Validate original REST field types before production implicit conversion.
- Clear local errors on conversation changes and correct reference-popover Tab/Shift+Tab and browser blur handling.
- Bind every queue mutation and liveness check to the exact lease captured at claim time. A stable worker id alone did not distinguish an expired attempt from a fresh attempt reclaimed by the same process; late progress, completion and failure could overwrite the new attempt. Two new tests first reproduced this race, including expiration of the real lease timer, and pass with the lease fence.

## Verification

The initial audit completed four review rounds and 8,373 passing checks with five pre-existing conditional skips. The additional review found the same-worker lease issue; the fix passed 19 Assist suites / 550 checks, server type checking, changed-source ESLint and an independent review of all claim/mutation paths. The final full repository gate passed: 8,375 checks, zero failures and five pre-existing conditional skips (runtime 319/1, real PostgreSQL/Redis 244/0, server 3698/3, client 2849/0, protocol 140/0, local-sync 1125/1). Final typecheck, lint, versioned production build and release guard also passed.

Deployment ran from a clean detached checkout of the frozen commit. The paired backup `/var/backups/agentwiki/agent-audit-v01262.7nox7xx3` verified database/attachments checksums and restored service health before deployment. The previous tree is `/root/agentwiki-previous-20261026063503`; it must be recovered together with its matching data backup.

Host verification matched all 1,437 source files and application/package versions; API, worker and frontend are active and five health fields are ok. Public HTTPS matched the deployed HTML and all five entry assets. Real configured model calls passed question, proposal and auto-answer in 33.935 seconds using synthetic Chinese/emoji documents: answers retained a random nonce, and proposals changed only the requested status text (ignoring final-newline presence). This probe uses in-memory routing health and does not modify database, Redis or pages.

Production BrowserSkill acceptance passed clean session creation/clearing, preserved history and unsent drafts, Tab/Shift+Tab focus, and full-reload retention of selected session and current-page source. Two empty test sessions were created through normal UI; no model turns or page writes were submitted by the browser, and page title/body/version were unchanged. The browser session was stopped. The local detached release worktree and temporary full-test databases were cleaned.

See `deployment-receipt.json`, `production-host.json`, `production-public.json`, `live-model-smoke.json`, `production-browser.json`, `github-release.json`, `log-digests.json` and `release-tools.md` for evidence and exact identifiers.

## Scope

No Prisma migration, npm package or protocol change. Local Sync remains 0.13.5 and sync protocol remains 0.6.1. Existing user pages and historical conversations are not overwritten by acceptance. The original Bug-summary content reconciliation remains a separate semantic check; successful model execution alone does not establish its correctness.
