# Agent Self-Service Onboarding and Unified Gateway Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `@neomei/agentwiki-local-sync@0.3.0` so one pinned command can complete web authorization, deterministic form collection, one unified local `agentwiki` MCP installation, first local scan, preview confirmation, and first sync.

**Architecture:** Add a first-party Device Auth and idempotent bootstrap flow to the NestJS server. Replace the public 0.2.9 dual-MCP/connect surface with one stdio gateway whose static registry binds `wiki_*` tools to a remote MCP bridge, `local_*` tools to local adapters, and `knowledge_*` tools to high-level local/remote workflows. Drive the installation with an NDJSON state machine, persist non-secret checkpoints, write client configuration atomically, and independently verify the gateway before declaring completion.

**Tech Stack:** NestJS 10, Prisma 5/PostgreSQL, Redis, React 18, Vite, TypeScript, Model Context Protocol SDK 1.30, Zod 3, Jest, Vitest, Testing Library, Playwright, Node test runner.

## Global Constraints

- The public command is exactly:

  ```bash
  npx --yes @neomei/agentwiki-local-sync@0.3.0 onboard --server https://agentwiki.quukk.com/api --protocol ndjson
  ```

- Passwords, Google credentials, human JWTs, Agent API keys, raw source files, and local paths never enter the server plan or NDJSON output.
- `serverPlan` is uploaded only after its hash is confirmed; `localPlan` never leaves the machine.
- The three human actions are web authorization, onboarding plan confirmation, and sync preview confirmation.
- One client receives one stdio MCP named `agentwiki`. There is no direct remote MCP entry, second local MCP entry, `connect` command, remote-only branch, old tool alias, or old checkpoint migration.
- Existing 0.2.9 files remain untouched until 0.3 onboarding is confirmed. At install time, the complete old client configuration and `~/.agentwiki` directory are archived before the clean 0.3 state is activated.
- Credential Scope, Space Grant, Agent status, Space role, Space Policy, ChangeSet, and approval rules remain authoritative.
- Every external operation has a deadline, every wait emits an event within five seconds, and cancellation terminates the process group.
- Every task follows RED → minimal implementation → GREEN → focused commit. Do not batch several unchecked tasks into one commit.

## Public Contracts

### HTTP

| Method | Path | Authentication | Purpose |
| --- | --- | --- | --- |
| `POST` | `/api/onboard/device/start` | public + rate limit | Create a device session |
| `GET` | `/api/onboard/device/session?userCode=...` | public + rate limit | Show non-sensitive authorization context |
| `POST` | `/api/onboard/device/decision` | human JWT | Approve or deny the device session |
| `POST` | `/api/onboard/device/poll` | public + rate limit | Poll for a one-use onboarding token |
| `POST` | `/api/onboard/bootstrap` | onboarding token + idempotency key | Create/reuse server resources and issue an installation code |

### Gateway tools

- Control: `onboard_status`.
- Remote: every compatible server tool is exposed as `wiki_<remote-name>`.
- Local: `local_scan_sources`, `local_read_artifacts`.
- Hybrid: `knowledge_prepare`, `knowledge_confirm_and_sync`, `knowledge_pull`.
- The old `start_knowledge_job`, `get_next_work_item`, `read_artifacts`, `submit_organized_item`, `validate_knowledge_job`, `preview_knowledge_job`, `confirm_and_push`, `pull_space`, and `resolve_conflict` names are not registered.

### Stable failure codes

`AUTH_DENIED`, `AUTH_EXPIRED`, `PROTOCOL_UNSUPPORTED`, `CLIENT_UNSUPPORTED`, `CONFIG_NOT_WRITABLE`, `CONFIG_CONFLICT`, `PACKAGE_INTEGRITY_FAILED`, `MCP_HANDSHAKE_FAILED`, `TOOLSET_MISMATCH`, `REMOTE_UNAVAILABLE`, `SCAN_FAILED`, `CONFIRMATION_REQUIRED`, `PREVIEW_CHANGED`, `SYNC_CONFLICT`, and `SYNC_FAILED` are public protocol values. Tests must assert the code, retryability, resume session, and redacted next action instead of matching free-form messages.

---

## Milestone 1 — Device Auth, bootstrap, and protocol foundations

### Task 1: Add the server-side onboarding persistence and DTO contract

**Files:**
- Modify: `apps/server/prisma/schema.prisma`
- Create: `apps/server/prisma/migrations/20260810000000_add_onboarding_device_sessions/migration.sql`
- Create: `apps/server/src/onboard/onboard.types.ts`
- Create: `apps/server/src/onboard/onboard.dto.ts`
- Create: `apps/server/src/onboard/onboard.dto.spec.ts`

**Interfaces:**
- Produces `OnboardingDeviceSession`, `OnboardingBootstrap`, `ServerPlan`, permission presets, and validated start/poll/decision/bootstrap DTOs.
- Consumed by Tasks 2 and 3.

- [ ] **Step 1: Write failing DTO and plan-normalization tests**

  Cover exact version validation, supported clients, unknown-field rejection, create/existing Space variants, preset scopes, approval modes, and canonical hashing. The canonical plan helper must sort object keys and scope arrays before hashing.

  ```ts
  expect(normalizeServerPlan({
    space: { mode: 'create', name: '研发知识库' },
    agentName: 'Codex',
    permissionPreset: 'editor',
    approvalMode: 'always-review',
    packageVersion: '0.3.0',
  })).toEqual(expect.objectContaining({
    scopes: ['graph:read', 'graph:write', 'pages:read', 'pages:write', 'sources:read', 'spaces:read'],
  }));
  ```

