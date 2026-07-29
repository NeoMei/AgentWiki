# Space Add Agent Member Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Space owners and admins add one of their own active Agents from the existing Add member dialog, with viewer/editor default scopes and the existing Agent Grant model.

**Architecture:** Keep human membership in `SpaceMember` and Agent membership in `AgentGrant`. Add a focused dialog component that switches between human and Agent modes, reuses `GET /agents` and `PUT /agents/:agentId/grants/:spaceId`, and delegates the existing member-list refresh to `SpaceMembers`. Add server-side active-Agent validation so stale or revoked IDs cannot receive new grants.

**Tech Stack:** React 18, TypeScript, React Router, Axios client, Vitest/Testing Library, NestJS, Prisma, Jest.

## Global Constraints

- Only Agents owned by the current signed-in user are discoverable through `GET /agents`.
- Only Agents with `status === 'active'` and no existing grant for the Space are selectable.
- Agent member roles are limited to `viewer` and `editor`; Agents cannot be Space `owner` or `admin`.
- Viewer defaults to `pages:read` and `graph:read`.
- Editor defaults to `pages:read`, `pages:write`, `sources:read`, `graph:read`, and `graph:write`.
- Space owner/admin authorization remains enforced server-side.
- Human email-based member creation must continue to behave exactly as before.
- Every new user-visible string must have Chinese and English copy.
- No database migration or new membership table.

---

## File Structure

- `apps/server/src/core/agent/agent.service.ts`: reject missing, revoked, paused, or otherwise inactive Agents before grant upsert.
- `apps/server/src/core/agent/agent.service.spec.ts`: server regression tests for active-Agent validation and idempotent upsert.
- `apps/client/src/features/space/spaceMemberAgentOptions.ts`: pure Agent filtering and role-to-scope defaults.
- `apps/client/src/features/space/spaceMemberAgentOptions.spec.ts`: deterministic tests for filtering and presets.
- `apps/client/src/features/space/AddSpaceMemberDialog.tsx`: focused two-mode Add member dialog and API orchestration.
- `apps/client/src/features/space/AddSpaceMemberDialog.spec.tsx`: dialog behavior, accessibility, errors, and bilingual tests.
- `apps/client/src/features/space/SpaceMembers.tsx`: replace the inline human-only modal with the focused dialog.
- `apps/client/src/features/space/SpaceMembers.spec.tsx`: integration test proving owner/admin entry and existing Agent IDs are passed into the dialog.

---

### Task 1: Enforce active Agent grants on the server

**Files:**
- Modify: `apps/server/src/core/agent/agent.service.ts:132-160`
- Test: `apps/server/src/core/agent/agent.service.spec.ts`

**Interfaces:**
- Consumes: `AgentService.upsertGrantForSpace(agentId, spaceId, role, scopes?)`.
- Produces: the same method signature, now rejecting missing/revoked Agents with `NotFoundException` and non-active Agents with `BadRequestException` before `agentGrant.upsert`.

- [ ] **Step 1: Write failing active-Agent validation tests**

Add `NotFoundException` to the test import and add these tests:

```ts
it('rejects a missing or revoked agent before persisting the grant', async () => {
  prisma.agent.findUnique.mockResolvedValueOnce(null);
  await expect(service.upsertGrantForSpace('missing', 'space-1', 'viewer', ['pages:read']))
    .rejects.toBeInstanceOf(NotFoundException);

  prisma.agent.findUnique.mockResolvedValueOnce({ id: 'agent-1', status: 'revoked', revokedAt: new Date() });
  await expect(service.upsertGrantForSpace('agent-1', 'space-1', 'viewer', ['pages:read']))
    .rejects.toBeInstanceOf(NotFoundException);

  expect(prisma.agentGrant.upsert).not.toHaveBeenCalled();
});

it('rejects a paused agent before persisting the grant', async () => {
  prisma.agent.findUnique.mockResolvedValue({ id: 'agent-1', status: 'paused', revokedAt: null });

  await expect(service.upsertGrantForSpace('agent-1', 'space-1', 'editor', ['pages:write']))
    .rejects.toBeInstanceOf(BadRequestException);
  expect(prisma.agentGrant.upsert).not.toHaveBeenCalled();
});

it('upserts an active agent grant idempotently', async () => {
  prisma.agent.findUnique.mockResolvedValue({ id: 'agent-1', status: 'active', revokedAt: null });
  prisma.agentGrant.upsert.mockResolvedValue({ id: 'grant-1' });
  prisma.agentAuditEvent.create.mockResolvedValue({});

  await service.upsertGrantForSpace('agent-1', 'space-1', 'viewer', ['pages:read', 'graph:read']);
  await service.upsertGrantForSpace('agent-1', 'space-1', 'viewer', ['pages:read', 'graph:read']);

  expect(prisma.agentGrant.upsert).toHaveBeenCalledTimes(2);
  expect(prisma.agentGrant.upsert).toHaveBeenLastCalledWith(expect.objectContaining({
    where: { agentId_spaceId: { agentId: 'agent-1', spaceId: 'space-1' } },
  }));
});
```

Update the two existing successful grant tests to mock:

```ts
prisma.agent.findUnique.mockResolvedValue({ id: 'agent-1', status: 'active', revokedAt: null });
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
pnpm --filter @agentwiki/server test -- src/core/agent/agent.service.spec.ts
```

Expected: the missing/revoked/paused tests fail because `upsertGrantForSpace` currently persists without loading the Agent.

- [ ] **Step 3: Implement minimal validation**

At the beginning of `upsertGrantForSpace`, before scope normalization, add:

```ts
const agent = await this.prisma.agent.findUnique({
  where: { id: agentId },
  select: { id: true, status: true, revokedAt: true },
});
if (!agent || agent.revokedAt || agent.status === 'revoked') {
  throw new NotFoundException('Agent not found');
}
if (agent.status !== 'active') {
  throw new BadRequestException('Agent must be active before it can join a space');
}
```

- [ ] **Step 4: Run focused and full server tests**

Run:

```bash
pnpm --filter @agentwiki/server test -- src/core/agent/agent.service.spec.ts
pnpm --filter @agentwiki/server test
```

Expected: focused tests pass; all server suites pass.

- [ ] **Step 5: Commit**

```bash
git add agentwiki/apps/server/src/core/agent/agent.service.ts \
  agentwiki/apps/server/src/core/agent/agent.service.spec.ts
git commit -m "fix: require active agents for space grants"
```

---

### Task 2: Add pure Agent member selection rules

**Files:**
- Create: `apps/client/src/features/space/spaceMemberAgentOptions.ts`
- Test: `apps/client/src/features/space/spaceMemberAgentOptions.spec.ts`

**Interfaces:**
- Produces: `AgentOption`, `AgentMemberRole`, `AGENT_ROLE_SCOPES`, and `filterAvailableAgents(agents, existingAgentIds)`.
- Consumed by: `AddSpaceMemberDialog` in Task 3.

- [ ] **Step 1: Write failing pure-function tests**

Create `spaceMemberAgentOptions.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { AGENT_ROLE_SCOPES, filterAvailableAgents } from './spaceMemberAgentOptions';

describe('space member agent options', () => {
  const agents = [
    { id: 'active-new', name: 'Active new', status: 'active', revokedAt: null },
    { id: 'active-existing', name: 'Active existing', status: 'active', revokedAt: null },
    { id: 'paused', name: 'Paused', status: 'paused', revokedAt: null },
    { id: 'revoked', name: 'Revoked', status: 'revoked', revokedAt: '2030-01-01T00:00:00.000Z' },
  ];

  it('returns only active agents without an existing space grant', () => {
    expect(filterAvailableAgents(agents, ['active-existing']).map((agent) => agent.id))
      .toEqual(['active-new']);
  });

  it('maps viewer and editor roles to the approved default scopes', () => {
    expect(AGENT_ROLE_SCOPES.viewer).toEqual(['pages:read', 'graph:read']);
    expect(AGENT_ROLE_SCOPES.editor).toEqual([
      'pages:read', 'pages:write', 'sources:read', 'graph:read', 'graph:write',
    ]);
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
pnpm --filter @agentwiki/client test -- src/features/space/spaceMemberAgentOptions.spec.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the pure rules**

Create `spaceMemberAgentOptions.ts`:

```ts
export type AgentMemberRole = 'viewer' | 'editor';

