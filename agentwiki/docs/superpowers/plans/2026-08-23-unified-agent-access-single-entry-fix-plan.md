# Agent Unified Access Single-Entry Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `Space + reader | editor | publisher` in the connection card the only Agent authorization input, with credentials created only by connection exchange and displayed only as revocable connection records.

**Architecture:** Keep the existing atomic connection-intent exchange as the sole Credential minting path. Remove the manual Credential creation API and the Agent-detail Grant/Credential edit forms; keep Space membership administration APIs for the Space Members workflow and keep read-only/revoke records on the Agent page.

**Tech Stack:** TypeScript, React 18, Vite, Vitest, NestJS 10, Jest, Prisma 5, `@neomei/agentwiki-sync-protocol`.

## Global Constraints

- The only Agent roles are exactly `reader`, `editor`, and `publisher`.
- The Agent access page contains exactly one editable role selector, inside the unified connection authorization card.
- Connection exchange remains the only Agent Credential creation path and atomically applies the same role to Credential and Space Grant.
- Existing Credentials and Grants may be inspected and revoked, but cannot be independently created or assigned a role from the Agent access page.
- Space Members keeps its role-management workflow and existing Grant API because it manages Space membership, not connection credentials.
- No Agent role contains `review:decide`; Agents cannot approve changes or manage members.
- Do not push, publish npm, or deploy production without separate explicit user authorization.

---

### Task 1: Lock the Single-Entry Product Contract

**Files:**
- Modify: `agentwiki/apps/client/src/features/agent/AgentDetail.spec.tsx`
- Modify: `agentwiki/apps/server/src/core/agent/agent.controller.spec.ts`

**Interfaces:**
- Consumes: the existing Agent detail response with `grants` and `credentials`.
- Produces: regression tests for one editable role selector and absence of `POST /agents/:id/credentials`.

- [ ] **Step 1: Replace the old three-section UI tests with a failing single-entry test**

Assert that the Access tab has one `Agent 角色` combobox, has no `授权` or `创建凭据` button, and still displays existing Grant/Credential records with revoke actions.

- [ ] **Step 2: Add a failing controller surface test**

Read `Reflect.getMetadata('path', AgentController.prototype.createCredential)` only if the method exists and assert that `AgentController.prototype` has no `createCredential` member. This must fail against the current public manual credential route.

- [ ] **Step 3: Run RED**

Run:

```bash
cd agentwiki
pnpm --filter @agentwiki/client exec vitest run src/features/agent/AgentDetail.spec.tsx
pnpm --filter @agentwiki/server exec jest --runInBand src/core/agent/agent.controller.spec.ts
```

Expected: both suites fail because the UI and controller still expose independent authorization paths.

---

### Task 2: Remove Manual Credential Minting

**Files:**
- Modify: `agentwiki/apps/server/src/core/dto/agent.dto.ts`
- Modify: `agentwiki/apps/server/src/core/dto/agent.dto.spec.ts`
- Modify: `agentwiki/apps/server/src/core/agent/agent.controller.ts`
- Modify: `agentwiki/apps/server/src/core/agent/agent.service.ts`
- Modify: `agentwiki/apps/server/src/core/agent/agent.service.spec.ts`
- Modify: `agentwiki/README.md`
- Modify: `agentwiki/docs/TESTING_GUIDE.md`

**Interfaces:**
- Removes: `CreateAgentCredentialDto`, `AgentController.createCredential`, and `AgentService.createCredential`.
- Retains: connection exchange Credential creation, Credential listing, and credential lifecycle revoke.

- [ ] **Step 1: Remove the public DTO, controller route, and service method**

Delete only the manual signing path. Keep `listCredentials`, `revokeCredentialAndReceipts`, and `exchangeConnectionIntent` unchanged.

- [ ] **Step 2: Remove obsolete unit tests and documentation**

Delete tests that call `createCredential`; retain DTO rejection coverage for Grant roles/scopes. Replace README and testing-guide instructions with the unified connection installation endpoint and explain that the key is produced only during exchange.

