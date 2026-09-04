# Agent self-service prompt hotfix release verification

## Result

The Agent self-service onboarding prompt hotfix was corrected and re-released
on 2026-09-04 (Asia/Shanghai). GitHub `master` and production contain
application commit `f02f8c4`.
The onboarding page once again gives the user a complete task prompt to paste
into a local Agent instead of presenting the NDJSON driver command as an
ordinary terminal command.

## Product contract restored

- The copied payload tells the Agent to start the pinned `0.7.0` command and
  drive its line-delimited NDJSON stdout/stdin protocol through a terminal
  event.
- Browser authorization, structured input, preview, explicit confirmation,
  upload safety, session recovery, Space/Agent/role reporting, and MCP
  verification are stated in both Chinese and English.
- The page badge derives from `LOCAL_SYNC_VERSION`; the old hard-coded `0.5`
  label is gone.
- The page explicitly says the NDJSON command is not an ordinary terminal
  command. The stable project specification records `--protocol human` as the
  direct human-terminal fallback.

## Clean candidate gates

The release candidate was rebuilt from GitHub `master` at `cc8a14d`, isolated
from unrelated staged work in the primary checkout.

- onboarding and adjacent guide tests: 15/15 passed;
- client suite: 1,119/1,120 passed in the full parallel run; the one unrelated
  200,000-code-point boundary test exceeded its five-second timeout and then
  passed 1/1 in isolation;
- repository typecheck and lint: passed;
- full production build: passed, with only the existing Vite large-chunk
  warning;
- `git diff --check`: passed;
- no server, npm package, lockfile, or database migration changed.

## Backup and deployment

Verified rollback artifacts were created before deployment:

- PostgreSQL custom dump:
  `/root/backups/agentwiki/pre-onboard-prompt-20260904-094620.dump`
  (6,337,133 bytes; 499 listed restore objects);
- complete application archive:
  `/root/backups/agentwiki/pre-onboard-prompt-20260904-094620-app.tar.gz`
  (327,227,427 bytes; environment, server build, and client build entries
  verified);
- verified checksum manifest:
  `/root/backups/agentwiki/pre-onboard-prompt-20260904-094620.sha256`.

The staged deployment reported 49 migrations and no pending migration, then
atomically activated the release. The previous application tree remains at
`/root/agentwiki-previous-20260904094931`.

## Production acceptance

- API, Worker, and Frontend are active/running with `NRestarts=0`.
- Public `/api/health` reports application, database, Redis, audit persistence,
  and attachment storage `ok`; `/` and `/guide/agent-onboard` return HTTP 200.
- The deployed `OnboardPage.tsx` SHA-256 exactly matches the release candidate.
- The controlled public business smoke passed 31/31 checks.
- Release-window service logs contain no 500, FATAL, unhandled, or ERROR entry.
- Real Chrome shows the complete Chinese prompt and pinned `0.7.0` command;
  clicking Copy changes the control to `已复制提示词`.
- At a 390x844 viewport the prompt and button remain visible and document
  `scrollWidth` equals `innerWidth` (390px).

## Package surfaces

`@neomei/agentwiki-local-sync` remains published at `0.7.0`. This web-only
hotfix does not change the package, so no npm publication or release tag was
required.

## Corrective Agent-consumer acceptance

The first release above did not satisfy the product contract: its checks proved
that the prompt was displayed and copied, but did not prove that a fresh Agent
could consume it. A controlled production run also showed that a cold `npx`
install may emit no stdout for several minutes before the CLI starts.

The missing reply contract was reproduced with a fresh Agent and an offline
NDJSON fixture. After the plan preview, the Agent inferred this invalid reply:

```json
{"requestId":"plan-1","approved":true}
```

The fixture rejected it with `BAD_DRIVER_REPLY` because the real protocol
requires `requestId`, boolean `confirmed`, and the exact `planHash` from the
event. The corrected bilingual prompt now also preserves declared field types
(`paths` is a string array and `choice` uses an advertised choice), keeps one
writable process through cold-start silence and browser authorization, and
reports the real failure fields without inventing recovery instructions.

Reproducible repository gates:

- `cd agentwiki && node --test scripts/onboarding-prompt-fixture.test.mjs`:
  3/3 passed,
  including rejection of `approved` and delayed-first-event coverage;
- a second fresh Agent ran
  `cd agentwiki && node scripts/onboarding-prompt-fixture.mjs`, kept the same
  process through delayed startup, authorization wait and heartbeat, copied
  both `requestId + confirmed + planHash` pairs, and reached `completed` with
  connection and manifest evidence;
- Chinese and English clipboard prompts assert the complete valid input and
  confirmation examples and exclude an `approved` JSON field;
- full client suite: 1,120/1,120 passed; client typecheck, lint, and production
  build passed.

The production CLI/API path was separately exercised with a disposable account,
Space, Agent, and one-file source. It completed Device Auth, bootstrap, scan,
both confirmations, and first sync with a `completed` event; all disposable
production resources were deleted afterward.

## Corrective production release

Rollback artifacts created immediately before the corrective deployment:

- `/root/backups/agentwiki/pre-agent-prompt-20260904-175254.dump`;
- `/root/backups/agentwiki/pre-agent-prompt-20260904-175254-app.tar.gz`;
- `/root/backups/agentwiki/pre-agent-prompt-20260904-175254.sha256`.

The deployment rebuilt all six workspace projects, reported 49 migrations with
none pending, atomically activated the release, and retained the previous tree
at `/root/agentwiki-previous-20260904175421`. The API, Worker, and Frontend are
active/running. Public `/api/health` reports `ok` for application, database,
Redis, audit persistence, and attachment storage; the public onboarding route
returns HTTP 200.

The deployed `OnboardPage.tsx` SHA-256 is
`affde2070aea72b8a64d47a41338b97a0a934e895f0548c993840d3a8adb3855`, exactly
matching the release candidate. The public JavaScript bundle contains both
language variants and the required `values`, `confirmed`, and `planHash`
contract. In real Chrome, the Chinese prompt rendered in full, Copy changed to
`已复制提示词`, and the English prompt retained the same protocol requirements.

The npm package remains `@neomei/agentwiki-local-sync@0.7.0`; this corrective
release changes the Web prompt and its repository-level consumer gate, not the
published CLI package.
