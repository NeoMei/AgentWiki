# Collaboration Agent Preparation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an authorized user prepare, authorize, connect, and map an Agent without leaving the collaboration run-start wizard.

**Architecture:** Keep `AgentGrant.role` and the existing Local Sync exchange as the only authorization path. Add one narrowly scoped Super Admin contract alignment on the server, then compose typed existing Agent endpoints through a small client orchestration module and an accessible preparation dialog; `RunStartWizard` remains the owner of members, bindings, route epochs, and prepared-connection warnings.

**Tech Stack:** NestJS 11, Prisma 5, Jest 30, React 18, TypeScript, Vite 6, Vitest 3, Testing Library, Tailwind CSS, existing `ModalDialog`, existing `@neomei/agentwiki-sync-protocol` Agent roles, Local Sync 0.6.1.

## Global Constraints

- `AgentGrant.role` remains the only persisted permission fact; Credential records identify connections and derive permissions from the current Grant.
- Agent roles remain exactly `reader | editor | publisher`; collaboration preparation exposes only `editor | publisher`, defaulting to `editor`.
- Agents never receive human review, member-management, or `review:decide` permission.
- Space Owner/Admin and platform Super Admin may prepare their own Agents; Space Editor can start a run but cannot mutate Agent Grants.
- Each preparation action targets exactly one Role Slot; never auto-map one Agent to every role.
- A pending connection may be mapped and the run may start, but both mapping and review steps must label it as not yet connected.
- One-time instructions never enter `localStorage`, run drafts, generic logs, or analytics.
- All new visible copy must exist in Simplified Chinese and English.
- Desktop and 390px layouts must not horizontally overflow.
- Do not push, publish npm packages, or deploy production without separate user authorization.
- Preserve unrelated dirty submodules and `agentwiki/.codebase-memory/` exactly as found.

---

## File Structure

- Modify `apps/server/src/core/agent/agent.service.ts`: accept a trusted Super Admin flag when checking whether a connection intent may be issued.
- Modify `apps/server/src/core/agent/local-sync-installation.controller.ts`: forward the authenticated platform role to the installation service.
- Modify `apps/server/src/core/agent/local-sync-installation.service.ts`: propagate the Super Admin flag to `AgentService`.
- Modify the three colocated server specs for the permission contract.
- Create `apps/client/src/features/collaboration/agentPreparationApi.ts`: typed HTTP adapter and connection-validity helper only.
- Create `apps/client/src/features/collaboration/prepareAgent.ts`: deterministic multi-stage preparation orchestration independent of React.
- Create `apps/client/src/features/collaboration/components/AgentPreparationDialog.tsx`: accessible UI, instruction lifecycle, connection polling, and stage-specific recovery.
- Create colocated Vitest files for the API/helper, orchestrator, and dialog.
- Modify `apps/client/src/features/collaboration/components/RoleBindingEditor.tsx`: expose one contextual preparation callback per Role Slot while keeping lifecycle logic outside it.
- Modify `apps/client/src/features/collaboration/RunStartWizard.tsx`: permission derivation, dialog ownership, authoritative member refresh, target-slot mapping, and connection warnings.
- Modify `apps/client/src/features/collaboration/RunStartWizard.test.tsx`: owner/editor/Super Admin, empty-state, refreshed mapping, pending connection, and stale-route coverage.
- Modify `apps/client/src/i18n/messages.ts`: exact Chinese and English UI copy.
- Create `docs/testing/collaboration-agent-preparation-acceptance.md`: fresh automated and real-browser evidence without production mutations.

---

### Task 1: Align Local Sync Installation Permission with Super Admin Rules

**Files:**
- Modify: `apps/server/src/core/agent/agent.service.ts:115-129`
- Modify: `apps/server/src/core/agent/local-sync-installation.controller.ts:30-44`
- Modify: `apps/server/src/core/agent/local-sync-installation.service.ts:100-122`
- Test: `apps/server/src/core/agent/agent.service.spec.ts`
- Test: `apps/server/src/core/agent/local-sync-installation.controller.spec.ts`
- Test: `apps/server/src/core/agent/local-sync-installation.service.spec.ts`

**Interfaces:**
- Consumes: authenticated principal `{ userId: string; platformRole?: string }` and existing Agent ownership check.
- Produces: `assertCanIssueConnection(ownerId, agentId, spaceId, isSuperAdmin?: boolean)` and `LocalSyncInstallationService.create(..., serverUrl, isSuperAdmin?: boolean)`; default `false` preserves every existing caller.

- [x] **Step 1: Add failing service and controller contract tests**

Add these assertions before changing production signatures:

```ts
it('allows an owned Agent connection for a platform Super Admin without Space membership', async () => {
  prisma.agent.findUnique.mockResolvedValue({
    id: 'agent-1', ownerId: 'owner-1', revokedAt: null, grants: [], credentials: [], status: 'active',
  });
  prisma.space.findFirst.mockResolvedValue({ id: 'space-1' });

  await expect(service.assertCanIssueConnection(
    'owner-1', 'agent-1', 'space-1', true,
  )).resolves.toBeUndefined();

  expect(prisma.space.findFirst).toHaveBeenCalledWith({
    where: { id: 'space-1', deletedAt: null },
    select: { id: true },
  });
});

it('forwards platform Super Admin status when creating an installation', async () => {
  config.get.mockImplementation((key: string) => (
    key === 'PUBLIC_API_URL' ? 'https://wiki.test/api' : 'production'
  ));
  const request = { user: { userId: 'owner-1', platformRole: 'super_admin' } } as any;

  await controller.create(request, 'agent-1', {
    spaceId: 'space-1', role: 'editor', pluginVersion: '0.6.1',
  });

  expect(installations.create).toHaveBeenCalledWith(
    'owner-1', 'agent-1', 'space-1', 'editor', '0.6.1',
    'https://wiki.test/api', true,
  );
});
```

Update the existing Local Sync service expectation to require the final boolean, and add:

```ts
it('passes the trusted Super Admin flag to the Agent authorization check', async () => {
  await service.create(
    'owner-1', 'agent-1', 'space-1', 'editor', '0.6.1',
    'https://wiki.test/api', true,
  );

  expect(agents.assertCanIssueConnection).toHaveBeenCalledWith(
    'owner-1', 'agent-1', 'space-1', true,
  );
});
```

- [x] **Step 2: Run the focused tests and verify RED**

Run:

```bash
pnpm --filter @agentwiki/server exec jest --runInBand \
  src/core/agent/agent.service.spec.ts \
  src/core/agent/local-sync-installation.controller.spec.ts \
  src/core/agent/local-sync-installation.service.spec.ts
```

Expected: FAIL because the fourth/seventh boolean parameters are absent and Super Admin still receives a membership-filtered Space query.

- [x] **Step 3: Implement the minimal permission alignment**

Change the Agent check to:

```ts
async assertCanIssueConnection(
  ownerId: string,
  agentId: string,
  spaceId: string,
  isSuperAdmin = false,
): Promise<void> {
  const agent = await this.getOwned(ownerId, agentId);
  if (agent.status !== 'active') throw new BadRequestException('Agent must be active');
  const space = await this.prisma.space.findFirst({
    where: {
      id: spaceId,
      deletedAt: null,
      ...(!isSuperAdmin ? {
        members: { some: { userId: ownerId, role: { in: ['owner', 'admin'] } } },
      } : {}),
    },
    select: { id: true },
  });
  if (!space) throw new ForbiddenException('You cannot authorize this Agent for the Space');
}
```

In the controller, derive the flag only from the trusted authenticated principal:

```ts
const principal = req.user as { userId: string; platformRole?: string };
return this.installations.create(
  principal.userId,
  agentId,
  dto.spaceId,
  dto.role,
  dto.pluginVersion,
  this.publicApiUrl(req),
  principal.platformRole === 'super_admin',
);
```

Extend `LocalSyncInstallationService.create` with `isSuperAdmin = false` and call:

```ts
await this.agents.assertCanIssueConnection(ownerId, agentId, spaceId, isSuperAdmin);
```

- [x] **Step 4: Run the focused tests and verify GREEN**

Run the Step 2 command again.

Expected: all three suites PASS; ordinary human tests still prove membership enforcement, and Super Admin bypass applies only to Space membership, never Agent ownership.

- [x] **Step 5: Commit the server contract**

```bash
git add apps/server/src/core/agent/agent.service.ts \
  apps/server/src/core/agent/agent.service.spec.ts \
  apps/server/src/core/agent/local-sync-installation.controller.ts \
  apps/server/src/core/agent/local-sync-installation.controller.spec.ts \
  apps/server/src/core/agent/local-sync-installation.service.ts \
  apps/server/src/core/agent/local-sync-installation.service.spec.ts
git commit -m "fix(agent): align installation access for super admins"
```

---

### Task 2: Add Typed Agent Preparation API and Connection Predicate

**Files:**
- Create: `apps/client/src/features/collaboration/agentPreparationApi.ts`
- Test: `apps/client/src/features/collaboration/agentPreparationApi.test.ts`

**Interfaces:**
- Consumes: existing Axios client and `AgentAccessRole`.
- Produces: `AgentIdentity`, `OwnedAgentSummary`, `OwnedAgentDetail`, `AgentInstallation`, `AgentPreparationApi`, `agentPreparationApi`, `apiResponseStatus(error)`, and `hasActiveSpaceCredential(agent, spaceId, now?)`.

- [x] **Step 1: Write the failing adapter and predicate tests**

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../../api/client';
import { agentPreparationApi, apiResponseStatus, hasActiveSpaceCredential } from './agentPreparationApi';

vi.mock('../../api/client', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn() },
}));

describe('agentPreparationApi', () => {
  beforeEach(() => vi.clearAllMocks());

  it('uses the existing Agent, Grant, and installation endpoints', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: [] } as never);
    vi.mocked(api.post).mockResolvedValue({ data: { id: 'agent-1' } } as never);
    vi.mocked(api.patch).mockResolvedValue({ data: { id: 'agent-1', status: 'active' } } as never);
    vi.mocked(api.put).mockResolvedValue({ data: { id: 'grant-1' } } as never);

    await agentPreparationApi.listAgents();
    await agentPreparationApi.createAgent({ name: 'Writer', description: '' });
    await agentPreparationApi.activateAgent('agent-1');
    await agentPreparationApi.upsertGrant('agent-1', 'space-1', 'editor');
    await agentPreparationApi.createInstallation('agent-1', 'space-1', 'editor');

    expect(api.get).toHaveBeenCalledWith('/agents');
    expect(api.post).toHaveBeenCalledWith('/agents', { name: 'Writer', description: '' });
    expect(api.patch).toHaveBeenCalledWith('/agents/agent-1', { status: 'active' });
    expect(api.put).toHaveBeenCalledWith('/agents/agent-1/grants/space-1', { role: 'editor' });
    expect(api.post).toHaveBeenCalledWith('/agents/agent-1/local-sync-installations', {
      pluginVersion: '0.6.1', spaceId: 'space-1', role: 'editor',
    });
  });

  it('accepts only an unrevoked, unexpired credential for the target Space', () => {
    const detail = {
      id: 'agent-1', name: 'Writer', status: 'active', grants: [],
      credentials: [
        { id: 'other', revokedAt: null, expiresAt: null, authorization: { space: { id: 'space-2', name: 'Other' }, role: 'editor' } },
        { id: 'expired', revokedAt: null, expiresAt: '2026-08-25T00:00:00.000Z', authorization: { space: { id: 'space-1', name: 'Target' }, role: 'editor' } },
        { id: 'active', revokedAt: null, expiresAt: '2026-08-25T00:20:00.000Z', authorization: { space: { id: 'space-1', name: 'Target' }, role: 'editor' } },
      ],
    };

    expect(hasActiveSpaceCredential(detail, 'space-1', Date.parse('2026-08-25T00:10:00.000Z'))).toBe(true);
    expect(hasActiveSpaceCredential(detail, 'space-3', Date.parse('2026-08-25T00:10:00.000Z'))).toBe(false);
  });

  it('classifies an Axios-shaped status without exposing raw error text', () => {
    expect(apiResponseStatus({ response: { status: 403, data: { message: 'internal' } } })).toBe(403);
    expect(apiResponseStatus(new Error('offline'))).toBeUndefined();
  });
});
```

- [x] **Step 2: Run the new test and verify RED**

Run:

```bash
pnpm --filter @agentwiki/client exec vitest run \
  src/features/collaboration/agentPreparationApi.test.ts
```

Expected: FAIL because the module does not exist.

- [x] **Step 3: Implement the typed adapter**

Define exact public types and methods:

```ts
import type { AgentAccessRole } from '@neomei/agentwiki-sync-protocol';
import api from '../../api/client';
import { LOCAL_SYNC_VERSION } from '../../config/localSync';

