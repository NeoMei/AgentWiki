# Agent Authorization Single Source Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Make the Space Grant role the only persisted Agent authorization fact so an Agent Credential can authenticate a connection but can never independently narrow or widen that role.

**Architecture:** Each `AgentCredential` is bound by a database-enforced composite foreign key to exactly one `AgentGrant` for the same Agent. `AgentGrant.role` is the sole persisted permission field; scopes are always derived from that role at request time. Authentication returns the bound authorization identity, Space authorization accepts only that exact Grant, and connection exchange creates/updates the Grant before issuing its identity-only Credential.

**Tech Stack:** TypeScript, NestJS 10, Prisma 5/PostgreSQL, React 18, Vitest/Jest, `@neomei/agentwiki-sync-protocol`, pnpm 11.

## Global Constraints

- The only Agent authorization roles are `reader`, `editor`, and `publisher`.
- `AgentCredential` stores identity/lifecycle only; it must not persist `role` or `scopes`.
- `AgentGrant` stores exactly one `role`; it must not persist a duplicate `scopes` array.
- Every Agent Credential is bound to exactly one Grant for the same Agent through `(authorizationId, agentId) -> (AgentGrant.id, AgentGrant.agentId)`.
- A Credential may access only its bound Space authorization; it cannot inherit another Grant owned by the same Agent.
- Role scopes are derived only with `scopesForAgentAccessRole(grant.role)`.
- Existing credentials may be deleted by the migration; old-version data compatibility is explicitly out of scope.
- Agents never receive `review:decide` or member-management permission.
- Do not push, publish npm, or deploy production without separate explicit user authorization.

## File Structure

- `apps/server/prisma/schema.prisma` and a new migration: remove duplicate permission columns and bind Credential to Grant.
- `apps/server/src/core/auth/auth.service.ts`: authenticate from the bound Grant and derive role/scopes.
- `apps/server/src/core/authorization/authorization.service.ts`: authorize only the Credential-bound Grant.
- `apps/server/src/core/agent/agent.service.ts`: Grant-first connection exchange and derived Credential diagnostics.
- `apps/server/src/review/review.service.ts`: auto-publish revalidation from the bound Grant only.
- `apps/server/src/knowledge-pipeline/source.service.ts`: worker revalidation from the bound Grant only.
- `packages/local-sync/src/*`: verify derived authorization rather than Credential-owned scopes.
- Focused specs beside each implementation file provide the RED/GREEN evidence.

---

### Task 1: Persist One Authorization Fact

**Files:**
- Modify: `agentwiki/apps/server/prisma/schema.prisma`
- Create: `agentwiki/apps/server/prisma/migrations/20260823090000_bind_agent_credentials_to_grants/migration.sql`
- Modify: `agentwiki/scripts/migration-contract.test.mjs` or the closest active migration contract test

**Interfaces:**
- Produces: `AgentCredential.authorizationId`, `AgentCredential.authorization`, and `AgentGrant.credentials`.
- Removes: `AgentCredential.role`, `AgentCredential.scopes`, and `AgentGrant.scopes`.

- [x] **Step 1: Write a failing migration/schema contract test**

Assert that the Prisma schema contains the composite Grant relation and that the new SQL migration deletes legacy Credentials, drops all three duplicate permission columns, creates a unique `(id, agentId)` Grant key, and adds the composite foreign key.

- [x] **Step 2: Run the contract test and verify RED**

Run: `node --test scripts/*migration*.test.mjs`

Expected: FAIL because Credential still persists role/scopes and has no authorization relation.

- [x] **Step 3: Implement the schema and migration**

Use this relation shape:

```prisma
model AgentCredential {
  authorization   AgentGrant @relation(fields: [authorizationId, agentId], references: [id, agentId], onDelete: Cascade)
  authorizationId String
  agent            Agent      @relation(fields: [agentId], references: [id], onDelete: Cascade)
  agentId          String
}

model AgentGrant {
  credentials AgentCredential[]
  @@unique([id, agentId])
}
```

The migration intentionally starts with `DELETE FROM "AgentCredential";` because compatibility with existing credentials is out of scope.

