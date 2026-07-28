# Plugin Task 1 Report

## Status

DONE_WITH_CONCERNS

## Delivered

- Added the publishable `@agentwiki/local-sync` package at version `0.1.0`, with a Node.js `>=20` runtime floor, NodeNext TypeScript configuration, publish metadata, and workspace lockfile importer.
- Added secure local-state storage in `src/config.ts`:
  - local-sync config at `~/.agentwiki/local-sync.json`
  - credentials at `~/.agentwiki/credentials.json`
  - absolute-path to opaque UUID source-key map at `~/.agentwiki/sync-state.json`
  - atomically claimed preview files with retry release and definitive completion paths
  - atomic JSON writes using a `0700` parent directory, random sibling temporary file, `0600` file mode, rename, final chmod, and one trailing newline
- Added TDD tests covering credential mode, stable opaque source keys, and one-time preview claims.
- Extended root build, test, typecheck, and lint gates to cover `@agentwiki/local-sync`.

## Verification

- `pnpm install --lockfile-only` passed.
- `pnpm --filter @agentwiki/local-sync test` passed: 1 file, 3 tests.
- `pnpm --filter @agentwiki/local-sync typecheck` passed.
- `pnpm --filter @agentwiki/local-sync build` passed.
- `pnpm lint` passed.
- `git diff --check` passed before commit.

## Concern

The task plan requires `packages/local-sync/dist/cli.js` after the Task 1 build, but only lists `config.ts` and `config.spec.ts` as new source files. Consequently the successful build emits only `config` artifacts; the configured `bin` and `main` targets will be implemented by the later CLI/MCP tasks. This plan inconsistency was reported to the parent task before completion.

The local runtime was Node 24.18.0, so pnpm warned that the monorepo root asks for Node 26. The new package itself deliberately accepts Node 20+ as required.

## Commit

`4e1dafd feat: scaffold secure local sync package`

## Review Remediation (2026-07-29)

- Added minimal `src/cli.ts` and `src/mcp.ts`, so the declared CLI and MCP package entry points are emitted by TypeScript.
- `getOrCreateSourceKey` now re-reads `sync-state.json` after its atomic write and returns the persisted key.
- `claimPreview` now reads an existing `.inflight` preview; expired inflight files are removed and reported as unavailable, while valid inflight previews remain protected.
- Added tests for preview release/reclaim and expired inflight cleanup.

Verification: `pnpm --filter @agentwiki/local-sync test`, `typecheck`, and `build` passed; `dist/cli.js` and `dist/mcp.js` exist. pnpm emitted only the pre-existing Node 24 versus monorepo Node 26 engine warning.

## Review Remediation: Source-Key Lock (2026-07-29)

- Wrapped the full `getOrCreateSourceKey` read/check/write cycle in an exclusive `sync-state.json.lock` file lock created with `fs/promises.open(..., 'wx')`.
- Lock acquisition retries up to 50 times at 100 ms intervals and removes locks older than 30 seconds before retrying.
- Added a parallel same-path source-key test to verify concurrent callers receive one key.

Verification: `pnpm --filter @agentwiki/local-sync test` (1 file, 6 tests), `typecheck`, and `build` all passed. pnpm emitted only the pre-existing Node 24 versus monorepo Node 26 engine warning.

## Final Lock TOCTOU Remediation (2026-07-29)

- Replaced `withLock` cleanup's non-atomic read-then-unlink sequence with an atomic rename of the lock into a token-scoped `.done` path.
- Cleanup now only reads and deletes the renamed path, so it never touches a lock recreated at the original path by another process.

Verification: `pnpm --filter @agentwiki/local-sync test` (1 file, 6 tests), `typecheck`, and `build` all passed. pnpm emitted only the pre-existing Node 24 versus monorepo Node 26 engine warning.

## Critical Remediation: Stale-Lock Ownership (2026-07-29)

- Each `withLock` holder now writes a unique `${process.pid}-${randomUUID()}` ownership token into the lock file after exclusive creation.
- Final cleanup re-reads the lock file and unlinks it only when the token still belongs to the finishing holder, preventing a stale original holder from deleting a newer holder's lock.
- Stale-lock detection and retry behavior remain unchanged.

Verification: `pnpm --filter @agentwiki/local-sync test` (1 file, 6 tests), `typecheck`, and `build` all passed. pnpm emitted only the pre-existing Node 24 versus monorepo Node 26 engine warning.