- [ ] **Step 2: Run the focused test and verify RED**

  ```bash
  pnpm --filter @agentwiki/server test -- src/onboard/onboard.dto.spec.ts
  ```

  Expected: FAIL because the DTO and contract modules do not exist.

- [ ] **Step 3: Add the Prisma models and migration**

  Add the user relation and these models, preserving only hashes of device/user codes and onboarding tokens:

  ```prisma
  // Add to User:
  onboardingSessions OnboardingDeviceSession[]

  model OnboardingDeviceSession {
    id                    String   @id @default(cuid())
    deviceCodeHash        String   @unique
    userCodeHash          String   @unique
    packageVersion        String
    clientType            String
    purpose               String
    requestedCapabilities String[]
    status                String   @default("pending")
    pollIntervalSeconds   Int      @default(5)
    pollCount             Int      @default(0)
    authorizedUserId      String?
    authorizedUser        User?    @relation(fields: [authorizedUserId], references: [id], onDelete: SetNull)
    approvedAt            DateTime?
    deniedAt              DateTime?
    expiresAt             DateTime
    onboardingTokenHash   String?  @unique
    tokenExpiresAt        DateTime?
    tokenConsumedAt       DateTime?
    bootstrap             OnboardingBootstrap?
    createdAt             DateTime @default(now())
    updatedAt             DateTime @updatedAt

    @@index([status, expiresAt])
    @@index([authorizedUserId, createdAt])
  }

  model OnboardingBootstrap {
    id                 String   @id @default(cuid())
    deviceSessionId    String   @unique
    deviceSession      OnboardingDeviceSession @relation(fields: [deviceSessionId], references: [id], onDelete: Cascade)
    idempotencyKeyHash String
    serverPlanHash     String
    status             String   @default("running")
    resourceIds        Json?
    resultHash         String?
    createdAt          DateTime @default(now())
    updatedAt          DateTime @updatedAt

    @@unique([deviceSessionId, idempotencyKeyHash])
  }
  ```

- [ ] **Step 4: Implement strict DTOs and the canonical plan helper**

  Define `PERMISSION_PRESETS` in one server module. `viewer`, `editor`, and `full` must map only to scopes already accepted by `AgentService.normalizeCredentialScopes`; bootstrap must reject any client-supplied `scopes` field.

- [ ] **Step 5: Validate schema and run tests**

  ```bash
  pnpm --filter @agentwiki/server exec prisma validate --schema prisma/schema.prisma
  pnpm --filter @agentwiki/server exec prisma generate --schema prisma/schema.prisma
  pnpm --filter @agentwiki/server test -- src/onboard/onboard.dto.spec.ts
  ```

  Expected: Prisma validates and all onboarding DTO tests pass.

- [ ] **Step 6: Commit**

  ```bash
  git add apps/server/prisma apps/server/src/onboard/onboard.types.ts apps/server/src/onboard/onboard.dto.ts apps/server/src/onboard/onboard.dto.spec.ts
  git commit -m "feat: define onboarding device contracts"
  ```

### Task 2: Implement Device Auth lifecycle, throttling, and one-use token issuance

**Files:**
- Create: `apps/server/src/onboard/onboard-device.service.ts`
- Create: `apps/server/src/onboard/onboard-device.service.spec.ts`
- Create: `apps/server/src/onboard/onboarding-token.guard.ts`
- Modify: `apps/server/src/onboard/onboard.controller.ts`
- Modify: `apps/server/src/onboard/onboard.module.ts`
- Modify: `apps/server/src/core/security/audit.service.ts` only if the existing audit action typing rejects new action names

**Interfaces:**
- Produces start/session/decision/poll endpoints and `request.onboarding` for bootstrap.
- Reuses `RedisService.incrementWithWindow`, `AuditService`, `JwtAuthGuard`, and `HumanOnlyGuard`.

- [ ] **Step 1: Write failing service tests**

  Test: 32-byte device entropy, hashed persistence, eight-character user code, five-second interval, ten-minute expiry, pending/slow-down/denied/expired responses, approval by a human user, one token returned once, token hash persistence, locked/deleted users denied, and per-IP/per-user/device rate limits.

  ```ts
  const started = await service.start({ packageVersion: '0.3.0', clientType: 'codex', purpose: 'full-onboarding' }, '127.0.0.1');
  expect(started.deviceCode).toMatch(/^awd_[A-Za-z0-9_-]{43}$/);
  expect(prisma.onboardingDeviceSession.create).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ deviceCodeHash: expect.not.stringContaining(started.deviceCode) }),
  }));
  ```

- [ ] **Step 2: Run focused tests and verify RED**

  ```bash
  pnpm --filter @agentwiki/server test -- src/onboard/onboard-device.service.spec.ts
  ```

- [ ] **Step 3: Implement the lifecycle**

  Use `randomBytes(32).toString('base64url')`, SHA-256 hashes, constant-time comparisons where raw values are compared, and database compare-and-swap updates on `status`. `poll` returns the raw onboarding token only on the first approved poll; later polls return `authorization_consumed`.