- [x] **Step 4: Verify GREEN and validate Prisma**

Run: `pnpm test:runtime` and `DATABASE_URL=postgresql://agentwiki:placeholder@127.0.0.1:5432/agentwiki pnpm --filter @agentwiki/server exec prisma validate`

Expected: migration contract PASS and Prisma schema valid.

### Task 2: Authenticate and Authorize the Bound Grant

**Files:**
- Modify: `agentwiki/apps/server/src/core/auth/auth.service.spec.ts`
- Modify: `agentwiki/apps/server/src/core/auth/auth.service.ts`
- Modify: `agentwiki/apps/server/src/core/authorization/authorization.service.spec.ts`
- Modify: `agentwiki/apps/server/src/core/authorization/authorization.http.integration.spec.ts`
- Modify: `agentwiki/apps/server/src/core/authorization/authorization.service.ts`

**Interfaces:**
- Produces Principal fields `authorizationId` and `authorizationSpaceId`.
- `agentRole` and `scopes` remain response metadata derived from `AgentGrant.role`, never Credential fields.

- [x] **Step 1: Write failing authentication tests**

Assert that an Agent Credential query loads `authorization.role/spaceId`, returns `authorizationId`, and derives Editor scopes even though the Credential row has no role/scopes.

- [x] **Step 2: Write failing authorization tests**

Assert that an Editor bound Grant permits `pages:write`, a Reader bound Grant denies it, and a Credential bound to Space A is denied in Space B even when the same Agent owns a Publisher Grant there.

- [x] **Step 3: Run the focused specs and verify RED**

Run: `pnpm --filter @agentwiki/server test -- --runInBand src/core/auth/auth.service.spec.ts src/core/authorization/authorization.service.spec.ts`

Expected: FAIL because authorization still requires Credential-owned role/scopes and does not bind the requested Grant.

- [x] **Step 4: Implement derived authentication and Grant-only authorization**

`validateApiKey` must derive `agentRole` and `scopes` from `agentCredential.authorization.role`. Agent authorization must require `grant.id === principal.authorizationId`, derive scopes from `grant.role`, and never intersect Credential fields.

- [x] **Step 5: Run focused specs and verify GREEN**

Run the command from Step 3; expect all focused tests to pass.

### Task 3: Make Connection Exchange Grant-First

**Files:**
- Modify: `agentwiki/apps/server/src/core/agent/agent.service.spec.ts`
- Modify: `agentwiki/apps/server/src/core/agent/agent.service.ts`
- Modify: `agentwiki/apps/server/src/core/agent/local-sync-installation.service.spec.ts`
- Modify: `agentwiki/apps/server/src/core/agent/local-sync-installation.service.ts`

**Interfaces:**
- `exchangeConnectionIntent` returns the role/scopes derived from the persisted Grant.
- `assertConnectionReceipt` verifies `credential.authorizationId === grant.id` and the current Grant role.

- [x] **Step 1: Write failing exchange tests**

Assert that exchange upserts the Grant first, creates a Credential with `authorizationId` and no permission fields, and reports scopes derived from the Grant. Assert that replay fails when Credential and Grant identities do not match.

- [x] **Step 2: Run focused specs and verify RED**

Run: `pnpm --filter @agentwiki/server test -- --runInBand src/core/agent/agent.service.spec.ts src/core/agent/local-sync-installation.service.spec.ts`

Expected: FAIL because exchange currently writes role/scopes to both rows.

- [x] **Step 3: Implement Grant-first exchange and derived diagnostics**

Upsert `AgentGrant { role }`, then upsert `AgentCredential { authorizationId: grant.id }`. Map Agent detail and integration Credential responses to `{ role, scopes, space }` from the authorization relation so clients retain useful read-only diagnostics.

- [x] **Step 4: Run focused specs and verify GREEN**

Run the command from Step 2; expect all focused tests to pass.

### Task 4: Remove Credential Permission Checks from Long-Running Writes

