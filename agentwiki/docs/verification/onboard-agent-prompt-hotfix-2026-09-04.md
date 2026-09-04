# Agent self-service prompt hotfix release verification

## Result

The Agent self-service onboarding prompt hotfix was released on 2026-09-04
(Asia/Shanghai). GitHub and production contain application commit `ae147a4`.
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
