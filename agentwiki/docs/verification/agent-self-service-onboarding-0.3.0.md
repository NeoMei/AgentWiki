# Agent Self-Service Onboarding 0.3.0 — Verification

> Status: **Pending production E2E**
> Date: 2026-08-11

## Automated Gates

| Gate | Count | Status |
|------|-------|--------|
| Runtime contract | 59 pass / 9 skip | ✅ |
| Server unit/integration | 486 pass | ✅ |
| Client unit | 160 pass | ✅ |
| Local-sync unit | 292 pass | ✅ |
| Typecheck | 0 errors | ✅ |
| Lint | 0 errors | ✅ |
| Build | success | ✅ |

## Onboarding E2E Harness

- `scripts/onboarding-e2e.mjs` — NDJSON-driven harness with loopback-by-default safety
- `scripts/onboarding-e2e.test.mjs` — Safety + protocol assertions (7 tests)
- Loopback: `AGENTWIKI_E2E=1 node scripts/onboarding-e2e.mjs --target http://localhost:3000/api`
- Production opt-in: `AGENTWIKI_E2E=1 AGENTWIKI_E2E_ALLOW_REMOTE=1 AGENTWIKI_E2E_CONFIRM_HOST=agentwiki.quukk.com`

## Production E2E Checklist

- [ ] Back up production PostgreSQL
- [ ] Apply Prisma migration (onboarding_device_sessions)
- [ ] Deploy server/client/worker (0.3.0)
- [ ] Verify `/api/health` all green
- [ ] Run onboarding E2E with disposable resources
- [ ] Verify single `agentwiki` MCP entry after onboarding
- [ ] Verify `/api/onboard.json` returns 410
- [ ] Verify resume after interruption
- [ ] Clean up disposable user/Space/Agent
- [ ] Confirm npm `latest=0.3.0`, GitHub master, deployed commit aligned

## Known Non-Blocking Risks

- Three-client (Codex/Claude/OpenCode) installation verification requires real CLIs present
- Production deployment of 0.3.0 pending user authorization