**Files:**
- Modify: `agentwiki/apps/server/src/review/review.service.spec.ts`
- Modify: `agentwiki/apps/server/src/review/review.service.ts`
- Modify: `agentwiki/apps/server/src/knowledge-pipeline/source.service.spec.ts`
- Modify: `agentwiki/apps/server/src/knowledge-pipeline/source.service.ts`
- Modify: `agentwiki/apps/server/src/mcp/agent-access-roles.spec.ts`

**Interfaces:**
- Auto-publish and worker revalidation consume Credential lifecycle plus `authorizationId`, and role capability solely from the matching live Grant.

- [x] **Step 1: Write failing race and write-boundary tests**

Cover Credential revocation/expiry, Grant role downgrade, Grant removal/replacement, and a Credential bound to another Grant. Prove an Editor Grant can submit `pages:write` without Credential permission columns.

- [x] **Step 2: Run focused specs and verify RED**

Run: `pnpm --filter @agentwiki/server test -- --runInBand src/review/review.service.spec.ts src/knowledge-pipeline/source.service.spec.ts src/mcp/agent-access-roles.spec.ts`

Expected: FAIL at the old Credential role/scope intersections.

- [x] **Step 3: Implement live Grant-only revalidation**

Credential checks are limited to identity, bound authorization, revocation, and expiry. Every scope decision uses the live matching Grant role and `scopesForAgentAccessRole`.

- [x] **Step 4: Run focused specs and verify GREEN**

Run the command from Step 2; expect all focused tests to pass.

### Task 5: Update Local Sync Contracts, UI Diagnostics, and Documentation

**Files:**
- Modify: `agentwiki/packages/local-sync/src/agentwiki-client.ts`
- Modify: `agentwiki/packages/local-sync/src/onboarding/install.ts`
- Modify: `agentwiki/packages/local-sync/src/cli.ts`
- Modify: adjacent Local Sync specs
- Modify: `agentwiki/apps/client/src/features/agent/AgentDetail.tsx`
- Modify: `agentwiki/apps/client/src/features/docs/DocsSecurity.tsx`
- Modify: `agentwiki/README.md`
- Modify: `agentwiki/docs/TESTING_GUIDE.md`

**Interfaces:**
- Credential diagnostics expose a derived `authorization` with Space and role.
- Doctor reports `connection-authorization`, not Credential-owned scopes.

- [x] **Step 1: Write failing client/doctor tests**

Assert onboarding verifies Credential active plus its bound Space authorization, while never requiring Credential role/scopes fields.

- [x] **Step 2: Run focused tests and verify RED**

Run the affected client and Local Sync specs; expect failures on the old response shape.

- [x] **Step 3: Update client contracts and product copy**

Keep the single editable `Space + role` UI. Describe Credential as a revocable identity bound to the Space authorization, not a second permission ceiling.

- [x] **Step 4: Run focused tests and verify GREEN**

Run all affected client and Local Sync specs; expect PASS.

### Task 6: Real Editor Acceptance and Convergence

**Files:**
- Modify: `agentwiki/scripts/smoke-test.mjs`
- Modify: `agentwiki/scripts/e2e-safety.test.mjs`
- Modify: `agentwiki/docs/verification/unified-agent-access-roles-0.5.0.md`
- Modify: project `.codex-memory` current/task files

**Interfaces:**
- Produces end-to-end evidence that one Editor authorization yields an authenticated Credential that can submit a page change into `pending_review`.

- [x] **Step 1: Add the failing smoke assertion**

After connection exchange, use the returned Agent key to create/update a page proposal and assert `pending_review`; assert the Agent cannot approve it.

- [x] **Step 2: Run against an isolated migrated PostgreSQL database**

Expected before the fix: authorization fails when Credential permission state and Grant state diverge. Expected after the fix: Editor proposal succeeds and approval is denied.

- [x] **Step 3: Run repeated review and full gates**

Run `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`, Prisma validation, `git diff --check`, and the clean-install package gate. Re-scan production code for persisted Credential `role/scopes` and Grant `scopes`; active-path matches must be zero.

- [x] **Step 4: Update evidence and commit only task files**

Record exact counts, real DB/MCP results, temporary-data cleanup, and local/origin/production alignment. Do not stage unrelated submodule or `.codebase-memory` changes.
