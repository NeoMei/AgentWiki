# User-Owned Agent Space Delegation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Allow any human Space member to grant a Space they belong to to an Agent they own, with a role ceiling derived from that human membership and no privilege escalation.

**Architecture:** Keep human membership and AgentGrant records separate. Add a server-side mapping from human Space roles to the maximum Agent access role in the Agent service, apply it to grant mutations and local-sync connection issuance, and expose only the bounded choices in the client. Owner/admin users keep the existing ability to manage their own Agents; non-admin members may manage only Agents they own and only within their ceiling.

**Tech Stack:** NestJS, Prisma, TypeScript, React, Vitest, Jest, `@neomei/agentwiki-sync-protocol`.

**Spec:** This plan implements the approved user requirement from the current conversation: a user invited to a Space may bring their own Agent to act for them; the default is the user-equivalent maximum, lower roles are allowed, higher roles are rejected.

## Global Constraints

- `viewer` maps to maximum Agent role `reader`; `editor` maps to `editor`; `admin` and `owner` map to `publisher` because publisher is the highest content role and still cannot manage members or approve reviews.
- Every grant and connection issuance is checked server-side against the live human membership and Agent ownership; client filtering is advisory only.
- A member may never grant or connect an Agent they do not own, and may never request a role above their mapped maximum.
- Preserve the existing owner/admin behavior and existing AgentGrant audit records.
- Do not change Agent authorization for Agent principals, human page-write gates, or credential space isolation.
- Use existing API shapes where possible; do not add a second credential model.

---

### Task 1: Shared delegation policy and server grant authorization

**Files:**
- Modify: `agentwiki/apps/server/src/core/agent/agent.service.ts`
- Modify: `agentwiki/apps/server/src/core/agent/agent.controller.ts`
- Test: `agentwiki/apps/server/src/core/agent/agent.service.spec.ts`
- Test: `agentwiki/apps/server/src/core/agent/agent.controller.spec.ts`

**Interfaces:**
- Keep the role ceiling mapping and check in the server Agent authorization path.
- Extend grant mutation authorization with the live actor Space role while retaining the existing Agent ownership check.

- [x] **Step 1: Write failing service tests**

Add cases covering:

```ts
await service.upsertGrantForSpace('editor-1', 'agent-1', 'space-1', 'editor', false, 'editor');
await expect(service.upsertGrantForSpace('editor-1', 'agent-1', 'space-1', 'publisher', false, 'editor'))
  .rejects.toThrow('Agent role exceeds the human member role');
await expect(service.upsertGrantForSpace('editor-1', 'other-agent', 'space-1', 'editor', false, 'editor'))
  .rejects.toThrow('You do not own this agent');
await service.upsertGrantForSpace('viewer-1', 'agent-1', 'space-1', 'reader', false, 'viewer');
await expect(service.upsertGrantForSpace('viewer-1', 'agent-1', 'space-1', 'editor', false, 'viewer'))
  .rejects.toThrow('Agent role exceeds the human member role');
```

Also cover `admin`/`owner` accepting `publisher` and retain existing owner/admin mutation tests.

- [x] **Step 2: Run the focused server test and verify the new cases fail**

Run:

```bash
pnpm --dir agentwiki --filter @agentwiki/server exec jest src/core/agent/agent.service.spec.ts src/core/agent/agent.controller.spec.ts --runInBand
```

Expected: the new delegation tests fail because grant mutations still require Space administration and have no human-role ceiling.

- [x] **Step 3: Implement the policy and mutation path**

Add the role mapping and ceiling assertion in the Agent service. Change the controller to authenticate any human Space member for the grant route, read the returned live membership role, and pass it to the service. Keep `getOwned(actorUserId, agentId)` as the ownership boundary. The service must re-check the membership role inside its transaction before `AgentGrant.upsert`, and reject a requested role above the ceiling before writing or auditing.

- [x] **Step 4: Run focused server tests**

