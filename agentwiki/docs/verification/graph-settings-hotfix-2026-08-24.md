# Knowledge graph settings hotfix release verification

## Result

The knowledge graph settings hotfix was released on 2026-08-24
(Asia/Shanghai). GitHub and production contain code commit `898dc0b`; this
release did not change database migrations or either published npm package.

## Defects fixed

- The client PATCHes only editable graph-setting fields instead of echoing the
  read-only `lastRunAt` field returned by GET.
- Successful saves use the server response; failed threshold saves roll back to
  the last server-confirmed value.
- Space changes clear stale settings, permissions, save state, and delayed
  responses from the previous Space.
- Space and graph controls are disabled when the current human member role does
  not allow configuration changes.
- Graph settings are updated atomically as a partial update, and empty updates
  are rejected.
- A refresh now rescans retained automatic similarity relations and updates
  their scores instead of leaving stale scores unchanged.

## Local gates

Fresh full-repository verification passed before deployment:

| Gate | Result |
| --- | --- |
| Runtime contracts | 90 passed, 47 explicit environment skips |
| Server Jest | 800 passed, 3 explicit environment skips |
| Client Vitest | 240 passed |
| Sync protocol Vitest | 25 passed |
| Local Sync Vitest | 743 passed |
| Typecheck, lint, production build, `git diff --check` | passed |

The graph-specific regression suite passed 37/37 before the final full run.

## Backup and deployment

Verified rollback artifacts were created before deployment:

- database: `/root/backups/agentwiki/pre-graph-settings-hotfix-20260824-000450.dump`
  - SHA-256: `2750daf8a0c48c0621695307fdcbf9eb6849e9d5862c83a735400a1e7910b206`
- application: `/root/backups/agentwiki/pre-graph-settings-hotfix-20260824-000450-app.tar.gz`
  - SHA-256: `63ccb0d97b412b094fdb887f8980921935095631573a913736bb4e13295dcc2e`

The database dump was listed successfully with `pg_restore -l`, the application
archive was listed successfully, and both checksums were verified. The previous
application tree remains at `/root/agentwiki-previous-20260824000843`.

Deployment found no pending migration. The API, Worker, and Frontend user
services are active with `NRestarts=0`. Public health reports database, Redis,
and audit persistence `ok`. The deployed hashes of the three changed production
source files exactly match the local release.

## Production acceptance

In the authenticated production browser, the original graph configuration was
recorded, then the complete save path was exercised:

1. enabled automatic similarity relations and observed `已保存`;
2. changed the threshold from `0.86` to `0.85` and observed `已保存`;
3. reloaded the page and confirmed both values persisted;
4. restored the original threshold `0.86` and disabled similarity relations;
5. reloaded again and confirmed the original state was restored;
6. ran `立即刷新` and received `刷新完成：链接 +0/-0，相似 +0/-0，LLM 提案 0`.

No `保存失败` appeared. The public HTTP/MCP smoke then passed all 31 checks.
Queries limited to this release window confirmed that the smoke runs left zero
new test users, Spaces, or Agents. Expected 401/403/409 negative-test responses
were present; no 500 or FATAL entry was found after deployment.

The generic Playwright route-smoke script could not launch because its optional
local Chromium binary was not installed. This did not block the release because
the exact changed route and interactions were exercised in the user's real,
authenticated Chrome session, while public UI and API health checks both passed.

## Package surfaces

- `@neomei/agentwiki-local-sync`: `0.5.1`
- `@neomei/agentwiki-sync-protocol`: `0.2.0`

Neither package contains this web/API-only hotfix, so no npm publish was needed.
