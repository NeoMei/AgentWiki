# AgentWiki Node 26-Only Compatibility Design

## Status

Approved direction: targeted Node 26 adaptation for the `agentwiki/` product only. Reference projects at the repository root are out of scope. Node 20, 22, and 24 compatibility will not be retained as a requirement.

## Goal

Make Node.js 26 the single explicit runtime baseline for AgentWiki development, tests, production builds, Docker images, and direct deployments, while preserving current product behavior and avoiding unrelated framework upgrades.

## Current Evidence

- Node 26.5.0 starts the Vite frontend, Nest API, and ingestion Worker successfully.
- Server tests, type checks, lint, and the production build already run on Node 26.
- The four client tests fail on Node 26 because Node 26 exposes a configurable global `localStorage` accessor and throws when no `--localstorage-file` is configured. Vitest 3 workers do not pass a Web Storage disabling flag, so jsdom cannot supply its browser-scoped `localStorage` global.
- Running the same client tests with an explicit Node local-storage file succeeds, confirming that the failure is test-runtime isolation rather than product behavior.
- Docker defaults still use `node:20-alpine`; the root package has no Node engine contract; direct deployment does not reject the wrong Node major.
- Bare `pnpm dev` does not load the root `.env` into the filtered server package and therefore does not map `APP_SECRET` to the API's required `JWT_SECRET`.

## Runtime Contract

- The root package declares `engines.node` as `>=26 <27`.
- The repository adds `.node-version` with major version `26`, allowing version managers to resolve the newest installed Node 26 patch.
- The root package declares the existing package-manager baseline, `pnpm@11.9.0`, so Node migration does not also become a pnpm migration.
- Direct `@types/node` dependencies are aligned to major 26. Application frameworks and business dependencies remain at their current versions unless a Node 26 verification failure proves an upgrade necessary.
- No fallback behavior, conditional code, or test matrix for Node 20, 22, or 24 is added.

## Development Startup

A small Node-based development runner replaces the shell-background expression currently embedded in the root `dev` script.

The runner will:

1. Load the repository-root `.env` using Node 26's built-in environment-file support.
2. Set `JWT_SECRET` from `APP_SECRET` only when `JWT_SECRET` is absent.
3. Start the API watcher, Worker watcher, and Vite dev server as separate child processes.
4. Stream each child process directly to the terminal.
5. Forward `SIGINT` and `SIGTERM` to all children.
6. Stop the remaining children and return a non-zero exit status when any child exits unexpectedly.

This makes `pnpm dev` the only required local startup command and removes the manual Node 20 `PATH` override and shell-specific environment setup recorded during migration.

The runner will expose its environment-resolution and process-supervision logic for Node's built-in test runner. Tests will cover `APP_SECRET` fallback, preservation of an explicit `JWT_SECRET`, missing-secret failure, signal forwarding, and sibling shutdown after an unexpected child exit. The root test command will include this runner suite.

## Client Test Isolation

The Vitest configuration will pass `--no-experimental-webstorage` to forked test workers through `poolOptions.forks.execArgv`.

This intentionally disables Node's process-global Web Storage implementation inside test workers. The configured jsdom environment then owns `window.localStorage` and the corresponding test global, matching browser behavior and preventing process-wide persisted state from leaking across test files. Product code continues to use the browser's native `localStorage` unchanged.

The existing four client tests are the regression tests for this compatibility failure: they fail under unmodified Node 26 and must pass after the worker configuration change without adding a shared `--localstorage-file`.

## Build and Deployment

- Both application Dockerfiles default to `node:26-alpine`.
- `docker-compose.yml` uses `node:26-alpine` as its default `NODE_IMAGE` for backend and frontend builds.
- The direct deployment script performs an early Node-major check before dependency installation, build, migration, or service restart. Any runtime other than major 26 fails with an actionable error.
- Existing systemd units keep invoking the provisioned system Node path. Deployment documentation must state that the host's `/usr/bin/node` must resolve to Node 26 before deployment.
- Production application behavior, service topology, PostgreSQL migrations, Redis configuration, and systemd process separation remain unchanged.

## Error Handling

- The development runner fails before spawning children when `.env` cannot be loaded or neither `JWT_SECRET` nor `APP_SECRET` is configured.
- An unexpected API, Worker, or frontend exit terminates the sibling processes so a partially running development stack is not reported as healthy.
- The deployment preflight reports the detected Node version and the required major version, then exits before any remote mutation.
- Existing API fail-fast checks for required production secrets remain in place.

## Documentation and Project Memory

The migration guide, development handbook, operations documentation where applicable, and `.codex-memory/current.md` will be updated to state:

- Node 26 is the only supported runtime.
- `pnpm dev` is the normal local startup command.
- Docker builds use Node 26.
- Direct-deployment hosts must provision Node 26 before running `deploy.sh`.
- Node 20-specific startup instructions and compatibility notes are obsolete.

## Verification

All verification commands must execute with Node 26 selected and must report Node major 26 before running:

1. `pnpm install --frozen-lockfile`
2. `pnpm lint` with zero errors
3. `pnpm typecheck`
4. `pnpm test` with the development-runner suite, 16/16 server suites, 58/58 server tests, and 4/4 client tests passing
5. `pnpm build`
6. `pnpm --filter server exec prisma migrate status`
7. `pnpm dev`, followed by frontend HTTP 200, `/api/health` reporting database and Redis `ok`, and a live Worker process
8. Static confirmation that no active AgentWiki runtime or Docker default still references Node 20
9. Docker image builds when a Docker runtime is available; otherwise Dockerfile and Compose configuration validation is reported separately as an environment-limited check
10. A refreshed full codebase-memory index after all source and configuration changes

## Non-Goals

- Upgrading React, NestJS, Prisma, Vite, Vitest, Tailwind, or other dependencies without a demonstrated Node 26 incompatibility
- Adapting `outline/`, `docmost/`, `openwiki/`, `swarmvault/`, or `mnemon/`
- Preserving Node 20, 22, or 24 support
- Changing product features, authorization rules, knowledge provenance, deployment topology, or database schema
