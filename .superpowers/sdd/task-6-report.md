# Task 6 Report: One-time local-sync installation codes

## Status

DONE

## Commit

- `fd86829` — `feat: add one-time local sync enrollment`

## Delivered

- Added strict Redis security-state operations: `setOnce`, `getDel`, `getStrict`, and `deleteStrict`; these surface Redis failures instead of using permissive cache fallbacks.
- Added validated installation creation/exchange DTOs and stable business mappings:
  - `LOCAL_SYNC_CODE_INVALID` → 401
  - `LOCAL_SYNC_VERSION_UNSUPPORTED` → 409
  - `SYNC_CONFIRMATION_REQUIRED` → 400
- Extracted `AgentService.normalizeCredentialScopes` and reused it for ordinary credentials and local-sync installations.
- Added `LocalSyncInstallationService` with:
  - 144-bit random visible codes prefixed with `AW-`.
  - SHA-256 installation IDs and hash-keyed Redis state only.
  - 600-second TTL, atomic `GETDEL` exchange, and three-attempt collision handling.
  - Exact `LOCAL_SYNC_PACKAGE_VERSION` enforcement.
  - Active-Agent and owner checks before issuance and again before credential creation.
  - Scope validation before any Redis write and before credential creation.
  - Per-IP fixed-window exchange limiting at 10 attempts per minute, failing closed if rate-limit state is unavailable.
  - Audit metadata containing the Credential ID but never the API key or visible installation code.
  - Pinned `npx @agentwiki/local-sync@<version> connect` instructions that request doctor output and state that installation does not scan or sync.
- Added revocation ownership binding: the stored immutable payload must match the authenticated owner and route Agent before strict deletion.
- Added a separate controller so creation/revocation use `JwtAuthGuard` + `HumanOnlyGuard`, while exchange remains a public one-time-code route.
- Restricted request-derived API origins to development only. Configured and derived URLs must be absolute HTTP(S) URLs without embedded credentials and have trailing slashes normalized.
- Registered the controller/service and documented `PUBLIC_API_URL` and `LOCAL_SYNC_PACKAGE_VERSION`.
- Updated the existing knowledge-sync HTTP expectation for the planned 400 confirmation-required response.

## TDD Evidence

- Redis tests first failed because `setOnce`, `getDel`, `getStrict`, and `deleteStrict` did not exist, then passed after implementation.
- DTO/business-code tests first failed because the DTO module did not exist, then passed after implementation.
- Installation service tests first failed because the service did not exist; the completed suite covers hash-only storage, TTL, collisions, invalid scopes, ownership-bound revocation, one-time/concurrent exchange, expiration/reuse, version mismatch, paused/revoked Agents, rate limiting, and secret-safe audit metadata.
- Agent scope tests first failed because the public shared normalizer did not exist, then passed after extraction.
- Controller tests first failed because the controller did not exist; the completed suite covers guard separation, canonical configured URL, development fallback, staging/production/unset fail-closed behavior, invalid URL rejection, and request IP forwarding.

## Verification

All final gates ran with Node.js `v26.5.0`:

- Full server Jest: 32 suites, 228 tests passed.
- Server TypeScript typecheck: passed.
- Server ESLint: passed with 0 errors and 0 warnings.
- Nest production build: passed.
- `git diff --check`: passed.
- Independent code review after fixes: no Critical or Important findings; Ready = Yes.

## Concerns

None.

## Review Fixes (2026-07-29)

- Fixed exchange audit-failure cleanup: if `local-sync.installation.exchange` audit persistence fails after a credential is created, the service revokes that credential before rethrowing the audit error. This prevents an active credential whose API key was never returned to the caller.
- Hardened generated connect instructions: the normalized server URL is now parsed and restricted to HTTP(S), credential-free URLs with shell-safe hostname, port, and path characters; query strings and fragments are rejected. Unsafe URLs fail with `LOCAL_SYNC_VERSION_UNSUPPORTED` and `Server URL contains unsafe characters` before Redis state is written.
- Added regression tests for both audit-failure credential revocation and shell-metacharacter URL rejection.

Verification (local runtime Node.js `v24.18.0`, package declares Node.js `>=26 <27`, so pnpm emitted its expected engine warning):

- `pnpm --filter @agentwiki/server exec jest src/core/agent/local-sync-installation.service.spec.ts src/core/agent/agent.service.spec.ts src/database/redis.service.spec.ts --runInBand` — 3 suites / 46 tests passed.
- `pnpm --filter @agentwiki/server typecheck` — passed.
- `git diff --check` — passed.

## Review Fixes (credential audit compensation, 2026-07-29)

- Moved local-sync credential creation inside the exchange compensation boundary.
- If credential creation throws after persisting its row (for example, its internal audit fails), the service lists active credentials, revokes the newest one only when it was created within the prior 30 seconds, and then rethrows the original error.
- Added regression coverage for this internal-audit-failure cleanup path.

Verification (local runtime Node.js `v24.18.0`; package declares Node.js `>=26 <27`, resulting in the expected pnpm engine warning):

- `pnpm --filter @agentwiki/server exec jest src/core/agent/local-sync-installation.service.spec.ts --runInBand` — 1 suite / 20 tests passed.
- `pnpm --filter @agentwiki/server typecheck` — passed.

## Review Fixes (credential audit resilience, 2026-07-29)

- Made `AgentService.createCredential` preserve and return a successfully persisted credential when its own audit write fails, while emitting a warning.
- Removed the concurrency-unsafe newest-credential/time-window compensation from local-sync exchange.
- Exchange audit failures still revoke the credential that was returned by `createCredential`; pre-persistence credential creation failures revoke nothing.

Verification (local runtime Node.js `v24.18.0`; package declares Node.js `>=26 <27`, resulting in the expected pnpm engine warning):

- `pnpm --filter @agentwiki/server exec jest src/core/agent/local-sync-installation.service.spec.ts src/core/agent/agent.service.spec.ts --runInBand` — 2 suites / 25 tests passed.
- `pnpm --filter @agentwiki/server typecheck` — passed.
- `git diff --check` — passed.
