# Agent Unified Access Roles Implementation Plan

> **2026-08-23 correction:** This historical plan is superseded by `2026-08-23-agent-authorization-single-source-plan.md`. Any step involving Credential role/scopes, Grant scopes, or their permission intersection is not a current implementation instruction. A Credential is identity-only and binds one AgentGrant; `AgentGrant.role` is the sole persisted permission fact.

> **Status:** Superseded historical record. Do not execute the tasks below; use `2026-08-23-agent-authorization-single-source-plan.md`.

**Goal:** Replace split Agent Grant, connection-code, and Credential permissions with one `reader | editor | publisher` role selected once per connection, while retaining least-privilege intersections and human-only review decisions.

**Corrected architecture:** `@neomei/agentwiki-sync-protocol` owns the only role-to-scope policy. PostgreSQL stores the role only on `AgentGrant`; `AgentCredential` stores identity/lifecycle and a database-enforced binding to that Grant. A short-lived connection intent stores `agentId + spaceId + role`, and exchange atomically upserts the Grant before creating its bound Credential.

**Tech Stack:** TypeScript, pnpm 11.9.0, Node 24 or 26, NestJS 10, Prisma 5/PostgreSQL, Redis, React 18/Vite, Jest, Vitest, MCP SDK.

## Global Constraints

- The only Agent roles are exactly `reader`, `editor`, and `publisher`.
- `reader` scopes are `spaces:read`, `pages:read`, `graph:read`, `sources:read`, `runs:read`, and `review:read`.
- `editor` adds `pages:write`, `graph:write`, `sources:write`, and `runs:write`.
- `publisher` adds `memory:read`, `memory:write`, and `review:auto-publish`.
- No Agent role contains `review:decide`; Agents cannot approve changes or manage members.
- Effective access comes from the Credential's exact current Grant role, Agent/Credential lifecycle, Space policy, and domain authorization; Credential and Grant scope arrays are not persisted.
- Publisher never modifies an existing Space policy; auto-publish still requires `scoped-auto-publish` at every existing gate.
- New product APIs accept a role, never arbitrary scopes.
- Do not support legacy `viewer`, `full`, `permissionPreset`, `approvalMode`, or custom-scope clients. The breaking schema migration deletes existing Agent Credentials; compatibility is intentionally out of scope.
- The breaking local-sync/onboarding protocol version is `0.5.0`; the server accepts only `0.5.0` for this flow.
- Do not push, publish npm, or deploy production without separate explicit user authorization.

## File Structure

- `packages/sync-protocol/src/agent-access-role.ts`: canonical role names, exact scopes, capability ordering, Zod schema, and human-Space capability mapping.
- `apps/server/prisma/schema.prisma` and migration: persisted role enum only on Grant plus the composite Credential-to-Grant binding.
- `apps/server/src/core/authorization/authorization.service.ts`: exact bound-Grant authorization with scopes derived at request time.
- `apps/server/src/core/agent/agent.service.ts`: role-derived Space grants and atomic connection exchange; no manual Credential-creation API.
- `apps/server/src/core/agent/local-sync-installation.service.ts`: short-lived `spaceId + role` intent and replay-safe exchange orchestration.
- `apps/server/src/onboard/*`: 0.5.0 full onboarding expressed in the same role protocol.
- `packages/local-sync/src/onboarding/*`: role-only client input, hashing, session validation, and bootstrap types.
- `apps/client/src/features/agent/AgentDetail.tsx` and `LocalSyncInstallCard.tsx`: unified role-based controls.
- `apps/server/src/mcp/agent-access-roles.spec.ts`: role-level MCP acceptance boundary.

---

### Task 1: Canonical Agent Role Contract

**Files:**
- Create: `agentwiki/packages/sync-protocol/src/agent-access-role.ts`
- Create: `agentwiki/packages/sync-protocol/src/agent-access-role.spec.ts`
- Modify: `agentwiki/packages/sync-protocol/src/index.ts`
- Modify: `agentwiki/packages/local-sync/package.json`
- Modify: `agentwiki/apps/client/package.json`
- Modify: `agentwiki/pnpm-lock.yaml`

**Interfaces:**
- Produces: `AgentAccessRole`, `AgentAccessRoleSchema`, `AGENT_ACCESS_ROLES`, `AGENT_ACCESS_ROLE_SCOPES`, `scopesForAgentAccessRole(role)`, `agentRoleAllowsScope(role, scope)`, and `agentRoleSpaceCapability(role)`.
- Consumers: all later server, client, and local-sync tasks.

- [ ] **Step 1: Write the failing canonical policy tests**

```ts
// packages/sync-protocol/src/agent-access-role.spec.ts
import { describe, expect, it } from "vitest";
import {
  AGENT_ACCESS_ROLES,
  agentRoleAllowsScope,
  agentRoleSpaceCapability,
  scopesForAgentAccessRole,
} from "./agent-access-role.js";

describe("Agent access roles", () => {
  it("expands the three exact role scope sets", () => {
    expect(AGENT_ACCESS_ROLES).toEqual(["reader", "editor", "publisher"]);
    expect(scopesForAgentAccessRole("reader")).toEqual([
      "graph:read", "pages:read", "review:read", "runs:read", "sources:read", "spaces:read",
    ]);
    expect(scopesForAgentAccessRole("editor")).toEqual([
      "graph:read", "graph:write", "pages:read", "pages:write", "review:read",
      "runs:read", "runs:write", "sources:read", "sources:write", "spaces:read",
    ]);
    expect(scopesForAgentAccessRole("publisher")).toEqual([
      "graph:read", "graph:write", "memory:read", "memory:write", "pages:read",
      "pages:write", "review:auto-publish", "review:read", "runs:read", "runs:write",
      "sources:read", "sources:write", "spaces:read",
    ]);
  });

  it("never grants a human review decision", () => {
    for (const role of AGENT_ACCESS_ROLES) {
      expect(agentRoleAllowsScope(role, "review:decide")).toBe(false);
    }
  });

  it("maps reader to viewer capability and writers to editor capability", () => {
    expect(agentRoleSpaceCapability("reader")).toBe("viewer");
    expect(agentRoleSpaceCapability("editor")).toBe("editor");
    expect(agentRoleSpaceCapability("publisher")).toBe("editor");
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `cd agentwiki && pnpm --filter @neomei/agentwiki-sync-protocol exec vitest run src/agent-access-role.spec.ts`

Expected: FAIL because `src/agent-access-role.ts` does not exist.

- [ ] **Step 3: Implement the canonical policy and export it**

```ts
// packages/sync-protocol/src/agent-access-role.ts
import { z } from "zod";

