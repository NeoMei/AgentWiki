# Embedded Agent reliability — v0.12.62

Release candidate for the user-authorized additional audit, repair and production publication. It includes the full embedded-Agent audit in `ee955c72` plus the follow-up same-worker lease fencing fix. Production publication and acceptance will be recorded after completion; this document does not yet claim deployment.

## Changes

- Decode UTF-8 incrementally so split pipe buffers cannot corrupt Chinese or emoji. Use the final assistant step in question/proposal modes; reject a final empty, truncated, invalid or unfinished tool response instead of recovering an earlier answer.
- Fence overlapping history reads, cancellation and access loss so stale successes or failures cannot restore old content. Recognize directory source-loss responses and preserve other conversations’ save receipts when only one source disappears.
- Clear abandoned progress/results during queue recovery and show progress only while running. Validate original REST field types before production implicit conversion.
- Clear local errors on conversation changes and correct reference-popover Tab/Shift+Tab and browser blur handling.
- Bind every queue mutation and liveness check to the exact lease captured at claim time. A stable worker id alone did not distinguish an expired attempt from a fresh attempt reclaimed by the same process; late progress, completion and failure could overwrite the new attempt. Two new tests first reproduced this race, including expiration of the real lease timer, and pass with the lease fence.

## Verification

The initial audit completed four review rounds and 8,373 passing checks with five pre-existing conditional skips. The additional review found the same-worker lease issue; the fix passed 19 Assist suites / 550 checks, server type checking, changed-source ESLint and an independent review of all claim/mutation paths. The final full repository gate passed: 8,375 checks, zero failures and five pre-existing conditional skips (runtime 319/1, real PostgreSQL/Redis 244/0, server 3698/3, client 2849/0, protocol 140/0, local-sync 1125/1). Final typecheck and lint also passed.

The new production receipts must use a manifest derived from the exact frozen Git commit and `.62` versions. A clean detached worktree is required because deploy.sh packages working-tree files. Paired database/attachments/config/application backup must verify and restore services before deployment.

## Scope

No Prisma migration, npm package or protocol change. Local Sync remains 0.13.5 and sync protocol remains 0.6.1. Existing user pages and historical conversations are not overwritten by acceptance. The original Bug-summary content reconciliation remains a separate semantic check; successful model execution alone does not establish its correctness.
