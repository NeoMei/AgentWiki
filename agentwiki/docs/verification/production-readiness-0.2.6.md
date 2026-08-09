# AgentWiki 0.2.6 Production Readiness Verification

Date: 2026-08-10

## Result

AgentWiki 0.2.6 passed the local release gates, real PostgreSQL migration suite,
disposable full-stack acceptance suite, real local knowledge adapter flow, and
server-side OpenCode isolation checks. Public npm publication and production
deployment remain gated on the external release steps recorded below.

## Specification and task coverage

| Surface | Verification evidence |
|---|---|
| Node 24/26 compatibility | Runtime contract, dependency install, typecheck and production build on Node 24.18.0 |
| Generic Agent onboarding | One-shot installation API, self-install scope ceiling, onboarding JSON and Playwright enrollment flow |
| Global navigation and responsive UI | 3 public, 16 authenticated and 6 mobile routes without page errors, API 5xx or horizontal overflow |
| Space Agent membership | Real owner flow in desktop and 390x844 browser views with fixture cleanup |
| Local knowledge orchestration | Real codebase-memory scan, local preview, provenance-preserving Bundle, explicit confirmation, human review and publish |
| Bidirectional Space sync | Real Snapshot/Delta Pull/Push across two workspaces, three-way conflict blocking, page/memory/relation sync and approved deletion |
| OpenCode assistance | Real free-model completion plus an isolated filesystem canary test with tools denied |
| Platform administration | Random one-time password, forced password change, account lock/revocation and last-superadmin deletion invariants |
| Agent review and revert | Page, relation and shared-memory publication plus reversible rollback state |

## Automated gates

- Runtime contracts and real PostgreSQL migrations: 61/61.
- Server Jest: 45/45 suites, 369/369 tests.
- Client Vitest: 30/30 files, 124/124 tests.
- Local-sync Vitest: 23/23 files, 173/173 tests.
- Total automated assertions: 727.
- TypeScript typecheck: passed.
- ESLint: passed with zero findings.
- Production build: passed.
- Playwright editor, language and local-sync enrollment: 3/3.
- Production dependency audit: 0 critical, 0 high (2 low, 11 moderate).
- Peer dependency check: passed.
- `git diff --check` and repository secret-pattern scan: passed.

## Disposable full-stack acceptance

- API health confirmed PostgreSQL, Redis and durable audit persistence.
- Core smoke covered registration/login failures, Spaces, pages, history, Agents,
  grants, review, graph, search and cleanup (18 checks).
- Real codebase-memory adapter produced an architecture artifact and a Wiki page;
  the Orchestrator previewed, submitted, reviewed and published it.
- Cross-machine SyncEngine advanced two authoritative revisions, blocked one
  conflict, synchronized shared memory and graph relations, and applied three
  human-approved deletions.
- UI acceptance covered public, authenticated, mobile, Space Agent member and
  Markdown editor flows.
- OpenCode completed with `opencode/big-pickle` on the free tier in one attempt
  with zero reported cost. A malicious filesystem-read prompt could not disclose
  a randomly generated canary outside the isolated working directory.

All disposable users, Spaces, Agents, credentials and local workspaces were
removed by the guarded harnesses.

## Security review

Codex Security scan `9d4ab263-f081-4ab1-a169-1ba4985bd5ff` reviewed 429 files
across seven security surfaces. It reported 16 findings against the pre-fix
snapshot (1 critical, 6 high, 9 medium). The production-readiness working tree
contains and verifies remediations for all 16, including OpenCode tool isolation,
scope-delegation ceilings, revocation checks, path containment, symlink blocking,
resource quotas, secret redaction, proxy trust and loopback backend binding.

## Codebase knowledge graph

- Full persistent index: 3,861 nodes and 10,135 edges.
- Architecture, graph schema, symbol search, exact source retrieval and call-chain
  tracing were all queried successfully.
- The `confirmAndPush` source proves explicit confirmation precedes `SyncEngine.push`;
  the push trace reaches merge, conflict, atomic state and safe materialization paths.

## External release status

- npm package tarball: built, inspected and installed from a clean temporary HOME;
  version 0.2.6 is staged publicly and awaits npm website WebAuthn approval.
- GitHub `master`: commit `caba0a4` pushed; annotated tag `v0.2.6` published.
- Production service: awaits npm publication, backup, migration/deploy and public
  health/onboarding smoke.

## Environment limitation

Docker CLI is not installed on this validation host. Docker image construction was
therefore not executed. Dockerfiles and Compose behavior remain covered by runtime
contract tests, production build validation and static configuration review.