export type ExecutableAgentRole = Extract<AgentAccessRole, 'editor' | 'publisher'>;
export interface AgentIdentity {
  id: string;
  name: string;
  description?: string;
  status: string;
  revokedAt?: string | null;
}
export interface OwnedAgentSummary extends AgentIdentity {
  grants: Array<{ id: string; spaceId: string; role: AgentAccessRole; space: { id: string; name: string } }>;
}
export interface OwnedAgentCredential {
  id: string;
  revokedAt?: string | null;
  expiresAt?: string | null;
  authorization: { role: AgentAccessRole; space: { id: string; name: string } };
}
export interface OwnedAgentDetail extends OwnedAgentSummary {
  credentials: OwnedAgentCredential[];
}
export interface AgentInstallation {
  installationId: string;
  code: string;
  expiresAt: string;
  instructions: string;
}
export interface AgentPreparationApi {
  listAgents(): Promise<OwnedAgentSummary[]>;
  getAgent(agentId: string): Promise<OwnedAgentDetail>;
  createAgent(input: { name: string; description?: string }): Promise<AgentIdentity>;
  activateAgent(agentId: string): Promise<AgentIdentity>;
  upsertGrant(agentId: string, spaceId: string, role: ExecutableAgentRole): Promise<unknown>;
  createInstallation(agentId: string, spaceId: string, role: ExecutableAgentRole): Promise<AgentInstallation>;
}

export const agentPreparationApi: AgentPreparationApi = {
  listAgents: async () => (await api.get<OwnedAgentSummary[]>('/agents')).data,
  getAgent: async (agentId) => (await api.get<OwnedAgentDetail>(`/agents/${agentId}`)).data,
  createAgent: async (input) => (await api.post<AgentIdentity>('/agents', input)).data,
  activateAgent: async (agentId) => (await api.patch<AgentIdentity>(`/agents/${agentId}`, { status: 'active' })).data,
  upsertGrant: async (agentId, spaceId, role) => (await api.put(`/agents/${agentId}/grants/${spaceId}`, { role })).data,
  createInstallation: async (agentId, spaceId, role) => (await api.post<AgentInstallation>(
    `/agents/${agentId}/local-sync-installations`,
    { pluginVersion: LOCAL_SYNC_VERSION, spaceId, role },
  )).data,
};

export function hasActiveSpaceCredential(
  agent: Pick<OwnedAgentDetail, 'credentials'>,
  spaceId: string,
  now = Date.now(),
): boolean {
  return agent.credentials.some((credential) => (
    credential.authorization.space.id === spaceId
    && !credential.revokedAt
    && (!credential.expiresAt || Date.parse(credential.expiresAt) > now)
  ));
}

export function apiResponseStatus(error: unknown): number | undefined {
  return (error as { response?: { status?: number } } | null)?.response?.status;
}
```

- [x] **Step 4: Run the test and verify GREEN**

Run the Step 2 command again.

Expected: both tests PASS and TypeScript reports no `any` in the new adapter.

- [x] **Step 5: Commit the typed boundary**

```bash
git add apps/client/src/features/collaboration/agentPreparationApi.ts \
  apps/client/src/features/collaboration/agentPreparationApi.test.ts
git commit -m "feat(collaboration): add typed Agent preparation API"
```

---

### Task 3: Implement the Deterministic Preparation Orchestrator

**Files:**
- Create: `apps/client/src/features/collaboration/prepareAgent.ts`
- Test: `apps/client/src/features/collaboration/prepareAgent.test.ts`

**Interfaces:**
- Consumes: `AgentIdentity`, `AgentPreparationApi`, `OwnedAgentSummary`, `ExecutableAgentRole`, `apiResponseStatus`, and `hasActiveSpaceCredential` from Task 2.
- Produces: `AgentCandidate`, `PreparationStage`, `PreparedAgent`, `AgentPreparationFailure`, and `prepareAgent(input, api, onStage?)`.

- [x] **Step 1: Write failing orchestration tests for existing, new, connected, and partial-success paths**

Use one typed fake and assert call order:

```ts
const calls: string[] = [];
const api: AgentPreparationApi = {
  listAgents: vi.fn(),
  getAgent: vi.fn(async (id) => ({ id, name: 'Writer', status: 'active', grants: [], credentials: [] })),
  createAgent: vi.fn(async (input) => { calls.push('create'); return { id: 'new-1', name: input.name, status: 'active', grants: [] }; }),
  activateAgent: vi.fn(async (id) => { calls.push('activate'); return { id, name: 'Writer', status: 'active', grants: [] }; }),
  upsertGrant: vi.fn(async () => { calls.push('grant'); return {}; }),
  createInstallation: vi.fn(async () => { calls.push('instruction'); return { installationId: 'install-1', code: 'AW-CODE', expiresAt: '2030-01-01T00:10:00.000Z', instructions: 'onboard --code AW-CODE' }; }),
};

it('activates a paused existing Agent before granting and issuing instructions', async () => {
  const result = await prepareAgent({
    candidate: { kind: 'existing', agent: { id: 'agent-1', name: 'Writer', status: 'paused', grants: [] } },
    spaceId: 'space-1', role: 'editor', now: Date.parse('2030-01-01T00:00:00.000Z'),
  }, api);

  expect(calls).toEqual(['activate', 'grant', 'instruction']);
  expect(result.connection.kind).toBe('waiting');
});

it('creates exactly one new Agent before granting it', async () => {
  const result = await prepareAgent({
    candidate: { kind: 'new', name: 'New Writer', description: 'Drafts chapters' },
    spaceId: 'space-1', role: 'editor', now: Date.parse('2030-01-01T00:00:00.000Z'),
  }, api);

  expect(result.agentId).toBe('new-1');
  expect(calls).toEqual(['create', 'grant', 'instruction']);
  expect(api.createAgent).toHaveBeenCalledTimes(1);
});

it('reuses an active target-Space credential without issuing another instruction', async () => {
  vi.mocked(api.getAgent).mockResolvedValueOnce({
    id: 'agent-1', name: 'Writer', status: 'active', grants: [],
    credentials: [{ id: 'credential-1', expiresAt: null, revokedAt: null, authorization: { role: 'editor', space: { id: 'space-1', name: 'Space' } } }],
  });
  const result = await prepareAgent({
    candidate: { kind: 'existing', agent: { id: 'agent-1', name: 'Writer', status: 'active', grants: [] } },
    spaceId: 'space-1', role: 'editor', now: Date.now(),
  }, api);

  expect(result.connection).toEqual({ kind: 'connected' });
  expect(api.createInstallation).not.toHaveBeenCalled();
});