- [ ] **Step 4: Add controller routes and token guard**

  `OnboardingTokenGuard` accepts only an `awo_` bearer token, validates its hash/expiry/status, and attaches `{ sessionId, userId, packageVersion, requestedCapabilities }`. It must not delegate to the normal JWT/API-key guard. After the first successful bootstrap it may admit only an exact replay for the already-saved bootstrap record; it must reject a new mutation.

- [ ] **Step 5: Add HTTP contract tests**

  Extend `onboard-device.service.spec.ts` with a Nest test application proving public start/poll, JWT-only decision, no raw token/code in logs or database mocks, and stable business error codes.

- [ ] **Step 6: Run focused and full server tests**

  ```bash
  pnpm --filter @agentwiki/server test -- src/onboard/onboard-device.service.spec.ts
  pnpm --filter @agentwiki/server test
  ```

- [ ] **Step 7: Commit**

  ```bash
  git add apps/server/src/onboard apps/server/src/core/security/audit.service.ts
  git commit -m "feat: add onboarding device authorization"
  ```

### Task 3: Add transactional, idempotent onboarding bootstrap

**Files:**
- Create: `apps/server/src/onboard/onboard-bootstrap.service.ts`
- Create: `apps/server/src/onboard/onboard-bootstrap.service.spec.ts`
- Modify: `apps/server/src/onboard/onboard.controller.ts`
- Modify: `apps/server/src/onboard/onboard.module.ts`
- Modify: `apps/server/src/core/agent/local-sync-installation.service.ts`
- Modify: `apps/server/src/core/agent/local-sync-installation.service.spec.ts`

**Interfaces:**
- Consumes authenticated onboarding context, `Idempotency-Key`, confirmed `serverPlan`, and `serverPlanHash`.
- Produces Space/Agent/Grant IDs and a ten-minute one-use installation code; never returns an Agent API key.

- [ ] **Step 1: Write failing bootstrap tests**

  Cover create/reuse Space, create/reuse active Agent, preset grant scopes, `always-review` versus `scoped-auto-publish`, plan capability narrowing, wrong hash, missing idempotency key, identical replay, changed-plan replay rejection, concurrent replay, failure rollback, and token consumption only after a saved result exists.

  ```ts
  const first = await service.bootstrap(context, 'idem-1', plan, hashServerPlan(plan));
  const replay = await service.bootstrap(context, 'idem-1', plan, hashServerPlan(plan));
  expect(replay).toEqual(first);
  expect(prisma.space.create).toHaveBeenCalledTimes(1);
  expect(prisma.agent.create).toHaveBeenCalledTimes(1);
  ```

- [ ] **Step 2: Run focused tests and verify RED**

  ```bash
  pnpm --filter @agentwiki/server test -- src/onboard/onboard-bootstrap.service.spec.ts
  ```

- [ ] **Step 3: Implement bootstrap transaction and replay cache**

  The Prisma transaction must create/reuse the Space owner membership, Agent, and AgentGrant. Persist resource IDs in `OnboardingBootstrap`; store the short-lived response containing the installation code in Redis under the bootstrap record ID. Exact replay reads that response, while a different idempotency key or plan hash fails with `ONBOARDING_REPLAY_MISMATCH`.

- [ ] **Step 4: Reuse installation-code issuance safely**

  Extract a package-private `issueForBootstrap` path in `LocalSyncInstallationService` that accepts already-authorized resource IDs and the server-selected scopes. It must retain exact-version checking, safe public URL handling, TTL, exchange rate limits, audit, and credential cleanup.

- [ ] **Step 5: Add the HTTP route**

  `POST /api/onboard/bootstrap` uses only `OnboardingTokenGuard`, requires `Idempotency-Key`, verifies the canonical plan hash server-side, and returns:

  ```ts
  {
    space: { id: string; name: string };
    agent: { id: string; name: string };
    grant: { role: 'viewer' | 'editor'; scopes: string[] };
    installation: { code: string; installationId: string; expiresAt: string };
  }
  ```

- [ ] **Step 6: Run focused and full server tests**

  ```bash
  pnpm --filter @agentwiki/server test -- src/onboard/onboard-bootstrap.service.spec.ts src/core/agent/local-sync-installation.service.spec.ts
  pnpm --filter @agentwiki/server test
  ```

- [ ] **Step 7: Commit**

  ```bash
  git add apps/server/src/onboard apps/server/src/core/agent/local-sync-installation.service.ts apps/server/src/core/agent/local-sync-installation.service.spec.ts
  git commit -m "feat: bootstrap agent onboarding idempotently"
  ```

### Task 4: Build the browser authorization page and replace the old dual-MCP guide

**Files:**
- Create: `apps/client/src/features/about/OnboardDevicePage.tsx`
- Create: `apps/client/src/features/about/OnboardDevicePage.spec.tsx`
- Create: `apps/client/src/features/auth/safeReturnTo.ts`
- Create: `apps/client/src/features/auth/safeReturnTo.spec.ts`
- Modify: `apps/client/src/features/about/OnboardPage.tsx`
- Modify: `apps/client/src/features/about/OnboardPage.spec.tsx`
- Modify: `apps/client/src/features/about/ProductPage.tsx`
- Modify: `apps/client/src/App.tsx`
- Modify: `apps/client/src/api/client.ts`
- Modify: `apps/client/src/i18n/messages.ts`

