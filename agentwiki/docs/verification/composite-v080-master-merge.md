# Composite templates: completed local master integration

Date: 2026-09-06

## Outcome and source identity

The authorized local merge is complete. The real main checkout is
`/Users/neomei/项目/codexprojects/AgentWiki ` (trailing space). Local `master`
fast-forwarded from `711cae77277af1f79c6f4c16f998dbc66f6e2dae` to reviewed
candidate `f84d576e08cc26c6a2c8ef22c1cb5ae238e99dbd` before its fresh main-checkout
acceptance. The final handoff commit containing this record changes documentation
only; it is also fast-forwarded into local master.

The candidate includes the composite/v0.8.0 integration merge `069eb126...` and
the last locked upstream snapshot `e0f7acaf0b6cbbeb8bc56f33e5da2991a9b40991`
through executable merge `1a25bfb5426a77bb49a8b3600bd71606cd0e33a7`.
The exact-SHA task, scoped evidence-fix, final integration, and bounded-upstream
reviews all passed; no Critical, Important, or deferred finding remains.

This task did not push, publish packages, deploy, modify credentials, migrate
production, or replay paid models. Another task independently advanced the
upstream hotfix branch while this work ran; that task's historical deployment
record is not a deployment performed by this task.

## Main-checkout verification

Working directory for every command below:
`/Users/neomei/项目/codexprojects/AgentWiki /agentwiki`.

All DB tests used these explicit dedicated settings, never production or a
fallback environment:

```sh
export DATABASE_URL='postgresql://postgres@127.0.0.1:50415/agentwiki_composite_test'
export FOLDER_TEST_DATABASE_URL="$DATABASE_URL"
export MARKDOWN_TEST_DATABASE_URL="$DATABASE_URL"
export COLLABORATION_TEST_DATABASE_URL="$DATABASE_URL"
export PAGE_TEMPLATE_TEST_DATABASE_URL="$DATABASE_URL"
export SYNC_V3_TEST_DATABASE_URL="$DATABASE_URL"
export TEST_REDIS_URL='redis://127.0.0.1:50416/0'
export PG_DUMP_BIN='/opt/homebrew/opt/postgresql@16/bin/pg_dump'
export PSQL_BIN='/opt/homebrew/opt/postgresql@16/bin/psql'
export AGENTWIKI_PSQL_BIN="$PSQL_BIN"
pnpm install --frozen-lockfile
pnpm --filter shared build
pnpm --filter @neomei/agentwiki-sync-protocol build
pnpm typecheck && pnpm lint && pnpm build && pnpm test:full
```

Frozen install succeeded. An initial typecheck before rebuilding dependencies
exited 2: main's old `dist/esm/index.d.ts` lacked composite and content-tree-limit
exports that existed in current protocol source. The corresponding isolated
worktree build already had both exports. Rebuilding shared/protocol artifacts
resolved this without editing any product or test source. The original failed
log is retained, not overwritten by the successful retry.

The subsequent combined main command exited **0**: typecheck, lint, build and
`test:full` all passed. Fresh totals:

| Phase | Passed | Skipped |
| --- | ---: | ---: |
| Repository Node/TAP | 257 | 1 |
| Real serial database | 175 | 0 |
| Server Jest | 2499 | 1 |
| Client Vitest | 1264 | 0 |
| Sync protocol | 140 | 0 |
| Local Sync | 877 | 1 |
| Total | **5212** | **3** |

Zero failures. Skips are the explicit CodeGraph opt-in, Windows-only OpenCode
execution, and Windows ACL cases. The existing Vite chunk-size advisory and
expected negative/fault-injection logs remain documented in
`composite-v080-local-integration.md`; success does not mean warning-free output.

Retained logs under `/tmp/agentwiki-composite-v080-master-`:
`install.log`, `prerequisites.log`, failed `typecheck.log`, successful
`typecheck2.log`, `lint.log`, `build.log`, and `full.log`.
Controller command sessions: first attempt `65998` (exit 2), corrected
prerequisite-and-gate sequence `32514` (exit 0).

## Preservation and cleanup

Before/after the fast-forward and after main acceptance, the controller verified:

- All 46 original untracked files retain their captured SHA-256 hashes.
- All five dirty submodules (`docmost`, `mnemon`, `openwiki`, `outline`,
  `swarmvault`) retain their HEAD, status, and binary-diff hashes.
- Main's original status inventory hash remains
  `cd720231d32e86cbd1c2fc0345e727726dcec3c0371c47c2ccbe9a6b08c0ca31`.
- Candidate changes do not overlap those original files/submodules.
- No stash, reset, clean, submodule update, or write to another active worktree.
- Post-main-gate SQL: public tables 0, generated test schemas 0, other connections
  to the dedicated database 0.

The externally managed feature worktree, branch and unique review/browser proof
are retained for traceability; this costs local disk space, not recoverability.
The dedicated test containers and their storage are retained; no unrelated
container or database is removed. Source/task records are archived after local
completion. Publication and deployment require a separate request.

## Evidence boundaries

The six-journey real Chrome run proved UI and persisted workflows on executable
merge `069eb126...`, before the final non-UI two-expression legacy-list hotfix.
The final executable source has fresh affected HTTP and full tests, but no
additional exact-final-source Chrome or external-model run is claimed.
The upstream-tail review explicitly evaluated that unchanged UI boundary.

Detailed immutable reviews and preservation manifests remain in the feature
worktree's `.superpowers/sdd/2026-09-06-composite-v080-local-integration/`:
`task-1-review.md`, `task-1-fix1-review.md`, `final-integration-review.md`,
`upstream-tail-review.md`, `main-before.json`, and `check-main-preservation.mjs`.