Run the command from Step 2. Expected: all existing and new grant/controller tests pass.

- [x] **Step 5: Commit**

```bash
git add agentwiki/apps/server/src/core/agent/agent.service.ts agentwiki/apps/server/src/core/agent/agent.controller.ts agentwiki/apps/server/src/core/agent/agent.service.spec.ts agentwiki/apps/server/src/core/agent/agent.controller.spec.ts
git commit -m "feat: let members delegate owned agents within role ceiling"
```

---

### Task 2: Apply the same ceiling to local-sync connection issuance

**Files:**
- Modify: `agentwiki/apps/server/src/core/agent/agent.service.ts`
- Modify: `agentwiki/apps/server/src/core/agent/local-sync-installation.service.ts`
- Modify: `agentwiki/apps/server/src/core/agent/local-sync-installation.controller.ts`
- Test: `agentwiki/apps/server/src/core/agent/agent.service.spec.ts`
- Test: `agentwiki/apps/server/src/core/agent/local-sync-installation.service.spec.ts`
- Test: `agentwiki/apps/server/src/core/agent/local-sync-installation.controller.spec.ts`

**Interfaces:**
- Extend `assertCanIssueConnection` and the installation creation path with the authenticated human member role.
- Keep the installation payload and one-credential-per-space behavior unchanged.

- [x] **Step 1: Write failing connection authorization tests**

Cover an editor issuing an `editor` connection successfully, an editor requesting `publisher` being rejected, a viewer requesting `reader` succeeding, a viewer requesting `editor` being rejected, and a nonmember being rejected. Retain the existing owner/admin and super-admin tests.

- [x] **Step 2: Run focused installation tests and verify failure**

```bash
pnpm --dir agentwiki --filter @agentwiki/server exec jest src/core/agent/agent.service.spec.ts src/core/agent/local-sync-installation.service.spec.ts src/core/agent/local-sync-installation.controller.spec.ts --runInBand
```

Expected: new member-connection tests fail because issuance currently requires owner/admin.

- [x] **Step 3: Implement live membership and ceiling checks**

Make the controller obtain the actor’s live membership role for the target Space. Pass it through the service. In `assertCanIssueConnection` and the transactional `exchangeConnectionIntent` revalidation, require that the Agent is owned by the actor, the actor is a live Space member, and the requested Agent role is at or below the mapped ceiling. Keep the existing transaction locks and audit behavior.

- [x] **Step 4: Run focused installation tests**

Run the command from Step 2. Expected: all pass.

- [x] **Step 5: Commit**

```bash
git add agentwiki/apps/server/src/core/agent/agent.service.ts agentwiki/apps/server/src/core/agent/local-sync-installation.service.ts agentwiki/apps/server/src/core/agent/local-sync-installation.controller.ts agentwiki/apps/server/src/core/agent/agent.service.spec.ts agentwiki/apps/server/src/core/agent/local-sync-installation.service.spec.ts agentwiki/apps/server/src/core/agent/local-sync-installation.controller.spec.ts
git commit -m "feat: bound Agent connections to member role"
```

---

### Task 3: Bounded Space member UI

**Files:**
- Modify: `agentwiki/apps/client/src/features/space/SpaceMembers.tsx`
- Modify: `agentwiki/apps/client/src/features/space/AddSpaceMemberDialog.tsx`
- Modify: `agentwiki/apps/client/src/features/agent/AgentDetail.tsx`
- Modify: `agentwiki/apps/client/src/features/agent/LocalSyncInstallCard.tsx`
- Modify: `agentwiki/apps/client/src/i18n/messages.ts`
- Test: `agentwiki/apps/client/src/features/space/SpaceMembers.spec.tsx`
- Test: `agentwiki/apps/client/src/features/space/AddSpaceMemberDialog.spec.tsx`
- Test: `agentwiki/apps/client/src/features/agent/AgentDetail.spec.tsx`
- Test: `agentwiki/apps/client/src/features/agent/LocalSyncInstallCard.spec.tsx`