export interface AgentOption {
  id: string;
  name: string;
  status: string;
  revokedAt?: string | null;
}

export const AGENT_ROLE_SCOPES: Record<AgentMemberRole, string[]> = {
  viewer: ['pages:read', 'graph:read'],
  editor: ['pages:read', 'pages:write', 'sources:read', 'graph:read', 'graph:write'],
};

export function filterAvailableAgents(
  agents: AgentOption[],
  existingAgentIds: string[],
): AgentOption[] {
  const existing = new Set(existingAgentIds);
  return agents.filter((agent) =>
    agent.status === 'active' && !agent.revokedAt && !existing.has(agent.id));
}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
pnpm --filter @agentwiki/client test -- src/features/space/spaceMemberAgentOptions.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add agentwiki/apps/client/src/features/space/spaceMemberAgentOptions.ts \
  agentwiki/apps/client/src/features/space/spaceMemberAgentOptions.spec.ts
git commit -m "feat: define space agent member presets"
```

---

### Task 3: Build the unified Add member dialog

**Files:**
- Create: `apps/client/src/features/space/AddSpaceMemberDialog.tsx`
- Test: `apps/client/src/features/space/AddSpaceMemberDialog.spec.tsx`

**Interfaces:**
- Consumes: `AGENT_ROLE_SCOPES`, `AgentMemberRole`, and `filterAvailableAgents` from Task 2.
- Produces:

```ts
export interface AddSpaceMemberDialogProps {
  spaceId: string;
  canGrantOwner: boolean;
  existingAgentIds: string[];
  zh: boolean;
  onClose: () => void;
  onAdded: () => Promise<void> | void;
}
```

- [ ] **Step 1: Write failing dialog tests**

Create `AddSpaceMemberDialog.spec.tsx`. Mock the API client and render inside `MemoryRouter`. Include these behaviors:

```tsx
it('keeps the existing human email flow', async () => {
  vi.mocked(api.get).mockResolvedValue({ data: [] } as any);
  renderDialog();
  fireEvent.change(screen.getByLabelText('用户邮箱 *'), { target: { value: 'member@example.com' } });
  fireEvent.click(screen.getByRole('button', { name: '添加' }));
  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/spaces/space-1/members', {
    email: 'member@example.com', role: 'viewer',
  }));
});

it('shows only active ungranted owned agents', async () => {
  vi.mocked(api.get).mockResolvedValue({ data: [
    { id: 'agent-new', name: 'New agent', status: 'active', revokedAt: null },
    { id: 'agent-existing', name: 'Existing agent', status: 'active', revokedAt: null },
    { id: 'agent-paused', name: 'Paused agent', status: 'paused', revokedAt: null },
  ] } as any);
  renderDialog({ existingAgentIds: ['agent-existing'] });
  fireEvent.click(screen.getByRole('button', { name: '智能体' }));
  expect(await screen.findByRole('option', { name: 'New agent' })).toBeInTheDocument();
  expect(screen.queryByRole('option', { name: 'Existing agent' })).not.toBeInTheDocument();
  expect(screen.queryByRole('option', { name: 'Paused agent' })).not.toBeInTheDocument();
});