**Interfaces:**
- `/onboard` shows only the pinned 0.3 command and three-action flow.
- `/onboard/device?user_code=ABCD-EFGH` authenticates the human and approves/denies the displayed session.

- [ ] **Step 1: Write failing UI tests**

  Test missing/invalid/expired codes, logged-out return flow, login/register return-to preservation, displayed client/server/purpose, approve/deny, duplicate click prevention, bilingual copy, and absence of 0.2.9/two-MCP/API-key instructions.

- [ ] **Step 2: Run focused tests and verify RED**

  ```bash
  pnpm --filter @agentwiki/client test -- src/features/about/OnboardDevicePage.spec.tsx src/features/about/OnboardPage.spec.tsx src/features/auth/safeReturnTo.spec.ts
  ```

- [ ] **Step 3: Implement a safe same-origin return target**

  `safeReturnTo` accepts only an absolute-path URL beginning with `/onboard/device`; reject protocol-relative, cross-origin, backslash, encoded-control, and arbitrary app paths. `ProductPage` navigates there after successful login/registration instead of `/dashboard` when present.

- [ ] **Step 4: Implement the authorization page**

  Fetch public session context, require the existing human JWT for decision, show exactly what is being authorized, and never render or persist the device code/onboarding token. The approve and deny buttons use one in-flight request and end in a terminal success message.

- [ ] **Step 5: Replace onboarding public copy**

  Remove the old prompt, direct `/api/onboard.json` workflow, API-key generation, “two MCP modes,” and old tool lists. Show the pinned command, supported Agents as examples, browser authorization, plan confirmation, first scan, and preview confirmation.

- [ ] **Step 6: Run focused and full client tests**

  ```bash
  pnpm --filter @agentwiki/client test -- src/features/about/OnboardDevicePage.spec.tsx src/features/about/OnboardPage.spec.tsx src/features/auth/safeReturnTo.spec.ts
  pnpm --filter @agentwiki/client test
  ```

- [ ] **Step 7: Commit**

  ```bash
  git add apps/client/src
  git commit -m "feat: add web authorization for agent onboarding"
  ```

### Task 5: Implement NDJSON transport, onboarding HTTP client, and secure sessions

**Files:**
- Create: `packages/local-sync/src/onboarding/protocol.ts`
- Create: `packages/local-sync/src/onboarding/protocol.spec.ts`
- Create: `packages/local-sync/src/onboarding/client.ts`
- Create: `packages/local-sync/src/onboarding/client.spec.ts`
- Create: `packages/local-sync/src/onboarding/session.ts`
- Create: `packages/local-sync/src/onboarding/session.spec.ts`
- Create: `packages/local-sync/src/onboarding/errors.ts`
- Modify: `packages/local-sync/src/utils/redact.ts`
- Modify: `packages/local-sync/src/utils/redact.spec.ts`

**Interfaces:**
- Produces versioned NDJSON events/replies, monotonic sequence numbers, typed errors, HTTP deadlines, and resumable local checkpoints.
- Consumed by Task 9.

- [ ] **Step 1: Write failing protocol tests**

  Cover one-object-per-line output, stdout/stderr separation, monotonic `seq`, request ID correlation, duplicate response idempotency, unknown-field rejection, protocol mismatch before side effects, heartbeat within five seconds, EOF/cancel, and exact event schemas.

  ```ts
  expect(lines.map(JSON.parse).map((event) => event.seq)).toEqual([1, 2, 3]);
  expect(stderr).toContain('diagnostic');
  expect(stdout).not.toContain('diagnostic');
  ```

- [ ] **Step 2: Write failing client/session tests**

  Test device start/poll/bootstrap deadlines, `slow_down`, retry bounds, redacted errors, `0600` session and secret-file modes, atomic writes, valid state transitions, resume after every checkpoint, and deletion of the transient onboarding token after bootstrap.

- [ ] **Step 3: Run focused tests and verify RED**

  ```bash
  pnpm --filter @neomei/agentwiki-local-sync test -- src/onboarding/protocol.spec.ts src/onboarding/client.spec.ts src/onboarding/session.spec.ts src/utils/redact.spec.ts
  ```

- [ ] **Step 4: Implement the protocol and state types**

  Use Zod discriminated unions. The persisted states are:

  ```ts
  type OnboardingState =
    | 'collecting_input' | 'waiting_for_web_auth' | 'preflight'
    | 'waiting_for_confirmation' | 'bootstrapping' | 'installing_gateway'
    | 'verifying_gateway' | 'scanning' | 'waiting_for_sync_confirmation'
    | 'syncing' | 'completed' | 'failed_recoverable'
    | 'failed_terminal' | 'cancelled';
  ```

- [ ] **Step 5: Implement secure persistence**

  Save non-secret state at `~/.agentwiki/onboarding/<sessionId>.json`. Save the short-lived onboarding token separately at `~/.agentwiki/onboarding/<sessionId>.secret.json`; both are `0600`, the directory is `0700`, and the secret file is removed immediately after bootstrap. Never persist an Agent API key in either file.

- [ ] **Step 6: Run focused tests**

  ```bash
  pnpm --filter @neomei/agentwiki-local-sync test -- src/onboarding/protocol.spec.ts src/onboarding/client.spec.ts src/onboarding/session.spec.ts src/utils/redact.spec.ts
  ```