it('returns durable partial success when instruction issuance fails', async () => {
  vi.mocked(api.createInstallation).mockRejectedValueOnce(new Error('redis unavailable'));
  const result = await prepareAgent({
    candidate: { kind: 'new', name: 'New Writer', description: '' },
    spaceId: 'space-1', role: 'editor', now: Date.now(),
  }, api);

  expect(result).toMatchObject({ agentId: 'new-1', connection: { kind: 'instruction_failed' } });
  expect(api.createAgent).toHaveBeenCalledTimes(1);
  expect(api.upsertGrant).toHaveBeenCalledTimes(1);
});
```

- [x] **Step 2: Run the orchestrator test and verify RED**

Run:

```bash
pnpm --filter @agentwiki/client exec vitest run \
  src/features/collaboration/prepareAgent.test.ts
```

Expected: FAIL because `prepareAgent.ts` does not exist.

- [x] **Step 3: Implement the orchestration result as a strict union**

Use these exact result contracts:

```ts
export type AgentCandidate =
  | { kind: 'existing'; agent: OwnedAgentSummary }
  | { kind: 'new'; name: string; description: string };
export type PreparationStage = 'creating' | 'activating' | 'granting' | 'checking_connection' | 'issuing_instruction';
export type PreparedConnection =
  | { kind: 'connected' }
  | { kind: 'waiting'; installation: AgentInstallation }
  | { kind: 'instruction_failed'; status?: number };
export interface PreparedAgent {
  agentId: string;
  agentName: string;
  role: ExecutableAgentRole;
  connection: PreparedConnection;
}
export class AgentPreparationFailure extends Error {
  constructor(readonly stage: PreparationStage, readonly cause: unknown) {
    super(`Agent preparation failed during ${stage}`);
  }
}
```

Implement `prepareAgent` so create/activate/grant/detail errors throw `AgentPreparationFailure` with the exact stage, while installation failure returns `instruction_failed` after durable Agent and Grant success:

```ts
export async function prepareAgent(
  input: { candidate: AgentCandidate; spaceId: string; role: ExecutableAgentRole; now?: number },
  api: AgentPreparationApi,
  onStage: (stage: PreparationStage) => void = () => undefined,
): Promise<PreparedAgent> {
  let agent: AgentIdentity;
  let stage: PreparationStage = input.candidate.kind === 'new' ? 'creating' : 'granting';
  try {
    if (input.candidate.kind === 'new') {
      stage = 'creating';
      onStage(stage);
      agent = await api.createAgent({ name: input.candidate.name.trim(), description: input.candidate.description.trim() });
    } else {
      agent = input.candidate.agent;
      if (agent.status !== 'active') {
        stage = 'activating';
        onStage(stage);
        agent = await api.activateAgent(agent.id);
      }
    }
    stage = 'granting';
    onStage(stage);
    await api.upsertGrant(agent.id, input.spaceId, input.role);
    stage = 'checking_connection';
    onStage(stage);
    const detail = await api.getAgent(agent.id);
    if (hasActiveSpaceCredential(detail, input.spaceId, input.now)) {
      return { agentId: agent.id, agentName: agent.name, role: input.role, connection: { kind: 'connected' } };
    }
  } catch (error) {
    throw new AgentPreparationFailure(stage, error);
  }

  stage = 'issuing_instruction';
  onStage(stage);
  try {
    const installation = await api.createInstallation(agent.id, input.spaceId, input.role);
    return { agentId: agent.id, agentName: agent.name, role: input.role, connection: { kind: 'waiting', installation } };
  } catch (error) {
    return {
      agentId: agent.id,
      agentName: agent.name,
      role: input.role,
      connection: { kind: 'instruction_failed', status: apiResponseStatus(error) },
    };
  }
}
```

- [x] **Step 4: Run Task 2 and Task 3 tests and verify GREEN**

Run:

```bash
pnpm --filter @agentwiki/client exec vitest run \
  src/features/collaboration/agentPreparationApi.test.ts \
  src/features/collaboration/prepareAgent.test.ts
```

Expected: all tests PASS, including exactly-once creation after instruction failure.

- [x] **Step 5: Commit the orchestration unit**

```bash
git add apps/client/src/features/collaboration/prepareAgent.ts \
  apps/client/src/features/collaboration/prepareAgent.test.ts
git commit -m "feat(collaboration): orchestrate Agent preparation stages"
```

---

### Task 4: Build the Accessible Preparation and Connection Dialog

**Files:**
- Create: `apps/client/src/features/collaboration/components/AgentPreparationDialog.tsx`
- Test: `apps/client/src/features/collaboration/components/AgentPreparationDialog.test.tsx`
- Modify: `apps/client/src/i18n/messages.ts`

**Interfaces:**
- Consumes: Task 2 API, Task 3 orchestrator, `ModalDialog`, `ExecutableAgentRole`, target `{ id, name }`.
- Produces: `PreparedAgentSelection` and `AgentPreparationDialog` with `onPrepared(result: PreparedAgentSelection): Promise<void>` plus `onAuthorizationLost(): Promise<void>`.

- [x] **Step 1: Write failing dialog tests for the full UI lifecycle**

Mock `agentPreparationApi` and the orchestrator module. Cover at least these concrete cases:

```tsx
it('creates and grants an Agent, then shows the one-time instruction', async () => {
  vi.mocked(agentPreparationApi.listAgents).mockResolvedValue([]);
  vi.mocked(prepareAgent).mockResolvedValue({
    agentId: 'agent-new', agentName: 'Chapter Writer', role: 'editor',
    connection: { kind: 'waiting', installation: {
      installationId: 'install-1', code: 'AW-CODE',
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
      instructions: 'npx --yes @neomei/agentwiki-local-sync@0.6.1 onboard --code AW-CODE',
    } },
  });
  renderDialog();

  fireEvent.click(await screen.findByRole('tab', { name: 'Create new Agent' }));
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Chapter Writer' } });
  fireEvent.click(screen.getByRole('button', { name: 'Prepare Agent' }));

  expect(await screen.findByText(/onboard --code AW-CODE/)).toBeVisible();
  expect(screen.getByRole('status')).toHaveTextContent('Waiting for Agent connection');
});