it('adds an editor agent with editor default scopes', async () => {
  vi.mocked(api.get).mockResolvedValue({ data: [
    { id: 'agent-new', name: 'New agent', status: 'active', revokedAt: null },
  ] } as any);
  renderDialog();
  fireEvent.click(screen.getByRole('button', { name: '智能体' }));
  await screen.findByRole('option', { name: 'New agent' });
  fireEvent.change(screen.getByLabelText('智能体角色'), { target: { value: 'editor' } });
  fireEvent.click(screen.getByRole('button', { name: '添加智能体' }));
  await waitFor(() => expect(api.put).toHaveBeenCalledWith('/agents/agent-new/grants/space-1', {
    role: 'editor',
    scopes: ['pages:read', 'pages:write', 'sources:read', 'graph:read', 'graph:write'],
  }));
});
```

Add these explicit edge-case tests in the same file:

```tsx
it('exposes the selected member mode accessibly', async () => {
  vi.mocked(api.get).mockResolvedValue({ data: [] } as any);
  renderDialog();
  const human = screen.getByRole('button', { name: '用户' });
  const agent = screen.getByRole('button', { name: '智能体' });
  expect(human).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(agent);
  expect(agent).toHaveAttribute('aria-pressed', 'true');
  expect(human).toHaveAttribute('aria-pressed', 'false');
});

it('renders an empty state and disables agent submission', async () => {
  vi.mocked(api.get).mockResolvedValue({ data: [] } as any);
  renderDialog();
  fireEvent.click(screen.getByRole('button', { name: '智能体' }));
  expect(await screen.findByText('没有可添加的智能体')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: '前往智能体管理' })).toHaveAttribute('href', '/agents');
  expect(screen.getByRole('button', { name: '添加智能体' })).toBeDisabled();
});

it('shows a retry action when loading agents fails', async () => {
  vi.mocked(api.get).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ data: [] } as any);
  renderDialog();
  fireEvent.click(screen.getByRole('button', { name: '智能体' }));
  fireEvent.click(await screen.findByRole('button', { name: '重试' }));
  await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
});