- [ ] **Step 7: Commit**

  ```bash
  git add packages/local-sync/src/onboarding packages/local-sync/src/utils/redact.ts packages/local-sync/src/utils/redact.spec.ts
  git commit -m "feat: add resumable onboarding protocol"
  ```

---

## Milestone 2 — One gateway and deterministic tool routing

### Task 6: Replace both public MCP servers with one gateway and remote bridge

**Files:**
- Create: `packages/local-sync/src/gateway/manifest.ts`
- Create: `packages/local-sync/src/gateway/manifest.spec.ts`
- Create: `packages/local-sync/src/gateway/remote-mcp-bridge.ts`
- Create: `packages/local-sync/src/gateway/remote-mcp-bridge.spec.ts`
- Create: `packages/local-sync/src/gateway/server.ts`
- Create: `packages/local-sync/src/gateway/server.spec.ts`
- Modify: `packages/local-sync/src/mcp.ts`
- Modify: `packages/local-sync/src/mcp.spec.ts` if created by the implementation; otherwise move existing MCP assertions into `gateway/server.spec.ts`

**Interfaces:**
- `createGatewayServer(context)` registers one exact manifest.
- `RemoteMcpBridge.listTools()` and `.callTool()` proxy `/api/mcp` using the stored Agent credential.

- [ ] **Step 1: Write failing manifest and routing tests**

  Assert exact names, unique execution planes, no old aliases, no silent collision, deterministic schema hash, offline manifest behavior, and `REMOTE_UNAVAILABLE` without disabling local tools.

  ```ts
  expect(toolNames).toContain('wiki_list_pages');
  expect(toolNames).toContain('knowledge_prepare');
  expect(toolNames).not.toContain('start_knowledge_job');
  expect(new Set(toolNames).size).toBe(toolNames.length);
  ```

- [ ] **Step 2: Write failing MCP bridge tests**

  Use an in-process MCP HTTP fixture to verify `initialize`, `tools/list`, `tools/call`, authorization header redaction, 30-second deadline, incompatible server manifest rejection, last-known-good cache, and remote error-code preservation.

- [ ] **Step 3: Run focused tests and verify RED**

  ```bash
  pnpm --filter @neomei/agentwiki-local-sync test -- src/gateway/manifest.spec.ts src/gateway/remote-mcp-bridge.spec.ts src/gateway/server.spec.ts
  ```

- [ ] **Step 4: Implement the bridge and gateway**

  Use the MCP SDK client and `StreamableHTTPClientTransport`; do not recreate remote business operations with REST calls. Prefix every compatible remote tool with `wiki_`, cache only its non-sensitive schema/version/hash, and bind every registered handler to its declared plane.

- [ ] **Step 5: Remove public dual-server factories**

  Delete `createLocalSyncMcpServer`, `serveLocalSyncMcp`, `createOrchestratorMcpServer`, and `serveOrchestratorMcp` from the public runtime. Keep reusable local orchestration classes internal for Task 7.

- [ ] **Step 6: Run focused and package tests**

  ```bash
  pnpm --filter @neomei/agentwiki-local-sync test -- src/gateway/manifest.spec.ts src/gateway/remote-mcp-bridge.spec.ts src/gateway/server.spec.ts
  pnpm --filter @neomei/agentwiki-local-sync test
  ```

- [ ] **Step 7: Commit**

  ```bash
  git add packages/local-sync/src/gateway packages/local-sync/src/mcp.ts
  git commit -m "feat: unify local and remote gateway tools"
  ```

### Task 7: Add high-level local and hybrid knowledge workflows

**Files:**
- Create: `packages/local-sync/src/gateway/knowledge-workflows.ts`
- Create: `packages/local-sync/src/gateway/knowledge-workflows.spec.ts`
- Modify: `packages/local-sync/src/orchestrator-commands.ts`
- Modify: `packages/local-sync/src/orchestrator-commands.spec.ts`
- Modify: `packages/local-sync/src/gateway/manifest.ts`
- Modify: `packages/local-sync/src/gateway/server.ts`
- Modify: `packages/local-sync/src/sync/sync-engine.ts`
- Modify: `packages/local-sync/src/sync/sync-engine.spec.ts`

**Interfaces:**
- `knowledge_prepare` performs local adapter discovery, collection, organization, validation, and preview persistence without upload.
- `knowledge_confirm_and_sync` requires `jobId`, `previewHash`, and `confirmed: true`, pulls before push, checks revision/conflicts, then uploads only the confirmed bundle.
- `knowledge_pull` updates the local Space workspace from the authoritative revision.

- [ ] **Step 1: Write failing workflow tests**

  Cover code/document adapter auto-detection, multiple source paths, ignore rules, zero network calls during prepare, preview hash binding, changed/expired preview rejection, Pull-before-Push order, three-way conflict blocking, approval result propagation, retry idempotency, and cleanup.

  ```ts
  const preview = await workflows.prepare({ spaceId: 'space-1', sourcePaths: [repo], sourceType: 'auto' });
  expect(remote.calls).toEqual([]);
  await workflows.confirmAndSync({ jobId: preview.jobId, previewHash: preview.previewHash, confirmed: true });
  expect(remote.calls.map((call) => call.name)).toEqual(['pull', 'push']);
  ```