- [ ] **Step 3: Run GREEN for server boundaries**

Run:

```bash
cd agentwiki
pnpm --filter @agentwiki/server exec jest --runInBand src/core/agent/agent.controller.spec.ts src/core/agent/agent.service.spec.ts src/core/dto/agent.dto.spec.ts src/core/agent/local-sync-installation.service.spec.ts
pnpm --filter @agentwiki/server exec tsc --noEmit
```

Expected: all selected suites pass and TypeScript reports no errors.

---

### Task 3: Collapse the Agent Access Page

**Files:**
- Modify: `agentwiki/apps/client/src/features/agent/AgentDetail.tsx`
- Modify: `agentwiki/apps/client/src/features/agent/AgentDetail.spec.tsx`
- Modify: `agentwiki/apps/client/src/i18n/messages.ts`

**Interfaces:**
- Consumes: `LocalSyncInstallCard` as the only editable `Space + role` authorization form.
- Produces: read-only/revoke lists for Space grants and connection credentials.

- [ ] **Step 1: Remove duplicate local state and mutations**

Delete the independent Grant form, Grant role updater, Credential form, key-copy state, and `POST /credentials` call from `AgentDetail`.

- [ ] **Step 2: Render one authorization card followed by records**

Render `LocalSyncInstallCard` first. Under it, display Space authorization rows as name + role badge + remove button and connection rows as lifecycle diagnostics + revoke button. Do not render any role selector outside `LocalSyncInstallCard`.

- [ ] **Step 3: Use product copy that exposes one model**

Rename headings to `Agent 接入与授权`, `已授权空间`, and `连接记录` (plus English equivalents). Remove manual-key help and creation/copy strings if no remaining consumer uses them.

- [ ] **Step 4: Run GREEN for the client**

Run:

```bash
cd agentwiki
pnpm --filter @agentwiki/client exec vitest run src/features/agent/AgentDetail.spec.tsx src/features/agent/LocalSyncInstallCard.spec.tsx
pnpm --filter @agentwiki/client exec tsc --noEmit
pnpm --filter @agentwiki/client build
```

Expected: selected tests, typecheck, and build pass.

---

### Task 4: Migrate Repository Tests and Verify the Contract

**Files:**
- Modify: `agentwiki/scripts/smoke-test.mjs`
- Modify: `agentwiki/scripts/cross-machine-e2e.mjs`
- Modify: any current non-legacy source found by the static scan that still calls `POST /agents/:id/credentials`.

**Interfaces:**
- Consumes: the current connection-intent creation/exchange contract.
- Produces: repository tests that obtain Agent credentials only through unified connection exchange.

- [ ] **Step 1: Replace direct credential minting in current smoke scripts**

Use the existing local-sync installation/onboarding helper or add a focused helper that creates an installation for `spaceId + role` and exchanges it. Do not add a test-only production Credential route.

- [ ] **Step 2: Run static contract scans**

Run:

```bash
cd agentwiki
rg -n "createCredential|CreateAgentCredentialDto|POST /agents/:id/credentials|/agents/.*/credentials" apps packages scripts README.md docs/TESTING_GUIDE.md
```

Expected: no manual creation implementation or current documentation remains; list/revoke paths are allowed.

- [ ] **Step 3: Run repository gates**

Run the full server and client suites, repository typecheck/lint/build gates, Prisma validation, local-sync tests, and the existing clean-package installation verification.

- [ ] **Step 4: Review the rendered Access tab**

Run the app locally and verify at desktop and 390px width that the page has one role selector, no manual Credential form, readable records, and no overflow.

- [ ] **Step 5: Update verification evidence and project memory**

Record exact commands and counts in `agentwiki/docs/verification/unified-agent-access-roles-0.5.0.md`, then update `.codex-memory/current.md` and the active task brief/decisions/refs with the corrected single-entry contract.