it('keeps the dialog open when the grant request fails', async () => {
  vi.mocked(api.get).mockResolvedValue({ data: [
    { id: 'agent-new', name: 'New agent', status: 'active', revokedAt: null },
  ] } as any);
  vi.mocked(api.put).mockRejectedValue(new Error('failed'));
  renderDialog();
  fireEvent.click(screen.getByRole('button', { name: '智能体' }));
  await screen.findByRole('option', { name: 'New agent' });
  fireEvent.click(screen.getByRole('button', { name: '添加智能体' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('智能体添加失败');
  expect(screen.getByRole('dialog')).toBeInTheDocument();
});

it('renders equivalent English controls', async () => {
  vi.mocked(api.get).mockResolvedValue({ data: [] } as any);
  renderDialog({ zh: false });
  expect(screen.getByRole('button', { name: 'User' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Agent' }));
  expect(await screen.findByText('No available agents')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Add agent' })).toBeDisabled();
});
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
pnpm --filter @agentwiki/client test -- src/features/space/AddSpaceMemberDialog.spec.tsx
```

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement the focused dialog**

Implement `AddSpaceMemberDialog.tsx` with these state contracts:

```ts
type MemberMode = 'human' | 'agent';
const [mode, setMode] = useState<MemberMode>('human');
const [email, setEmail] = useState('');
const [humanRole, setHumanRole] = useState('viewer');
const [agents, setAgents] = useState<AgentOption[]>([]);
const [agentId, setAgentId] = useState('');
const [agentRole, setAgentRole] = useState<AgentMemberRole>('viewer');
const [loadingAgents, setLoadingAgents] = useState(false);
const [submitting, setSubmitting] = useState(false);
const [error, setError] = useState<string | null>(null);
```

Load and filter Agents with:

```ts
const loadAgents = async () => {
  setLoadingAgents(true);
  setError(null);
  try {
    const response = await api.get('/agents');
    const available = filterAvailableAgents(response.data, existingAgentIds);
    setAgents(available);
    setAgentId((current) => available.some((agent) => agent.id === current)
      ? current
      : available[0]?.id ?? '');
  } catch {
    setError(zh ? '智能体加载失败' : 'Failed to load agents');
  } finally {
    setLoadingAgents(false);
  }
};
```

Call `loadAgents()` once when the dialog mounts so the Agent candidates load while the human form remains usable, and reuse it for retry:

```ts
useEffect(() => {
  void loadAgents();
}, [spaceId]);

const switchMode = (nextMode: MemberMode) => {
  setMode(nextMode);
  setError(null);
};
```

Submit through two explicit branches:

```ts
if (mode === 'human') {
  await api.post(`/spaces/${spaceId}/members`, { email: email.trim(), role: humanRole });
} else {
  await api.put(`/agents/${agentId}/grants/${spaceId}`, {
    role: agentRole,
    scopes: AGENT_ROLE_SCOPES[agentRole],
  });
}
await onAdded();
onClose();
```

Render requirements:

- dialog heading “添加成员” / “Add member”;
- two buttons “用户” / “User” and “智能体” / “Agent”, each with `aria-pressed`;
- existing human email and owner/admin/editor/viewer role fields in Human mode;
- Agent select, viewer/editor select, and a read-only scope summary in Agent mode;
- `/agents` link when there are no available Agents;
- retry button when loading fails;
- cancel and mode-specific submit buttons.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run:

```bash
pnpm --filter @agentwiki/client test -- src/features/space/AddSpaceMemberDialog.spec.tsx
```

Expected: all dialog tests pass.

- [ ] **Step 5: Commit**

```bash
git add agentwiki/apps/client/src/features/space/AddSpaceMemberDialog.tsx \
  agentwiki/apps/client/src/features/space/AddSpaceMemberDialog.spec.tsx
git commit -m "feat: add unified user and agent member dialog"
```

---

### Task 4: Integrate the dialog into Space members

**Files:**
- Modify: `apps/client/src/features/space/SpaceMembers.tsx`
- Create: `apps/client/src/features/space/SpaceMembers.spec.tsx`

**Interfaces:**
- Consumes: `AddSpaceMemberDialogProps` from Task 3.
- Produces: the existing `/spaces/:id/members` page with a unified Add member dialog.

- [ ] **Step 1: Write the failing integration test**

Create `SpaceMembers.spec.tsx`, mock `useAuth`, `useLanguage`, `SpaceNav`, and the API client, and render the route `/spaces/space-1/members`.

```tsx
it('opens the unified dialog for an owner and excludes existing agent grants', async () => {
  vi.mocked(api.get)
    .mockResolvedValueOnce({ data: [
      { id: 'owner-member', type: 'human', userId: 'user-1', role: 'owner', user: { id: 'user-1', email: 'owner@example.com', name: 'Owner', type: 'human' } },
      { id: 'grant-1', type: 'agent', agentId: 'agent-existing', role: 'viewer', scopes: ['pages:read'], agent: { id: 'agent-existing', name: 'Existing', status: 'active' } },
    ] } as any)
    .mockResolvedValueOnce({ data: [
      { id: 'agent-existing', name: 'Existing', status: 'active', revokedAt: null },
      { id: 'agent-new', name: 'New', status: 'active', revokedAt: null },
    ] } as any);

  renderMembers();
  fireEvent.click(await screen.findByRole('button', { name: '添加成员' }));
  fireEvent.click(screen.getByRole('button', { name: '智能体' }));

  expect(await screen.findByRole('option', { name: 'New' })).toBeInTheDocument();
  expect(screen.queryByRole('option', { name: 'Existing' })).not.toBeInTheDocument();
});
```

Add a second test with the current user as `editor` and assert that “添加成员” is absent.

- [ ] **Step 2: Run the integration test and verify RED**

Run:

```bash
pnpm --filter @agentwiki/client test -- src/features/space/SpaceMembers.spec.tsx
```

Expected: FAIL because `SpaceMembers` still renders its inline human-only modal.

- [ ] **Step 3: Replace the inline modal**

In `SpaceMembers.tsx`:

- import `AddSpaceMemberDialog`;
- remove `addForm`, `adding`, and `handleAdd`;
- retain `showAdd`;
- compute existing Agent IDs:

```ts
const existingAgentIds = members
  .filter((member) => member.type === 'agent' && member.agentId)
  .map((member) => member.agentId as string);
```

- replace the inline modal with:

```tsx
{showAdd && id ? (
  <AddSpaceMemberDialog
    spaceId={id}
    canGrantOwner={canGrantOwner}
    existingAgentIds={existingAgentIds}
    zh={zh}
    onClose={() => setShowAdd(false)}
    onAdded={fetchMembers}
  />
) : null}
```

- update the page description to mention users and Agents in both languages:

```tsx
{zh
  ? '管理可以访问此空间的用户、智能体及其权限。'
  : 'Manage users, Agents, and permissions for this space.'}
```

- [ ] **Step 4: Run focused and full client tests**

Run:

```bash
pnpm --filter @agentwiki/client test -- src/features/space/SpaceMembers.spec.tsx
pnpm --filter @agentwiki/client test
```

Expected: focused integration tests and the full client suite pass.

- [ ] **Step 5: Run repository quality gates**

Run:

```bash
pnpm typecheck
pnpm lint
pnpm build
git diff --check
```

Expected: all commands exit 0. The Node 26 contract must be run with the repository-declared Node 26 runtime.

- [ ] **Step 6: Commit**

```bash
git add agentwiki/apps/client/src/features/space/SpaceMembers.tsx \
  agentwiki/apps/client/src/features/space/SpaceMembers.spec.tsx
git commit -m "feat: add agents from the space member page"
```

---

### Task 5: Browser verification of the complete member workflow

**Files:**
- Modify only files required by failures discovered in this task.

**Interfaces:**
- Consumes: the complete server and client implementation from Tasks 1-4.
- Produces: verified desktop and 390×844 mobile behavior with no console errors or horizontal overflow.

- [ ] **Step 1: Start the real local stack**

Run with the repository Node 26 runtime:

```bash
cd agentwiki
pnpm dev
```

Expected: frontend on `http://localhost:5173`, API health on `http://localhost:3000/api/health`, and Redis/PostgreSQL healthy.

- [ ] **Step 2: Verify owner/admin Agent addition in the browser**

Using the real authenticated system:

1. Open a Space Members page as owner.
2. Open Add member and switch to Agent.
3. Confirm only the signed-in user's active, ungranted Agents appear.
4. Add one as Viewer and verify its card shows two default scopes.
5. Remove the grant, add it as Editor, and verify five default scopes.
6. Expand scope settings and confirm existing fine-grained editing still works.
7. Repeat the add flow as Space admin.

Expected: every mutation succeeds, refreshes the list once, and leaves no duplicate card.

- [ ] **Step 3: Verify errors and responsive layout**

1. Pause an Agent before submitting and confirm the server rejects the grant with the active-Agent message.
2. Add all eligible Agents and confirm the empty state plus `/agents` link.
3. Verify a Space editor cannot see Add member.
4. Switch the application to English and repeat opening both modes.
5. Test desktop and 390×844; confirm no modal clipping or horizontal scrolling.
6. Check browser console for errors.

Expected: stable bilingual error/empty states, no overflow, and no console errors.

- [ ] **Step 4: Re-run final automated gates after any browser fix**

Run:

```bash
pnpm --filter @agentwiki/server test
pnpm --filter @agentwiki/client test
pnpm typecheck
pnpm lint
pnpm build
git diff --check
```

Expected: all gates pass.

- [ ] **Step 5: Commit only if browser verification required fixes**

If browser verification changed any implementation, stage only the known feature files and commit:

```bash
git add agentwiki/apps/server/src/core/agent/agent.service.ts \
  agentwiki/apps/server/src/core/agent/agent.service.spec.ts \
  agentwiki/apps/client/src/features/space/spaceMemberAgentOptions.ts \
  agentwiki/apps/client/src/features/space/spaceMemberAgentOptions.spec.ts \
  agentwiki/apps/client/src/features/space/AddSpaceMemberDialog.tsx \
  agentwiki/apps/client/src/features/space/AddSpaceMemberDialog.spec.tsx \
  agentwiki/apps/client/src/features/space/SpaceMembers.tsx \
  agentwiki/apps/client/src/features/space/SpaceMembers.spec.tsx
git diff --cached --check
git commit -m "fix: polish space agent member workflow"
```

If browser verification required no changes, skip this commit.