export const AGENT_ACCESS_ROLES = ["reader", "editor", "publisher"] as const;
export const AgentAccessRoleSchema = z.enum(AGENT_ACCESS_ROLES);
export type AgentAccessRole = z.infer<typeof AgentAccessRoleSchema>;

const READER_SCOPES = [
  "graph:read", "pages:read", "review:read", "runs:read", "sources:read", "spaces:read",
] as const;
const EDITOR_SCOPES = [
  ...READER_SCOPES, "graph:write", "pages:write", "runs:write", "sources:write",
].sort();
const PUBLISHER_SCOPES = [
  ...EDITOR_SCOPES, "memory:read", "memory:write", "review:auto-publish",
].sort();

export const AGENT_ACCESS_ROLE_SCOPES: Readonly<Record<AgentAccessRole, readonly string[]>> = {
  reader: [...READER_SCOPES].sort(),
  editor: EDITOR_SCOPES,
  publisher: PUBLISHER_SCOPES,
};

export function scopesForAgentAccessRole(role: AgentAccessRole): string[] {
  return [...AGENT_ACCESS_ROLE_SCOPES[role]];
}

export function agentRoleAllowsScope(role: AgentAccessRole, scope: string): boolean {
  return AGENT_ACCESS_ROLE_SCOPES[role].includes(scope);
}

export function agentRoleSpaceCapability(role: AgentAccessRole): "viewer" | "editor" {
  return role === "reader" ? "viewer" : "editor";
}
```

Add `export * from "./agent-access-role.js";` to `packages/sync-protocol/src/index.ts`. Add `"@neomei/agentwiki-sync-protocol": "workspace:*"` to both client and local-sync dependencies, then run `pnpm install --lockfile-only` to update the lockfile mechanically.

- [ ] **Step 4: Run GREEN and package gates**

Run:

```bash
cd agentwiki
pnpm --filter @neomei/agentwiki-sync-protocol exec vitest run src/agent-access-role.spec.ts
pnpm --filter @neomei/agentwiki-sync-protocol typecheck
pnpm --filter @neomei/agentwiki-sync-protocol build
```

Expected: all commands exit 0; the role test reports 3 passing tests.

- [ ] **Step 5: Commit the shared contract**

```bash
git add agentwiki/packages/sync-protocol agentwiki/packages/local-sync/package.json agentwiki/apps/client/package.json agentwiki/pnpm-lock.yaml
git commit -m "feat(auth): define canonical agent access roles"
```

---

### Task 2: Persist Roles and Enforce Them in Authorization

**Files:**
- Modify: `agentwiki/apps/server/prisma/schema.prisma`
- Create: `agentwiki/apps/server/prisma/migrations/20260822120000_unify_agent_access_roles/migration.sql`
- Modify: `agentwiki/apps/server/src/core/auth/auth.service.ts`
- Modify: `agentwiki/apps/server/src/core/authorization/authorization.service.ts`
- Modify: `agentwiki/apps/server/src/core/authorization/authorization.service.spec.ts`
- Modify: `agentwiki/apps/server/src/knowledge-pipeline/source.service.ts`
- Modify: `agentwiki/apps/server/src/knowledge-pipeline/source.service.spec.ts`

**Interfaces:**
- Consumes: canonical role functions from Task 1.
- Produces: Prisma `AgentAccessRole`, principal field `agentRole?: AgentAccessRole`, and role-aware authorization for HTTP, MCP, and background runs.

- [ ] **Step 1: Add failing authorization tests for all three roles**

Add cases to `authorization.service.spec.ts` using grants whose `role` is `reader`, `editor`, and `publisher`:

```ts
it.each([
  ["reader", ["owner", "editor"], false],
  ["editor", ["owner", "editor"], true],
  ["publisher", ["owner", "editor"], true],
] as const)("maps %s to the expected write capability", async (role, allowedRoles, allowed) => {
  prisma.space.findUnique.mockResolvedValue({ id: "space-1", deletedAt: null });
  prisma.agentGrant.findUnique.mockResolvedValue({
    role,
    scopes: scopesForAgentAccessRole(role),
    agent: { status: "active", revokedAt: null },
    space: { deletedAt: null },
  });
  const call = service.assertSpaceAccess({
    userId: "owner-1", agentId: "agent-1", agentRole: role,
    scopes: scopesForAgentAccessRole(role),
  }, "space-1", [...allowedRoles], "pages:write");
  if (allowed) await expect(call).resolves.toBeDefined();
  else await expect(call).rejects.toMatchObject({ businessCode: "SPACE_ACCESS_DENIED" });
});

it("rejects a stored write scope when the credential role is reader", async () => {
  prisma.space.findUnique.mockResolvedValue({ id: "space-1", deletedAt: null });
  prisma.agentGrant.findUnique.mockResolvedValue({
    role: "publisher", scopes: scopesForAgentAccessRole("publisher"),
    agent: { status: "active", revokedAt: null }, space: { deletedAt: null },
  });
  await expect(service.assertSpaceAccess({
    userId: "owner-1", agentId: "agent-1", agentRole: "reader",
    scopes: ["spaces:read", "pages:read", "pages:write"],
  }, "space-1", ["owner", "editor"], "pages:write"))
    .rejects.toMatchObject({ businessCode: "AUTH_SCOPE_REQUIRED" });
});
```

- [ ] **Step 2: Run the authorization test and verify RED**

Run: `cd agentwiki && pnpm --filter @agentwiki/server exec jest --runInBand src/core/authorization/authorization.service.spec.ts`

Expected: FAIL because Agent roles are still compared directly to human Space roles and `Principal` has no `agentRole`.

- [ ] **Step 3: Add the Prisma enum and conservative migration**

```prisma
enum AgentAccessRole {
  reader
  editor
  publisher
}

model AgentCredential {
  // existing fields
  role AgentAccessRole @default(reader)
}

model AgentGrant {
  id     String          @id @default(cuid())
  role   AgentAccessRole @default(reader)
  scopes String[]        @default([])
  // existing relations and indexes
}
```

```sql
-- prisma/migrations/20260822120000_unify_agent_access_roles/migration.sql
CREATE TYPE "AgentAccessRole" AS ENUM ('reader', 'editor', 'publisher');