- [ ] **Step 2: Run focused tests and verify RED**

  ```bash
  pnpm --filter @neomei/agentwiki-local-sync test -- src/gateway/knowledge-workflows.spec.ts src/orchestrator-commands.spec.ts src/sync/sync-engine.spec.ts
  ```

- [ ] **Step 3: Implement the high-level coordinator**

  Reuse `AdapterManager`, recipes, organizer, validator, workspace checkpoints, `SyncEngine`, and the existing source-key mechanism. The returned preview includes counts, warnings, paths represented as display-safe relative roots, revision, checksum, and preview file path; it does not include raw full file bodies in NDJSON.

- [ ] **Step 4: Register only the approved public tools**

  `local_scan_sources` returns discovery metadata; `local_read_artifacts` reads bounded local summaries. `knowledge_prepare`, `knowledge_confirm_and_sync`, and `knowledge_pull` wrap the whole safe workflow. Internal job primitives remain ordinary TypeScript functions, not MCP tools.

- [ ] **Step 5: Run package tests**

  ```bash
  pnpm --filter @neomei/agentwiki-local-sync test
  pnpm --filter @neomei/agentwiki-local-sync typecheck
  ```

- [ ] **Step 6: Commit**

  ```bash
  git add packages/local-sync/src/gateway packages/local-sync/src/orchestrator-commands.ts packages/local-sync/src/orchestrator-commands.spec.ts packages/local-sync/src/sync
  git commit -m "feat: add confirmed knowledge gateway workflows"
  ```

---

## Milestone 3 — Atomic installation, verification, and recovery

### Task 8: Build preflight, backup, atomic client configuration, and rollback

**Files:**
- Create: `packages/local-sync/src/installer/plan.ts`
- Create: `packages/local-sync/src/installer/plan.spec.ts`
- Create: `packages/local-sync/src/installer/client-config.ts`
- Create: `packages/local-sync/src/installer/client-config.spec.ts`
- Create: `packages/local-sync/src/installer/archive.ts`
- Create: `packages/local-sync/src/installer/archive.spec.ts`
- Modify: `packages/local-sync/src/agent-clients.ts`
- Modify: `packages/local-sync/src/agent-clients.spec.ts`
- Modify: `packages/local-sync/src/config.ts`
- Modify: `packages/local-sync/src/config.spec.ts`

**Interfaces:**
- `preflightClient()` returns config path/hash, old AgentWiki entries, conflict status, backup path, command, and reload capability.
- `installGateway(plan)` archives, writes, verifies the post-write hash, and exposes `rollback()` until verification completes.

- [ ] **Step 1: Write failing isolated-HOME tests**

  Cover Codex, Claude Code, OpenCode 1/2, exact `0.3.0` gateway command, complete config backup, old remote/local entry removal, unknown same-name refusal, concurrent hash change, atomic JSON/TOML/CLI mutation boundary, rollback, private modes, repeat install, command timeout, and process-group termination.

- [ ] **Step 2: Run focused tests and verify RED**

  ```bash
  pnpm --filter @neomei/agentwiki-local-sync test -- src/installer/plan.spec.ts src/installer/client-config.spec.ts src/installer/archive.spec.ts src/agent-clients.spec.ts src/config.spec.ts
  ```

- [ ] **Step 3: Define the only installed command**

  ```ts
  const gatewayCommand = [
    'npx', '--yes', '@neomei/agentwiki-local-sync@0.3.0',
    'gateway', '--connection', connectionId,
  ];
  ```

  Do not include `mcp`, `--orchestrator`, a remote URL, installation code, or API key in client configuration.

- [ ] **Step 4: Implement archive and clean 0.3 state**

  Before mutation, copy the full client config and move every legacy child of `~/.agentwiki` except the active `onboarding/` session directory into a timestamped directory under `~/.agentwiki-archive/`. Mark the archive read-only, initialize schema-version-3 state beside the preserved onboarding checkpoint with `0700/0600`, and never delete the archive automatically. A failure restores the legacy children without overwriting the active session.

- [ ] **Step 5: Implement bounded client mutation**

  Codex/Claude commands receive explicit non-interactive arguments and a 60-second deadline. OpenCode uses temp-file write, file `fsync`, directory `fsync`, atomic rename, and mode restoration. Re-hash immediately before mutation; a mismatch returns `CONFIG_CONFLICT` without writing.

- [ ] **Step 6: Run focused and package tests**

  ```bash
  pnpm --filter @neomei/agentwiki-local-sync test -- src/installer/plan.spec.ts src/installer/client-config.spec.ts src/installer/archive.spec.ts src/agent-clients.spec.ts src/config.spec.ts
  pnpm --filter @neomei/agentwiki-local-sync test
  ```

- [ ] **Step 7: Commit**

  ```bash
  git add packages/local-sync/src/installer packages/local-sync/src/agent-clients.ts packages/local-sync/src/agent-clients.spec.ts packages/local-sync/src/config.ts packages/local-sync/src/config.spec.ts
  git commit -m "feat: install the agentwiki gateway atomically"
  ```

### Task 9: Implement the end-to-end onboarding state machine and CLI

