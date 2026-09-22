# AgentWiki v0.12.5

Page-group creation now follows the Space content-write boundary: Space owners and editors can use page-group templates across Spaces, while viewers and Agents remain unable to instantiate them. The old Space allowlist no longer hides or blocks page-group instantiation; management of template definitions remains owner/admin scoped.

Validation:

- Server page-template suites: 3 focused suites, 46 tests passed.
- Client new-content/page-group suites: 2 files, 19 tests passed.
- `pnpm typecheck` passed.
- `pnpm lint` passed with one existing warning in `project-taskboard.service.ts` and no errors.
- `pnpm build` passed.
- `node --test scripts/node-runtime-contract.test.mjs` passed 33/33.
- The repository harness (`pnpm test`) and full database gate were attempted but remain blocked by the release host's missing dedicated test database/Redis configuration and PostgreSQL privileges; the existing folder migration corpus hash check also remains mismatched. These failures are outside the page-group permission regression.