ALTER TABLE "AgentCredential"
  ADD COLUMN "role" "AgentAccessRole" NOT NULL DEFAULT 'reader';

ALTER TABLE "AgentGrant" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "AgentGrant"
  ALTER COLUMN "role" TYPE "AgentAccessRole"
  USING ('reader'::"AgentAccessRole");
ALTER TABLE "AgentGrant" ALTER COLUMN "role" SET DEFAULT 'reader';
```

This intentionally does not infer new roles from legacy scopes. Existing connections become reader-limited until reconnected.

- [ ] **Step 4: Implement role-aware principals and authorization**

In `auth.service.ts`, select Credential `role` and return it as `agentRole`. In `authorization.service.ts`, extend `Principal` and replace the direct Grant-role comparison:

```ts
import {
  agentRoleAllowsScope,
  agentRoleSpaceCapability,
  type AgentAccessRole,
} from "@neomei/agentwiki-sync-protocol";

export interface Principal {
  userId: string;
  agentId?: string;
  agentRole?: AgentAccessRole;
  scopes?: string[];
  credentialId?: string;
  platformRole?: "user" | "super_admin";
}

const capability = agentRoleSpaceCapability(grant.role);
if (!allowedRoles.includes(capability)) {
  throw new BusinessException("SPACE_ACCESS_DENIED", "Agent does not have permission to access this space");
}

private assertScope(principal: Principal, requiredScope?: string, grantScopes: string[] = []) {
  if (!requiredScope) return;
  if (!principal.agentRole || !agentRoleAllowsScope(principal.agentRole, requiredScope)
    || !principal.scopes?.includes(requiredScope)) {
    throw new BusinessException("AUTH_SCOPE_REQUIRED", `Agent credential requires scope: ${requiredScope}`);
  }
  if (grantScopes.length > 0 && !grantScopes.includes(requiredScope)) {
    throw new BusinessException("SPACE_ACCESS_DENIED", `Agent is not granted scope ${requiredScope} in this space`);
  }
}
```

Return the Agent role from `listAccessibleSpaces`; keep human member roles unchanged. In `source.service.ts::assertRequesterStillAuthorized`, select Credential `role`, require `agentRoleAllowsScope(credential.role, "runs:write")`, and accept Grant roles `editor` or `publisher` via `agentRoleSpaceCapability(grant.role) === "editor"`.

- [ ] **Step 5: Generate Prisma, validate schema, and run GREEN**

Run:

```bash
cd agentwiki
pnpm --filter @agentwiki/server exec prisma generate
pnpm --filter @agentwiki/server exec prisma validate
pnpm --filter @agentwiki/server exec jest --runInBand src/core/authorization/authorization.service.spec.ts src/knowledge-pipeline/source.service.spec.ts
pnpm --filter @agentwiki/server typecheck
```

Expected: schema validation and typecheck exit 0; both Jest suites pass.

- [ ] **Step 6: Commit persistence and authorization**

```bash
git add agentwiki/apps/server/prisma agentwiki/apps/server/src/core/auth/auth.service.ts agentwiki/apps/server/src/core/authorization agentwiki/apps/server/src/knowledge-pipeline/source.service.ts agentwiki/apps/server/src/knowledge-pipeline/source.service.spec.ts
git commit -m "feat(auth): persist and enforce agent access roles"
```

---

### Task 3: Make Manual Credential and Grant APIs Role-Only

**Files:**
- Modify: `agentwiki/apps/server/src/core/dto/agent.dto.ts`
- Modify: `agentwiki/apps/server/src/core/agent/agent.service.ts`
- Modify: `agentwiki/apps/server/src/core/agent/agent.service.spec.ts`
- Modify: `agentwiki/apps/server/src/core/agent/agent.controller.ts`
- Modify: `agentwiki/apps/server/src/core/agent/agent.controller.spec.ts`

**Interfaces:**
- Consumes: `AgentAccessRole` and `scopesForAgentAccessRole`.
- Produces: `POST /agents/:id/credentials { name, role, expiresAt? }` and `PUT /agents/:id/grants/:spaceId { role }`.

- [ ] **Step 1: Replace scope-based tests with failing role-derived tests**

```ts
it("derives ordinary credential scopes from its role", async () => {
  prisma.agent.findUnique.mockResolvedValue({
    id: "agent-1", ownerId: "owner-1", status: "active", revokedAt: null,
  });
  prisma.agentCredential.create.mockResolvedValue({ id: "credential-1", role: "editor" });
  prisma.agentAuditEvent.create.mockResolvedValue({});

  await service.createCredential("owner-1", "agent-1", {
    name: "OpenCode", role: "editor",
  });

  expect(prisma.agentCredential.create).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({
      role: "editor",
      scopes: scopesForAgentAccessRole("editor"),
    }),
  }));
});

it("derives a grant ceiling from its role", async () => {
  prisma.agent.findUnique.mockResolvedValue({
    id: "agent-1", ownerId: "owner-1", status: "active", revokedAt: null,
  });
  prisma.agentGrant.findUnique.mockResolvedValue(null);
  prisma.agentGrant.upsert.mockResolvedValue({ id: "grant-1", role: "publisher" });
  prisma.agentAuditEvent.create.mockResolvedValue({});

  await service.upsertGrantForSpace("owner-1", "agent-1", "space-1", "publisher");

  expect(prisma.agentGrant.upsert).toHaveBeenCalledWith(expect.objectContaining({
    create: expect.objectContaining({
      role: "publisher",
      scopes: scopesForAgentAccessRole("publisher"),
    }),
    update: { role: "publisher", scopes: scopesForAgentAccessRole("publisher") },
  }));
});

it("enables publisher switches without letting lower roles turn them off", async () => {
  prisma.agent.findUnique.mockResolvedValue({
    id: "agent-1", ownerId: "owner-1", status: "active", revokedAt: null,
  });
  prisma.agentCredential.create.mockResolvedValue({ id: "credential-1", role: "publisher" });
  prisma.agent.update.mockResolvedValue({});
  prisma.agentAuditEvent.create.mockResolvedValue({});

  await service.createCredential("owner-1", "agent-1", {
    name: "Publisher API", role: "publisher",
  });
  expect(prisma.agent.update).toHaveBeenCalledWith({
    where: { id: "agent-1" },
    data: { memoryEnabled: true, approvalMode: "scoped-auto-publish" },
  });

  prisma.agent.update.mockClear();
  await service.createCredential("owner-1", "agent-1", {
    name: "Reader API", role: "reader",
  });
  expect(prisma.agent.update).not.toHaveBeenCalled();
});