**Files:**
- Create: `packages/local-sync/src/onboarding/coordinator.ts`
- Create: `packages/local-sync/src/onboarding/coordinator.spec.ts`
- Create: `packages/local-sync/src/onboarding/preflight.ts`
- Create: `packages/local-sync/src/onboarding/preflight.spec.ts`
- Create: `packages/local-sync/src/onboarding/verifier.ts`
- Create: `packages/local-sync/src/onboarding/verifier.spec.ts`
- Modify: `packages/local-sync/src/cli.ts`
- Modify: `packages/local-sync/src/cli.spec.ts`
- Modify: `packages/local-sync/src/gateway/server.ts`

**Interfaces:**
- Public CLI: `onboard`, `onboard resume <sessionId>`, `doctor`, `uninstall`, and `gateway` only.
- `onboard_status` reads the non-secret completed session report.

- [ ] **Step 1: Write failing coordinator tests**

  Exercise every state/terminal state, required field defaults, merged server/local preview, separate hash confirmations, web auth pending/slow-down/expiry, bootstrap replay, installation rollback, child MCP verification, reload-required success, first scan, sync confirmation, cancel cleanup, resume from every checkpoint, and heartbeat cadence.

- [ ] **Step 2: Write failing verifier and CLI-surface tests**

  Verify child process `initialize`, exact `tools/list`, `onboard_status`, local test tool, remote identity/Space scopes, 30-second deadline, credential revocation on failed install, and absence of old commands/help text.

  ```ts
  expect(help).toContain('onboard');
  expect(help).toContain('gateway');
  expect(help).not.toContain('connect');
  expect(help).not.toContain('--orchestrator');
  ```

- [ ] **Step 3: Run focused tests and verify RED**

  ```bash
  pnpm --filter @neomei/agentwiki-local-sync test -- src/onboarding/coordinator.spec.ts src/onboarding/preflight.spec.ts src/onboarding/verifier.spec.ts src/cli.spec.ts
  ```

- [ ] **Step 4: Implement collection, authorization, and one plan confirmation**

  NDJSON emits `input_required`, opens/emits the verification URL, polls with heartbeat, performs local/server preflight, then emits one merged `preview` and one `confirmation_required`. Only the canonical `serverPlan` and its hash go to bootstrap.

- [ ] **Step 5: Implement install verification and first sync**

  Exchange the installation code into the private credential store, configure the gateway, launch the child directly, verify MCP and remote access, execute `knowledge_prepare` inside the onboarding process, emit a bounded content summary, and require a second confirmation before `knowledge_confirm_and_sync`.

- [ ] **Step 6: Implement resume and terminal reporting**

  The report contains IDs, tool manifest hash, config backup, scan counts, revision/ChangeSet status, `agentReload`, and redacted next action. A recoverable failure always prints `resumeSessionId`; terminal failure/cancel revokes unused installation/credential material and restores configuration.

- [ ] **Step 7: Run focused and package tests**

  ```bash
  pnpm --filter @neomei/agentwiki-local-sync test -- src/onboarding/coordinator.spec.ts src/onboarding/preflight.spec.ts src/onboarding/verifier.spec.ts src/cli.spec.ts
  pnpm --filter @neomei/agentwiki-local-sync test
  pnpm --filter @neomei/agentwiki-local-sync typecheck
  ```

- [ ] **Step 8: Commit**

  ```bash
  git add packages/local-sync/src/onboarding packages/local-sync/src/cli.ts packages/local-sync/src/cli.spec.ts packages/local-sync/src/gateway/server.ts
  git commit -m "feat: orchestrate complete self-service onboarding"
  ```

---

## Milestone 4 — Product surfaces, E2E, release, and production proof

### Task 10: Update versioned instructions, documentation, and release surfaces

**Files:**
- Modify: `package.json`
- Modify: `apps/server/package.json`
- Modify: `apps/client/package.json`
- Modify: `packages/local-sync/package.json`
- Modify: `.env.example`
- Modify: `apps/server/.env.example`
- Modify: `apps/server/src/onboard/onboard.controller.ts`
- Modify: `packages/local-sync/README.md`
- Modify: `packages/local-sync/skill/SKILL.md`
- Modify: `README.md`
- Modify: `apps/client/src/features/about/UsageGuide.tsx`
- Modify: `apps/client/src/features/about/UsageGuide.spec.tsx`
- Modify: `scripts/node-runtime-contract.test.mjs`
- Modify: `scripts/local-sync-e2e.mjs`
- Modify: `scripts/cross-machine-e2e.mjs`

**Interfaces:**
- Every active instruction surface advertises only `0.3.0 onboard`, one gateway, Device Auth, and separate preview confirmation.

- [ ] **Step 1: Update version contract tests first**

  Require `0.3.0`, reject `0.2.9`, reject `connect`, reject direct remote MCP installation, and assert the pinned public command on the home/onboard/guide/server Markdown/npm README/skill surfaces.

- [ ] **Step 2: Run runtime contract tests and verify RED**

  ```bash
  pnpm test:runtime
  ```

- [ ] **Step 3: Update all release surfaces**

  Set root/server/client/local-sync versions and `LOCAL_SYNC_PACKAGE_VERSION` to `0.3.0`. Rewrite the server `/api/onboard` Markdown as a compact wrapper around the pinned script; remove `/api/onboard.json` or return HTTP 410 with the pinned replacement command so no executable dual-MCP plan remains.

- [ ] **Step 4: Rewrite README, skill, and usage guide**

  Document supported Agents as examples, the three user actions, local-versus-remote execution planes, privacy boundaries, resume/doctor/uninstall, and expected completed report. Do not describe manual Agent key/install-code handling.

