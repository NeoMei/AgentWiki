# Unified AgentWiki MCP 0.3.7 — Local Verification

> Date: 2026-08-15  
> Branch: `codex/unified-agentwiki-mcp-fix`  
> Scope: local implementation and verification only; npm publish, merge, and production deployment were not performed.

## Verified behavior

- Ordinary Agent Credentials display the one-time API key for API/script/external-system use and do not render MCP registration instructions.
- Existing-Agent installation instructions use exact-version `onboard --code --protocol ndjson --agent auto`; the retired `connect` command is absent.
- The client configuration contains one gateway named `agentwiki`, exposing `wiki_*`, `local_*`, and `knowledge_*` tools.
- Codex, Claude Code, and OpenCode migration preserves unrelated entries, rejects an unknown occupant of the fixed name, and removes only package-owned entries during uninstall.
- Codex TOML migration preserves non-MCP sections following a migrated MCP block.
- Attachment confirms before consuming the one-time code, closes its input transport on every terminal path, emits a structured NDJSON failure, redacts credential-like values, and delegates rollback/revoke to the shared installer.
- README, Skill, UI guide, server instructions, environment defaults, CLI help, and runtime contracts agree on version 0.3.7 and the single-gateway model.

## Automated gates

| Gate | Result |
| --- | --- |
| `pnpm test` | PASS — runtime 69 pass / 39 conditional skips; server 517; client 156; sync-protocol 22; local-sync 358 |
| `pnpm typecheck` | PASS |
| `pnpm lint` | PASS |
| `pnpm build` | PASS |
| `git diff --check` | PASS |

The 39 runtime skips require a configured PostgreSQL test database and were already guarded as conditional integration suites; this patch does not change their database paths.

## Package inspection

Command:

```bash
pack_dir="$(mktemp -d /tmp/agentwiki-pack-0.3.7.XXXXXX)"
pnpm --filter @neomei/agentwiki-local-sync pack --pack-destination "$pack_dir"
```

Result:

- Tarball: `neomei-agentwiki-local-sync-0.3.7.tgz`
- Prepack: 42 files / 358 tests passed.
- Contents are limited to compiled `dist/`, `README.md`, `skill/SKILL.md`, `LICENSE`, and package metadata.
- Extracted package metadata reports `@neomei/agentwiki-local-sync@0.3.7`.
- Extracted CLI help exposes only `onboard|gateway|doctor|uninstall` and documents optional `--code CODE`.
- Extracted README/Skill contain the single-gateway tool families and no two-MCP, `connect --server`, public `mcp --connection`, or `upgrade --version` instruction.

## Real CLI protocol check

A built CLI subprocess ran with an isolated temporary HOME, an explicit Codex target, a non-listening loopback server, and a non-secret test installation code. The harness parsed the preview, echoed the exact request ID and plan hash, and confirmed the plan.

Observed event sequence:

```text
preview → confirmation_required → failed
```

The terminal event was a valid protocol-v1 `SYNC_FAILED` with `fetch failed`; the process exited non-zero as expected. Neither the installation code nor an `agk_` value appeared in stdout events or stderr. This verifies the real NDJSON confirmation/failure path without consuming a production code or mutating an AgentWiki server.

## Exchange hardening (independent review rounds 2–3)

Three rounds of independent code review were completed. All Critical and Important findings were fixed and verified; the third round concluded **ready to merge**, and its remaining Minor findings were also addressed:

- Redis exchange receipts store metadata only (no API key). Installation credentials derive a deterministic key via `HMAC-SHA256(JWT_SECRET, installationId)` and are claimed exactly once through the new unique `AgentCredential.localSyncInstallationId` column (migration `20260815010000_add_local_sync_installation_claim`), so a crash between credential creation and receipt persistence recovers the same credential on retry.
- Receipt replay is bounded to `min(120 s, remaining code lifetime)`, revalidates expiry, and rechecks credential availability; revocation invalidates both receipt keys. Transient database failures during replay propagate as retryable errors and keep the receipt intact.
- The exchange Redis lock uses a random owner token with compare-and-delete (Lua), so an expired lock can never release another holder's lock.
- Replaying a one-time attach code no longer archives and reinitializes the active `~/.agentwiki` workspace; a fully matching existing connection only repairs the MCP entry and re-verifies.
- Client-config rollback, local-state restore, and credential revoke failures are each reported explicitly in terminal failures, including the replay path.
- `AW-` redaction covers real generated codes without a second hyphen; OpenCode 2.x rewrites preserve non-server `mcp` container fields; atomic config writes fsync the file and clean up temporary files.

Operational note: rotating `JWT_SECRET` prevents re-deriving installation API keys for codes exchanged before the rotation (already-installed credentials keep working because authentication hashes the presented value). Rotate `JWT_SECRET` only together with issuing fresh installation codes.

## Non-blocking observations

- Client tests still print the pre-existing jsdom/CodeMirror `getClientRects` warning while passing.
- Vite still warns that the PageEditor production chunk exceeds 500 kB; this is an existing performance item outside the gateway fix.
- A positive public-package/production attachment E2E is intentionally deferred until npm 0.3.7 is explicitly published and the server is explicitly deployed.

## Release boundary

Remaining external actions require separate authorization and their own evidence:

1. Publish `@neomei/agentwiki-local-sync@0.3.7`.
2. Push/merge the verified branch.
3. Back up PostgreSQL, deploy the server/client release, and run health/smoke checks.
4. Run isolated Codex, Claude Code, and OpenCode acceptance against the public package and production service, including one-entry configuration and unified tool-list checks.
