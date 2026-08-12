# Third-Party Onboarding 0.3.6 — Verification

> Status: **Released and production-verified**
> Date: 2026-08-12
> Release: `0.3.6` (npm `latest`)

## Defects Resolved

| Defect | Severity | Root cause | Fix version |
|--------|----------|------------|-------------|
| DEF-3PT-20260812-002 | S2 | Codex: doctor spawn runner discarded options, so isolated HOME never reached `codex mcp get`. Claude: gateway written to `~/.claude/settings.json` which Claude Code does not read. | Codex fixed in 0.3.5; Claude fixed in 0.3.6. |
| DEF-3PT-20260812-003 | S2 | Preview summary omitted added/modified/deleted/uploadBytes on first sync (no base revision). | 0.3.3. |

## Automated Gates (0.3.6)

| Gate | Result |
|------|--------|
| Runtime contract | 67 pass / 9 skip |
| Server unit/integration | 486 pass |
| Client unit | 160 pass |
| Local-sync unit | 328 pass |
| Typecheck | 0 errors |
| Lint | 0 errors |
| Build | success |

## RETEST4 — public package 0.3.6 isolated-HOME verification

- Scope: ONBOARD-003, ONBOARD-007 (mcp-registration acceptance for all three clients).
- Method: fresh isolated HOME per client; gateway configs written to the correct locations; `npx @neomei/agentwiki-local-sync@0.3.6 doctor --connection <id>`.
- Result: **3 PASS / 0 FAIL**. Codex, Claude, and OpenCode all return `mcp-registration=pass`.
- ONBOARD-004 (preview diff totals) remains PASS from RETEST3.
- Evidence: `docs/testing/third-party/0.3.1-20260811/evidence/04-onboarding-sync/RETEST4-ONBOARD-003-007-doctor.json`.

## Version Alignment

| Surface | Version |
|---------|---------|
| npm `latest` | 0.3.6 |
| GitHub `codex/third-party-test-spec` HEAD | `ef08c56` |
| Production server `LOCAL_SYNC_PACKAGE_VERSION` | 0.3.6 |
| Production server DTO accepted versions | 0.3.6 |
| `/api/onboard` advertised command | 0.3.6 |
| `/api/onboard.json` | HTTP 410, names 0.3.6 replacement |

## Production Evidence

- `https://agentwiki.quukk.com/api/health`: status=ok, database=ok, redis=ok, auditPersistence=ok.
- Pre-deployment backup: `/root/backups/agentwiki/pre-0.3.6-20260812195644.dump.gz` (420,857 bytes).
- API, worker, frontend: all `active`.
- No new Prisma migration required (schema unchanged since 0.3.1).

## RETEST5 — published-package full end-to-end onboarding (0.3.6)

Ran the automated onboarding E2E harness against production `https://agentwiki.quukk.com/api` with the public npm package `@neomei/agentwiki-local-sync@0.3.6`. Each client completed Device Auth (auto-registered disposable user + auto-approved), bootstrap confirmation, single gateway install, first local scan, preview confirmation, and first sync.

| Client | Session | Status |
|--------|---------|--------|
| Codex | `fdf341cc-e907-4ce2-95b8-328512feb514` | PASS |
| Claude Code | `a6c23e9b-f2a9-495d-8ebd-9453e8f6fdb5` | PASS |
| OpenCode | `c68019fa-59da-4a24-b342-f4e7af3554d7` | PASS |

Post-run residue check (production): `0` active `onboard-e2e-*` users, `0` active `aw-e2e-*` spaces, `0` active `aw-e2e-*` agents. Production health green after all runs.

This closes the open verification boundary: the complete Device Auth → onboarding → first-sync flow now passes end-to-end for all three clients on the public 0.3.6 package, including the Claude gateway fix.