- [ ] **Step 5: Run contracts, UI tests, and package tests**

  ```bash
  pnpm test:runtime
  pnpm --filter @agentwiki/client test -- src/features/about/UsageGuide.spec.tsx src/features/about/OnboardPage.spec.tsx
  pnpm --filter @neomei/agentwiki-local-sync test
  ```

- [ ] **Step 6: Commit**

  ```bash
  git add package.json apps/server/package.json apps/client/package.json packages/local-sync/package.json .env.example apps/server/.env.example apps/server/src/onboard/onboard.controller.ts packages/local-sync/README.md packages/local-sync/skill/SKILL.md README.md apps/client/src/features/about scripts
  git commit -m "docs: publish the unified onboarding contract"
  ```

### Task 11: Add full local, browser, three-client, and production E2E gates

**Files:**
- Create: `scripts/onboarding-e2e.mjs`
- Create: `scripts/onboarding-e2e.test.mjs`
- Create: `apps/client/e2e/onboarding-device.spec.ts`
- Modify: `package.json`
- Modify: `scripts/e2e-safety.mjs`
- Modify: `scripts/e2e-safety.test.mjs`
- Create: `docs/verification/agent-self-service-onboarding-0.3.0.md`

**Interfaces:**
- `pnpm test:e2e:onboarding` is destructive only for an explicit loopback target unless production opt-in and cleanup credentials are supplied.

- [ ] **Step 1: Write failing safety and harness tests**

  Assert loopback-by-default, explicit production opt-in, unique disposable user/Space/Agent names, cleanup in `finally`, secret redaction, process cleanup, timeout bounds, and non-zero exit on any missing completion criterion.

- [ ] **Step 2: Implement the E2E harness**

  Drive NDJSON stdin/stdout from the pinned built CLI, approve Device Auth through browser/API fixture, confirm the plan, perform one real codebase-memory scan and one real MarkItDown document scan, confirm the preview, verify server revision/ChangeSet, restart/resume once, and assert one `agentwiki` MCP entry.

- [ ] **Step 3: Cover all three clients in isolated HOME directories**

  Use real installed Codex, Claude Code, and OpenCode CLIs when present. A missing binary is a reported environment skip in local development but a failure in the release/production gate. Validate backup, single gateway entry, child handshake, exact manifest, `agentReload`, and uninstall restore behavior.

- [ ] **Step 4: Run the complete local gate**

  ```bash
  pnpm test
  pnpm typecheck
  pnpm lint
  pnpm build
  pnpm test:e2e:local-sync
  pnpm test:e2e:cross-machine
  pnpm test:e2e:onboarding
  pnpm --filter @agentwiki/client exec playwright test e2e/onboarding-device.spec.ts
  ```

  Expected: all unit, integration, browser, real-adapter, cross-machine, and three-client onboarding checks pass with no credential/raw-source leakage.

- [ ] **Step 5: Run security and package inspections**

  ```bash
  pnpm audit --prod --audit-level=high
  (cd packages/local-sync && npm pack --dry-run)
  rg -n "(agk|awk|awd|awo)_[A-Za-z0-9_-]+|BEGIN (RSA|OPENSSH|PRIVATE) KEY" . --glob '!node_modules/**' --glob '!.git/**'
  ```

  Expected: no high/critical reachable production advisory, package contains the gateway/onboarding runtime and skill, and no live secret appears.

- [ ] **Step 6: Perform controlled production E2E**

  Back up production, apply the Prisma migration, deploy server/client/worker, verify health, then run the production-opted harness with disposable resources. Confirm public `/onboard`, Device Auth, one gateway, first code scan, first document scan, preview confirmation, revision/ChangeSet, resume, cleanup, and npm/GitHub version equality.

- [ ] **Step 7: Record evidence**

  Write exact commit, package integrity, migration status, automated counts, browser screenshots, three-client results, production resource IDs, cleanup results, and known non-blocking risks to `docs/verification/agent-self-service-onboarding-0.3.0.md`.

- [ ] **Step 8: Commit**

  ```bash
  git add package.json scripts apps/client/e2e docs/verification/agent-self-service-onboarding-0.3.0.md
  git commit -m "test: verify unified onboarding end to end"
  ```

---

## Final Completion Gate

- [ ] Re-run `pnpm test`, `pnpm typecheck`, `pnpm lint`, and `pnpm build` from a clean worktree.
- [ ] Re-run the real codebase-memory, MarkItDown, cross-machine, browser, and three-client E2E suites.
- [ ] Verify `/api/onboard.json` cannot instruct an Agent to install two MCPs.
- [ ] Verify CLI help and built tarball contain no `connect`, old low-level tool alias, or remote-only branch.
- [ ] Verify one `agentwiki` entry remains after repeat onboarding and rollback restores the exact preflight hash on failure.
- [ ] Verify raw files and all credentials are absent from NDJSON, reports, logs, sessions, git diff, npm tarball, and server request bodies.
- [ ] Verify production Device Auth and bootstrap rate limits, expiry, denial, idempotency, and cleanup.
- [ ] Verify GitHub `master`, deployed commit, package version, npm `latest`, server `LOCAL_SYNC_PACKAGE_VERSION`, guide command, and verification report all identify `0.3.0`.