it("does not let a Space admin change another owners Agent role", async () => {
  prisma.agent.findUnique.mockResolvedValue({
    id: "agent-1", ownerId: "owner-2", status: "active", revokedAt: null,
  });
  await expect(service.upsertGrantForSpace(
    "admin-1", "agent-1", "space-1", "publisher",
  )).rejects.toThrow("You do not own this agent");
  expect(prisma.agentGrant.upsert).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the service suite and verify RED**

Run: `cd agentwiki && pnpm --filter @agentwiki/server exec jest --runInBand src/core/agent/agent.service.spec.ts`

Expected: FAIL because DTOs and services still require arbitrary scopes and viewer/editor Grant roles.

- [ ] **Step 3: Implement role-only DTOs and service signatures**

```ts
export class CreateAgentCredentialDto {
  @IsString() @MinLength(1) @MaxLength(100) name: string;
  @IsIn(AGENT_ACCESS_ROLES) role: AgentAccessRole;
  @IsOptional() @IsDateString() expiresAt?: string;
}

export class UpsertAgentGrantDto {
  @IsIn(AGENT_ACCESS_ROLES) role: AgentAccessRole;
}
```

In `AgentService`, remove public wildcard/custom scope normalization paths. Derive scopes exactly once:

```ts
const scopes = scopesForAgentAccessRole(dto.role);
// AgentCredential create data
{ agentId, name: dto.name, role: dto.role, prefix, keyHash, scopes, expiresAt }

const scopes = scopesForAgentAccessRole(role);
// AgentGrant upsert data
create: { agentId, spaceId, role, scopes },
update: { role, scopes },
```

Include `role` in every Credential select and integration response. Audit Grant changes with `{ oldRole, newRole: role, spaceId }`; never log the API key. Update controller calls to pass only `dto.role`.

Both manual APIs must call `getOwned`, so only the Agent owner can change its Credential or Grant role; the controller still independently requires owner/admin authority in the target Space. When either API assigns `publisher`, update the Agent to `{ memoryEnabled: true, approvalMode: "scoped-auto-publish" }`. Assigning `reader` or `editor` never turns those global switches off because another Space may still have a Publisher connection.

- [ ] **Step 4: Run GREEN and DTO/controller regression**

Run:

```bash
cd agentwiki
pnpm --filter @agentwiki/server exec jest --runInBand src/core/agent/agent.service.spec.ts src/core/agent/agent.controller.spec.ts
pnpm --filter @agentwiki/server typecheck
```

Expected: both Jest suites and typecheck pass; no test submits `scopes` to these two product APIs.

- [ ] **Step 5: Commit role-only APIs**

```bash
git add agentwiki/apps/server/src/core/dto/agent.dto.ts agentwiki/apps/server/src/core/agent
git commit -m "feat(auth): make agent credentials and grants role based"
```

---

### Task 4: Make Connection Intent Exchange Atomic

**Files:**
- Modify: `agentwiki/apps/server/src/core/dto/local-sync.dto.ts`
- Modify: `agentwiki/apps/server/src/core/agent/local-sync-installation.controller.ts`
- Modify: `agentwiki/apps/server/src/core/agent/local-sync-installation.controller.spec.ts`
- Modify: `agentwiki/apps/server/src/core/agent/local-sync-installation.service.ts`
- Modify: `agentwiki/apps/server/src/core/agent/local-sync-installation.service.spec.ts`
- Modify: `agentwiki/apps/server/src/core/agent/agent.service.ts`
- Modify: `agentwiki/apps/server/src/core/agent/agent.service.spec.ts`

**Interfaces:**
- Produces: `CreateLocalSyncInstallationDto { spaceId, role, pluginVersion }` and `AgentService.exchangeConnectionIntent(input)`.
- Guarantees: one transaction revalidates authority, creates/reuses Credential, upserts Grant, enables publisher Agent switches, and writes Agent audit.

- [ ] **Step 1: Write failing connection-intent and atomicity tests**

Update service fixtures so the stored payload is:

```ts
const payload = {
  installationId: "installation-1",
  ownerId: "owner-1",
  agentId: "agent-1",
  spaceId: "space-1",
  role: "editor" as const,
  pluginVersion: "0.5.0",
  serverUrl: "https://wiki.test/api",
  expiresAt: "2030-01-01T00:10:00.000Z",
};
```

Add an AgentService test whose mocked `$transaction` invokes the callback with a transaction mock:

```ts
it("atomically creates the credential and matching Space grant", async () => {
  prisma.$transaction.mockImplementation(async (operation: any) => operation(prisma));
  prisma.agent.findFirst.mockResolvedValue({ id: "agent-1", status: "active" });
  prisma.space.findFirst.mockResolvedValue({ id: "space-1" });
  prisma.agentCredential.upsert.mockResolvedValue({
    id: "credential-1", agentId: "agent-1", role: "editor",
    keyHash: deterministicHash, scopes: scopesForAgentAccessRole("editor"), revokedAt: null,
  });
  prisma.agentGrant.findUnique.mockResolvedValue({ role: "reader" });
  prisma.agentGrant.upsert.mockResolvedValue({ id: "grant-1", role: "editor" });
  prisma.agentAuditEvent.create.mockResolvedValue({});

  await service.exchangeConnectionIntent({
    ownerId: "owner-1", agentId: "agent-1", spaceId: "space-1",
    role: "editor", installationId: "installation-1", rawKey: "agk_deterministic",
  });

  expect(prisma.agentCredential.upsert).toHaveBeenCalledWith(expect.objectContaining({
    create: expect.objectContaining({ role: "editor", scopes: scopesForAgentAccessRole("editor") }),
  }));
  expect(prisma.agentGrant.upsert).toHaveBeenCalledWith(expect.objectContaining({
    create: expect.objectContaining({ role: "editor", scopes: scopesForAgentAccessRole("editor") }),
    update: { role: "editor", scopes: scopesForAgentAccessRole("editor") },
  }));
  expect(prisma.agentAuditEvent.create).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ action: "connection.authorize" }),
  }));
});
```

Also test: missing owner/admin Space membership rolls back; publisher updates only Agent `memoryEnabled` and `approvalMode`; reader/editor never turn those switches off; repeated and concurrent exchanges return one Credential; failed transactions write no Redis success receipt.

- [ ] **Step 2: Run targeted suites and verify RED**

Run:

```bash
cd agentwiki
pnpm --filter @agentwiki/server exec jest --runInBand src/core/agent/agent.service.spec.ts src/core/agent/local-sync-installation.service.spec.ts src/core/agent/local-sync-installation.controller.spec.ts
```

Expected: FAIL because the DTO/payload still accepts scopes and Credential/Grant writes are separate.

- [ ] **Step 3: Implement the role-only intent DTO and payload**

```ts
export class CreateLocalSyncInstallationDto {
  @IsString() @MinLength(1) spaceId: string;
  @IsIn(AGENT_ACCESS_ROLES) role: AgentAccessRole;
  @IsString() @Matches(/^0\.5\.0$/) pluginVersion: "0.5.0";
}

interface InstallationPayload {
  installationId: string;
  ownerId: string;
  agentId: string;
  spaceId: string;
  role: AgentAccessRole;
  pluginVersion: string;
  serverUrl: string;
  expiresAt: string;
  issuerCredentialId?: string;
}
```

Change `create(...)` and controller calls to accept `spaceId` and `role`. Before Redis write, call this AgentService boundary and store no caller-supplied scopes:

```ts
async assertCanIssueConnection(ownerId: string, agentId: string, spaceId: string): Promise<void> {
  const agent = await this.getOwned(ownerId, agentId);
  if (agent.status !== "active") throw new BadRequestException("Agent must be active");
  const space = await this.prisma.space.findFirst({
    where: {
      id: spaceId,
      deletedAt: null,
      members: { some: { userId: ownerId, role: { in: ["owner", "admin"] } } },
    },
    select: { id: true },
  });
  if (!space) throw new ForbiddenException("You cannot authorize this Agent for the Space");
}
```

Remove the unused `POST /agents/:agentId/local-sync-installations/self` endpoint and its delegation branch. Version 0.5.0 connection roles are granted only by a human who both owns the Agent and administers the target Space; an existing Agent Credential cannot mint or raise its own role.

- [ ] **Step 4: Implement the database transaction**

Add this exact input/output boundary to `AgentService`:

```ts
async exchangeConnectionIntent(input: {
  ownerId: string;
  agentId: string;
  spaceId: string;
  role: AgentAccessRole;
  installationId: string;
  rawKey: string;
}): Promise<{ id: string; agentId: string; role: AgentAccessRole; scopes: string[]; apiKey: string }> {
  return this.prisma.$transaction(async (tx) => {
    const agent = await tx.agent.findFirst({
      where: { id: input.agentId, ownerId: input.ownerId, status: "active", revokedAt: null,
        owner: { deletedAt: null, lockedAt: null } },
      select: { id: true },
    });
    const space = await tx.space.findFirst({
      where: { id: input.spaceId, deletedAt: null,
        members: { some: { userId: input.ownerId, role: { in: ["owner", "admin"] } } } },
      select: { id: true },
    });
    if (!agent || !space) throw new ForbiddenException("Connection authorization is no longer valid");

    const scopes = scopesForAgentAccessRole(input.role);
    const keyHash = createHash("sha256").update(input.rawKey).digest("hex");
    const previousGrant = await tx.agentGrant.findUnique({
      where: { agentId_spaceId: { agentId: input.agentId, spaceId: input.spaceId } },
      select: { role: true },
    });
    const credential = await tx.agentCredential.upsert({
      where: { localSyncInstallationId: input.installationId },
      create: {
        agentId: input.agentId, name: "AgentWiki connection", role: input.role,
        prefix: input.rawKey.slice(0, 12), keyHash,
        localSyncInstallationId: input.installationId, scopes,
      },
      update: {},
      select: { id: true, agentId: true, role: true, keyHash: true, scopes: true, revokedAt: true },
    });
    if (credential.agentId !== input.agentId || credential.role !== input.role
      || credential.keyHash !== keyHash || credential.revokedAt) {
      throw new ForbiddenException("Connection credential is unavailable");
    }
    await tx.agentGrant.upsert({
      where: { agentId_spaceId: { agentId: input.agentId, spaceId: input.spaceId } },
      create: { agentId: input.agentId, spaceId: input.spaceId, role: input.role, scopes },
      update: { role: input.role, scopes },
    });
    if (input.role === "publisher") {
      await tx.agent.update({
        where: { id: input.agentId },
        data: { memoryEnabled: true, approvalMode: "scoped-auto-publish" },
      });
    }
    await tx.agentAuditEvent.create({
      data: {
        agentId: input.agentId, action: "connection.authorize", outcome: "success",
        resourceType: "Space", resourceId: input.spaceId,
        metadata: { credentialId: credential.id, oldRole: previousGrant?.role ?? null, newRole: input.role },
      },
    });
    return { ...credential, apiKey: input.rawKey };
  });
}
```

After the transaction, retain the existing secret-free Redis receipt and transport audit behavior. The receipt must add `spaceId` and `role`; replay validation must verify both and the live Credential role.

- [ ] **Step 5: Run GREEN, typecheck, and secret scans**

Run:

```bash
cd agentwiki
pnpm --filter @agentwiki/server exec jest --runInBand src/core/agent/agent.service.spec.ts src/core/agent/local-sync-installation.service.spec.ts src/core/agent/local-sync-installation.controller.spec.ts
pnpm --filter @agentwiki/server typecheck
rg -n "apiKey.*metadata|metadata.*apiKey|agk_secret" apps/server/src/core/agent
```

Expected: Jest/typecheck pass; the final `rg` finds only negative test assertions or no matches, never production logging.

- [ ] **Step 6: Commit atomic connection authorization**

```bash
git add agentwiki/apps/server/src/core/dto/local-sync.dto.ts agentwiki/apps/server/src/core/agent
git commit -m "feat(auth): atomically authorize agent connections"
```

---

### Task 5: Cut Full Onboarding and Local Sync to the 0.5.0 Role Protocol

**Files:**
- Modify: `agentwiki/apps/server/src/onboard/onboard.types.ts`
- Modify: `agentwiki/apps/server/src/onboard/onboard.dto.ts`
- Modify: `agentwiki/apps/server/src/onboard/onboard.dto.spec.ts`
- Modify: `agentwiki/apps/server/src/onboard/onboard-bootstrap.service.ts`
- Modify: `agentwiki/apps/server/src/onboard/onboard-bootstrap.service.spec.ts`
- Modify: `agentwiki/apps/server/src/onboard/onboard-device.service.spec.ts`
- Modify: `agentwiki/packages/local-sync/src/onboarding/plan-hash.ts`
- Modify: `agentwiki/packages/local-sync/src/onboarding/plan-hash.spec.ts`
- Modify: `agentwiki/packages/local-sync/src/onboarding/client.ts`
- Modify: `agentwiki/packages/local-sync/src/onboarding/coordinator.ts`
- Modify: `agentwiki/packages/local-sync/src/onboarding/session.ts`
- Modify: `agentwiki/packages/local-sync/src/onboarding/client.spec.ts`
- Modify: `agentwiki/packages/local-sync/src/onboarding/coordinator.spec.ts`
- Modify: `agentwiki/packages/local-sync/src/onboarding/install.spec.ts`
- Modify: `agentwiki/packages/local-sync/src/onboarding/local-plan-hash.spec.ts`
- Modify: `agentwiki/packages/local-sync/src/onboarding/onboarding-e2e-driver.ts`
- Modify: `agentwiki/packages/local-sync/src/onboarding/onboarding-e2e-driver.spec.ts`
- Modify: `agentwiki/packages/local-sync/src/onboarding/runtime.spec.ts`
- Modify: `agentwiki/packages/local-sync/src/onboarding/session.spec.ts`
- Modify: `agentwiki/packages/local-sync/package.json`
- Modify: `agentwiki/apps/server/package.json`
- Modify: `agentwiki/apps/client/package.json`
- Modify: `agentwiki/apps/client/src/config/localSync.ts`
- Modify: `agentwiki/pnpm-lock.yaml`

**Interfaces:**
- Produces: `ServerPlan { space, agentName, role, packageVersion: "0.5.0" }` with no permission preset or approval-mode input.
- Consumes: atomic connection intent from Task 4.

- [ ] **Step 1: Write failing server/local hash contract tests**

Use the same fixture in both server and local-sync suites:

```ts
const plan = {
  space: { mode: "existing" as const, id: "space-1" },
  agentName: "OpenCode",
  role: "editor" as const,
  packageVersion: "0.5.0" as const,
};

expect(normalizeServerPlan(plan)).toEqual({
  ...plan,
  scopes: scopesForAgentAccessRole("editor"),
});
expect(hashServerPlan(plan)).toMatch(/^[0-9a-f]{64}$/);
```

Add DTO rejection cases for `viewer`, `full`, `permissionPreset`, `approvalMode`, arbitrary scopes, and package `0.4.0`.

- [ ] **Step 2: Run server and local contract tests and verify RED**

Run:

```bash
cd agentwiki
pnpm --filter @agentwiki/server exec jest --runInBand src/onboard/onboard.dto.spec.ts src/onboard/onboard-bootstrap.service.spec.ts
pnpm --filter @neomei/agentwiki-local-sync exec vitest run src/onboarding/plan-hash.spec.ts src/onboarding/session.spec.ts src/onboarding/coordinator.spec.ts
```

Expected: FAIL because both sides still use `permissionPreset + approvalMode` and version 0.4.0.

- [ ] **Step 3: Replace the duplicated preset model with the shared role contract**

```ts
export type ServerPlan = {
  space: { mode: "create"; name: string } | { mode: "existing"; id: string };
  agentName: string;
  role: AgentAccessRole;
  packageVersion: "0.5.0";
};

export type NormalizedServerPlan = ServerPlan & { scopes: string[] };

export function normalizeServerPlan(plan: ServerPlan): NormalizedServerPlan {
  return { ...plan, scopes: scopesForAgentAccessRole(plan.role) };
}
```

Local Sync imports this role contract from sync-protocol, requests one input named `role` with choices `reader`, `editor`, `publisher`, removes `permissionPreset` and `approvalMode` from schemas/checkpoints, and hashes the new normalized plan.

- [ ] **Step 4: Align bootstrap resource creation with exchange-time Grant creation**

Change onboarding bootstrap to create only the Space and Agent before issuing the connection intent. New Spaces use `approvalPolicy: "always-review"`; existing Space policies are never changed or rejected. Create the Agent with:

```ts
data: {
  ownerId: userId,
  name: plan.agentName,
  memoryEnabled: plan.role === "publisher",
  approvalMode: plan.role === "publisher" ? "scoped-auto-publish" : "always-review",
}
```

Do not create `AgentGrant` during bootstrap. Issue the installation with `space.id` and `plan.role`; the next exchange performs the atomic Credential+Grant write from Task 4. Remove `grantId` from recovery IDs and remove `bootstrap:grant` from required capabilities. The bootstrap response may still expose the planned `{ role, scopes }`, but recovery must verify the plan hash rather than a pre-existing Grant row.

- [ ] **Step 5: Bump all local-sync protocol surfaces to 0.5.0**

Set package versions to `0.5.0`, `LOCAL_SYNC_VERSION = "0.5.0"`, `StartDeviceDto.packageVersion = "0.5.0"`, and update exact test instructions. Run `pnpm install --lockfile-only` after package edits. Do not accept 0.4.0 in onboarding DTOs.

- [ ] **Step 6: Run GREEN and the complete onboarding matrix**

Run:

```bash
cd agentwiki
pnpm --filter @agentwiki/server exec jest --runInBand src/onboard
pnpm --filter @neomei/agentwiki-local-sync exec vitest run src/onboarding
pnpm --filter @neomei/agentwiki-local-sync typecheck
pnpm --filter @agentwiki/server typecheck
```

Expected: all onboarding tests pass; repository search below returns no live protocol fields outside historical docs/designs:

```bash
rg -n "permissionPreset|approvalMode.*onboard|\['editor', 'full'\]" apps/server/src/onboard packages/local-sync/src/onboarding apps/client/src/config
```

- [ ] **Step 7: Commit the 0.5.0 protocol cutover**

```bash
git add agentwiki/apps/server/src/onboard agentwiki/packages/local-sync agentwiki/apps/server/package.json agentwiki/apps/client/package.json agentwiki/apps/client/src/config/localSync.ts agentwiki/pnpm-lock.yaml
git commit -m "feat(onboarding): cut over to role based protocol"
```

---

### Task 6: Unify the Agent Access UI

**Files:**
- Modify: `agentwiki/apps/client/src/features/agent/AgentDetail.tsx`
- Modify: `agentwiki/apps/client/src/features/agent/AgentDetail.spec.tsx`
- Modify: `agentwiki/apps/client/src/features/agent/LocalSyncInstallCard.tsx`
- Modify: `agentwiki/apps/client/src/features/agent/LocalSyncInstallCard.spec.tsx`
- Modify: `agentwiki/apps/client/src/i18n/messages.ts`

**Interfaces:**
- Consumes: `AGENT_ACCESS_ROLES` and `AgentAccessRole` from sync-protocol.
- Produces: one `Space + role` connection form, role-only Grant controls, and role-only manual Credential controls.

- [ ] **Step 1: Write failing UI behavior tests**

Replace the old auto-publish checkbox test with:

```tsx
it("generates an editor connection intent for the selected Space", async () => {
  renderCard({
    agentId: "agent-1",
    spaces: [{ id: "space-1", name: "团队知识库" }],
    grants: [{ spaceId: "space-1", role: "reader", space: { id: "space-1", name: "团队知识库" } }],
  });
  fireEvent.change(screen.getByLabelText("空间"), { target: { value: "space-1" } });
  fireEvent.change(screen.getByLabelText("Agent 角色"), { target: { value: "editor" } });
  expect(screen.getByText(/Reader.*Editor/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "生成统一网关接入指令" }));
  await waitFor(() => expect(api.post).toHaveBeenCalledWith(
    "/agents/agent-1/local-sync-installations",
    { pluginVersion: "0.5.0", spaceId: "space-1", role: "editor" },
  ));
});

it("shows the publisher governance warning", () => {
  renderCard({ agentId: "agent-1", spaces: [{ id: "space-1", name: "S" }], grants: [] });
  fireEvent.change(screen.getByLabelText("Agent 角色"), { target: { value: "publisher" } });
  expect(screen.getByText(/仍受 Space 发布策略限制/)).toBeInTheDocument();
  expect(screen.getByText(/不能执行人工审批或成员管理/)).toBeInTheDocument();
});
```

Add AgentDetail tests asserting Grant PUT body `{ role: "publisher" }`, Credential POST body `{ name, role: "reader" }`, and absence of scope checkboxes.

- [ ] **Step 2: Run UI suites and verify RED**

Run:

```bash
cd agentwiki
pnpm --filter @agentwiki/client exec vitest run src/features/agent/AgentDetail.spec.tsx src/features/agent/LocalSyncInstallCard.spec.tsx
```

Expected: FAIL because the UI still sends scopes and separates Space Grant from connection authorization.

- [ ] **Step 3: Implement the unified connection form**

Change `LocalSyncInstallCard` props and request boundary:

```ts
type SpaceOption = { id: string; name: string };
type GrantSummary = { spaceId: string; role: AgentAccessRole; space: SpaceOption };

export const LocalSyncInstallCard: React.FC<{
  agentId: string;
  spaces: SpaceOption[];
  grants: GrantSummary[];
}> = ({ agentId, spaces, grants }) => {
  const [spaceId, setSpaceId] = useState(spaces[0]?.id ?? "");
  const [role, setRole] = useState<AgentAccessRole>("reader");
  // existing expiry/copy state remains
  const generate = async () => api.post(`/agents/${agentId}/local-sync-installations`, {
    pluginVersion: LOCAL_SYNC_VERSION,
    spaceId,
    role,
  });
};
```

Render labeled Space and role selects. If `grants.find(grant => grant.spaceId === spaceId)?.role !== role`, show the exact old-to-new role warning. Remove `BASE_SCOPES` and the auto-publish checkbox.

- [ ] **Step 4: Convert Grant and manual Credential controls to roles**

In `AgentDetail`, use:

```ts
const [grant, setGrant] = useState<{ spaceId: string; role: AgentAccessRole }>({
  spaceId: "", role: "reader",
});
const [credential, setCredential] = useState<{ name: string; role: AgentAccessRole }>({
  name: "Default credential", role: "reader",
});

await api.put(`/agents/${id}/grants/${grant.spaceId}`, { role: grant.role });
await api.post(`/agents/${id}/credentials`, credential);
```

Pass `spaces` and `agent.grants` to `LocalSyncInstallCard`. Render role selectors from `AGENT_ACCESS_ROLES`; remove `SCOPES`, `toggleScope`, and all editable scope checkboxes. Credential lists may show scopes only as read-only diagnostic text.

Render each existing Credential with its role, prefix, last-used time, expiry, active state, and revoke action. Render every Space Grant with a three-role selector and remove action. Remove the independent Agent `approvalMode` selector from the Settings tab; Publisher assignment is the product path that enables scoped auto-publish, while the effective state remains visible as read-only diagnostics.

- [ ] **Step 5: Add complete Chinese and English role copy**

Add i18n keys for Reader, Editor, Publisher, their descriptions, Space/role labels, role-change warning, publisher governance warning, and role-only Credential help. Do not describe Publisher as admin, owner, or approver.

- [ ] **Step 6: Run GREEN, accessibility tests, and client build**

Run:

```bash
cd agentwiki
pnpm --filter @agentwiki/client exec vitest run src/features/agent/AgentDetail.spec.tsx src/features/agent/LocalSyncInstallCard.spec.tsx
pnpm --filter @agentwiki/client exec tsc --noEmit
pnpm --filter @agentwiki/client build
```

Expected: tests/typecheck/build pass; `rg -n "BASE_SCOPES|toggleScope|type=\"checkbox\"" apps/client/src/features/agent` returns no permission-scope controls.

- [ ] **Step 7: Commit the unified UI**

```bash
git add agentwiki/apps/client/src/features/agent agentwiki/apps/client/src/i18n/messages.ts
git commit -m "feat(ui): unify agent connection role controls"
```

---

### Task 7: Lock MCP Role Behavior and Human-Only Approval

**Files:**
- Create: `agentwiki/apps/server/src/mcp/agent-access-roles.spec.ts`
- Modify: `agentwiki/apps/server/src/mcp/mcp.service.spec.ts`
- Modify: `agentwiki/apps/server/src/review/review.service.spec.ts`
- Modify: `agentwiki/apps/server/src/review/agent-write-boundary.spec.ts`

**Interfaces:**
- Consumes: role-aware AuthorizationService and MCP tools.
- Produces: executable acceptance proof for reader/editor/publisher and `review:decide` denial.

- [ ] **Step 1: Write the MCP role matrix test and verify it fails before final wiring**

Create a real `AuthorizationService` with a small Prisma fake and feed it into `McpService`. Register `list_spaces`, `list_pages`, `propose_page`, and `approve_change_set`. The core matrix must assert:

```ts
it.each([
  ["reader", false],
  ["editor", true],
  ["publisher", true],
] as const)("enforces %s page proposal access", async (role, canPropose) => {
  const principal = {
    userId: "owner-1", agentId: "agent-1", credentialId: `credential-${role}`,
    agentRole: role, scopes: scopesForAgentAccessRole(role),
  };
  grant.role = role;
  grant.scopes = scopesForAgentAccessRole(role);
  const tools = createTools(principal);
  await expect(tools.list_spaces.handler({})).resolves.toBeDefined();
  await expect(tools.list_pages.handler({ spaceId: "space-1" })).resolves.toBeDefined();
  const proposal = tools.propose_page.handler({
    spaceId: "space-1", title: "吃饭睡觉打豆豆", content: "豆豆不能随便打",
  });
  if (canPropose) {
    await expect(proposal).resolves.toBeDefined();
    expect(review.propose).toHaveBeenCalledWith(
      principal, "space-1", "Proposed page: 吃饭睡觉打豆豆", expect.any(Object),
    );
  } else {
    await expect(proposal).rejects.toMatchObject({ businessCode: "SPACE_ACCESS_DENIED" });
  }
  await expect(tools.approve_change_set.handler({ changeSetId: "change-1" }))
    .rejects.toThrow("Agents cannot approve change sets");
});
```

Also keep ReviewService cases proving Publisher auto-publishes only when Credential scope, Grant scope, Agent approval mode, and Space policy all allow it; editor remains `pending_review`.

- [ ] **Step 2: Run the focused MCP/review suites**

Run:

```bash
cd agentwiki
pnpm --filter @agentwiki/server exec jest --runInBand src/mcp/agent-access-roles.spec.ts src/mcp/mcp.service.spec.ts src/review/agent-write-boundary.spec.ts src/review/review.service.spec.ts
```

Expected: the new matrix passes after Tasks 1–6; any missed role wiring fails with the specific reader/editor/publisher case.

- [ ] **Step 3: Run static boundary scans**

Run:

```bash
cd agentwiki
rg -n "review:decide" apps/server/src packages/sync-protocol/src packages/local-sync/src
rg -n "role: ['\"](viewer|full)['\"]|permissionPreset|scopes:" apps/client/src/features/agent apps/server/src/core/dto packages/local-sync/src/onboarding
```

Expected: `review:decide` appears only in human-only authorization/tool descriptions/tests; legacy role/preset/custom-scope product inputs have no live matches.

- [ ] **Step 4: Commit acceptance coverage**

```bash
git add agentwiki/apps/server/src/mcp agentwiki/apps/server/src/review
git commit -m "test(auth): lock agent role mcp boundaries"
```

---

### Task 8: Full Verification, Project Memory, and Release Gate

**Files:**
- Create: `agentwiki/docs/verification/unified-agent-access-roles-0.5.0.md`
- Modify: `.codex-memory/current.md`
- Modify: `.codex-memory/tasks/active/unified-agent-access-roles/brief.md`
- Modify: `.codex-memory/tasks/active/unified-agent-access-roles/decisions.md`
- Modify: `.codex-memory/tasks/active/unified-agent-access-roles/refs.md`

**Interfaces:**
- Produces: fresh local verification evidence and an explicit stop before push/npm/production operations.

- [ ] **Step 1: Run the complete local verification matrix**

Run from `agentwiki/`:

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm --filter @agentwiki/server exec prisma validate
pnpm --filter @neomei/agentwiki-local-sync pack --pack-destination /tmp/agentwiki-role-pack
git diff --check
```

Expected: every command exits 0, no unexpected skips beyond documented database-environment skips, and the packed tarball contains 0.5.0 role-only onboarding code.

- [ ] **Step 2: Run the local three-client onboarding harness**

Run:

```bash
pnpm test:e2e:onboarding
pnpm --filter @neomei/agentwiki-local-sync exec vitest run src/onboarding/onboarding-e2e-driver.spec.ts
```

Expected: Codex, Claude Code, and OpenCode all confirm a `reader | editor | publisher` plan and no fixture sends `permissionPreset`, `approvalMode`, or custom scopes.

- [ ] **Step 3: Record exact evidence and update project memory**

Write `docs/verification/unified-agent-access-roles-0.5.0.md` with the exact command, date, pass/fail counts, skipped-test reasons, Node/pnpm versions, migration validation, package contents, and current commit. Update active task records and `current.md` with only current facts; do not claim production or GitHub alignment.

- [ ] **Step 4: Commit verification evidence**

```bash
git add agentwiki/docs/verification/unified-agent-access-roles-0.5.0.md .codex-memory/current.md .codex-memory/tasks/active/unified-agent-access-roles
git commit -m "docs: verify unified agent access roles"
```

- [ ] **Step 5: Stop for explicit release/deployment authorization**

Report local `HEAD`, `origin/master`, npm latest, and production commit/version using read-only checks. Do not push, publish npm 0.5.0, apply the migration, restart services, or change the live OpenCode connection until the user explicitly authorizes those external actions.

- [ ] **Step 6: After authorization, perform backup-first release and real OpenCode acceptance**

Before deployment, create and verify PostgreSQL custom-format and application backups, confirm the migration plan, and fingerprint the existing production files. Then push the verified commit, publish the audited tarball, deploy only AgentWiki, apply the migration, and verify health/restart counters.

Using a newly generated `editor` connection for NeoMei-Space, run the real acceptance sequence:

```text
wiki_list_spaces
wiki_list_pages(spaceId=<NeoMei-Space internal id>)
wiki_propose_page(spaceId=<id>, title="吃饭睡觉打豆豆", content=<existing content plus "豆豆不能随便打">)
approve_change_set(changeSetId=<new id>)  # must fail for the Agent
```

Expected: the proposal creates `pending_review`; Agent approval fails; after human approval, the page contains “豆豆不能随便打”. Finally report whether local master, `origin/master`, npm 0.5.0, and production are aligned at the verified release commit.
