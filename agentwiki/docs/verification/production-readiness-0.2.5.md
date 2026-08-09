# AgentWiki 0.2.5 Production Readiness Verification

Date: 2026-08-10

## Result

AgentWiki 0.2.5 passed the local release gates and disposable full-stack acceptance suite. The npm package `@neomei/agentwiki-local-sync@0.2.5` is publicly published and was reinstalled from the public registry in a clean temporary home.

## Specification coverage

| Specification | Verification evidence |
|---|---|
| Node 24/26 compatibility | Runtime contract, Docker/deploy contract, typecheck and production build |
| Generic Agent onboarding | `/onboard`, one-shot installation API, Playwright installation-card flow |
| Global navigation | Desktop and mobile route smoke across product, guide and workspace routes |
| Local-sync usage guide | Client component tests, public guide route and package URL/version contract |
| Space Agent membership | Real owner flow in desktop and 390×844 browser view with cleanup |
| Zero-config local orchestrator | Real `codebase-memory-mcp@0.9.0` scan, preview, non-empty provenance Bundle, confirmation, human review and publish |
| Space revisions and bidirectional sync | Real two-machine Snapshot/Delta Pull/Push, page/memory/relation materialization, conflict blocking and approved deletion |
| OpenCode fallback routing | Real free-model assist task with model/tier/attempt/usage/cost metadata |
| Platform administration | Server authorization tests and authenticated route smoke |

## Automated gates

- Runtime and real PostgreSQL migration tests: 60/60.
- Server Jest suites: 42/42 suites, 349/349 tests.
- Client Vitest suites: 30/30 files, 124/124 tests.
- Local-sync Vitest suites: 23/23 files, 171/171 tests.
- TypeScript typecheck: passed.
- ESLint: passed with zero findings.
- Production build: passed.
- Playwright editor/language/local-sync enrollment: 3/3.

## Disposable full-stack acceptance

- API health: PostgreSQL, Redis and audit persistence healthy.
- Local-sync legacy compatibility: two pages, graph relations, evidence, second-run noop and credential revocation.
- Real local orchestrator: code graph artifact collected, Wiki preview generated, reviewed and published.
- Cross-machine: two local homes, authoritative revision advancement, Delta Pull, three-way conflict protection, shared memory, relation, and approved page/memory/relation deletion.
- UI routes: 3 public, 16 authenticated and 6 mobile routes; no page exception, console error, API 5xx or mobile horizontal overflow.
- Space Agent membership: desktop and mobile passed.
- Agent assist: free OpenCode model succeeded on first attempt at zero reported cost.

All disposable users, Spaces, Agents, credentials and local workspaces were removed by the harnesses.