**Interfaces:**
- Use the same role-ceiling mapping in a small client helper for display and option filtering.
- Space members page must show “添加成员” for any human member who owns at least one eligible active Agent, while human-member role management remains owner/admin-only.
- Agent detail and local-sync installation controls must list all Spaces where the current human is a member, but offer only roles at or below that membership ceiling.

- [x] **Step 1: Add failing UI tests**

Cover an editor seeing the Agent tab and only Reader/Editor options with Editor selected by default, a viewer seeing only Reader, a publisher option remaining available to owner/admin, an editor’s own Agent grant being removable or downgradable while another owner’s Agent remains read-only, and Agent detail listing an invited editor Space.

- [x] **Step 2: Run focused client tests and verify failure**

```bash
pnpm --dir agentwiki --filter @agentwiki/client exec vitest run src/features/space/SpaceMembers.spec.tsx src/features/space/AddSpaceMemberDialog.spec.tsx src/features/agent/AgentDetail.spec.tsx src/features/agent/LocalSyncInstallCard.spec.tsx
```

Expected: new member and role-ceiling tests fail because the current UI hides the Add member entry from editors and filters Agent spaces to owner/admin.

- [x] **Step 3: Implement the UI policy**

Expose the Agent mode to eligible members based on owned active Agents, calculate the maximum role from the current human membership, default to that maximum, and filter options above it. Keep the human tab and human role controls owner/admin-only. Show clear Chinese and English text that the Agent acts with the user’s Space role and cannot be granted a higher role.

- [x] **Step 4: Run focused client tests**

Run the command from Step 2. Expected: all pass.

- [x] **Step 5: Commit**

```bash
git add agentwiki/apps/client/src/features/space/SpaceMembers.tsx agentwiki/apps/client/src/features/space/AddSpaceMemberDialog.tsx agentwiki/apps/client/src/features/agent/AgentDetail.tsx agentwiki/apps/client/src/features/agent/LocalSyncInstallCard.tsx agentwiki/apps/client/src/i18n/messages.ts agentwiki/apps/client/src/features/space/SpaceMembers.spec.tsx agentwiki/apps/client/src/features/space/AddSpaceMemberDialog.spec.tsx agentwiki/apps/client/src/features/agent/AgentDetail.spec.tsx agentwiki/apps/client/src/features/agent/LocalSyncInstallCard.spec.tsx
git commit -m "feat: expose bounded Agent delegation to Space members"
```

---

### Task 4: Integration verification and documentation

**Files:**
- Modify: `agentwiki/docs/TESTING_GUIDE.md`
- Modify: `agentwiki/apps/client/src/features/about/UsageGuide.tsx`
- Test: existing server/client suites and a focused HTTP authorization test if needed

- [x] **Step 1: Document the two entry points and ceiling**

Explain that any human Space member can add only their own active Agent, that the default role equals the member’s maximum, lower roles are allowed, higher roles are rejected, and Agent roles do not gain member management or review approval powers.

- [x] **Step 2: Run focused server and client suites**

Run the Task 1–3 commands together and inspect failures.

- [x] **Step 3: Run typecheck and lint for changed packages**

```bash
pnpm --dir agentwiki --filter @agentwiki/server typecheck
pnpm --dir agentwiki --filter @agentwiki/client exec tsc --noEmit
pnpm --dir agentwiki --filter @agentwiki/client lint
```

- [x] **Step 4: Run the relevant HTTP/e2e authorization test**

Run the existing space/Agent UI or HTTP authorization test that covers the route used by the changed flow, then record the exact command and result.

- [x] **Step 5: Commit documentation and verification changes**

```bash
git add agentwiki/docs/TESTING_GUIDE.md agentwiki/apps/client/src/features/about/UsageGuide.tsx
git commit -m "docs: explain member-owned Agent delegation"
```
