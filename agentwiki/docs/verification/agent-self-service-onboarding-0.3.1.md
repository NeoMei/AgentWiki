# Agent Self-Service Onboarding 0.3.1 — Verification

> Status: **Released and production-verified**
> Date: 2026-08-11
> Release: `v0.3.1` / GitHub PR #4

## Automated Gates

| Gate | Result | Status |
|------|--------|--------|
| Runtime contract | 67 pass / 9 skip | ✅ |
| Server unit/integration | 486 pass | ✅ |
| Client unit | 160 pass | ✅ |
| Local-sync unit | 317 pass | ✅ |
| Typecheck | 0 errors | ✅ |
| Lint | 0 errors | ✅ |
| Build | success | ✅ |
| Peer dependencies | 0 issues | ✅ |
| Dependency audit | 0 high / 0 critical | ✅ |

The one remaining moderate advisory is `GHSA-36xv-jgw5-4q75` in NestJS SSE serialization. AgentWiki exposes no SSE route or `SseStream` usage, so the affected path is unreachable. Fixing it requires a coordinated NestJS 10 → 11 major upgrade and is intentionally kept out of this patch release.

## Package Verification

- Published package: `@neomei/agentwiki-local-sync@0.3.1`
- npm `latest`: `0.3.1`
- Tarball: 116 files, 95.1 kB packed / 440.2 kB unpacked
- Public CLI: `agentwiki-local-sync` → `dist/cli.js`
- Retired `connect`, `dist/mcp` and low-level orchestrator command surfaces are excluded from the package.
- Markdown/text onboarding no longer installs the managed MarkItDown Python runtime; PDF/DOC/DOCX still install it on demand.

## Production Evidence

- Production: `https://agentwiki.quukk.com`
- Pre-release PostgreSQL backup: `/root/backups/agentwiki/pre-0.3.0-20260811-163320.dump` (407,025 bytes)
- Prisma migration `20260810000000_add_onboarding_device_sessions`: applied
- API / worker / frontend: `active`
- `/api/health`: database, Redis and audit persistence all `ok`
- `/api/onboard`: advertises the pinned `0.3.1` command
- `/api/onboard.json`: actual HTTP `410 Gone`, with the `0.3.1` replacement command
- Server and production environment `LOCAL_SYNC_PACKAGE_VERSION`: `0.3.1`

## Published-Package Three-Client E2E

Each run used a disposable user and isolated HOME, installed the package from npm (not a local build), completed Device Auth, bootstrap, the single `agentwiki` gateway configuration, first scan, preview confirmation, sync, and cleanup.

| Client | Session | Status |
|--------|---------|--------|
| Codex | `eb0f426a-e74f-48ac-8e09-66f9c66caac7` | ✅ |
| Claude Code | `fa25ca8c-2932-4474-be10-2b835df46674` | ✅ |
| OpenCode | `0c978d16-9615-40cd-9e5a-38a4f9a84e98` | ✅ |

Post-run production residue check: `0` active `onboard-e2e-*` users and `0` active `aw-e2e-*` Spaces.

## Browser E2E

Playwright ran against production Chrome and verified the complete Device Auth UI flow, safe return target, authorization, one-time onboarding token issuance, replay protection, and disposable-user cleanup: **1 passed**.

## Final Checklist

- [x] Back up production PostgreSQL
- [x] Apply the onboarding device-session migration
- [x] Deploy server/client/worker 0.3.1
- [x] Verify health and all three services
- [x] Publish npm 0.3.1 and verify `latest`
- [x] Run real published-package onboarding for Codex, Claude Code and OpenCode
- [x] Verify single `agentwiki` MCP gateway and first sync
- [x] Verify browser Device Auth interaction and token replay protection
- [x] Verify `/api/onboard.json` returns an actual HTTP 410
- [x] Verify interruption/resume and cleanup behavior through automated harness tests
- [x] Verify disposable production resources are fully cleaned
- [x] Integrate PR #4, tag `v0.3.1`, and publish the GitHub Release