it('retries only instruction issuance after durable preparation succeeded', async () => {
  vi.mocked(prepareAgent).mockResolvedValue({
    agentId: 'agent-new', agentName: 'Writer', role: 'editor', connection: { kind: 'instruction_failed' },
  });
  vi.mocked(agentPreparationApi.createInstallation).mockResolvedValue({
    installationId: 'install-2', code: 'AW-RETRY', expiresAt: new Date(Date.now() + 600_000).toISOString(), instructions: 'onboard --code AW-RETRY',
  });
  renderDialog();

  fireEvent.click(await screen.findByRole('tab', { name: 'Create new Agent' }));
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Writer' } });
  fireEvent.click(screen.getByRole('button', { name: 'Prepare Agent' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Retry connection instruction' }));

  expect(await screen.findByText(/AW-RETRY/)).toBeVisible();
  expect(prepareAgent).toHaveBeenCalledTimes(1);
  expect(agentPreparationApi.createInstallation).toHaveBeenCalledWith('agent-new', 'space-1', 'editor');
});

it('detects connection automatically and completes the target Role Slot', async () => {
  vi.useFakeTimers();
  vi.mocked(prepareAgent).mockResolvedValue(waitingResult);
  vi.mocked(agentPreparationApi.getAgent)
    .mockResolvedValueOnce(disconnectedDetail)
    .mockResolvedValueOnce(connectedDetail);
  const onPrepared = vi.fn().mockResolvedValue(undefined);
  renderDialog({ onPrepared });
  await openWaitingInstruction();

  await act(async () => { await vi.advanceTimersByTimeAsync(4_000); });

  expect(onPrepared).toHaveBeenCalledWith({
    agentId: 'agent-1', agentName: 'Writer', connection: 'connected',
  });
  vi.useRealTimers();
});

it('allows mapping first while preserving a pending connection state', async () => {
  vi.mocked(prepareAgent).mockResolvedValue(waitingResult);
  const onPrepared = vi.fn().mockResolvedValue(undefined);
  renderDialog({ onPrepared });
  await openWaitingInstruction();

  fireEvent.click(screen.getByRole('button', { name: 'Connect later and map now' }));

  expect(onPrepared).toHaveBeenCalledWith({
    agentId: 'agent-1', agentName: 'Writer', connection: 'pending',
  });
});

it('refreshes parent authorization instead of retrying after a 403', async () => {
  vi.mocked(prepareAgent).mockResolvedValue({
    agentId: 'agent-1', agentName: 'Writer', role: 'editor',
    connection: { kind: 'instruction_failed', status: 403 },
  });
  const onAuthorizationLost = vi.fn().mockResolvedValue(undefined);
  renderDialog({ onAuthorizationLost });
  await submitExistingAgent();

  expect(onAuthorizationLost).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('button', { name: 'Retry connection instruction' })).not.toBeInTheDocument();
});
```

Also assert that a paused existing Agent displays the status change, Reader displays the exact upgrade notice, Editor is the default role, Publisher is selectable, Escape cannot close during a mutation, expired instructions expose regeneration, a rejected `onPrepared` keeps the dialog open with the localized refresh error, clipboard failure creates an alert without leaking the instruction into the error text, and `localStorage` never contains the instruction or code.

- [x] **Step 2: Run the dialog test and verify RED**

Run:

```bash
pnpm --filter @agentwiki/client exec vitest run \
  src/features/collaboration/components/AgentPreparationDialog.test.tsx
```

Expected: FAIL because the dialog and its message keys do not exist.

- [x] **Step 3: Add exact bilingual message keys**

Add these keys to both language maps with the shown meanings:

```ts
// English
'collaboration.agentPreparation.title': 'Prepare Agent for {role}',
'collaboration.agentPreparation.existing': 'Use existing Agent',
'collaboration.agentPreparation.create': 'Create new Agent',
'collaboration.agentPreparation.prepare': 'Prepare Agent',
'collaboration.agentPreparation.role': 'Execution role',
'collaboration.agentPreparation.readerUpgrade': 'This Agent is currently Reader and will be upgraded to {role}.',
'collaboration.agentPreparation.pausedResume': 'This Agent is paused and will be resumed before authorization.',
'collaboration.agentPreparation.waiting': 'Waiting for Agent connection',
'collaboration.agentPreparation.connected': 'Agent connected',
'collaboration.agentPreparation.connectLater': 'Connect later and map now',
'collaboration.agentPreparation.retryInstruction': 'Retry connection instruction',
'collaboration.agentPreparation.checkNow': 'Check connection now',
'collaboration.agentPreparation.instructionFailed': 'The Agent is ready for this Space, but the connection instruction could not be generated.',
'collaboration.agentPreparation.expired': 'This connection instruction has expired.',
'collaboration.agentPreparation.copy': 'Copy connection instruction',
'collaboration.agentPreparation.copied': 'Connection instruction copied',
'collaboration.agentPreparation.copyFailed': 'Could not copy the connection instruction.',
'collaboration.agentPreparation.refreshFailed': 'The Agent was prepared, but the Space Agent list could not be refreshed.',
'collaboration.agentPreparation.ownerRequired': 'Ask a Space Owner or Admin to prepare an executable Agent.',
'collaboration.agentPreparation.loadFailed': 'Could not load your Agents.',
'collaboration.agentPreparation.noOwnedAgents': 'You do not have an available Agent yet. Create one here.',
'collaboration.agentPreparation.error.creating': 'Could not create the Agent.',
'collaboration.agentPreparation.error.activating': 'Could not resume the Agent.',
'collaboration.agentPreparation.error.granting': 'Could not authorize the Agent for this Space.',
'collaboration.agentPreparation.error.checking_connection': 'Could not check the Agent connection.',

// Simplified Chinese
'collaboration.agentPreparation.title': '为“{role}”准备 Agent',
'collaboration.agentPreparation.existing': '使用已有 Agent',
'collaboration.agentPreparation.create': '创建新 Agent',
'collaboration.agentPreparation.prepare': '准备 Agent',
'collaboration.agentPreparation.role': '执行角色',
'collaboration.agentPreparation.readerUpgrade': '此 Agent 当前为 Reader，将升级为 {role}。',
'collaboration.agentPreparation.pausedResume': '此 Agent 已暂停，将先恢复再授权。',
'collaboration.agentPreparation.waiting': '等待 Agent 接入',
'collaboration.agentPreparation.connected': 'Agent 已接入',
'collaboration.agentPreparation.connectLater': '稍后接入，先完成映射',
'collaboration.agentPreparation.retryInstruction': '重新生成接入指令',
'collaboration.agentPreparation.checkNow': '立即检查接入状态',
'collaboration.agentPreparation.instructionFailed': 'Agent 已为当前 Space 准备完成，但未能生成接入指令。',
'collaboration.agentPreparation.expired': '此接入指令已过期。',
'collaboration.agentPreparation.copy': '复制接入指令',
'collaboration.agentPreparation.copied': '接入指令已复制',
'collaboration.agentPreparation.copyFailed': '无法复制接入指令。',
'collaboration.agentPreparation.refreshFailed': 'Agent 已准备完成，但无法刷新当前 Space 的 Agent 列表。',
'collaboration.agentPreparation.ownerRequired': '请让 Space Owner 或 Admin 准备可执行 Agent。',
'collaboration.agentPreparation.loadFailed': '无法加载你的 Agent。',
'collaboration.agentPreparation.noOwnedAgents': '你还没有可用 Agent，可以在这里创建。',
'collaboration.agentPreparation.error.creating': '无法创建 Agent。',
'collaboration.agentPreparation.error.activating': '无法恢复 Agent。',
'collaboration.agentPreparation.error.granting': '无法为当前 Space 授权 Agent。',
'collaboration.agentPreparation.error.checking_connection': '无法检查 Agent 接入状态。',
```

- [x] **Step 4: Implement the dialog state machine and bounded polling**

Export the callback type from the component:

```ts
export interface PreparedAgentSelection {
  agentId: string;
  agentName: string;
  connection: 'connected' | 'pending';
}
```

Use `ModalDialog` with `closeDisabled={busy}`. Keep instruction text only in component state. Load owned Agents on mount. Call Task 3 for initial preparation. For `waiting`, start one 2-second interval and one 1-second countdown; stop both on close, target change, connection, or expiry. The polling body must be guarded against overlapping requests:

```ts
useEffect(() => {
  if (result?.connection.kind !== 'waiting') return;
  let cancelled = false;
  let checking = false;
  const check = async () => {
    if (checking || cancelled) return;
    checking = true;
    try {
      const detail = await agentPreparationApi.getAgent(result.agentId);
      if (!cancelled && hasActiveSpaceCredential(detail, spaceId)) {
        await onPrepared({ agentId: result.agentId, agentName: result.agentName, connection: 'connected' });
      }
    } catch {
      if (!cancelled) setConnectionCheckFailed(true);
    } finally {
      checking = false;
    }
  };
  const interval = window.setInterval(() => void check(), 2_000);
  return () => { cancelled = true; window.clearInterval(interval); };
}, [onPrepared, result, spaceId]);
```

For instruction retry, call only `agentPreparationApi.createInstallation(result.agentId, spaceId, result.role)` and replace `result.connection`; never call `prepareAgent` again. Convert `AgentPreparationFailure.stage` to `collaboration.agentPreparation.error.${stage}` and never render raw Axios/server text. If either an `AgentPreparationFailure.cause` or an instruction/retry error has `apiResponseStatus(error) === 403`, await `onAuthorizationLost()` instead of exposing another retry.

- [x] **Step 5: Run dialog and lower-level tests and verify GREEN**

Run:

```bash
pnpm --filter @agentwiki/client exec vitest run \
  src/features/collaboration/agentPreparationApi.test.ts \
  src/features/collaboration/prepareAgent.test.ts \
  src/features/collaboration/components/AgentPreparationDialog.test.tsx
```

Expected: all suites PASS with no unhandled timer or React `act` warnings.

- [x] **Step 6: Commit the dialog**

```bash
git add apps/client/src/features/collaboration/components/AgentPreparationDialog.tsx \
  apps/client/src/features/collaboration/components/AgentPreparationDialog.test.tsx \
  apps/client/src/i18n/messages.ts
git commit -m "feat(collaboration): prepare and connect Agents in wizard"
```

---

### Task 5: Integrate Contextual Preparation into Role Mapping and Run Review

**Files:**
- Modify: `apps/client/src/features/collaboration/components/RoleBindingEditor.tsx`
- Create: `apps/client/src/features/collaboration/components/RoleBindingEditor.test.tsx`
- Modify: `apps/client/src/features/collaboration/RunStartWizard.tsx`
- Modify: `apps/client/src/features/collaboration/RunStartWizard.test.tsx`
- Modify: `apps/client/src/i18n/messages.ts`

**Interfaces:**
- Consumes: `AgentPreparationDialog`, `PreparedAgentSelection`, and `SpaceMemberSummary`.
- Produces: `onPrepare(roleSlotId)` from the editor; wizard-owned `preparedConnections: Record<string, 'connected' | 'pending'>`; authoritative `onPrepared` refresh-and-map behavior.

- [x] **Step 1: Write the failing pure Role Slot action test**

```tsx
it('reports the exact Role Slot when Prepare Agent is chosen', () => {
  const onPrepare = vi.fn();
  render(<RoleBindingEditor
    roleSlots={validDefinition.roleSlots}
    agents={[]}
    bindings={[]}
    onChange={vi.fn()}
    onPrepare={onPrepare}
    chooseLabel="Choose Agent"
    prepareLabel="Prepare Agent"
  />);

  fireEvent.click(screen.getByRole('button', { name: 'Prepare Agent for Writer' }));
  expect(onPrepare).toHaveBeenCalledWith('writer');
});
```

- [x] **Step 2: Write failing wizard integration tests**

Wrap the test wizard in `AuthProvider`, seed `localStorage.user`, and include one human member in the default fixture. Add these behaviors:

```tsx
it('lets an Owner prepare the first required Role Slot from the empty state', async () => {
  vi.mocked(collaborationApi.listMembers)
    .mockResolvedValueOnce([{ type: 'human', userId: 'user-owner', role: 'owner' }])
    .mockResolvedValueOnce([
      { type: 'human', userId: 'user-owner', role: 'owner' },
      { type: 'agent', agentId: 'agent-new', role: 'editor', agent: { id: 'agent-new', name: 'New Writer', status: 'active', revokedAt: null } },
    ]);
  renderWizard({ user: { id: 'user-owner', platformRole: 'user' } });
  await advanceToMapping();

  fireEvent.click(screen.getByRole('button', { name: 'Prepare first Agent' }));
  expect(await screen.findByRole('dialog', { name: 'Prepare Agent for Writer' })).toBeVisible();
  await completeMockedPreparation({ agentId: 'agent-new', agentName: 'New Writer', connection: 'connected' });

  expect(screen.getByLabelText('Writer')).toHaveValue('agent-new');
});

it('does not expose Grant mutation to a Space Editor', async () => {
  vi.mocked(collaborationApi.listMembers).mockResolvedValue([
    { type: 'human', userId: 'user-editor', role: 'editor' },
  ]);
  renderWizard({ user: { id: 'user-editor', platformRole: 'user' } });
  await advanceToMapping();

  expect(screen.getByText('Ask a Space Owner or Admin to prepare an executable Agent.')).toBeVisible();
  expect(screen.queryByRole('button', { name: /Prepare/u })).not.toBeInTheDocument();
});

it('treats a platform Super Admin as able to prepare Agents without a human membership row', async () => {
  vi.mocked(collaborationApi.listMembers).mockResolvedValue([]);
  renderWizard({ user: { id: 'super-1', platformRole: 'super_admin' } });
  await advanceToMapping();
  expect(screen.getByRole('button', { name: 'Prepare first Agent' })).toBeVisible();
});

it('keeps a pending-connection warning in mapping and review', async () => {
  renderWizard({ user: { id: 'user-owner', platformRole: 'user' } });
  await advanceToMapping();
  await completeMockedPreparation({ agentId: 'agent-new', agentName: 'New Writer', connection: 'pending' });

  expect(screen.getByText('New Writer is mapped but has not connected to this Space yet.')).toBeVisible();
  mapRemainingRequiredRoles();
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  expect(await screen.findByText('New Writer is mapped but has not connected to this Space yet.')).toBeVisible();
});
```

Retain and extend the existing stale-template test so a preparation callback from the old template cannot mutate the new template's bindings.

- [x] **Step 3: Run focused mapping tests and verify RED**

Run:

```bash
pnpm --filter @agentwiki/client exec vitest run \
  src/features/collaboration/components/RoleBindingEditor.test.tsx \
  src/features/collaboration/RunStartWizard.test.tsx
```

Expected: FAIL because preparation callbacks, permission derivation, dialog ownership, and warnings are absent.

- [x] **Step 4: Refactor RoleBindingEditor into valid contextual controls**

Replace the outer wrapping `<label>` with a `<div>` plus an explicit `htmlFor`, then add the optional action:

```tsx
const selectId = `role-binding-${slot.id}`;
return <div key={slot.id} className="rounded-xl border bg-white p-4">
  <div className="flex flex-wrap items-start justify-between gap-3">
    <div>
      <label htmlFor={selectId} className="font-medium text-gray-900">{slot.name}</label>
      {slot.required ? <span className="ml-1 text-red-600" aria-hidden="true">*</span> : null}
      <span className="mt-1 block text-sm text-gray-500">{slot.description}</span>
    </div>
    {onPrepare ? <button
      type="button"
      aria-label={`${prepareLabel} for ${slot.name}`}
      onClick={() => onPrepare(slot.id)}
      className="min-h-10 rounded-lg border px-3 text-sm"
    >{prepareLabel}</button> : null}
  </div>
  <select id={selectId} aria-label={slot.name} value={value} onChange={handleChange} className="mt-3 h-10 w-full rounded-lg border px-3 text-sm">
    <option value="">{chooseLabel}</option>
    {agents.map((member) => <option key={member.agentId} value={member.agentId}>{member.agent?.name}</option>)}
  </select>
</div>;
```

- [x] **Step 5: Add wizard-owned permission, target, refresh, and warning state**

Add `useAuth`, preserve the full `members` response, and derive permission exactly:

```ts
const myRole = members.find((member) => member.type === 'human' && member.userId === user?.id)?.role;
const canPrepareAgents = user?.platformRole === 'super_admin' || myRole === 'owner' || myRole === 'admin';
```

Store `preparationTarget: { id: string; name: string } | null` and `preparedConnections`. On completion, reload members before changing the binding:

```ts
const handlePrepared = async (prepared: PreparedAgentSelection) => {
  const epoch = mutationEpoch.current;
  const members = await collaborationApi.listMembers(id);
  if (epoch !== mutationEpoch.current || !preparationTarget) return;
  const executable = members.filter(isExecutableAgent);
  if (!executable.some((member) => member.agentId === prepared.agentId)) {
    throw new Error(t('collaboration.agentPreparation.refreshFailed'));
  }
  setMembers(members);
  setAgents(executable);
  setBindings((current) => [
    ...current.filter((binding) => binding.roleSlotId !== preparationTarget.id),
    { roleSlotId: preparationTarget.id, roleSlotName: preparationTarget.name, agentId: prepared.agentId },
  ]);
  setPreparedConnections((current) => ({ ...current, [prepared.agentId]: prepared.connection }));
  setPreparationTarget(null);
};
```

Provide the dialog's authorization-loss callback from the wizard:

```ts
const handlePreparationAuthorizationLost = async () => {
  const epoch = mutationEpoch.current;
  const nextMembers = await collaborationApi.listMembers(id);
  if (epoch !== mutationEpoch.current) return;
  setMembers(nextMembers);
  setAgents(nextMembers.filter(isExecutableAgent));
  setPreparationTarget(null);
};
```

The empty-state main button targets `template.definition.roleSlots.find(slot => slot.required && !bindings.some(binding => binding.roleSlotId === slot.id))`. Render pending warnings in both Step 2 and `ReviewStep`; do not disable Start solely because the connection is pending.

- [x] **Step 6: Add exact integration message keys**

```ts
// English
'collaboration.agentPreparation.action': 'Prepare Agent',
'collaboration.agentPreparation.actionFor': 'Prepare Agent for {role}',
'collaboration.agentPreparation.first': 'Prepare first Agent',
'collaboration.agentPreparation.pending': '{agent} is mapped but has not connected to this Space yet.',

// Simplified Chinese
'collaboration.agentPreparation.action': '准备 Agent',
'collaboration.agentPreparation.actionFor': '为“{role}”准备 Agent',
'collaboration.agentPreparation.first': '准备第一个 Agent',
'collaboration.agentPreparation.pending': '{agent} 已完成映射，但尚未接入当前 Space。',
```

- [x] **Step 7: Run focused client tests and verify GREEN**

Run:

```bash
pnpm --filter @agentwiki/client exec vitest run \
  src/features/collaboration/agentPreparationApi.test.ts \
  src/features/collaboration/prepareAgent.test.ts \
  src/features/collaboration/components/AgentPreparationDialog.test.tsx \
  src/features/collaboration/components/RoleBindingEditor.test.tsx \
  src/features/collaboration/RunStartWizard.test.tsx
```

Expected: all focused suites PASS, existing three-step and self-review tests remain GREEN, and output contains no React warnings.

- [x] **Step 8: Commit the wizard integration**

```bash
git add apps/client/src/features/collaboration/components/RoleBindingEditor.tsx \
  apps/client/src/features/collaboration/components/RoleBindingEditor.test.tsx \
  apps/client/src/features/collaboration/RunStartWizard.tsx \
  apps/client/src/features/collaboration/RunStartWizard.test.tsx \
  apps/client/src/i18n/messages.ts
git commit -m "feat(collaboration): prepare Agents from role mapping"
```

---

### Task 6: Run Full Gates and Real Local Acceptance

**Files:**
- Create: `docs/testing/collaboration-agent-preparation-acceptance.md`
- Modify: `.codex-memory/tasks/active/collaboration-agent-preparation/brief.md`
- Modify: `.codex-memory/tasks/active/collaboration-agent-preparation/refs.md`
- Modify: `.codex-memory/current.md`

**Interfaces:**
- Consumes: completed Tasks 1-5 and existing isolated collaboration test infrastructure.
- Produces: reproducible gate results and real UI/MCP evidence; no production mutation.

- [x] **Step 1: Run static and focused gates from a clean intended diff**

Run:

```bash
git diff --check
pnpm --filter @agentwiki/server typecheck
pnpm --filter @agentwiki/client exec tsc --noEmit
pnpm --filter @agentwiki/server exec jest --runInBand \
  src/core/agent/agent.service.spec.ts \
  src/core/agent/local-sync-installation.controller.spec.ts \
  src/core/agent/local-sync-installation.service.spec.ts
pnpm --filter @agentwiki/client exec vitest run \
  src/features/collaboration/agentPreparationApi.test.ts \
  src/features/collaboration/prepareAgent.test.ts \
  src/features/collaboration/components/AgentPreparationDialog.test.tsx \
  src/features/collaboration/components/RoleBindingEditor.test.tsx \
  src/features/collaboration/RunStartWizard.test.tsx
```

Expected: every command exits 0 with no warnings worth fixing.

- [x] **Step 2: Run complete repository gates**

Run:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
git diff --check
```

Expected: all repository suites pass; only documented environment-dependent skips remain, and no new skip is introduced.

- [x] **Step 3: Start isolated local services and create disposable acceptance data**

Use the repository's existing collaboration-test environment and a random `collaboration_test_*` PostgreSQL schema through `COLLABORATION_TEST_DATABASE_URL`; never point Prisma migration or cleanup at `public`. Start the API, worker, and client on unused local ports. Register a disposable human, create one Space, and preserve its IDs in an ephemeral acceptance note, not in source.

Expected: API health is `ok`, worker has zero restart loop, and the browser can sign in to the disposable account.

- [x] **Step 4: Exercise the real browser flow at desktop width**

In the local UI:

1. Open a built-in collaboration template and complete Step 1.
2. Confirm Step 2 has no executable Agent and displays “准备第一个 Agent”.
3. Create `Acceptance Writer`, leave role at Editor, and generate the one-time instruction.
4. Copy the instruction and execute its Local Sync onboard command with isolated temporary configuration paths so no existing user MCP configuration is overwritten.
5. Confirm the dialog changes from waiting to connected without a page reload.
6. Confirm `Acceptance Writer` is selected only for the targeted Role Slot.
7. Prepare a second Agent with “稍后接入”; confirm pending warnings appear in Step 2 and Step 3 while Start remains available.
8. Finish the remaining mappings, start the run, and confirm the existing join instructions and dashboard still render.

Expected: every authoritative state transition is visible, no raw credential appears outside the intended instruction panel, and the browser console contains no error/warn worth fixing.

- [x] **Step 5: Repeat responsive and permission acceptance**

At a 390px viewport, repeat empty state, dialog, long instruction, copy, retry, and pending-warning screens. Assert `document.documentElement.scrollWidth === 390` at each screen. Then sign in as a disposable Space Editor and confirm the wizard shows the Owner/Admin instruction with no Grant mutation button. Finally verify the Super Admin preparation path in the isolated environment.

Expected: no horizontal overflow, clipped buttons, inaccessible dialog content, or permission-confused action.

- [x] **Step 6: Clean every disposable resource and write evidence**

Stop local services, remove only the validated random test schema and temporary Local Sync configuration directory, and confirm no `collaboration_test_*` data or process remains. Read the tested SHA with `git rev-parse HEAD`, then write `docs/testing/collaboration-agent-preparation-acceptance.md` with the actual SHA and observed numerical counts. The final document must contain these fields:

```md
# Collaboration Agent Preparation Acceptance

- Tested local commit
- Focused server/client tests: PASS with counts
- Full lint/typecheck/test/build: PASS with counts
- Real create -> Grant -> installation -> onboard -> auto-detect -> map: PASS
- Pending connection warning in mapping and review: PASS
- Owner/Admin, Editor, Super Admin permission cases: PASS
- Desktop and 390px, scrollWidth equality: PASS
- Browser console: no error/warn worth fixing
- Cleanup: disposable schema, users, Agents, processes, and temporary connection config removed
- Production: read-only reproduction only; no deployment performed
```

Record the SHA and numerical counts on the same lines when writing the evidence; do not copy example markers into the finished document.

- [x] **Step 7: Update project memory and commit acceptance evidence**

Keep the task active after local acceptance because external release is explicitly outside the current scope. Record “local implementation verified; push and production release not authorized” in the brief, and update `current.md` by replacement, not by appending a timeline.

```bash
git add docs/testing/collaboration-agent-preparation-acceptance.md \
  .codex-memory/current.md \
  .codex-memory/tasks/index.md \
  .codex-memory/tasks/active/collaboration-agent-preparation
git commit -m "test(collaboration): verify in-wizard Agent preparation"
```

Expected: `git status --short` shows only the unrelated pre-existing submodule and `.codebase-memory` entries; local implementation is release-ready but not pushed or deployed.
