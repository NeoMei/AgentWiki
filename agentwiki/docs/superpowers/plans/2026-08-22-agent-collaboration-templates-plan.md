# Agent Collaboration Templates and Components Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Space-scoped collaboration control plane with five copyable built-in templates, deterministic task/Todo/dependency/review components, secure external-Agent MCP execution, recovery, and a responsive bilingual run dashboard.

**Architecture:** `@neomei/agentwiki-sync-protocol` owns the collaboration schemas, enums, role-derived scopes, and MCP DTOs. A new `collaboration-workflows` NestJS domain owns PostgreSQL-authoritative templates and normalized runs, while the existing collaboration gateway only broadcasts committed state changes and the Worker process only recovers expired leases and due retries. The server exposes canonical `collaboration_*` MCP tools; the local gateway exposes their `wiki_collaboration_*` aliases with exact input schemas, and server results are parsed through exact shared output schemas.

**Tech Stack:** TypeScript, pnpm 11.9.0, Node 24 or 26, NestJS 10, Prisma 5/PostgreSQL 16, Redis, Socket.io, React 18/Vite/Tailwind, Zod, Ajv 8.18.0, class-validator, Jest, Vitest, Node test runner, MCP SDK.

## Global Constraints

- This plan starts only after `agentwiki/docs/superpowers/plans/2026-08-22-unified-agent-access-roles-plan.md` is complete and its local `0.5.0` gates are green. Do not separately publish/deploy that intermediate version; this plan finishes by moving local-sync, server/client app packages, the unified gateway, server onboarding compatibility, and user-visible instructions to `0.6.0` for one combined release. The sync-protocol package carries the contract but keeps its independent package semver.
- The only Agent access roles remain exactly `reader`, `editor`, and `publisher`; collaboration Role Slots are template responsibilities and must never be treated as access roles.
- Add `collaboration:read` to `reader`; add `collaboration:read` and `collaboration:execute` to both `editor` and `publisher`; no Agent role gains `review:decide`.
- Effective access remains the intersection of Credential role/scopes, Space Grant role/scopes, Agent state, Space policy, and collaboration-domain authorization.
- The five user-visible component kinds are exactly Agent task, ordered Todo, dependency/parallelism, human review, and result handoff/aggregation.
- The five built-in system templates are exactly coding, bid writing, paper writing, video script writing, and novel writing; system templates are immutable in the UI and copied before Space customization.
- AgentWiki is the control plane only: it does not host models, wake remote clients, read local repositories, fetch arbitrary external URLs, or store general-purpose files.
- PostgreSQL is authoritative; Redis/Socket.io notifications are best effort and clients re-fetch REST state on entry, focus, and reconnect.
- Human review is human-only. Agents cannot approve, reject, terminate, reassign, skip, pause, resume, edit templates, or change Role Bindings.
- Every write operation uses `(runId, actorKind, actorId, operation, idempotencyKey)` plus a canonical request hash; exact replay returns the stored safe response and mismatched reuse fails. Lease-token plaintext is never persisted or logged and may only be deterministically reconstructed for an authorized exact claim replay.
- A run stores an immutable template snapshot; template edits and system seed updates never mutate existing runs or copied Space templates.
- Every task has a current generation. Todo, Attempt, Artifact, and Review rows are generation-bound; review rejection supersedes the affected old-generation subgraph and no stale accepted Artifact can release dependencies or complete a run.
- `any` means early release, not winner-takes-all: the downstream task may start with currently available optional Artifacts, but all non-skipped upstream tasks remain required for run completion.
- External file/code references accept workspace-relative paths or auditable URLs only; reject absolute local paths, credential-bearing URLs, environment data, and unauditable temporary links.
- Reuse `Layout`, `SpaceNav`, `ModalDialog`, `IconButton`, Toast, and existing Tailwind visual conventions; do not add a second component library.
- Existing `/spaces/:id/runs` remains Source/Ingest Runs; collaboration uses distinct `/spaces/:id/collaboration` routes and copy.
- All user-visible UI, errors, status labels, and generated join/resume instructions support Simplified Chinese and English, use text plus icons, and fit a 390px viewport without horizontal overflow.
- Collaboration completion creates Task Artifacts only; Wiki publication still uses existing ChangeSet, Space Policy, and review governance.
- Do not push, publish npm, or deploy production without separate explicit user authorization.

## File Structure

- `packages/sync-protocol/src/collaboration.ts`: canonical template, run, component, artifact, state, permission, and MCP request/response schemas.
- `packages/sync-protocol/src/collaboration.spec.ts`: shared contract, built-in shape, state, bounds, and role-scope tests.
- `apps/server/package.json` and `pnpm-lock.yaml`: direct pinned Ajv dependency for the bounded JSON Schema subset.
- `apps/server/prisma/schema.prisma` plus `20260822220000_agent_collaboration_workflows`: the ten fixed collaboration records, enums, indexes, uniqueness, and foreign keys.
- `apps/server/src/collaboration-workflows/template-definitions.ts`: five immutable, versioned built-in definitions.
- `apps/server/src/collaboration-workflows/template-validator.ts`: graph, review-return, input/output, bound, and reachability validation.
- `apps/server/src/collaboration-workflows/template.service.ts` and controller/DTO files: seed, list, copy, edit, archive, validate, and template versioning.
- `apps/server/src/collaboration-workflows/run.service.ts` and controller/DTO files: transactional run creation, snapshot expansion, human controls, full human view, and bounded Agent view.
- `apps/server/src/collaboration-workflows/run-event.store.ts`: per-run event sequencing, idempotent mutation replay, and redacted stored responses.
- `apps/server/src/collaboration-workflows/execution.service.ts`: join, transactional claim, heartbeat, ordered Todo update, submission, Artifact versioning, and idempotency.
- `apps/server/src/collaboration-workflows/progression.service.ts`: dependency release, review gating, revision routing, terminal-state calculation, and event creation.
- `apps/server/src/collaboration-workflows/recovery.worker.ts`: expired-lease recovery and `retry_wait` release in Worker/all processes only.
- `apps/server/src/collaboration-workflows/collaboration-events.service.ts`: post-commit Redis publication; existing `core/collaboration` gateway relays run-room refresh hints.
- `apps/server/src/mcp/mcp.service.ts`: six canonical collaboration MCP tools and audit-safe handlers.
- `packages/local-sync/src/gateway/collaboration-tools.ts`: exact Zod schemas for dynamically discovered collaboration tools.
- `apps/client/src/features/collaboration/`: API adapter, workspace, template editor, start wizard, run dashboard, focused components, and tests.
- `scripts/collaboration-test-database.mjs`: validates the dedicated test connection, creates a prefixed random PostgreSQL schema, runs migrations against it, and drops exactly that schema in `finally`.
- `scripts/collaboration-workflows-db.test.mjs`: real isolated-schema PostgreSQL concurrency, lease, generation revision, idempotency, and termination checks.
- `scripts/collaboration-workflows-e2e.mjs`: human HTTP + MCP contract smoke using test identities; real-client acceptance remains a separately authorized manual runbook.

---

### Task 1: Canonical Collaboration Contract and Role Capabilities

**Files:**
- Create: `agentwiki/packages/sync-protocol/src/collaboration.ts`
- Create: `agentwiki/packages/sync-protocol/src/collaboration.spec.ts`
- Modify: `agentwiki/packages/sync-protocol/src/agent-access-role.ts`
- Modify: `agentwiki/packages/sync-protocol/src/agent-access-role.spec.ts`
- Modify: `agentwiki/packages/sync-protocol/src/index.ts`

**Interfaces:**
- Consumes: `AgentAccessRole`, `AGENT_ACCESS_ROLE_SCOPES`, and `agentRoleAllowsScope()` from the completed unified-role plan.
- Produces: `CollaborationTemplateDefinitionSchema`, exact state schemas, `CollaborationArtifactInputSchema`, all six MCP input/output schemas, and the two collaboration scopes.

- [ ] **Step 1: Write failing contract tests for bounds, enums, MCP strictness, and access-role inheritance**

```ts
// packages/sync-protocol/src/collaboration.spec.ts
import { describe, expect, it } from "vitest";
import {
  CollaborationNextActionInputSchema,
  CollaborationRunStatusSchema,
  CollaborationTaskStatusSchema,
  CollaborationTemplateDefinitionSchema,
} from "./collaboration.js";
import { scopesForAgentAccessRole } from "./agent-access-role.js";

describe("collaboration contract", () => {
  it("keeps exact run and task states", () => {
    expect(CollaborationRunStatusSchema.options).toEqual([
      "draft", "ready", "running", "waiting_review", "paused", "completed", "failed", "cancelled",
    ]);
    expect(CollaborationTaskStatusSchema.options).toEqual([
      "blocked", "ready", "claimed", "running", "submitted", "completed", "retry_wait", "failed", "skipped",
    ]);
  });

  it("rejects executable template content and oversized definitions", () => {
    expect(() => CollaborationTemplateDefinitionSchema.parse({
      schemaVersion: 1, inputs: [], roleSlots: [], nodes: [], dependencies: [],
      script: "process.env.SECRET",
    })).toThrow();
  });

  it("requires a write idempotency key and rejects unknown MCP fields", () => {
    expect(() => CollaborationNextActionInputSchema.parse({ runId: "run-1" })).toThrow();
    expect(() => CollaborationNextActionInputSchema.parse({
      runId: "run-1", idempotencyKey: "next-00000001", unexpected: true,
    })).toThrow();
  });

  it("derives collaboration execution from access roles without review decisions", () => {
    expect(scopesForAgentAccessRole("reader")).toContain("collaboration:read");
    expect(scopesForAgentAccessRole("reader")).not.toContain("collaboration:execute");
    for (const role of ["editor", "publisher"] as const) {
      expect(scopesForAgentAccessRole(role)).toEqual(expect.arrayContaining([
        "collaboration:read", "collaboration:execute",
      ]));
      expect(scopesForAgentAccessRole(role)).not.toContain("review:decide");
    }
  });
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
cd agentwiki
pnpm --filter @neomei/agentwiki-sync-protocol exec vitest run src/collaboration.spec.ts src/agent-access-role.spec.ts
```

Expected: FAIL because `src/collaboration.ts` is absent and role scopes do not contain collaboration permissions.

- [ ] **Step 3: Add the exact shared schemas, bounds, and role scopes**

```ts
// packages/sync-protocol/src/collaboration.ts
import { z } from "zod";

export const COLLABORATION_LIMITS = {
  inputs: 30, roleSlots: 20, nodes: 100, todosPerTask: 50,
  markdownBytes: 1_000_000, jsonBytes: 256_000, jsonDepth: 12,
  evidencePerTodo: 20, longPollSeconds: 25,
} as const;
export const CollaborationRunStatusSchema = z.enum([
  "draft", "ready", "running", "waiting_review", "paused", "completed", "failed", "cancelled",
]);
export const CollaborationTaskStatusSchema = z.enum([
  "blocked", "ready", "claimed", "running", "submitted", "completed", "retry_wait", "failed", "skipped",
]);
export const CollaborationTodoStatusSchema = z.enum(["pending", "doing", "done", "failed"]);
export const CollaborationArtifactKindSchema = z.enum(["markdown", "json", "external_reference", "evidence_summary"]);
export const CollaborationNodeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("agent_task"), id: z.string().min(1), name: z.string().min(1), roleSlotId: z.string().min(1),
    objective: z.string().min(1), inputKeys: z.array(z.string()).max(30),
    upstreamArtifacts: z.array(z.object({ key: z.string().min(1), required: z.boolean() }).strict()).max(30),
    output: z.object({ key: z.string().min(1), kind: CollaborationArtifactKindSchema, jsonSchema: z.record(z.unknown()).optional() }).strict(),
    evidenceRequired: z.array(z.string()).max(20), humanAcceptance: z.boolean(), leaseSeconds: z.number().int().min(30).max(3600),
    maxExecutionSeconds: z.number().int().min(60).max(86400), retryBudget: z.number().int().min(0).max(10), repairBudget: z.number().int().min(0).max(10),
    skippable: z.boolean(), todos: z.array(z.object({ id: z.string().min(1), name: z.string().min(1), required: z.boolean(), evidenceKinds: z.array(z.string()).max(10) }).strict()).min(1).max(50),
  }).strict(),
  z.object({ kind: z.literal("human_review"), id: z.string().min(1), name: z.string().min(1), artifactTaskId: z.string().min(1),
    minimumRole: z.enum(["owner", "admin", "editor"]), reviewerUserIds: z.array(z.string()).max(20),
    approvalCriteria: z.array(z.string().min(1)).min(1).max(30), revisionTaskId: z.string().min(1), allowTerminate: z.boolean(),
  }).strict(),
]);
export const CollaborationTemplateDefinitionSchema = z.object({
  schemaVersion: z.literal(1), inputs: z.array(z.object({ key: z.string().min(1), label: z.string().min(1), required: z.boolean(), type: z.enum(["short_text", "long_text", "number", "boolean", "url"]) }).strict()).max(30),
  roleSlots: z.array(z.object({ id: z.string().min(1), name: z.string().min(1), required: z.boolean(), description: z.string() }).strict()).max(20),
  nodes: z.array(CollaborationNodeSchema).min(1).max(100),
  dependencies: z.array(z.object({ from: z.string().min(1), to: z.string().min(1), mode: z.enum(["all", "any"]) }).strict()).max(500),
  terminalNodeIds: z.array(z.string().min(1)).min(1).max(20),
}).strict();
const WriteKeySchema = z.string().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/u);
export const CollaborationJoinRunInputSchema = z.object({ runId: z.string().min(1) }).strict();
export const CollaborationNextActionInputSchema = z.object({ runId: z.string().min(1), idempotencyKey: WriteKeySchema, waitSeconds: z.number().int().min(0).max(25).optional() }).strict();
export const CollaborationHeartbeatInputSchema = z.object({ runId: z.string(), attemptId: z.string(), leaseToken: z.string().min(32), idempotencyKey: WriteKeySchema }).strict();
export const CollaborationUpdateTodoInputSchema = z.object({ runId: z.string(), attemptId: z.string(), todoId: z.string(), leaseToken: z.string().min(32), status: z.enum(["doing", "done", "failed"]), summary: z.string().max(4000).optional(), evidence: z.array(z.object({ kind: z.string(), reference: z.string().max(2048) }).strict()).max(20), idempotencyKey: WriteKeySchema }).strict();
const EvidenceSchema = z.array(z.object({ kind: z.string(), reference: z.string().max(2048) }).strict()).max(50);
const ExternalReferenceSchema = z.object({ kind: z.enum(["workspace_path", "git_commit", "url"]), displayName: z.string().min(1), value: z.string().min(1), version: z.string().optional(), contentHash: z.string().regex(/^[a-f0-9]{64}$/u).optional() }).strict();
export const CollaborationArtifactInputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("markdown"), markdown: z.string(), evidence: EvidenceSchema }).strict(),
  z.object({ kind: z.literal("json"), json: z.unknown(), evidence: EvidenceSchema }).strict(),
  z.object({ kind: z.literal("external_reference"), externalReference: ExternalReferenceSchema, evidence: EvidenceSchema }).strict(),
  z.object({ kind: z.literal("evidence_summary"), summary: z.string(), evidence: EvidenceSchema }).strict(),
]);
export const CollaborationSubmitResultInputSchema = z.object({ runId: z.string(), attemptId: z.string(), leaseToken: z.string().min(32), artifact: CollaborationArtifactInputSchema, idempotencyKey: WriteKeySchema }).strict();
export const CollaborationGetRunInputSchema = z.object({ runId: z.string().min(1) }).strict();
const RoleSlotSummarySchema = z.object({ id: z.string(), name: z.string() }).strict();
const TodoViewSchema = z.object({ id: z.string(), ordinal: z.number().int(), name: z.string(), required: z.boolean(), status: CollaborationTodoStatusSchema }).strict();
const AgentTaskViewSchema = z.object({ id: z.string(), nodeId: z.string(), name: z.string(), objective: z.string(), todos: z.array(TodoViewSchema), inputs: z.record(z.unknown()), acceptedArtifacts: z.array(z.object({ taskId: z.string(), version: z.number().int(), kind: CollaborationArtifactKindSchema, payload: z.unknown() }).strict()) }).strict();
export const CollaborationJoinRunOutputSchema = z.object({ runId: z.string(), status: CollaborationRunStatusSchema, roleSlots: z.array(RoleSlotSummarySchema), protocol: z.object({ nextActionTool: z.literal('wiki_collaboration_next_action'), stopOn: z.array(z.enum(['waiting_human', 'paused', 'completed', 'failed', 'cancelled'])) }).strict() }).strict();
export const CollaborationNextActionOutputSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('execute_task'), attemptId: z.string(), leaseToken: z.string(), leaseExpiresAt: z.string(), task: AgentTaskViewSchema }).strict(),
  z.object({ action: z.literal('waiting_dependency'), retryAfterSeconds: z.number().int().min(1).max(60) }).strict(),
  z.object({ action: z.literal('waiting_human'), resumeRequired: z.literal(true), message: z.string() }).strict(),
  z.object({ action: z.literal('paused'), message: z.string() }).strict(),
  z.object({ action: z.literal('completed'), message: z.string() }).strict(),
  z.object({ action: z.literal('failed'), message: z.string() }).strict(),
  z.object({ action: z.literal('cancelled'), message: z.string() }).strict(),
]);
export const CollaborationHeartbeatOutputSchema = z.object({ attemptId: z.string(), leaseExpiresAt: z.string(), replayed: z.boolean() }).strict();
export const CollaborationUpdateTodoOutputSchema = z.object({ todo: TodoViewSchema, taskStatus: CollaborationTaskStatusSchema, replayed: z.boolean() }).strict();
export const CollaborationSubmitResultOutputSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('submitted'), artifactId: z.string(), version: z.number().int(), artifactStatus: z.enum(['pending', 'accepted', 'rejected', 'superseded']), taskStatus: CollaborationTaskStatusSchema, runStatus: CollaborationRunStatusSchema, replayed: z.boolean() }).strict(),
  z.object({ action: z.literal('repair_result'), issues: z.array(z.object({ code: z.string(), path: z.string(), message: z.string() }).strict()), repairsRemaining: z.number().int().min(0), replayed: z.boolean() }).strict(),
]);
export const CollaborationGetRunOutputSchema = z.object({ runId: z.string(), status: CollaborationRunStatusSchema, roleSlots: z.array(RoleSlotSummarySchema), assignedTasks: z.array(AgentTaskViewSchema), waitingReason: z.string().optional() }).strict();
export type CollaborationTemplateDefinition = z.infer<typeof CollaborationTemplateDefinitionSchema>;
export type CollaborationRunStatus = z.infer<typeof CollaborationRunStatusSchema>;
export type CollaborationTaskStatus = z.infer<typeof CollaborationTaskStatusSchema>;
```

After the structural schemas, add `superRefine` checks for unique input/Role Slot/node/Todo/output keys, at least one required Todo, existing role/node/terminal references, terminal nodes with no outgoing edge, Artifact producer reachability, review source edge and ancestor revision target, and illegal `any + required upstream Artifact`. Add strict input-value schemas and parse every MCP output before returning it. In `agent-access-role.ts`, append `collaboration:read` to the reader base and `collaboration:execute` to the editor additions, then export `collaboration.ts` from `index.ts`. Keep the existing sorted-return behavior so role snapshots remain deterministic.

- [ ] **Step 4: Run shared contract gates and verify GREEN**

Run:

```bash
cd agentwiki
pnpm --filter @neomei/agentwiki-sync-protocol exec vitest run src/collaboration.spec.ts src/agent-access-role.spec.ts
pnpm --filter @neomei/agentwiki-sync-protocol typecheck
pnpm --filter @neomei/agentwiki-sync-protocol build
```

Expected: all commands exit 0; the collaboration suite reports 4 passing tests and the updated role suite remains green.

- [ ] **Step 5: Commit the contract**

```bash
git add agentwiki/packages/sync-protocol
git commit -m "feat(collaboration): define shared workflow contract"
```

---

### Task 2: PostgreSQL Collaboration Model and Migration

**Files:**
- Modify: `agentwiki/apps/server/prisma/schema.prisma`
- Create: `agentwiki/apps/server/prisma/migrations/20260822220000_agent_collaboration_workflows/migration.sql`
- Create: `agentwiki/scripts/collaboration-schema-db.test.mjs`
- Create: `agentwiki/scripts/collaboration-test-database.mjs`
- Modify: `agentwiki/scripts/pgvector-semantic-search-db.test.mjs`
- Modify: `agentwiki/package.json`

**Interfaces:**
- Consumes: state names and object names from Task 1.
- Produces: Prisma delegates for the ten fixed collaboration records and database-enforced uniqueness needed by idempotency, active attempts, Artifact versions, and template seeds.

- [ ] **Step 1: Write a failing real-database schema test**

```js
// scripts/collaboration-schema-db.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { withCollaborationTestDatabase } from './collaboration-test-database.mjs';

const requireFromServer = createRequire(new URL('../apps/server/package.json', import.meta.url));
const { PrismaClient } = requireFromServer('@prisma/client');
const baseDatabaseUrl = process.env.COLLABORATION_TEST_DATABASE_URL;
test('collaboration migration exposes all ten tables and integrity guards', { skip: baseDatabaseUrl ? false : 'COLLABORATION_TEST_DATABASE_URL is not configured' }, async () => {
  await withCollaborationTestDatabase(baseDatabaseUrl, async ({ databaseUrl, schemaName }) => {
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  try {
    const rows = await prisma.$queryRawUnsafe('SELECT tablename FROM pg_tables WHERE schemaname = $1 AND tablename LIKE \'Collaboration%\' ORDER BY tablename', schemaName);
    assert.deepEqual(rows.map((row) => row.tablename), [
      'CollaborationReview', 'CollaborationRoleBinding', 'CollaborationRun', 'CollaborationRunEvent',
      'CollaborationRunTask', 'CollaborationTaskArtifact', 'CollaborationTaskAttempt',
      'CollaborationTaskDependency', 'CollaborationTaskTodo', 'CollaborationTemplate',
    ]);
  } finally {
    await prisma.$disconnect();
  }
  });
});
```

`withCollaborationTestDatabase()` must parse and validate the dedicated URL, require the database name itself to contain `test`, reject an empty database name and any pre-existing `schema` not matching `^collaboration_test_[a-z0-9_]+$`, create a fresh `collaboration_test_<random>` schema, run `prisma migrate deploy` with a child-process `DATABASE_URL` pointing only at that schema, and in `finally` quote and drop only the exact generated schema. It must never fall back to `DATABASE_URL`, never migrate `public`, and never accept a production-identity bypass flag.

- [ ] **Step 2: Run the schema test and verify RED**

Run: `cd agentwiki && node --test scripts/collaboration-schema-db.test.mjs`

Expected with `COLLABORATION_TEST_DATABASE_URL` configured: FAIL because the collaboration tables do not exist. Without it: one explicit skip, which is not accepted as migration evidence.

- [ ] **Step 3: Add exact Prisma models, enums, relations, and migration constraints**

Add Prisma enums for the run/task/Todo/Artifact/review states from Task 1 and these models with the named uniqueness rules:

```prisma
model CollaborationTemplate {
  id          String   @id @default(cuid())
  spaceId     String?
  scopeKey    String
  slug        String
  name        String
  description String   @default("")
  version     Int      @default(1)
  seedVersion Int?
  system      Boolean  @default(false)
  archivedAt  DateTime?
  definition  Json
  createdById String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  space       Space? @relation(fields: [spaceId], references: [id], onDelete: Cascade)
  createdBy   User? @relation("CollaborationTemplateCreatedBy", fields: [createdById], references: [id], onDelete: SetNull)
  runs        CollaborationRun[]
  @@unique([scopeKey, slug])
  @@index([spaceId, archivedAt])
}

model CollaborationRun {
  id               String @id @default(cuid())
  spaceId          String
  templateId       String
  templateVersion  Int
  templateSnapshot Json
  snapshotHash     String
  name             String
  status           CollaborationRunStatus @default(draft)
  version          Int @default(1)
  inputs            Json
  startedById      String
  pauseReason       String?
  eventSequence     Int @default(0)
  startedAt         DateTime?
  finishedAt        DateTime?
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
  template          CollaborationTemplate @relation(fields: [templateId], references: [id])
  space             Space @relation(fields: [spaceId], references: [id], onDelete: Cascade)
  startedBy         User @relation("CollaborationRunStartedBy", fields: [startedById], references: [id], onDelete: Restrict)
  roleBindings      CollaborationRoleBinding[]
  tasks             CollaborationRunTask[]
  dependencies      CollaborationTaskDependency[]
  reviews           CollaborationReview[]
  events            CollaborationRunEvent[]
  @@index([spaceId, status, updatedAt])
}

model CollaborationRoleBinding {
  id           String @id @default(cuid())
  runId        String
  roleSlotId   String
  roleSlotName String
  agentId      String
  run          CollaborationRun @relation(fields: [runId], references: [id], onDelete: Cascade)
  agent        Agent @relation(fields: [agentId], references: [id], onDelete: Restrict)
  @@unique([runId, roleSlotId])
  @@index([agentId, runId])
}

model CollaborationRunTask {
  id                 String @id @default(cuid())
  runId              String
  nodeId             String
  ordinal            Int
  name               String
  objective          String
  roleSlotId         String
  assigneeAgentId    String
  status             CollaborationTaskStatus @default(blocked)
  generation         Int @default(1)
  dependencyMode     CollaborationDependencyMode @default(all)
  outputContract     Json
  requiredEvidence   Json
  humanAcceptance    Boolean @default(false)
  skippable          Boolean @default(false)
  leaseSeconds       Int
  maxExecutionSeconds Int
  retryBudget        Int @default(0)
  repairBudget       Int @default(0)
  nextAttemptAt      DateTime?
  completedAt        DateTime?
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt
  run                CollaborationRun @relation(fields: [runId], references: [id], onDelete: Cascade)
  assignee           Agent @relation(fields: [assigneeAgentId], references: [id], onDelete: Restrict)
  todos              CollaborationTaskTodo[]
  attempts           CollaborationTaskAttempt[]
  artifacts          CollaborationTaskArtifact[]
  sourceReviews      CollaborationReview[] @relation("CollaborationReviewSourceTask")
  revisionReviews    CollaborationReview[] @relation("CollaborationReviewRevisionTask")
  @@unique([id, runId])
  @@unique([runId, nodeId])
  @@index([runId, assigneeAgentId, status, ordinal])
  @@index([status, nextAttemptAt])
}

model CollaborationTaskTodo {
  id          String @id @default(cuid())
  runId       String
  taskId      String
  generation  Int
  templateId  String
  ordinal     Int
  name        String
  required    Boolean @default(true)
  status      CollaborationTodoStatus @default(pending)
  summary     String?
  evidence    Json?
  updatedAt   DateTime @updatedAt
  task        CollaborationRunTask @relation(fields: [taskId, runId], references: [id, runId], onDelete: Cascade)
  @@unique([taskId, generation, templateId])
  @@unique([taskId, generation, ordinal])
}

model CollaborationTaskDependency {
  id         String @id @default(cuid())
  runId      String
  fromNodeId String
  toNodeId   String
  mode       CollaborationDependencyMode
  run        CollaborationRun @relation(fields: [runId], references: [id], onDelete: Cascade)
  @@unique([runId, fromNodeId, toNodeId])
  @@index([runId, toNodeId])
}

model CollaborationTaskAttempt {
  id                  String @id @default(cuid())
  runId               String
  taskId              String
  generation          Int
  agentId             String
  attemptNumber       Int
  status              CollaborationAttemptStatus
  claimIdempotencyKey String
  leaseTokenHash      String
  leaseStartedAt      DateTime
  leaseExpiresAt      DateTime
  maxExecutionAt      DateTime
  failureCode         String?
  repairCount         Int @default(0)
  finishedAt          DateTime?
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt
  runTask             CollaborationRunTask @relation(fields: [taskId, runId], references: [id, runId], onDelete: Cascade)
  agent               Agent @relation(fields: [agentId], references: [id], onDelete: Restrict)
  artifacts           CollaborationTaskArtifact[]
  @@unique([taskId, generation, attemptNumber])
  @@unique([id, taskId, runId, generation])
  @@index([runId, agentId, status])
  @@index([status, leaseExpiresAt])
}

model CollaborationTaskArtifact {
  id          String @id @default(cuid())
  runId       String
  taskId      String
  attemptId   String
  generation  Int
  version     Int
  kind        CollaborationArtifactKind
  status      CollaborationArtifactStatus @default(pending)
  payload     Json
  evidence    Json
  acceptedAt  DateTime?
  createdAt   DateTime @default(now())
  task        CollaborationRunTask @relation(fields: [taskId, runId], references: [id, runId], onDelete: Cascade)
  attempt     CollaborationTaskAttempt @relation(fields: [attemptId, taskId, runId, generation], references: [id, taskId, runId, generation], onDelete: Restrict)
  reviews     CollaborationReview[]
  @@unique([id, runId])
  @@unique([id, runId, generation])
  @@unique([taskId, generation, version])
  @@index([taskId, generation, status, version])
}

model CollaborationReview {
  id             String @id @default(cuid())
  runId          String
  nodeId         String
  revision       Int @default(1)
  generation     Int
  sourceTaskId   String
  artifactId     String
  revisionTaskId String
  minimumRole    String
  reviewerUserIds Json
  allowTerminate Boolean @default(false)
  status         CollaborationReviewStatus @default(pending)
  reviewerUserId String?
  reason         String?
  decidedAt      DateTime?
  createdAt      DateTime @default(now())
  run            CollaborationRun @relation(fields: [runId], references: [id], onDelete: Cascade)
  sourceTask     CollaborationRunTask @relation("CollaborationReviewSourceTask", fields: [sourceTaskId, runId], references: [id, runId], onDelete: Cascade)
  revisionTask   CollaborationRunTask @relation("CollaborationReviewRevisionTask", fields: [revisionTaskId, runId], references: [id, runId], onDelete: Restrict)
  artifact       CollaborationTaskArtifact @relation(fields: [artifactId, runId, generation], references: [id, runId, generation], onDelete: Restrict)
  reviewer       User? @relation("CollaborationReviewReviewer", fields: [reviewerUserId], references: [id], onDelete: SetNull)
  @@unique([runId, nodeId, revision])
  @@index([runId, status])
}

model CollaborationRunEvent {
  id             String @id @default(cuid())
  runId          String
  sequence       Int
  type           String
  actorKind      String
  actorId        String
  operation      String
  target         String
  actorUserId    String?
  actorAgentId   String?
  idempotencyKey String
  requestHash    String
  metadata       Json
  response       Json?
  createdAt      DateTime @default(now())
  run            CollaborationRun @relation(fields: [runId], references: [id], onDelete: Cascade)
  actorUser      User? @relation("CollaborationEventUser", fields: [actorUserId], references: [id], onDelete: SetNull)
  actorAgent     Agent? @relation("CollaborationEventAgent", fields: [actorAgentId], references: [id], onDelete: SetNull)
  @@unique([runId, sequence])
  @@unique([runId, actorKind, actorId, operation, idempotencyKey])
  @@index([runId, createdAt])
}
```

Add the corresponding enum definitions exactly matching Task 1 plus `CollaborationDependencyMode(all, any)`, `CollaborationAttemptStatus(claimed, running, expired, completed, failed, invalidated)`, `CollaborationArtifactStatus(pending, accepted, rejected, superseded)`, and `CollaborationReviewStatus(pending, approved, rejected, terminated, superseded)`. Add these exact inverse collections: Space gets `collaborationTemplates` and `collaborationRuns`; User gets `collaborationTemplatesCreated`, `collaborationRunsStarted`, `collaborationReviewsDecided`, and `collaborationEvents`; Agent gets `collaborationRoleBindings`, `collaborationAssignedTasks`, `collaborationAttempts`, and `collaborationEvents`. Use the relation names shown in the model snippet where Prisma would otherwise see ambiguity. Every declared foreign key must be represented in Prisma rather than left as an unmodelled raw ID. Use `scopeKey = "system"` for system seeds and `scopeKey = spaceId` for Space templates because PostgreSQL nullable compound uniqueness does not make `(NULL, slug)` unique. The migration adds the composite foreign keys shown above and these indexes:

```sql
CREATE UNIQUE INDEX "CollaborationTaskAttempt_one_active"
ON "CollaborationTaskAttempt" ("taskId")
WHERE "status" IN ('claimed', 'running');

CREATE UNIQUE INDEX "CollaborationTaskAttempt_one_active_per_agent_run"
ON "CollaborationTaskAttempt" ("runId", "agentId")
WHERE "status" IN ('claimed', 'running');

CREATE INDEX "CollaborationTaskAttempt_lease_scan"
ON "CollaborationTaskAttempt" ("status", "leaseExpiresAt");

ALTER TABLE "CollaborationTemplate" ADD CONSTRAINT "CollaborationTemplate_scope_check"
CHECK (("system" AND "scopeKey" = 'system' AND "spaceId" IS NULL)
    OR (NOT "system" AND "spaceId" IS NOT NULL AND "scopeKey" = "spaceId"));
ALTER TABLE "CollaborationTaskAttempt" ADD CONSTRAINT "CollaborationTaskAttempt_lease_bounds_check"
CHECK ("leaseExpiresAt" <= "maxExecutionAt");
ALTER TABLE "CollaborationRunEvent" ADD CONSTRAINT "CollaborationRunEvent_actor_check"
CHECK (("actorUserId" IS NOT NULL)::int + ("actorAgentId" IS NOT NULL)::int <= 1);
```

The schema test must also attempt invalid cross-run Task/Attempt/Artifact/Review inserts and each CHECK violation, and assert PostgreSQL rejects them. Run the existing Prisma drift command and keep the allowlist in `pgvector-semantic-search-db.test.mjs` exactly `Removed index on columns (embeddingVector)`; collaboration CHECK/partial indexes must not justify accepting any second unexpected drift line.

- [ ] **Step 4: Generate Prisma, apply to an isolated test database, and verify GREEN**

Run:

```bash
cd agentwiki
pnpm --filter @agentwiki/server exec prisma generate
COLLABORATION_TEST_DATABASE_URL='<dedicated non-production test database URL>' node --test scripts/collaboration-schema-db.test.mjs
pnpm --filter @agentwiki/server typecheck
```

Expected: all commands exit 0; schema test passes and Prisma typecheck recognizes all ten delegates.

- [ ] **Step 5: Commit the schema**

```bash
git add agentwiki/apps/server/prisma agentwiki/scripts/collaboration-schema-db.test.mjs agentwiki/scripts/collaboration-test-database.mjs agentwiki/scripts/pgvector-semantic-search-db.test.mjs agentwiki/package.json
git commit -m "feat(collaboration): persist workflow state"
```

---

### Task 3: Template Validation and Five Immutable Built-ins

**Files:**
- Create: `agentwiki/apps/server/src/collaboration-workflows/template-definitions.ts`
- Create: `agentwiki/apps/server/src/collaboration-workflows/template-validator.ts`
- Create: `agentwiki/apps/server/src/collaboration-workflows/template-validator.spec.ts`
- Create: `agentwiki/apps/server/src/collaboration-workflows/built-in-templates.spec.ts`

**Interfaces:**
- Consumes: `CollaborationTemplateDefinition` and schema from Task 1.
- Produces: `BUILT_IN_COLLABORATION_TEMPLATES`, `validateCollaborationTemplate(definition): TemplateValidationIssue[]`, and `hashCollaborationTemplate(definition): string`.

- [ ] **Step 1: Write failing graph-validation and built-in contract tests**

```ts
// apps/server/src/collaboration-workflows/template-validator.spec.ts
it.each([
  ["cycle", [{ from: "a", to: "b", mode: "all" }, { from: "b", to: "a", mode: "all" }], "DEPENDENCY_CYCLE"],
  ["missing node", [{ from: "missing", to: "a", mode: "all" }], "DEPENDENCY_NODE_MISSING"],
] as const)("rejects %s", (_name, dependencies, code) => {
  const definition = validDefinition({ dependencies });
  expect(validateCollaborationTemplate(definition)).toContainEqual(expect.objectContaining({ code }));
});

it("rejects unreachable required nodes, missing entry/terminal, illegal review return, duplicate keys, and unsafe any inputs", () => {
  expect(validateCollaborationTemplate(invalidReachabilityDefinition()).map((issue) => issue.code)).toEqual(expect.arrayContaining([
    "REQUIRED_NODE_UNREACHABLE", "ENTRY_NODE_MISSING", "TERMINAL_NODE_MISSING", "REVISION_TARGET_INVALID",
    "KEY_DUPLICATE", "REVIEW_SOURCE_EDGE_MISSING", "UPSTREAM_ARTIFACT_UNREACHABLE", "ANY_REQUIRED_ARTIFACT_UNSAFE",
  ]));
});

// apps/server/src/collaboration-workflows/built-in-templates.spec.ts
it("ships five stable immutable seeds that pass schema and graph validation", () => {
  expect(BUILT_IN_COLLABORATION_TEMPLATES.map((item) => item.slug)).toEqual([
    "coding", "bid-writing", "paper-writing", "video-script-writing", "novel-writing",
  ]);
  for (const seed of BUILT_IN_COLLABORATION_TEMPLATES) {
    expect(seed.seedVersion).toBe(1);
    expect(() => CollaborationTemplateDefinitionSchema.parse(seed.definition)).not.toThrow();
    expect(validateCollaborationTemplate(seed.definition)).toEqual([]);
  }
});
```

- [ ] **Step 2: Run both suites and verify RED**

Run: `cd agentwiki && pnpm --filter @agentwiki/server exec jest --runInBand src/collaboration-workflows/template-validator.spec.ts src/collaboration-workflows/built-in-templates.spec.ts`

Expected: FAIL because validator and seed files do not exist.

- [ ] **Step 3: Implement deterministic graph validation and stable hashing**

```ts
// apps/server/src/collaboration-workflows/template-validator.ts
import { createHash } from 'crypto';
import { CollaborationTemplateDefinitionSchema, type CollaborationTemplateDefinition } from '@neomei/agentwiki-sync-protocol';

export type TemplateValidationIssue = { code: string; path: string; message: string };
export function hashCollaborationTemplate(value: CollaborationTemplateDefinition): string {
  return createHash('sha256').update(JSON.stringify(sortObject(value))).digest('hex');
}
export function validateCollaborationTemplate(input: unknown): TemplateValidationIssue[] {
  const parsed = CollaborationTemplateDefinitionSchema.safeParse(input);
  if (!parsed.success) return parsed.error.issues.map((issue) => ({ code: 'SCHEMA_INVALID', path: issue.path.join('.'), message: issue.message }));
  const definition = parsed.data;
  const ids = new Set(definition.nodes.map((node) => node.id));
  const issues: TemplateValidationIssue[] = [];
  for (const edge of definition.dependencies) {
    if (!ids.has(edge.from) || !ids.has(edge.to)) issues.push({ code: 'DEPENDENCY_NODE_MISSING', path: 'dependencies', message: `${edge.from}->${edge.to}` });
  }
  issues.push(...detectCycleAndReachability(definition));
  for (const node of definition.nodes) {
    const revisionTarget = definition.nodes.find((candidate) => candidate.id === (node.kind === 'human_review' ? node.revisionTaskId : ''));
    if (node.kind === 'human_review' && (!revisionTarget || revisionTarget.kind !== 'agent_task' || !isAncestorOrSelf(definition, node.revisionTaskId, node.artifactTaskId))) {
      issues.push({ code: 'REVISION_TARGET_INVALID', path: `nodes.${node.id}.revisionTaskId`, message: node.revisionTaskId });
    }
  }
  issues.push(...validateUniqueKeysAndRequiredTodos(definition));
  issues.push(...validateArtifactReachabilityAndAnySafety(definition));
  issues.push(...validateReviewSourceEdges(definition));
  return uniqueIssues(issues);
}

function detectCycleAndReachability(definition: CollaborationTemplateDefinition): TemplateValidationIssue[] {
  const ids = new Set(definition.nodes.map((node) => node.id));
  const incoming = new Map([...ids].map((id) => [id, new Set<string>()]));
  const outgoing = new Map([...ids].map((id) => [id, new Set<string>()]));
  const modes = new Map<string, Set<'all' | 'any'>>();
  for (const edge of definition.dependencies) {
    if (!ids.has(edge.from) || !ids.has(edge.to)) continue;
    outgoing.get(edge.from)!.add(edge.to);
    incoming.get(edge.to)!.add(edge.from);
    const targetModes = modes.get(edge.to) ?? new Set();
    targetModes.add(edge.mode);
    modes.set(edge.to, targetModes);
  }
  const issues: TemplateValidationIssue[] = [];
  for (const [target, targetModes] of modes) {
    if (targetModes.size > 1) issues.push({ code: 'DEPENDENCY_MODE_CONFLICT', path: `dependencies.${target}`, message: 'Incoming dependency modes must match' });
  }
  const entries = [...ids].filter((id) => incoming.get(id)!.size === 0);
  if (entries.length === 0) issues.push({ code: 'ENTRY_NODE_MISSING', path: 'nodes', message: 'At least one entry node is required' });
  const declaredTerminals = definition.terminalNodeIds.filter((id) => ids.has(id));
  if (declaredTerminals.length === 0) issues.push({ code: 'TERMINAL_NODE_MISSING', path: 'terminalNodeIds', message: 'At least one valid terminal node is required' });
  for (const id of declaredTerminals) {
    if (outgoing.get(id)!.size > 0) issues.push({ code: 'TERMINAL_NODE_INVALID', path: `terminalNodeIds.${id}`, message: 'A terminal node cannot have outgoing dependencies' });
  }
  const indegree = new Map([...incoming].map(([id, from]) => [id, from.size]));
  const queue = entries.slice().sort();
  let visited = 0;
  while (queue.length) {
    const id = queue.shift()!;
    visited += 1;
    for (const next of [...outgoing.get(id)!].sort()) {
      indegree.set(next, indegree.get(next)! - 1);
      if (indegree.get(next) === 0) queue.push(next);
    }
    queue.sort();
  }
  if (visited !== ids.size) issues.push({ code: 'DEPENDENCY_CYCLE', path: 'dependencies', message: 'Dependencies must be acyclic' });
  const reachesTerminal = new Set(declaredTerminals);
  const reverseQueue = declaredTerminals.slice();
  while (reverseQueue.length) {
    const id = reverseQueue.shift()!;
    for (const previous of incoming.get(id) ?? []) {
      if (!reachesTerminal.has(previous)) { reachesTerminal.add(previous); reverseQueue.push(previous); }
    }
  }
  for (const id of [...ids].sort()) {
    if (!reachesTerminal.has(id)) issues.push({ code: 'REQUIRED_NODE_UNREACHABLE', path: `nodes.${id}`, message: 'Required node cannot reach a declared terminal' });
  }
  return issues;
}

function sortObject(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObject);
  if (value !== null && typeof value === 'object') return Object.keys(value as Record<string, unknown>).sort().reduce<Record<string, unknown>>((result, key) => {
    result[key] = sortObject((value as Record<string, unknown>)[key]);
    return result;
  }, {});
  return value;
}

function uniqueIssues(issues: TemplateValidationIssue[]): TemplateValidationIssue[] {
  return [...new Map(issues.map((issue) => [`${issue.code}|${issue.path}|${issue.message}`, issue])).values()]
    .sort((left, right) => `${left.code}|${left.path}|${left.message}`.localeCompare(`${right.code}|${right.path}|${right.message}`));
}
```

- [ ] **Step 4: Define all five complete seeds and verify their domain-specific gates**

In `template-definitions.ts`, first parse every literal through `CollaborationTemplateDefinitionSchema`, clone the parsed value, then recursively `deepFreeze` the result. Export seeds with `slug`, bilingual `name`, `seedVersion: 1`, and a complete Task/Review graph. `Object.freeze` on only the outer array is insufficient. Ensure these exact review-gate counts and distinguishing constraints:

```ts
export const BUILT_IN_COLLABORATION_TEMPLATES = Object.freeze([
  codingTemplate, bidWritingTemplate, paperWritingTemplate, videoScriptWritingTemplate, novelWritingTemplate,
] as const);

// Contract asserted in built-in-templates.spec.ts
expect(reviewCount("coding")).toBe(1);
expect(reviewCount("bid-writing")).toBe(3);
expect(reviewCount("paper-writing")).toBe(2);
expect(reviewCount("video-script-writing")).toBe(1);
expect(reviewCount("novel-writing")).toBe(2);
expect(task("novel-writing", "write-chapters").objective).toContain("continuity dependencies");
expect(task("paper-writing", "verify-citations").evidenceRequired).toContain("source-verification");
```

The bid template's review nodes are `bid-consensus-review`, `missing-material-review`, and `final-bid-review`; coverage, outline mapping, image-text mapping, and merged-draft consistency remain Agent tasks/Todo checks. The coding template ends with `merge-release-review` and never claims to publish or modify a repository itself.

Use this exact seed manifest; arrows are dependency edges, comma-separated predecessors use `all` unless marked `any`, and every listed output is the task's explicit Artifact key:

| Slug | Role Slot IDs | Ordered node IDs and outputs |
|---|---|---|
| `coding` | `planner`, `implementer-a`, `implementer-b`, `tester`, `code-reviewer`, `release-owner` | `requirements-analysis(plan)` → `implementation-plan(test-plan)` → parallel `implement-module-a(patch-a)` + `implement-module-b(patch-b)` → parallel `run-tests(test-evidence)` + `agent-code-review(review-report)` → `fix-defects(fixed-patch)` → `release-summary(release-notes)` → `merge-release-review` |
| `bid-writing` | `tender-analyst`, `material-manager`, `solution-architect`, `section-writer-a`, `section-writer-b`, `compliance-reviewer`, `final-editor` | `tender-analysis(scoring-matrix)` + `material-catalog(material-index)` → `bid-consensus-review` → `outline-and-mapping(outline)` → parallel `write-technical-sections(technical-draft)` + `write-service-sections(service-draft)` → `missing-material-review` → `coverage-and-visual-check(coverage-report)` → `merge-and-polish(merged-bid)` → `final-bid-review` → `export-reference(export-manifest)` |
| `paper-writing` | `research-planner`, `literature-researcher`, `method-analyst`, `chapter-author`, `citation-verifier`, `academic-editor` | `research-scope(research-outline)` → `outline-review` → parallel `literature-review(source-list)` + `method-analysis(method-note)` → `draft-chapters(chapter-draft)` → `verify-citations(citation-report)` → `academic-edit(final-markdown)` → `paper-final-review` → `paper-export-reference(export-manifest)` |
| `video-script-writing` | `content-planner`, `fact-researcher`, `script-writer`, `storyboard-designer`, `brand-fact-reviewer` | `creative-brief(brief)` → `fact-research(fact-cards)` → `hook-and-structure(structure)` → parallel `write-voiceover(voiceover)` + `design-storyboard(storyboard)` → `duration-fact-brand-check(review-report)` → `final-script(final-script)` → `pre-production-review` |
| `novel-writing` | `world-builder`, `plot-architect`, `chapter-author`, `continuity-editor`, `style-editor` | parallel `world-bible(world-bible)` + `character-bible(character-bible)` → `story-outline(story-outline)` → `outline-review` → `write-chapters(chapter-drafts)` → `continuity-check(continuity-report)` → `style-edit(full-manuscript)` → `novel-final-review` |

Each Agent task contains at least one Todo and at least one required Todo. Each upstream Artifact declaration names a reachable producer and marks the input required/optional. Coding requires commit/patch and test evidence; paper citation verification requires source identifiers and marks unverifiable claims; video review checks duration, facts, and brand tone; novel chapter work defaults to sequential continuity dependencies. `export-reference` tasks produce references only and never upload DOCX/PDF/LaTeX. Add validator issues for duplicate keys, dangling role/output/review references, missing review source edge, non-ancestor revision target, required Artifact on an early-release `any` path, and incoming edges that mix `all` and `any` for one target.

- [ ] **Step 5: Run focused and package tests, then commit**

Run:

```bash
cd agentwiki
pnpm --filter @agentwiki/server exec jest --runInBand src/collaboration-workflows/template-validator.spec.ts src/collaboration-workflows/built-in-templates.spec.ts
pnpm --filter @agentwiki/server typecheck
```

Expected: all commands exit 0; every seed parses and validator tests cover cycle, missing node, reachability, entry, terminal, and revision-target failures.

```bash
git add agentwiki/apps/server/src/collaboration-workflows
git commit -m "feat(collaboration): add validated built-in templates"
```

---

### Task 4: Template API, Versioned Seed Upsert, and Human Authorization

**Files:**
- Create: `agentwiki/apps/server/src/collaboration-workflows/template.dto.ts`
- Create: `agentwiki/apps/server/src/collaboration-workflows/template.service.ts`
- Create: `agentwiki/apps/server/src/collaboration-workflows/template.controller.ts`
- Create: `agentwiki/apps/server/src/collaboration-workflows/template.service.spec.ts`
- Create: `agentwiki/apps/server/src/collaboration-workflows/template.controller.spec.ts`
- Create: `agentwiki/apps/server/src/collaboration-workflows/collaboration-workflows.module.ts`
- Modify: `agentwiki/apps/server/src/app.module.ts`
- Modify: `agentwiki/apps/server/src/core/filters/business-error.ts`

**Interfaces:**
- Consumes: Prisma Template model, built-ins, validator, `CombinedAuthGuard`, `HumanOnlyGuard`, and `AuthorizationService.assertSpaceAccess()`.
- Produces: `TemplateService.list()`, `get()`, `createSpaceTemplate()`, `copySystemTemplate()`, `validateDefinition()`, `updateSpaceTemplate()`, `archiveSpaceTemplate()`, `seedBuiltIns()`, and the complete `/spaces/:spaceId/collaboration/templates` HTTP surface.

- [ ] **Step 1: Write failing service tests for immutable seeds, copy isolation, optimistic versioning, and permissions**

```ts
it("conditionally applies only a newer system seed without changing copied Space templates", async () => {
  prisma.collaborationTemplate.findUnique.mockResolvedValueOnce({ id: "system-1", seedVersion: 0, system: true });
  await service.seedBuiltIns();
  expect(prisma.collaborationTemplate.updateMany).toHaveBeenCalledWith(expect.objectContaining({
    where: { id: "system-1", system: true, seedVersion: { lt: 1 } },
    data: expect.objectContaining({ seedVersion: 1 }),
  }));
  expect(prisma.collaborationTemplate.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({ where: { system: false } }));
});

it("does not downgrade a newer seed during rollback or concurrent startup", async () => {
  prisma.collaborationTemplate.findUnique.mockResolvedValueOnce({ id: "system-1", seedVersion: 2, system: true });
  await service.seedBuiltIns();
  expect(prisma.collaborationTemplate.updateMany).not.toHaveBeenCalled();
});

it("increments version only when expectedVersion matches", async () => {
  prisma.collaborationTemplate.updateMany.mockResolvedValue({ count: 0 });
  await expect(service.updateSpaceTemplate("space-1", "template-1", 3, validDefinition(), principal))
    .rejects.toMatchObject({ businessCode: "COLLABORATION_TEMPLATE_VERSION_CONFLICT" });
});

it("rejects editing a system template", async () => {
  prisma.collaborationTemplate.findUnique.mockResolvedValue({ id: "system-1", system: true });
  await expect(service.updateSpaceTemplate("space-1", "system-1", 1, validDefinition(), principal))
    .rejects.toMatchObject({ businessCode: "COLLABORATION_SYSTEM_TEMPLATE_IMMUTABLE" });
});
```

- [ ] **Step 2: Run the focused suite and verify RED**

Run: `cd agentwiki && pnpm --filter @agentwiki/server exec jest --runInBand src/collaboration-workflows/template.service.spec.ts`

Expected: FAIL because the service is absent.

- [ ] **Step 3: Implement API-only seed startup and transactional template mutations**

```ts
@Injectable()
export class TemplateService implements OnModuleInit {
  async onModuleInit(): Promise<void> {
    const role = String(this.config.get('PROCESS_ROLE') || 'api').toLowerCase();
    if (role === 'api' || role === 'all') await this.seedBuiltIns();
  }

  async updateSpaceTemplate(spaceId: string, templateId: string, expectedVersion: number, definition: unknown, principal: Principal) {
    await this.authorization.assertSpaceAccess(principal, spaceId, ['owner', 'admin']);
    const issues = validateCollaborationTemplate(definition);
    if (issues.length) throw new BusinessException('COLLABORATION_TEMPLATE_INVALID', undefined, { issues });
    const current = await this.prisma.collaborationTemplate.findUnique({ where: { id: templateId } });
    if (!current || current.spaceId !== spaceId) throw new BusinessException('COLLABORATION_TEMPLATE_NOT_FOUND');
    if (current.system) throw new BusinessException('COLLABORATION_SYSTEM_TEMPLATE_IMMUTABLE');
    const result = await this.prisma.collaborationTemplate.updateMany({
      where: { id: templateId, spaceId, system: false, version: expectedVersion, archivedAt: null },
      data: { definition: definition as Prisma.InputJsonValue, version: { increment: 1 } },
    });
    if (result.count !== 1) throw new BusinessException('COLLABORATION_TEMPLATE_VERSION_CONFLICT');
    return this.prisma.collaborationTemplate.findUniqueOrThrow({ where: { id: templateId } });
  }
}
```

`seedBuiltIns()` runs each seed in a transaction and uses a conditional insert/update whose update predicate is `system = true AND seedVersion < incomingSeedVersion`; after a unique conflict it re-reads and retries the conditional update. It parses and deep-clones the seed before persistence. Same-version startup is a no-op, an older binary cannot downgrade a newer seed, and copied Space rows are never selected.

Use a single transaction in `copySystemTemplate` to re-read the system template, validate it, allocate a collision-free Space slug, and create an independent definition JSON. Add explicit business codes for invalid, not found, immutable, version conflict, and access denied to `ERROR_CODE_MAP`. Extend the payload without changing existing callers:

```ts
export interface BusinessErrorPayload {
  statusCode: number;
  code: string;
  message: string;
  error: string;
  details?: unknown;
}

constructor(code: keyof typeof ERROR_CODE_MAP, messageOverride?: string, details?: unknown) {
  const def = ERROR_CODE_MAP[code];
  const payload = { statusCode: def.status, code, message: messageOverride || def.message, error: errorNameFor(def.status), ...(details === undefined ? {} : { details }) };
  super(payload, def.status);
  this.businessCode = code;
  this.statusCode = def.status;
}
```

Error details contain validation issue codes/paths/messages but no input values or secrets. Extract the existing inline error-name selection into `errorNameFor(status)` so behavior for all current errors remains byte-for-byte equivalent.

Add this complete collaboration code/status set to `ERROR_CODE_MAP`; later tasks reuse these names instead of inventing new transport errors:

```ts
COLLABORATION_TEMPLATE_INVALID: { status: HttpStatus.BAD_REQUEST, message: 'Collaboration template is invalid' },
COLLABORATION_TEMPLATE_NOT_FOUND: { status: HttpStatus.NOT_FOUND, message: 'Collaboration template not found' },
COLLABORATION_SYSTEM_TEMPLATE_IMMUTABLE: { status: HttpStatus.CONFLICT, message: 'System collaboration templates are immutable' },
COLLABORATION_TEMPLATE_VERSION_CONFLICT: { status: HttpStatus.CONFLICT, message: 'Collaboration template changed; reload before saving' },
COLLABORATION_HUMAN_PERMISSION_DENIED: { status: HttpStatus.FORBIDDEN, message: 'This human member cannot perform the collaboration action' },
COLLABORATION_RUN_VERSION_CONFLICT: { status: HttpStatus.CONFLICT, message: 'Collaboration run draft changed; reload before continuing' },
COLLABORATION_RUN_TERMINAL: { status: HttpStatus.CONFLICT, message: 'The collaboration run is terminal' },
COLLABORATION_PROGRESS_INVARIANT: { status: HttpStatus.CONFLICT, message: 'Collaboration progression state requires human recovery' },
COLLABORATION_AGENT_INACTIVE: { status: HttpStatus.CONFLICT, message: 'A bound Agent is inactive' },
COLLABORATION_AGENT_CANNOT_EXECUTE: { status: HttpStatus.FORBIDDEN, message: 'A bound Agent cannot execute collaboration tasks' },
COLLABORATION_AGENT_NOT_BOUND: { status: HttpStatus.FORBIDDEN, message: 'The Agent is not a bound or assigned participant in this run' },
COLLABORATION_LEASE_EXPIRED: { status: HttpStatus.CONFLICT, message: 'The collaboration task lease expired' },
COLLABORATION_TODO_NOT_FOUND: { status: HttpStatus.NOT_FOUND, message: 'Collaboration Todo not found' },
COLLABORATION_TODO_OUT_OF_ORDER: { status: HttpStatus.CONFLICT, message: 'Required earlier Todo items must finish first' },
COLLABORATION_TODO_TRANSITION_INVALID: { status: HttpStatus.CONFLICT, message: 'Collaboration Todo transition is invalid' },
COLLABORATION_EXTERNAL_REFERENCE_INVALID: { status: HttpStatus.BAD_REQUEST, message: 'External Artifact reference is invalid' },
COLLABORATION_REVIEWER_DENIED: { status: HttpStatus.FORBIDDEN, message: 'The human member is not an allowed reviewer' },
COLLABORATION_REVIEW_TERMINATE_DENIED: { status: HttpStatus.FORBIDDEN, message: 'This review gate cannot terminate the run' },
COLLABORATION_IDEMPOTENCY_MISMATCH: { status: HttpStatus.CONFLICT, message: 'Idempotency key was reused for another collaboration action' },
```

- [ ] **Step 4: Add guarded HTTP routes and module wiring**

```ts
@Controller('spaces/:spaceId/collaboration/templates')
@UseGuards(CombinedAuthGuard, HumanOnlyGuard)
export class TemplateController {
  @Get() list(@Req() req: Request, @Param('spaceId') spaceId: string) {
    return this.templates.list(spaceId, req.user as Principal);
  }
  @Post() create(@Req() req: Request, @Param('spaceId') spaceId: string, @Body() body: CreateTemplateDto) {
    return this.templates.createSpaceTemplate(spaceId, body, req.user as Principal);
  }
  @Post('validate') validate(@Req() req: Request, @Param('spaceId') spaceId: string, @Body() body: ValidateTemplateDto) {
    return this.templates.validateDefinition(spaceId, body.definition, req.user as Principal);
  }
  @Get(':templateId') get(@Req() req: Request, @Param('spaceId') spaceId: string, @Param('templateId') templateId: string) {
    return this.templates.get(spaceId, templateId, req.user as Principal);
  }
  @Post(':templateId/copy') copy(@Req() req: Request, @Param('spaceId') spaceId: string, @Param('templateId') templateId: string, @Body() body: CopyTemplateDto) {
    return this.templates.copySystemTemplate(spaceId, templateId, body.name, req.user as Principal);
  }
  @Put(':templateId') update(@Req() req: Request, @Param('spaceId') spaceId: string, @Param('templateId') templateId: string, @Body() body: UpdateTemplateDto) {
    return this.templates.updateSpaceTemplate(spaceId, templateId, body.expectedVersion, body.definition, req.user as Principal);
  }
  @Post(':templateId/archive') archive(@Req() req: Request, @Param('spaceId') spaceId: string, @Param('templateId') templateId: string, @Body() body: ArchiveTemplateDto) {
    return this.templates.archiveSpaceTemplate(spaceId, templateId, body.expectedVersion, req.user as Principal);
  }
}
```

`CollaborationWorkflowsModule` imports `DatabaseModule`, `AuthorizationModule`, and `ConfigModule`, exports its services for MCP, and is imported by `AppModule`. DTOs use class-validator for names and numeric versions, then the service applies the shared Zod definition schema.

- [ ] **Step 5: Verify service, module graph, and commit**

Run:

```bash
cd agentwiki
pnpm --filter @agentwiki/server exec jest --runInBand src/collaboration-workflows/template.service.spec.ts
pnpm --filter @agentwiki/server exec jest --runInBand src/collaboration-workflows/template.controller.spec.ts
pnpm --filter @agentwiki/server exec jest --runInBand src/app.module.spec.ts
pnpm --filter @agentwiki/server typecheck
```

Expected: all commands exit 0; template tests prove conditional non-downgrading seed immutability, copy isolation, create/get/list/validate/copy/update/archive coverage, version conflict, and Owner/Admin-only writes.

```bash
git add agentwiki/apps/server/src/collaboration-workflows agentwiki/apps/server/src/app.module.ts agentwiki/apps/server/src/core/filters/business-error.ts
git commit -m "feat(collaboration): add template management API"
```

---

### Task 5: Transactional Run Creation, Snapshot Expansion, and Human Controls

**Files:**
- Create: `agentwiki/apps/server/src/collaboration-workflows/run.dto.ts`
- Create: `agentwiki/apps/server/src/collaboration-workflows/run.service.ts`
- Create: `agentwiki/apps/server/src/collaboration-workflows/run.controller.ts`
- Create: `agentwiki/apps/server/src/collaboration-workflows/run.service.spec.ts`
- Create: `agentwiki/apps/server/src/collaboration-workflows/run.controller.spec.ts`
- Create: `agentwiki/apps/server/src/collaboration-workflows/run-event.store.ts`
- Create: `agentwiki/apps/server/src/collaboration-workflows/run-event.store.spec.ts`
- Modify: `agentwiki/apps/server/src/collaboration-workflows/collaboration-workflows.module.ts`

**Interfaces:**
- Consumes: Template service/validator, Prisma models, shared schemas, `Principal`, and role-aware authorization from the prerequisite plan.
- Produces: `RunEventStore.executeIdempotent()`, `createDraft()`, `updateDraft()`, `validateDraft()`, `startRun()`, `listRuns()`, `getHumanRun()`, `pauseRun()`, `resumeRun()`, `retryTask()`, `reassignTask()`, `skipTask()`, `failRun()`, and `cancelRun()`.

- [ ] **Step 1: Write failing run-expansion and authorization tests**

```ts
it("persists an optimistic draft, validates it to ready, then freezes and expands it on start", async () => {
  prisma.collaborationTemplate.findUnique.mockResolvedValue(spaceTemplate());
  authorization.assertSpaceAccess.mockResolvedValue({ role: "editor" });
  prisma.agentGrant.findMany.mockResolvedValue([activeEditorGrant("agent-a"), activeEditorGrant("agent-b")]);
  const draft = await service.createDraft("space-1", {
    templateId: "template-1", name: "Release 1", inputs: { objective: "Ship feature" },
    roleBindings: [{ roleSlotId: "planner", agentId: "agent-a" }, { roleSlotId: "builder", agentId: "agent-b" }],
  }, humanPrincipal);
  expect(tx.collaborationRun.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "draft", version: 1 }) }));
  await service.validateDraft("space-1", draft.id, { expectedVersion: draft.version }, humanPrincipal);
  await service.startRun("space-1", draft.id, { expectedVersion: draft.version + 1, idempotencyKey: "start-run-0001" }, humanPrincipal);
  expect(prisma.$transaction).toHaveBeenCalled();
  expect(tx.collaborationRun.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
    templateVersion: 4, snapshotHash: expect.stringMatching(/^[a-f0-9]{64}$/u), status: "running",
  }) }));
  expect(tx.collaborationRunTask.createMany).toHaveBeenCalled();
  expect(tx.collaborationTaskTodo.createMany).toHaveBeenCalled();
  expect(tx.collaborationTaskDependency.createMany).toHaveBeenCalled();
});

it.each([
  ["inactive Agent", inactiveGrant("agent-a"), "COLLABORATION_AGENT_INACTIVE"],
  ["reader Agent", activeReaderGrant("agent-a"), "COLLABORATION_AGENT_CANNOT_EXECUTE"],
] as const)("rejects %s during fresh start preflight", async (_label, grant, code) => {
  prisma.agentGrant.findMany.mockResolvedValue([grant]);
  await expect(service.validateDraft("space-1", "draft-1", validDraftVersion(), humanPrincipal)).rejects.toMatchObject({ businessCode: code });
});

it("allows the starter to pause but only Owner/Admin to skip, fail, or cancel", async () => {
  await expect(service.pauseRun("run-1", { reason: "maintenance", idempotencyKey: "pause-run-1" }, starterPrincipal)).resolves.toBeDefined();
  await expect(service.skipTask("run-1", "task-1", { reason: "not needed", idempotencyKey: "skip-task-1" }, starterPrincipal))
    .rejects.toMatchObject({ businessCode: "COLLABORATION_HUMAN_PERMISSION_DENIED" });
});

it("replays a human mutation only for the same operation, target, and request hash", async () => {
  const first = await service.pauseRun("run-1", { reason: "maintenance", idempotencyKey: "pause-run-1" }, starterPrincipal);
  const second = await service.pauseRun("run-1", { reason: "maintenance", idempotencyKey: "pause-run-1" }, starterPrincipal);
  expect(second).toEqual(first);
  expect(tx.collaborationRun.update).toHaveBeenCalledTimes(1);
  await expect(service.resumeRun("run-1", { reason: "maintenance", idempotencyKey: "pause-run-1" }, starterPrincipal))
    .rejects.toMatchObject({ businessCode: "COLLABORATION_IDEMPOTENCY_MISMATCH" });
});

it("reassigns to a freshly authorized Agent, invalidates the old lease, and keeps Role Bindings immutable", async () => {
  await service.reassignTask("run-1", "task-1", { agentId: "agent-new", reason: "handoff", idempotencyKey: "reassign-0001" }, starterPrincipal);
  expectFreshExecutableGrantWasChecked("agent-new");
  expectActiveAttemptInvalidated("task-1", "agent-old");
  expect(tx.collaborationRoleBinding.updateMany).not.toHaveBeenCalled();
  expectResumeInstructionFor("agent-new");
});
```

- [ ] **Step 2: Run the suite and verify RED**

Run: `cd agentwiki && pnpm --filter @agentwiki/server exec jest --runInBand src/collaboration-workflows/run.service.spec.ts`

Expected: FAIL because run service/controller files are absent.

- [ ] **Step 3: Implement start preflight and immutable normalized expansion**

```ts
async startRun(spaceId: string, runId: string, input: StartRunDto, principal: Principal) {
  await this.authorization.assertSpaceAccess(principal, spaceId, ['owner', 'admin', 'editor']);
  return this.prisma.$transaction(async (tx) => {
    const draft = await tx.collaborationRun.findFirst({ where: { id: runId, spaceId, status: 'ready', version: input.expectedVersion } });
    if (!draft) throw new BusinessException('COLLABORATION_RUN_VERSION_CONFLICT');
    const template = await tx.collaborationTemplate.findFirst({ where: { id: draft.templateId, archivedAt: null, OR: [{ system: true }, { spaceId }] } });
    if (!template) throw new BusinessException('COLLABORATION_TEMPLATE_NOT_FOUND');
    const definition = CollaborationTemplateDefinitionSchema.parse(template.definition);
    const issues = validateCollaborationTemplate(definition);
    if (issues.length) throw new BusinessException('COLLABORATION_TEMPLATE_INVALID', undefined, { issues });
    validateInputBindings(definition, draft.inputs);
    const roleBindings = await loadDraftRoleBindings(tx, draft.id);
    await validateFreshAgentBindings(tx, spaceId, definition.roleSlots, roleBindings);
    const snapshot = structuredClone(definition);
    const run = await tx.collaborationRun.update({ where: { id: draft.id }, data: {
      templateVersion: template.version,
      templateSnapshot: snapshot, snapshotHash: hashCollaborationTemplate(snapshot),
      status: 'running', version: { increment: 1 }, startedAt: new Date(),
    } });
    await expandRunRows(tx, run.id, snapshot, roleBindings, { generation: 1 });
    await appendRunEvent(tx, run.id, humanActor(principal), 'start_run', run.id, input.idempotencyKey, canonicalRequestHash(input), { templateId: template.id, templateVersion: template.version });
    return loadHumanRun(tx, run.id);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
```

`createDraft` persists `draft` with version 1; `updateDraft` conditionally updates by `(id, spaceId, status=draft, version=expectedVersion)` and increments version; `validateDraft` re-parses typed inputs, graph, current Agent grants, and bindings, then conditionally changes `draft → ready` and increments version. `startRun` accepts only `ready` and performs the same checks again. `expandRunRows` creates generation 1 rows, assigns `ready` only to entry Agent tasks, keeps dependent tasks `blocked`, creates review rows only when upstream submission makes them actionable, and never evaluates user-provided code. Merge duplicate Agent bindings into one join-instruction record at read time, not by changing Role Binding rows.

Expose these exact guarded routes: `POST /spaces/:spaceId/collaboration/runs/drafts`, `PUT /spaces/:spaceId/collaboration/runs/:runId/draft`, `POST /spaces/:spaceId/collaboration/runs/:runId/validate`, `POST /spaces/:spaceId/collaboration/runs/:runId/start`, `GET /spaces/:spaceId/collaboration/runs`, `GET /spaces/:spaceId/collaboration/runs/:runId`, `POST /spaces/:spaceId/collaboration/runs/:runId/actions/pause`, `POST /spaces/:spaceId/collaboration/runs/:runId/actions/resume`, `POST /spaces/:spaceId/collaboration/runs/:runId/actions/fail`, `POST /spaces/:spaceId/collaboration/runs/:runId/actions/cancel`, `POST /spaces/:spaceId/collaboration/runs/:runId/tasks/:taskId/retry`, `POST /spaces/:spaceId/collaboration/runs/:runId/tasks/:taskId/reassign`, and `POST /spaces/:spaceId/collaboration/runs/:runId/tasks/:taskId/skip`. DTO and controller tests must assert each literal path.

- [ ] **Step 4: Implement guarded human controls with explicit transition predicates**

Use `@UseGuards(CombinedAuthGuard, HumanOnlyGuard)` on all run HTTP routes. Apply these exact predicates in a serializable transaction:

```ts
const RUN_TERMINAL = new Set(['completed', 'failed', 'cancelled']);
const STARTER_OR_ADMIN = ['pause', 'resume', 'retry', 'reassign'] as const;
const ADMIN_ONLY = ['skip', 'fail', 'cancel'] as const;

function assertHumanControl(action: string, run: { startedById: string; status: string }, member: { role: string }, userId: string) {
  if (RUN_TERMINAL.has(run.status)) throw new BusinessException('COLLABORATION_RUN_TERMINAL');
  const admin = member.role === 'owner' || member.role === 'admin';
  if (ADMIN_ONLY.includes(action as never) && !admin) throw new BusinessException('COLLABORATION_HUMAN_PERMISSION_DENIED');
  if (STARTER_OR_ADMIN.includes(action as never) && !admin && run.startedById !== userId) throw new BusinessException('COLLABORATION_HUMAN_PERMISSION_DENIED');
}
```

Every mutation requires a non-empty bounded reason, invalidates active attempts when necessary, appends an event with before/after states, and returns the newly loaded authoritative run. `reassignTask` validates that the new Agent is active, has a current Space Grant and effective editor/publisher `collaboration:execute`, invalidates the old active Attempt, changes only `CollaborationRunTask.assigneeAgentId`, and emits a resume instruction. It never edits the snapshot or Role Bindings.

Every human mutation DTO also requires an 8-128 character idempotency key. `RunEventStore.executeIdempotent<T>(tx, { runId, actorKind, actorId, operation, target, key, requestHash }, mutation)` returns a stored response only when all scope fields and the canonical request hash match; reuse with another operation/target/body throws `COLLABORATION_IDEMPOTENCY_MISMATCH`. Otherwise it locks the Run row, increments `eventSequence`, runs the mutation, stores redacted metadata plus the safe response, and returns it. System events use `actorKind='system'` and `actorId='system'`. The helper and state change share one serializable transaction.

- [ ] **Step 5: Verify run transitions, HTTP authorization, and commit**

Run:

```bash
cd agentwiki
pnpm --filter @agentwiki/server exec jest --runInBand src/collaboration-workflows/run.service.spec.ts
pnpm --filter @agentwiki/server exec jest --runInBand src/collaboration-workflows/run.controller.spec.ts
pnpm --filter @agentwiki/server exec jest --runInBand src/collaboration-workflows/run-event.store.spec.ts
pnpm --filter @agentwiki/server typecheck
```

Expected: all commands exit 0; tests cover persisted draft/version conflicts, fresh validate/start preflight, immutable snapshot, initial generation/readiness, Editor launch, starter controls, authorized reassignment and join eligibility, Owner/Admin controls, scoped idempotency, Agent denial, and terminal-state denial.

```bash
git add agentwiki/apps/server/src/collaboration-workflows
git commit -m "feat(collaboration): create and control workflow runs"
```

---

### Task 6: Task Claim, Lease, Ordered Todo, Submission, and Idempotency

**Files:**
- Create: `agentwiki/apps/server/src/collaboration-workflows/execution.service.ts`
- Create: `agentwiki/apps/server/src/collaboration-workflows/execution.service.spec.ts`
- Create: `agentwiki/apps/server/src/collaboration-workflows/artifact-validator.ts`
- Create: `agentwiki/apps/server/src/collaboration-workflows/artifact-validator.spec.ts`
- Modify: `agentwiki/apps/server/package.json`
- Modify: `agentwiki/pnpm-lock.yaml`
- Modify: `agentwiki/apps/server/src/collaboration-workflows/collaboration-workflows.module.ts`
- Modify: `agentwiki/apps/server/src/core/filters/business-error.ts`

**Interfaces:**
- Consumes: normalized run rows, shared MCP DTOs, role-aware `Principal`, template output contracts, and `RunEventStore.executeIdempotent()`.
- Produces: `joinRun()`, `nextAction()`, `heartbeat()`, `updateTodo()`, `submitResult()`, `getAgentRun()`, and `validateArtifact()`.

- [ ] **Step 1: Write failing execution tests for identity, claim exclusivity, Todo order, leases, and redacted tokens**

```ts
it("joins when authenticated Agent is bound or currently assigned, active, granted, and editor-capable", async () => {
  await expect(service.joinRun("run-1", editorAgentPrincipal)).resolves.toMatchObject({
    runId: "run-1", roleSlots: [{ id: "builder", name: "Builder" }], protocol: expect.any(Object),
  });
  await expect(service.joinRun("run-1", reassignedAgentPrincipal)).resolves.toMatchObject({ runId: "run-1", roleSlots: [] });
  await expect(service.joinRun("run-1", unboundAgentPrincipal)).rejects.toMatchObject({ businessCode: "COLLABORATION_AGENT_NOT_BOUND" });
});

it("creates one attempt and stores only a token hash", async () => {
  const result = await service.nextAction({ runId: "run-1", idempotencyKey: "next-agent-a-1" }, editorAgentPrincipal);
  expect(result.action).toBe("execute_task");
  expect(result.leaseToken).toHaveLength(64);
  expect(tx.collaborationTaskAttempt.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
    leaseTokenHash: expect.stringMatching(/^[a-f0-9]{64}$/u), claimIdempotencyKey: "next-agent-a-1",
  }) }));
  expect(JSON.stringify(tx.collaborationRunEvent.create.mock.calls)).not.toContain(result.leaseToken);
});

it("rejects skipping a required earlier Todo and rejects stale leases", async () => {
  await expect(service.updateTodo(doneSecondTodoInput, editorAgentPrincipal)).rejects.toMatchObject({ businessCode: "COLLABORATION_TODO_OUT_OF_ORDER" });
  clock.advanceBy(61_000);
  await expect(service.heartbeat(heartbeatInput, editorAgentPrincipal)).rejects.toMatchObject({ businessCode: "COLLABORATION_LEASE_EXPIRED" });
});

it("returns the original response for a repeated idempotency key", async () => {
  const first = await service.submitResult(submission, editorAgentPrincipal);
  const second = await service.submitResult(submission, editorAgentPrincipal);
  expect(second).toEqual(first);
  expect(tx.collaborationTaskArtifact.create).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run execution tests and verify RED**

Run: `cd agentwiki && pnpm --filter @agentwiki/server exec jest --runInBand src/collaboration-workflows/execution.service.spec.ts src/collaboration-workflows/artifact-validator.spec.ts`

Expected: FAIL because execution and artifact validation services are absent.

- [ ] **Step 3: Implement conditional claim and lease verification**

```ts
private async claimReadyTask(tx: Prisma.TransactionClient, runId: string, agentId: string, key: string, requestHash: string) {
  const replay = await this.events.findReplay(tx, { runId, actorKind: 'agent', actorId: agentId, operation: 'next_action', target: runId, key, requestHash });
  if (replay) return this.authorizedClaimReplay(tx, replay, agentId, key);
  const current = await tx.collaborationTaskAttempt.findFirst({ where: { runId, agentId, status: { in: ['claimed', 'running'] } } });
  if (current) return this.attemptResponse(current, this.leaseTokenFor(current.id, runId, agentId, current.claimIdempotencyKey), true);
  const task = await tx.collaborationRunTask.findFirst({ where: { runId, assigneeAgentId: agentId, status: 'ready' }, orderBy: [{ ordinal: 'asc' }, { id: 'asc' }] });
  if (!task) return this.waitingResponse(tx, runId, agentId);
  const attemptId = randomUUID();
  const leaseToken = this.leaseTokenFor(attemptId, runId, agentId, key);
  const attemptNumber = await nextAttemptNumber(tx, task.id);
  const claimed = await tx.collaborationRunTask.updateMany({ where: { id: task.id, status: 'ready' }, data: { status: 'claimed' } });
  if (claimed.count !== 1) throw new RetryableClaimConflict();
  const attempt = await tx.collaborationTaskAttempt.create({ data: {
    id: attemptId, runId, taskId: task.id, generation: task.generation, agentId, attemptNumber, status: 'claimed', claimIdempotencyKey: key,
    leaseTokenHash: sha256(leaseToken), leaseStartedAt: new Date(),
    leaseExpiresAt: boundedLeaseExpiry(task), maxExecutionAt: boundedMaximumExpiry(task),
  } });
  return { action: 'execute_task', attemptId: attempt.id, leaseToken, task: await loadExplicitTaskContext(tx, task.id, agentId) };
}
```

`leaseTokenFor()` uses `HMAC-SHA256(JWT_SECRET, "collaboration-lease-v1\0" + attemptId + "\0" + runId + "\0" + agentId + "\0" + idempotencyKey)`. It is called only after exact scoped replay authorization; plaintext is never persisted/logged. Run claim in a serializable transaction with a bounded three-attempt retry for `RetryableClaimConflict`. The per-Agent/run partial unique index prevents concurrent different keys from assigning two tasks to one Agent. Before every join, claim, heartbeat, Todo update, submission, or claim replay: confirm authenticated `agentId`, active Agent/current Grant/access role, current assignment or Role Binding participation, task generation, run non-terminal state, token hash, active Attempt, lease deadline, and maximum execution deadline as applicable.

Wrap claim, heartbeat, Todo, and submission mutations with `RunEventStore.executeIdempotent()`. Stored responses may contain task/Artifact IDs, states, bounded validation issues, and timestamps, but never a lease token; claim replays deterministically reconstruct the token only after authorization succeeds. A replay whose key is reused with a different operation or target returns `COLLABORATION_IDEMPOTENCY_MISMATCH`.

When `waitSeconds > 0`, `nextAction` performs short queries between abort-aware waits capped at 25 seconds; it never keeps a Prisma transaction or database connection open while waiting. Return `waiting_dependency` with a bounded retry interval when no own task is ready. Return `waiting_human` immediately as `{ action: 'waiting_human', resumeRequired: true, message }` with no retry interval; `paused` and terminal states also return immediately.

- [ ] **Step 4: Implement ordered Todo and bounded Artifact validation**

```ts
export function normalizeExternalReference(reference: ExternalReference): ExternalReference {
  if (reference.kind === 'workspace_path') {
    if (!reference.contentHash || reference.value.includes('\0') || reference.value.includes('\\') || /^[A-Za-z]:/u.test(reference.value)) throw invalidReference();
    const segments = reference.value.split('/');
    if (reference.value.startsWith('/') || segments.some((segment) => segment === '..')) throw invalidReference();
    return { ...reference, value: segments.filter((segment) => segment && segment !== '.').join('/') };
  }
  if (reference.kind === 'git_commit') {
    if (!reference.version || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(reference.value)) throw invalidReference();
    return reference;
  }
  let url: URL;
  try { url = new URL(reference.value); } catch { throw invalidReference(); }
  const secretKey = [...url.searchParams.keys()].some((key) => /^(?:token|key|signature|sig|x-amz-.+|x-goog-.+)$/iu.test(key));
  if (url.protocol !== 'https:' || url.username || url.password || secretKey || !reference.contentHash) throw invalidReference();
  url.username = ''; url.password = ''; url.hash = '';
  return { ...reference, value: url.toString() };
}

function assertTodoTransition(todos: TodoRow[], targetId: string, next: 'doing' | 'done' | 'failed') {
  const index = todos.findIndex((todo) => todo.id === targetId);
  if (index < 0) throw new BusinessException('COLLABORATION_TODO_NOT_FOUND');
  if (todos.slice(0, index).some((todo) => todo.required && todo.status !== 'done')) {
    throw new BusinessException('COLLABORATION_TODO_OUT_OF_ORDER');
  }
  if (!allowedTodoTransition(todos[index].status, next)) throw new BusinessException('COLLABORATION_TODO_TRANSITION_INVALID');
}
```

Add direct `"ajv": "8.18.0"` to `apps/server/package.json` and update the lockfile. Compile only the documented bounded JSON Schema 2020-12 keyword subset with Ajv strict/allErrors, no remote loader, maximum schema depth/bytes, and an LRU cache keyed by canonical schema hash; pre-scan and reject `$ref`, `$dynamicRef`, unknown keywords, and over-deep schemas before compile. Validate UTF-8 byte counts before JSON parse/depth walks, require all mandatory evidence, reject unknown Artifact fields through the discriminated shared union, and create `version = previous max + 1` inside the current task generation without overwriting. Submission reads only current-generation accepted upstream Artifacts. It sets Artifact `accepted` and task `completed` only when no human gate consumes it; otherwise Artifact stays `pending`, task becomes `submitted`, and a current-generation Review becomes actionable.

`updateTodo(..., status='failed')` atomically marks the current Attempt failed and applies the infrastructure retry rule: `attemptNumber <= retryBudget` enters `retry_wait`, otherwise it marks the task failed and pauses the run. `retryBudget` counts retries after the initial Attempt. A failed Todo can never coexist with a live Attempt or later successful submission.

For a validation failure, first insert a redacted Run Event keyed by the submission idempotency key and save its structured `{ code, path, message }[]` response. Atomically increment `attempt.repairCount`; while it is within `task.repairBudget`, keep the lease active and return `action: repair_result` with those issues. When the budget is exceeded, invalidate the attempt, set the task to `failed`, pause the run with next action `human_recovery`, and preserve all prior Artifact versions. Replaying the same key reads the Run Event response and does not increment `repairCount` twice. Infrastructure retry counters and content-repair counters never share a field.

- [ ] **Step 5: Verify execution boundaries and commit**

Run:

```bash
cd agentwiki
pnpm --filter @agentwiki/server exec jest --runInBand src/collaboration-workflows/execution.service.spec.ts src/collaboration-workflows/artifact-validator.spec.ts
pnpm --filter @agentwiki/server typecheck
```

Expected: all commands exit 0; tests cover bound-or-reassigned participation, object-shaped Role Slots, reader denial, concurrent claim fallback, token hashing, max deadline, generation checks, Todo ordering/failure semantics, Artifact discriminated union, URL/path/git normalization, bounded Ajv schemas, scoped idempotent replay, waiting-human exit, and late submission denial.

```bash
git add agentwiki/apps/server/src/collaboration-workflows agentwiki/apps/server/src/core/filters/business-error.ts agentwiki/apps/server/package.json agentwiki/pnpm-lock.yaml
git commit -m "feat(collaboration): execute leased agent tasks"
```

---

### Task 7: Dependency Progression, Human Review, Revision, and Terminal States

**Files:**
- Create: `agentwiki/apps/server/src/collaboration-workflows/progression.service.ts`
- Create: `agentwiki/apps/server/src/collaboration-workflows/progression.service.spec.ts`
- Create: `agentwiki/apps/server/src/collaboration-workflows/review.service.ts`
- Create: `agentwiki/apps/server/src/collaboration-workflows/review.service.spec.ts`
- Modify: `agentwiki/apps/server/src/collaboration-workflows/run.controller.ts`
- Modify: `agentwiki/apps/server/src/collaboration-workflows/collaboration-workflows.module.ts`

**Interfaces:**
- Consumes: submitted/accepted Artifacts, dependency rows, snapshot review nodes, human Principal, and run/task states.
- Produces: `advanceRun()`, `approveReview()`, `rejectForRevision()`, `terminateAtReview()`, and deterministic `calculateRunStatus()`.

- [ ] **Step 1: Write failing state-progression tests**

```ts
it("uses any for early release while requiring every non-skipped upstream for final completion", async () => {
  await progression.advanceRun(tx, "run-1", "artifact.accepted");
  expect(tx.collaborationRunTask.updateMany).toHaveBeenCalledWith(expect.objectContaining({
    where: { id: "all-target", status: "blocked" }, data: { status: "ready" },
  }));
  expect(tx.collaborationRunTask.updateMany).toHaveBeenCalledWith(expect.objectContaining({
    where: { id: "any-target", status: "blocked" }, data: { status: "ready" },
  }));
});

it("rejects for revision by superseding the affected generations without deleting history", async () => {
  await reviews.rejectForRevision("run-1", "review-1", { reason: "missing evidence", idempotencyKey: "review-reject-1" }, reviewerPrincipal);
  expectAffectedSubgraph(["revision-task", "source-task", "review-1", "aggregate-task"]);
  expectOldGenerationArtifactsAndReviewsToBe("superseded");
  expectFreshGenerationTodos("revision-task");
  expectTaskGeneration("revision-task", 2, "ready");
  expectTaskGeneration("aggregate-task", 2, "blocked");
  expect(tx.collaborationTaskArtifact.deleteMany).not.toHaveBeenCalled();
  expect(tx.collaborationTaskTodo.deleteMany).not.toHaveBeenCalled();
});

it("keeps running when a review is pending beside executable work and waits only when human review is the sole action", () => {
  expect(calculateRunStatus(state({ pendingReview: true, readyTask: true }))).toBe("running");
  expect(calculateRunStatus(state({ pendingReview: true, readyTask: false }))).toBe("waiting_review");
});

it("refuses an Agent principal and a human outside reviewer constraints", async () => {
  await expect(reviews.approveReview("run-1", "review-1", approval, agentPrincipal)).rejects.toMatchObject({ businessCode: "HUMAN_AUTH_REQUIRED" });
  await expect(reviews.approveReview("run-1", "review-1", approval, unrelatedHuman)).rejects.toMatchObject({ businessCode: "COLLABORATION_REVIEWER_DENIED" });
});
```

- [ ] **Step 2: Run progression/review tests and verify RED**

Run: `cd agentwiki && pnpm --filter @agentwiki/server exec jest --runInBand src/collaboration-workflows/progression.service.spec.ts src/collaboration-workflows/review.service.spec.ts`

Expected: FAIL because both services are absent.

- [ ] **Step 3: Implement one transactional progression algorithm**

```ts
async advanceRun(tx: Prisma.TransactionClient, runId: string, cause: string): Promise<void> {
  const state = await loadProgressionState(tx, runId);
  for (const task of state.blockedTasks) {
    const incoming = state.dependencies.filter((edge) => edge.toNodeId === task.nodeId);
    const satisfied = task.dependencyMode === 'any'
      ? incoming.some((edge) => state.currentGenerationSatisfiedNodeIds.has(edge.fromNodeId))
      : incoming.every((edge) => state.currentGenerationSatisfiedNodeIds.has(edge.fromNodeId));
    if (incoming.length > 0 && satisfied) await tx.collaborationRunTask.updateMany({ where: { id: task.id, status: 'blocked' }, data: { status: 'ready' } });
  }
  const nextStatus = calculateRunStatus(await loadProgressionState(tx, runId));
  await tx.collaborationRun.update({ where: { id: runId }, data: { status: nextStatus, finishedAt: isTerminal(nextStatus) ? new Date() : null } });
  await appendRunEvent(tx, runId, null, 'run.progressed', stableEventKey(runId, cause, nextStatus), { cause, nextStatus });
}
```

`calculateRunStatus` uses this exact priority: preserve explicit `completed | failed | cancelled`; then `paused` for an active pause reason; then `running` when any current-generation task is `ready | claimed | running | retry_wait`; then `waiting_review` when a current-generation pending Review exists; then `completed` only when every required non-skipped task and terminal is satisfied; otherwise throw/record `COLLABORATION_PROGRESS_INVARIANT` and pause rather than inventing a state. `any` only controls readiness; final completion still requires all non-skipped upstream tasks. Exhaustion never silently changes the run to `failed`.

- [ ] **Step 4: Implement human-only review decisions and revision routing**

Guard review routes with `CombinedAuthGuard, HumanOnlyGuard`. Expose decisions only as `POST /spaces/:spaceId/collaboration/runs/:runId/reviews/:reviewId/decision`; its strict DTO contains `kind`, bounded `reason`, and `idempotencyKey`, never a client-supplied actor ID. In a serializable transaction, re-read Space membership and reviewer constraints, acquire the pending review row with a conditional update, then:

```ts
switch (decision.kind) {
  case 'approve':
    await tx.collaborationTaskArtifact.update({ where: { id: review.artifactId }, data: { status: 'accepted', acceptedAt: new Date() } });
    await tx.collaborationRunTask.update({ where: { id: review.sourceTaskId }, data: { status: 'completed' } });
    break;
  case 'reject_for_revision':
    const affected = computeRevisionSubgraph(snapshot, review.revisionTaskId, review.nodeId);
    await markReviewRejected(tx, review.id, reviewer.id, decision.reason);
    await invalidateAttemptsInSubgraph(tx, review.runId, affected, 'review_revision');
    await supersedeArtifactsAndReviews(tx, review.runId, affected, { excludeReviewId: review.id });
    await incrementTaskGenerations(tx, review.runId, affected);
    await createGenerationTodos(tx, review.runId, affected);
    await resetRevisionSubgraph(tx, review.runId, affected, review.revisionTaskId);
    break;
  case 'terminate':
    if (!review.allowTerminate) throw new BusinessException('COLLABORATION_REVIEW_TERMINATE_DENIED');
    await invalidateActiveAttempts(tx, review.runId, 'review_terminated');
    await tx.collaborationRun.update({ where: { id: review.runId }, data: { status: 'cancelled', finishedAt: new Date() } });
    break;
}
```

`computeRevisionSubgraph` first proves that the revision task is the source task or its ancestor, then takes nodes reachable from the revision task that can reach the rejected Review, plus all descendants of that Review; this invalidates the causal branch without resetting unrelated parallel work. The mutation locks the Run, all affected task rows in stable ID order, and the pending Review. It marks the decision Review rejected, increments each affected task generation, supersedes old-generation accepted/pending Artifacts and other affected pending Reviews, preserves all decided Reviews/history, creates fresh Todo rows keyed by the new generation, sets the revision target according to dependencies outside the affected set, and leaves all affected descendants blocked until current-generation prerequisites satisfy. A new source submission creates a Review with source generation and `revision = previous max + 1`. Artifact lookup, dependency release, Review creation, and completion queries always filter current task generation. Record `reviewerUserId`, reason, old/new generations, affected node IDs, Artifact version, and timestamp; never store secrets.

- [ ] **Step 5: Verify review/progression and commit**

Run:

```bash
cd agentwiki
pnpm --filter @agentwiki/server exec jest --runInBand src/collaboration-workflows/progression.service.spec.ts src/collaboration-workflows/review.service.spec.ts
pnpm --filter @agentwiki/server typecheck
```

Expected: all commands exit 0; tests cover all/any early-release and completion semantics, mixed ready/review status precedence, approve, causal-subgraph generation invalidation, stale Artifact exclusion, terminate, exhaustion-pause, and final completion.

```bash
git add agentwiki/apps/server/src/collaboration-workflows
git commit -m "feat(collaboration): advance dependencies and reviews"
```

---

### Task 8: Lease Recovery Worker and Realtime Refresh Hints

**Files:**
- Create: `agentwiki/apps/server/src/collaboration-workflows/recovery.worker.ts`
- Create: `agentwiki/apps/server/src/collaboration-workflows/recovery.worker.spec.ts`
- Create: `agentwiki/apps/server/src/collaboration-workflows/collaboration-events.service.ts`
- Create: `agentwiki/apps/server/src/collaboration-workflows/collaboration-events.service.spec.ts`
- Modify: `agentwiki/apps/server/src/collaboration-workflows/collaboration-workflows.module.ts`
- Modify: `agentwiki/apps/server/src/worker.module.ts`
- Modify: `agentwiki/apps/server/src/core/collaboration/collaboration.gateway.ts`
- Modify: `agentwiki/apps/server/src/core/collaboration/collaboration.gateway.spec.ts`

**Interfaces:**
- Consumes: expired active attempts, retry budgets/timestamps, committed events, `ConfigService`, and `RedisService`.
- Produces: `RecoveryWorker.tick()`, `CollaborationEventsService.publishRunChanged()`, Redis channel `agentwiki:collaboration:runs`, Socket events `collaborationRunChanged`, and room name `collaboration:run:<runId>`.

- [ ] **Step 1: Write failing recovery and notification tests**

```ts
it("runs only in worker/all roles and expires a lease exactly once", async () => {
  config.get.mockImplementation((key) => key === "PROCESS_ROLE" ? "worker" : undefined);
  prisma.collaborationTaskAttempt.findMany.mockResolvedValue([expiredAttempt({ retryBudget: 2, attemptNumber: 1 })]);
  await worker.onModuleInit();
  await worker.tick();
  expect(tx.collaborationTaskAttempt.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "attempt-1", status: { in: ["claimed", "running"] } } }));
  expect(tx.collaborationRunTask.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "retry_wait" }) }));
});

it("pauses after retry exhaustion and never marks the run failed automatically", async () => {
  prisma.collaborationTaskAttempt.findMany.mockResolvedValue([expiredAttempt({ retryBudget: 1, attemptNumber: 2 })]);
  await worker.tick();
  expect(tx.collaborationRun.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "paused" }) }));
  expect(JSON.stringify(tx.collaborationRun.update.mock.calls)).not.toContain('"failed"');
});

it("pauses instead of releasing work when the current assignee lost execution authorization", async () => {
  prisma.collaborationTaskAttempt.findMany.mockResolvedValue([expiredAttempt({ retryBudget: 2, attemptNumber: 1 })]);
  authorization.assertCurrentAgentExecution.mockRejectedValue(agentAuthorizationChanged());
  await worker.tick();
  expectRunPausedWith("agent_authorization_changed");
  expect(tx.collaborationRunTask.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({ data: { status: "ready" } }));
});

it("publishes only a refresh hint after the transaction commits", async () => {
  await events.publishRunChanged("space-1", "run-1", 42);
  expect(redis.publish).toHaveBeenCalledWith("agentwiki:collaboration:runs", JSON.stringify({ spaceId: "space-1", runId: "run-1", eventSequence: 42 }));
});
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `cd agentwiki && pnpm --filter @agentwiki/server exec jest --runInBand src/collaboration-workflows/recovery.worker.spec.ts src/collaboration-workflows/collaboration-events.service.spec.ts`

Expected: FAIL because worker/event service files are absent.

- [ ] **Step 3: Implement bounded polling, exponential backoff, and single-winner expiry**

```ts
@Injectable()
export class RecoveryWorker implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private running = false;
  async onModuleInit() {
    const role = String(this.config.get('PROCESS_ROLE') || 'api').toLowerCase();
    if (role !== 'worker' && role !== 'all') return;
    this.timer = setInterval(() => void this.safeTick(), Number(this.config.get('COLLABORATION_RECOVERY_POLL_MS') || 5_000));
    void this.safeTick();
  }
  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      for (const attempt of await this.loadExpiredBatch(100)) await this.recoverAttempt(attempt.id);
      await this.releaseDueRetries(100);
    } finally { this.running = false; }
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }
}
```

`recoverAttempt` uses conditional `updateMany` for single-winner expiry and verifies Attempt generation still equals the task generation. `retryBudget` is retries after the initial Attempt, so retry while `attemptNumber <= retryBudget`; pause only after a failed Attempt whose number is greater than the budget. Infrastructure retry delay is `min(300, 2 ** attemptNumber * 5)` seconds; content-repair budget is separate. Before releasing an expired Attempt or due retry, re-read the current assignee's active status, Space Grant, Credential/access-role capability, and `collaboration:execute`; on revoke/downgrade pause with `agent_authorization_changed` and never automatically reassign.

- [ ] **Step 4: Bridge committed refresh events without making Socket state authoritative**

Extend the existing gateway Redis subscription:

```ts
const RUN_CHANNEL = 'agentwiki:collaboration:runs';
type RunChannelMessage = { spaceId: string; runId: string; eventSequence: number };

this.unsubscribeRuns = await this.redis.subscribe(RUN_CHANNEL, (raw) => {
  const message = JSON.parse(raw) as RunChannelMessage;
  if (!message.runId || !Number.isInteger(message.eventSequence)) return;
  this.server.to(`collaboration:run:${message.runId}`).emit('collaborationRunChanged', message);
});
```

Add authenticated `joinCollaborationRun`/`leaveCollaborationRun` handlers that verify run access through `RunService` before joining. The event contains only IDs and a monotonically increasing event sequence; clients must REST-fetch state after receiving it.

- [ ] **Step 5: Verify Worker/API role separation and commit**

Run:

```bash
cd agentwiki
pnpm --filter @agentwiki/server exec jest --runInBand src/collaboration-workflows/recovery.worker.spec.ts src/collaboration-workflows/collaboration-events.service.spec.ts src/core/collaboration/collaboration.gateway.spec.ts
pnpm --filter @agentwiki/server typecheck
```

Expected: all commands exit 0; API role never polls, Worker/all poll, expiry is single-winner, retry count semantics are exact, stale generations are ignored, current authorization is rechecked, exhaustion pauses, and Socket payloads contain refresh hints only.

```bash
git add agentwiki/apps/server/src/collaboration-workflows agentwiki/apps/server/src/worker.module.ts agentwiki/apps/server/src/core/collaboration
git commit -m "feat(collaboration): recover leases and broadcast updates"
```

---

### Task 9: Canonical MCP Tools and Exact Local-Gateway Schemas

**Files:**
- Modify: `agentwiki/apps/server/src/mcp/mcp.service.ts`
- Modify: `agentwiki/apps/server/src/mcp/mcp.service.spec.ts`
- Modify: `agentwiki/apps/server/src/mcp/mcp.module.ts`
- Modify: `agentwiki/apps/server/src/mcp/mcp.controller.ts`
- Create: `agentwiki/apps/server/src/mcp/collaboration-mcp.spec.ts`
- Create: `agentwiki/packages/local-sync/src/gateway/collaboration-tools.ts`
- Create: `agentwiki/packages/local-sync/src/gateway/collaboration-tools.spec.ts`
- Modify: `agentwiki/packages/local-sync/src/gateway/server.ts`
- Modify: `agentwiki/packages/local-sync/src/gateway/server.spec.ts`
- Modify: `agentwiki/packages/local-sync/package.json`
- Modify: `agentwiki/apps/server/package.json`
- Modify: `agentwiki/apps/client/package.json`
- Modify: `agentwiki/packages/local-sync/src/gateway/remote-mcp-bridge.ts`
- Modify: `agentwiki/packages/local-sync/src/gateway/entry.ts`
- Modify: `agentwiki/packages/local-sync/src/cli.spec.ts`
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
- Modify: `agentwiki/apps/server/src/onboard/onboard.types.ts`
- Modify: `agentwiki/apps/server/src/onboard/onboard.dto.ts`
- Modify: `agentwiki/apps/server/src/onboard/onboard.controller.ts`
- Modify: `agentwiki/apps/server/src/onboard/onboard-bootstrap.service.ts`
- Modify: `agentwiki/apps/server/src/onboard/onboard.dto.spec.ts`
- Modify: `agentwiki/apps/server/src/onboard/onboard-bootstrap.service.spec.ts`
- Modify: `agentwiki/apps/server/src/onboard/onboard-device.service.spec.ts`
- Modify: `agentwiki/apps/client/src/config/localSync.ts`

**Interfaces:**
- Consumes: execution/run services and the six shared input/output schema pairs.
- Produces: server tools `collaboration_join_run`, `collaboration_next_action`, `collaboration_heartbeat`, `collaboration_update_todo`, `collaboration_submit_result`, `collaboration_get_run`; gateway aliases `wiki_collaboration_*` with direct named inputs.

- [ ] **Step 1: Write failing MCP authorization, shape, and gateway-registration tests**

```ts
// apps/server/src/mcp/collaboration-mcp.spec.ts
it("registers exactly six collaboration tools with direct strict inputs", () => {
  const server = createInspectableMcpServer();
  service.createServer(editorAgentPrincipal, {}, server);
  expect(server.toolNames().filter((name) => name.startsWith("collaboration_"))).toEqual([
    "collaboration_join_run", "collaboration_next_action", "collaboration_heartbeat",
    "collaboration_update_todo", "collaboration_submit_result", "collaboration_get_run",
  ]);
  expect(server.schema("collaboration_next_action").shape).toHaveProperty("idempotencyKey");
});

it("keeps reader read-only and exposes no human-control tools to Agents", async () => {
  await expect(call("collaboration_next_action", readerPrincipal, nextInput)).rejects.toMatchObject({ businessCode: "AUTH_SCOPE_REQUIRED" });
  await expect(call("collaboration_get_run", readerPrincipal, { runId: "run-1" })).resolves.toBeDefined();
  expect(listedTools).not.toEqual(expect.arrayContaining(["collaboration_approve_review", "collaboration_reassign_task", "collaboration_cancel_run"]));
});

// packages/local-sync/src/gateway/collaboration-tools.spec.ts
it("maps discovered collaboration tools to exact direct schemas", () => {
  const schema = exactRemoteToolSchema("collaboration_next_action");
  expect(schema).toBeDefined();
  expect(() => z.object(schema).strict().parse({ runId: "run-1", idempotencyKey: "next-0001" })).not.toThrow();
  expect(() => z.object(schema).strict().parse({ __args: { runId: "run-1" } })).toThrow();
});
```

- [ ] **Step 2: Run server and gateway tests and verify RED**

Run:

```bash
cd agentwiki
pnpm --filter @agentwiki/server exec jest --runInBand src/mcp/collaboration-mcp.spec.ts
pnpm --filter @neomei/agentwiki-local-sync exec vitest run src/gateway/collaboration-tools.spec.ts src/gateway/server.spec.ts
```

Expected: FAIL because collaboration tools and exact gateway schema mapping are absent.

- [ ] **Step 3: Register canonical server tools through the existing audited adapter**

```ts
registerTool('collaboration_join_run', {
  description: 'Join a bound collaboration run as the authenticated Agent and receive the safe execution loop.',
  inputSchema: CollaborationJoinRunInputSchema.shape,
}, async (args: unknown) => this.text(await this.collaborationExecution.joinRun(CollaborationJoinRunInputSchema.parse(args).runId, principal)));

registerTool('collaboration_next_action', {
  description: 'Claim one assigned ready task or receive a bounded wait, human-wait, paused, or terminal action.',
  inputSchema: CollaborationNextActionInputSchema.shape,
}, async (args: unknown) => this.text(await this.collaborationExecution.nextAction(CollaborationNextActionInputSchema.parse(args), principal)));
```

Register the other four using their exact shared input schemas and parse each service result through its shared output schema before serializing it. Read calls require `collaboration:read`; claim/heartbeat/Todo/submit require `collaboration:execute`. Continue using `executeMcpCall` so audit records tool name, Agent ID, IP/user-agent, outcome, and argument names only; do not add full argument values.

- [ ] **Step 4: Replace generic `__args` only for the six collaboration aliases**

```ts
// packages/local-sync/src/gateway/collaboration-tools.ts
import { z } from 'zod';
import {
  CollaborationGetRunInputSchema, CollaborationHeartbeatInputSchema, CollaborationJoinRunInputSchema,
  CollaborationNextActionInputSchema, CollaborationSubmitResultInputSchema, CollaborationUpdateTodoInputSchema,
} from '@neomei/agentwiki-sync-protocol';

export const COLLABORATION_REMOTE_INPUT_SCHEMAS: Record<string, z.ZodRawShape> = {
  collaboration_join_run: CollaborationJoinRunInputSchema.shape,
  collaboration_next_action: CollaborationNextActionInputSchema.shape,
  collaboration_heartbeat: CollaborationHeartbeatInputSchema.shape,
  collaboration_update_todo: CollaborationUpdateTodoInputSchema.shape,
  collaboration_submit_result: CollaborationSubmitResultInputSchema.shape,
  collaboration_get_run: CollaborationGetRunInputSchema.shape,
};
export function exactRemoteToolSchema(name: string): z.ZodRawShape | undefined {
  return COLLABORATION_REMOTE_INPUT_SCHEMAS[name];
}
```

In `createGatewayServer`, if `exactRemoteToolSchema(remote.name)` exists, register it directly and forward `input` unchanged. Preserve generic `{ __args }` for unrelated discovered tools to avoid expanding this feature into a full remote-schema conversion project. Assert the returned names are `wiki_collaboration_join_run` through `wiki_collaboration_get_run`. Before the gate, set local-sync and server/client package versions, gateway/CLI runtime constants, `LOCAL_SYNC_VERSION`, server onboarding acceptance, generated instructions, and compatibility tests to `0.6.0`; do not force the independently versioned sync-protocol package to `0.6.0`. Run the `rg` commands from the Files list and classify every remaining active `0.5.0` occurrence as a defect.

- [ ] **Step 5: Verify MCP packages and commit**

Run:

```bash
cd agentwiki
pnpm --filter @agentwiki/server exec jest --runInBand src/mcp/mcp.service.spec.ts src/mcp/collaboration-mcp.spec.ts
pnpm --filter @neomei/agentwiki-local-sync exec vitest run src/gateway/collaboration-tools.spec.ts src/gateway/server.spec.ts
pnpm --filter @neomei/agentwiki-local-sync typecheck
pnpm --filter @neomei/agentwiki-local-sync build
```

Expected: all commands exit 0; six canonical server tools and six `wiki_` aliases have strict input/output schemas, direct named arguments, exact scope enforcement, unified 0.6.0 compatibility, and no human-control tool surface.

```bash
git add agentwiki/apps/server agentwiki/apps/client/package.json agentwiki/apps/client/src/config/localSync.ts agentwiki/packages/local-sync agentwiki/pnpm-lock.yaml
git commit -m "feat(collaboration): expose secure MCP execution tools"
```

---

### Task 10: Collaboration Workspace and Template Library

**Files:**
- Create: `agentwiki/apps/client/src/features/collaboration/types.ts`
- Create: `agentwiki/apps/client/src/features/collaboration/api.ts`
- Create: `agentwiki/apps/client/src/features/collaboration/CollaborationWorkspace.tsx`
- Create: `agentwiki/apps/client/src/features/collaboration/CollaborationWorkspace.test.tsx`
- Create: `agentwiki/apps/client/src/features/collaboration/components/TemplateCard.tsx`
- Create: `agentwiki/apps/client/src/features/collaboration/components/RunList.tsx`
- Modify: `agentwiki/apps/client/src/App.tsx`
- Modify: `agentwiki/apps/client/src/components/SpaceNav.tsx`
- Modify: `agentwiki/apps/client/src/components/SpaceNav.spec.tsx`
- Modify: `agentwiki/apps/client/src/i18n/messages.ts`

**Interfaces:**
- Consumes: template/run REST APIs, existing API client/auth, `SpaceNav`, `ModalDialog`, Toast, and shared enums.
- Produces: `/spaces/:id/collaboration` with Template Library, Active Runs, and History tabs; copy flow; distinct navigation copy.

- [ ] **Step 1: Write failing route, navigation, loading, empty, error, and copy tests**

```tsx
it("places Collaboration between Runs and Members and keeps ingest Runs distinct", () => {
  renderWithRouter(<SpaceNav spaceId="space-1" />, "/spaces/space-1/collaboration");
  const labels = screen.getAllByRole("link").map((link) => link.textContent);
  expect(labels.indexOf("Runs")).toBeLessThan(labels.indexOf("Collaboration"));
  expect(labels.indexOf("Collaboration")).toBeLessThan(labels.indexOf("Members"));
  expect(screen.getByRole("link", { name: /Runs/u })).toHaveAttribute("href", "/spaces/space-1/runs");
});

it("shows system and Space templates and copies a system template", async () => {
  server.use(listTemplatesHandler([systemCodingTemplate, spaceCodingCopy]));
  renderWorkspace();
  expect(await screen.findByText("Coding collaboration")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Copy as my template" }));
  await user.type(screen.getByLabelText("Template name"), "Backend release");
  await user.click(screen.getByRole("button", { name: "Copy" }));
  await waitFor(() => expect(copyRequest()).toEqual({ name: "Backend release" }));
});

it.each(["loading", "empty", "error"] as const)("renders the %s state", async (state) => {
  renderWorkspaceWithState(state);
  expect(await screen.findByTestId(`collaboration-${state}`)).toBeVisible();
});
```

- [ ] **Step 2: Run the focused client test and verify RED**

Run: `cd agentwiki && pnpm --filter @agentwiki/client exec vitest run src/features/collaboration/CollaborationWorkspace.test.tsx`

Expected: FAIL because the route and components are absent.

- [ ] **Step 3: Add a typed API boundary and lazy route**

```ts
// apps/client/src/features/collaboration/api.ts
import api from '../../api/client';
export const collaborationApi = {
  listTemplates: async (spaceId: string) => (await api.get<TemplateSummary[]>(`/spaces/${spaceId}/collaboration/templates`)).data,
  getTemplate: async (spaceId: string, templateId: string) => (await api.get<TemplateDetail>(`/spaces/${spaceId}/collaboration/templates/${templateId}`)).data,
  createTemplate: async (spaceId: string, input: CreateTemplateInput) => (await api.post<TemplateDetail>(`/spaces/${spaceId}/collaboration/templates`, input)).data,
  copyTemplate: async (spaceId: string, templateId: string, name: string) => (await api.post<TemplateSummary>(`/spaces/${spaceId}/collaboration/templates/${templateId}/copy`, { name })).data,
  validateTemplate: async (spaceId: string, definition: unknown) => (await api.post<ValidationResult>(`/spaces/${spaceId}/collaboration/templates/validate`, { definition })).data,
  updateTemplate: async (spaceId: string, templateId: string, input: UpdateTemplateInput) => (await api.put<TemplateDetail>(`/spaces/${spaceId}/collaboration/templates/${templateId}`, input)).data,
  archiveTemplate: async (spaceId: string, templateId: string, expectedVersion: number) => (await api.post<TemplateDetail>(`/spaces/${spaceId}/collaboration/templates/${templateId}/archive`, { expectedVersion })).data,
  listRuns: async (spaceId: string, status: 'active' | 'history') => (await api.get<RunSummary[]>(`/spaces/${spaceId}/collaboration/runs`, { params: { status } })).data,
};
```

In `App.tsx`, lazy-load `CollaborationWorkspace` at `/spaces/:id/collaboration`; do not rename or reuse `RunsPage`. In `SpaceNav.tsx`, add the `Collaboration` item between Runs and Members with a `Workflow` icon.

- [ ] **Step 4: Implement accessible tabs/cards and complete bilingual messages**

```tsx
export function CollaborationWorkspace() {
  const { id = '' } = useParams();
  const { t } = useLanguage();
  const [tab, setTab] = useState<'templates' | 'active' | 'history'>('templates');
  return <section aria-labelledby="collaboration-title">
    <SpaceNav spaceId={id} />
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div><h1 id="collaboration-title" className="text-2xl font-semibold">{t('collaboration.title')}</h1><p className="text-sm text-gray-600">{t('collaboration.subtitle')}</p></div>
    </div>
    <div role="tablist" aria-label={t('collaboration.sections')} className="mt-6 flex overflow-x-auto border-b">
      {(['templates', 'active', 'history'] as const).map((value) => <button key={value} role="tab" aria-selected={tab === value} onClick={() => setTab(value)} className="min-h-11 whitespace-nowrap px-4">{t(`collaboration.${value}`)}</button>)}
    </div>
    <WorkspacePanel spaceId={id} tab={tab} />
  </section>;
}
```

Add matching Simplified Chinese and English keys for navigation, tabs, all five template names/descriptions, copy modal, loading/empty/error actions, active/history status, and authorization errors. System cards show a read-only badge; Space cards expose edit/archive only for Owner/Admin.

- [ ] **Step 5: Verify client workspace and commit**

Run:

```bash
cd agentwiki
pnpm --filter @agentwiki/client exec vitest run src/features/collaboration/CollaborationWorkspace.test.tsx
pnpm --filter @agentwiki/client exec vitest run src/components/SpaceNav.spec.tsx
pnpm --filter @agentwiki/client exec tsc --noEmit
```

Expected: all commands exit 0; tests cover route/nav distinction, copy, permissions, loading, empty, error, Chinese, and English labels.

```bash
git add agentwiki/apps/client/src/App.tsx agentwiki/apps/client/src/components/SpaceNav.tsx agentwiki/apps/client/src/features/collaboration agentwiki/apps/client/src/i18n/messages.ts
git commit -m "feat(collaboration): add Space collaboration workspace"
```

---

### Task 11: Form-Based Template Editor and Three-Step Start Wizard

**Files:**
- Create: `agentwiki/apps/client/src/features/collaboration/TemplateEditor.tsx`
- Create: `agentwiki/apps/client/src/features/collaboration/TemplateEditor.test.tsx`
- Create: `agentwiki/apps/client/src/features/collaboration/RunStartWizard.tsx`
- Create: `agentwiki/apps/client/src/features/collaboration/RunStartWizard.test.tsx`
- Create: `agentwiki/apps/client/src/features/collaboration/components/FlowStepEditor.tsx`
- Create: `agentwiki/apps/client/src/features/collaboration/components/RoleBindingEditor.tsx`
- Create: `agentwiki/apps/client/src/features/collaboration/components/ValidationIssueList.tsx`
- Modify: `agentwiki/apps/client/src/features/collaboration/api.ts`
- Modify: `agentwiki/apps/client/src/App.tsx`
- Modify: `agentwiki/apps/client/src/i18n/messages.ts`

**Interfaces:**
- Consumes: shared definition schema, template validation endpoint, Space active-Agent endpoint, typed API, existing modal/form primitives, and member permissions.
- Produces: `/spaces/:id/collaboration/templates/:templateId`, `/spaces/:id/collaboration/templates/:templateId/start`, optimistic save, exact three-step start flow, and one merged instruction per Agent.

- [ ] **Step 1: Write failing editor and wizard behavior tests**

```tsx
it("uses a form directory and shows deterministic graph errors without a canvas", async () => {
  renderEditor(cyclicTemplate);
  expect(screen.getByRole("navigation", { name: "Template sections" })).toBeVisible();
  expect(screen.queryByTestId("workflow-canvas")).not.toBeInTheDocument();
  expect(await screen.findByText("Dependency cycle detected")).toBeVisible();
  expect(screen.getByRole("button", { name: "Save template" })).toBeDisabled();
});

it("enforces the exact three start steps and fresh Agent preflight", async () => {
  renderWizard(validTemplate, [activeEditorAgent, activeReaderAgent, revokedAgent]);
  expect(screen.getByRole("heading", { name: "1. Work input" })).toBeVisible();
  await fillRequiredInputs();
  await user.click(screen.getByRole("button", { name: "Next" }));
  expect(createDraftRequest()).toEqual(expect.objectContaining({ templateId: validTemplate.id }));
  expect(screen.getByRole("heading", { name: "2. Map Agents" })).toBeVisible();
  expect(screen.queryByRole("option", { name: activeReaderAgent.name })).not.toBeInTheDocument();
  expect(screen.queryByRole("option", { name: revokedAgent.name })).not.toBeInTheDocument();
  await bindAllSlots(activeEditorAgent);
  await user.click(screen.getByRole("button", { name: "Next" }));
  expect(updateDraftRequest()).toEqual(expect.objectContaining({ expectedVersion: 1 }));
  expect(screen.getByRole("heading", { name: "3. Review and start" })).toBeVisible();
  expect(validateDraftRequest()).toEqual(expect.objectContaining({ expectedVersion: 2 }));
});

it("merges multiple Role Slots into one instruction and warns about self-review", async () => {
  renderStartedWizard(runWithOneAgentInTwoSlots);
  expect(screen.getAllByRole("button", { name: "Copy join instruction" })).toHaveLength(1);
  expect(screen.getByText("This Agent fills roles that review each other.")).toBeVisible();
  expect(screen.getByText(/wiki_collaboration_join_run/u)).toBeVisible();
  expect(screen.queryByText(/credential|api[-_ ]?key|token=/iu)).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run editor/wizard tests and verify RED**

Run: `cd agentwiki && pnpm --filter @agentwiki/client exec vitest run src/features/collaboration/TemplateEditor.test.tsx src/features/collaboration/RunStartWizard.test.tsx`

Expected: FAIL because editor and wizard components are absent.

- [ ] **Step 3: Implement the five-section editor with server validation and version conflicts**

```tsx
const SECTIONS = ['overview', 'inputs', 'roles', 'flow', 'outputs'] as const;
function save() {
  const parsed = CollaborationTemplateDefinitionSchema.safeParse(draft.definition);
  if (!parsed.success) return setLocalIssues(toValidationIssues(parsed.error));
  return collaborationApi.updateTemplate(spaceId, templateId, {
    expectedVersion: draft.version,
    name: draft.name,
    description: draft.description,
    definition: parsed.data,
  }).then(setDraft).catch((error) => {
    if (error.businessCode === 'COLLABORATION_TEMPLATE_VERSION_CONFLICT') setConflictOpen(true);
    else showToast(t('collaboration.saveFailed'), 'error');
  });
}
```

`FlowStepEditor` is an ordered list and detail form for Agent tasks and human review nodes. Todo reordering stays within its parent task. Dependency selectors expose only existing nodes and `all | any`. The issue panel groups exact server codes for missing roles, cycle, no entry, no terminal, unreachable required node, invalid revision target, and invalid output contract. There is no arbitrary expression, command, webhook, loop, script, or free-canvas field.

- [ ] **Step 4: Implement start data, mapping, preflight, and secret-free instructions**

```ts
export function buildAgentJoinInstructions(run: StartedRun): AgentInstruction[] {
  const byAgent = new Map<string, string[]>();
  for (const binding of run.roleBindings) byAgent.set(binding.agentId, [...(byAgent.get(binding.agentId) ?? []), binding.roleSlotName]);
  return [...byAgent.entries()].map(([agentId, roleSlots]) => ({
    agentId,
    roleSlots,
    text: `Run ${run.id}. Roles: ${roleSlots.join(', ')}. Use the existing AgentWiki MCP connection. Call wiki_collaboration_join_run with runId ${run.id}, then follow next_action until waiting_human, paused, completed, failed, or cancelled. Never invent or request a new credential.`,
  }));
}
```

Step 1 parses every value through the shared typed input-value schema, then creates the persisted draft. Step 2 lists only current-Space active Agents whose access role is editor/publisher, requires every mandatory Role Slot, and updates the draft with `expectedVersion`. Entering Step 3 calls the non-starting validate route to obtain `ready` and the next version; the final button calls start with `expectedVersion` and one UI-generated idempotency key. A 409 preserves local input, reloads authoritative draft/template/Agent state, and offers an explicit retry; refreshing the browser resumes the existing draft instead of silently creating another run.

- [ ] **Step 5: Verify accessibility, bilingual copy, and commit**

Run:

```bash
cd agentwiki
pnpm --filter @agentwiki/client exec vitest run src/features/collaboration/TemplateEditor.test.tsx src/features/collaboration/RunStartWizard.test.tsx
pnpm --filter @agentwiki/client exec tsc --noEmit
```

Expected: all commands exit 0; keyboard navigation, focus-returning dialogs, persisted draft recovery, optimistic conflicts, typed validation, active-editor filtering, self-review warning, exact three steps, idempotent start, and secret-free instructions pass in both languages.

```bash
git add agentwiki/apps/client/src/features/collaboration agentwiki/apps/client/src/App.tsx agentwiki/apps/client/src/i18n/messages.ts
git commit -m "feat(collaboration): configure and start workflow runs"
```

---

### Task 12: Authoritative Run Dashboard, Reviews, Recovery, and Responsive Layout

**Files:**
- Create: `agentwiki/apps/client/src/features/collaboration/RunDashboard.tsx`
- Create: `agentwiki/apps/client/src/features/collaboration/RunDashboard.test.tsx`
- Create: `agentwiki/apps/client/src/features/collaboration/components/RunSummary.tsx`
- Create: `agentwiki/apps/client/src/features/collaboration/components/TaskPanel.tsx`
- Create: `agentwiki/apps/client/src/features/collaboration/components/ReviewPanel.tsx`
- Create: `agentwiki/apps/client/src/features/collaboration/components/ArtifactPanel.tsx`
- Create: `agentwiki/apps/client/src/features/collaboration/components/AgentActivityPanel.tsx`
- Create: `agentwiki/apps/client/src/features/collaboration/useCollaborationRun.ts`
- Modify: `agentwiki/apps/client/src/features/collaboration/api.ts`
- Modify: `agentwiki/apps/client/src/App.tsx`
- Modify: `agentwiki/apps/client/src/i18n/messages.ts`

**Interfaces:**
- Consumes: full human run REST response, Socket refresh hints, current member identity/role, human run-control/review APIs, and resume-instruction builder.
- Produces: `/spaces/:id/collaboration/runs/:runId`, desktop three-column layout, mobile ordered single column, review/control dialogs, and authoritative refetch behavior.

- [ ] **Step 1: Write failing dashboard state, permission, realtime, and responsive tests**

```tsx
it("shows status with text and icon, ordered Todos, lease time, reviews, artifacts, and timeline", async () => {
  renderDashboard(runningRunFixture);
  expect(await screen.findByText("Running")).toBeVisible();
  expect(screen.getByLabelText("Running status")).toContainElement(screen.getByTestId("status-icon"));
  expect(screen.getAllByRole("listitem", { name: /Todo/u }).map((item) => item.textContent)).toEqual(["1. Inspect", "2. Implement", "3. Test"]);
  expect(screen.getByText(/Lease expires/u)).toBeVisible();
  expect(screen.getByText("artifact-v2.md")).toBeVisible();
});

it("treats Socket messages as refresh hints and refetches on focus and reconnect", async () => {
  renderDashboard(runningRunFixture);
  emitSocket('collaborationRunChanged', { runId: 'run-1', eventSequence: 9 });
  await waitFor(() => expect(getRunRequestCount()).toBe(2));
  window.dispatchEvent(new Event('focus'));
  await waitFor(() => expect(getRunRequestCount()).toBe(3));
  emitSocket('reconnect');
  await waitFor(() => expect(getRunRequestCount()).toBe(4));
});

it("shows only authorized controls and preserves the mobile content order", () => {
  setViewport(390, 844);
  renderDashboard(waitingReviewFixture, { role: 'editor', userId: 'reviewer-1' });
  expect(screen.getByRole('button', { name: 'Approve' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'End as failed' })).not.toBeInTheDocument();
  expect(sectionOrder()).toEqual(['summary', 'current-task', 'reviews', 'artifacts', 'activity']);
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390);
});
```

- [ ] **Step 2: Run dashboard tests and verify RED**

Run: `cd agentwiki && pnpm --filter @agentwiki/client exec vitest run src/features/collaboration/RunDashboard.test.tsx`

Expected: FAIL because dashboard and run hook are absent.

- [ ] **Step 3: Implement REST-authoritative state and debounced refresh hints**

```ts
export function useCollaborationRun(spaceId: string, runId: string) {
  const [state, setState] = useState<LoadState<HumanRunView>>({ kind: 'loading' });
  const refresh = useCallback(async () => {
    try { setState({ kind: 'ready', value: await collaborationApi.getRun(spaceId, runId) }); }
    catch (error) { setState({ kind: 'error', error: toUiError(error) }); }
  }, [spaceId, runId]);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => subscribeToRunRefresh({ runId, onChanged: debounce(refresh, 150), onReconnect: refresh }), [runId, refresh]);
  useEffect(() => { const onFocus = () => void refresh(); window.addEventListener('focus', onFocus); return () => window.removeEventListener('focus', onFocus); }, [refresh]);
  return { state, refresh };
}
```

Never merge event payloads into local workflow state. After any mutation, await the HTTP response and then call `refresh`; keep the last authoritative view visible with an updating indicator.

- [ ] **Step 4: Implement permission-aware human actions and responsive semantic order**

```tsx
<div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(15rem,0.8fr)_minmax(0,1.8fr)_minmax(17rem,1fr)]">
  <aside className="order-1 min-w-0"><RunSummary run={run} /></aside>
  <main className="order-2 min-w-0"><TaskPanel run={run} /><ReviewPanel className="mt-4 lg:hidden" run={run} /></main>
  <aside className="order-4 min-w-0 lg:order-3"><ReviewPanel className="hidden lg:block" run={run} /><ArtifactPanel run={run} /><AgentActivityPanel run={run} /></aside>
</div>
```

Render exactly one instance of each semantic panel. Use CSS grid areas/order to place the same ReviewPanel in the desktop third column and the mobile sequence summary, current task, review, Artifact, activity; do not render hidden duplicate component trees. Buttons follow server policy: starter/Owner/Admin pause-resume-retry-reassign; Owner/Admin skip-fail-cancel; constrained reviewer approve-reject-terminate. Every destructive dialog requires a reason and repeats the target; review rejection requires a valid return task. After review/recovery, show one merged resume instruction per affected Agent with no secret.

- [ ] **Step 5: Verify all dashboard states and commit**

Run:

```bash
cd agentwiki
pnpm --filter @agentwiki/client exec vitest run src/features/collaboration/RunDashboard.test.tsx
pnpm --filter @agentwiki/client exec tsc --noEmit
pnpm --filter @agentwiki/client build
```

Expected: all commands exit 0; loading/empty/error/conflict/revoked/paused/waiting-review/completed/failed/cancelled, permissions, refetch rules, focus management, Chinese/English, non-color status, and 390px overflow assertions pass.

```bash
git add agentwiki/apps/client/src/features/collaboration agentwiki/apps/client/src/App.tsx agentwiki/apps/client/src/i18n/messages.ts
git commit -m "feat(collaboration): add observable run dashboard"
```

---

### Task 13: Real PostgreSQL Concurrency, HTTP/MCP E2E, and Acceptance Runbook

**Files:**
- Create: `agentwiki/scripts/collaboration-workflows-db.test.mjs`
- Create: `agentwiki/scripts/collaboration-workflows-e2e.mjs`
- Reuse: `agentwiki/scripts/collaboration-test-database.mjs`
- Create: `agentwiki/docs/testing/collaboration-real-agent-acceptance.md`
- Modify: `agentwiki/package.json`
- Modify: `agentwiki/scripts/node-runtime-contract.test.mjs`

**Interfaces:**
- Consumes: complete server/client/protocol/gateway implementation and an isolated PostgreSQL/Redis test environment.
- Produces: repeatable database evidence, HTTP/MCP smoke, real Codex/Claude Code/OpenCode acceptance checklist, cleanup procedure, and release gate commands.

- [ ] **Step 1: Write failing database concurrency and recovery tests**

```js
import { createRequire } from 'node:module';
import { withCollaborationTestDatabase } from './collaboration-test-database.mjs';
const requireFromServer = createRequire(new URL('../apps/server/package.json', import.meta.url));
const { PrismaClient } = requireFromServer('@prisma/client');

test('one assigned Agent gets one active claim and recovery cannot resurrect a terminated run', { skip }, async () => {
  const fixture = await createCollaborationFixture(prisma, { assignedAgentId: agentA.id });
  const [first, second] = await Promise.allSettled([
    claimViaService(fixture.runId, agentA, 'claim-a'),
    claimViaService(fixture.runId, agentA, 'claim-b'),
  ]);
  assert.equal([first, second].filter((result) => result.status === 'fulfilled' && result.value.action === 'execute_task').length, 1);
  await terminateRun(fixture.runId, owner, 'acceptance termination');
  await expireLeaseAndRecover(fixture.runId);
  assert.equal((await prisma.collaborationRun.findUniqueOrThrow({ where: { id: fixture.runId } })).status, 'cancelled');
  assert.equal(await prisma.collaborationTaskAttempt.count({ where: { taskId: fixture.taskId, status: { in: ['claimed', 'running'] } } }), 0);
});

test('review rejection supersedes the causal generations and preserves all old rows', { skip }, async () => {
  const fixture = await createSubmittedReviewFixture(prisma);
  await rejectAndResubmit(fixture);
  const artifacts = await prisma.collaborationTaskArtifact.findMany({ where: { taskId: fixture.taskId }, orderBy: { version: 'asc' } });
  assert.deepEqual(artifacts.map(({ generation, version, status }) => [generation, version, status]), [[1, 1, 'superseded'], [2, 1, 'pending']]);
  assert.equal(await staleGenerationDependencyReleases(fixture.runId), 0);
});
```

The file is plain ESM JavaScript: do not use TypeScript-only `as const`, type annotations, or root `import '@prisma/client'`. Wrap fixture execution in `withCollaborationTestDatabase(process.env.COLLABORATION_TEST_DATABASE_URL, ...)` so migration and cleanup use only the generated prefixed schema.

- [ ] **Step 2: Run the database suite and verify RED**

Run: `cd agentwiki && node --test scripts/collaboration-workflows-db.test.mjs`

Expected with `COLLABORATION_TEST_DATABASE_URL` configured: FAIL until all service adapters and fixture helpers are wired. A skipped run is recorded but does not satisfy this task. The suite must pass `node --check scripts/collaboration-workflows-db.test.mjs` before execution.

- [ ] **Step 3: Complete database and HTTP/MCP scenarios with isolated cleanup**

The database suite creates a unique prefixed schema and resources under a unique `testRunId`, registers cleanup by exact IDs inside the schema, then lets the shared helper drop only that schema in `finally`. It asserts:

```js
const REQUIRED_DB_SCENARIOS = [
  'same-Agent concurrent next action has one active lease', 'parallel assigned Agents claim distinct tasks',
  'scoped idempotent next action and mismatch rejection', 'heartbeat renewal',
  'lease expiry and late rejection', 'maximum execution deadline', 'ordered Todo and Todo failure',
  'Artifact union, external reference, and bounded JSON Schema validation', 'all dependency',
  'any early release with all-upstream completion', 'approve', 'causal generation reject revision',
  'stale Artifact cannot release or complete', 'mixed review and ready status precedence',
  'terminate', 'retry once then exhaustion pause', 'reassigned Agent join and old lease rejection',
  'Agent revoke', 'Agent role downgrade', 'Space deletion', 'manual reauthorization',
];
```

`collaboration-workflows-e2e.mjs` boots API and Worker with test-only ports against the generated test schema, creates human Owner/Editor/Viewer and reader/editor/publisher Agents through product APIs, calls the remote MCP endpoint with their actual Credentials, verifies all six input and output schemas, and checks that `reader` reads but cannot execute. It checks persisted draft → validate → start, `join → next → heartbeat/Todo → submit → waiting_human(resumeRequired) → resume → completed`, plus manual reassignment to a previously unbound Agent, then deletes only resources carrying its unique prefix.

- [ ] **Step 4: Add scripts, runtime contract, and real-client acceptance checklist**

Add package scripts:

```json
{
  "test:e2e:collaboration-db": "node --test scripts/collaboration-workflows-db.test.mjs",
  "test:e2e:collaboration": "node scripts/collaboration-workflows-e2e.mjs"
}
```

The acceptance document records operator, date/time, server commit, client versions, Space/run IDs, and evidence links, then requires these exact live scenarios:

1. Coding template with at least two real connected client types, two parallel implementation tasks, ordered Todo, heartbeat, commit/test evidence, one human rejection, resume, acceptance, aggregation, and completion.
2. One lease timeout or Agent revoke, followed by deterministic release/pause and manual reassignment.
3. Bid template with the three human gates `bid-consensus-review`, `missing-material-review`, `final-bid-review`; coverage, outline, image-text, and merged-draft checks remain machine tasks.
4. Paper/video/novel built-in schema and representative run checks, including source-verification and novel continuity constraints.
5. Explicit cleanup confirmation that no non-test Space, Agent, template, run, Artifact, or external file was changed.

The document must name results as `PASS`, `FAIL`, or `BLOCKED` with evidence; an unexecuted checklist is not proof of real multi-Agent acceptance.

- [ ] **Step 5: Run the complete local release gate and commit**

Run:

```bash
cd agentwiki
pnpm --filter @neomei/agentwiki-sync-protocol test
pnpm --filter @neomei/agentwiki-sync-protocol typecheck
pnpm --filter @neomei/agentwiki-sync-protocol build
pnpm --filter @neomei/agentwiki-local-sync test
pnpm --filter @neomei/agentwiki-local-sync typecheck
pnpm --filter @neomei/agentwiki-local-sync build
pnpm --filter @agentwiki/server test
pnpm --filter @agentwiki/server typecheck
pnpm --filter @agentwiki/server build
pnpm --filter @agentwiki/client test
pnpm --filter @agentwiki/client exec tsc --noEmit
pnpm --filter @agentwiki/client build
pnpm test:runtime
COLLABORATION_TEST_DATABASE_URL='<dedicated non-production test database URL>' pnpm test:e2e:collaboration-db
COLLABORATION_TEST_DATABASE_URL='<dedicated non-production test database URL>' pnpm test:e2e:collaboration
pnpm lint
```

Expected: every non-environment-gated command exits 0; real PostgreSQL and HTTP/MCP tests pass rather than skip; the full server/client/protocol/gateway suites remain green. Real-client acceptance is reported separately with its evidence and is required before calling the user-facing feature fully accepted.

```bash
git add agentwiki/scripts/collaboration-workflows-db.test.mjs agentwiki/scripts/collaboration-workflows-e2e.mjs agentwiki/docs/testing/collaboration-real-agent-acceptance.md agentwiki/package.json agentwiki/scripts/node-runtime-contract.test.mjs
git commit -m "test(collaboration): add workflow acceptance gates"
```

---

## Final Verification and Release Boundary

- [ ] Confirm `git status --short` contains no accidental changes to `docmost`, `mnemon`, `openwiki`, `outline`, `swarmvault`, or `agentwiki/.codebase-memory/`.
- [ ] Confirm every collaboration migration is additive and the Prisma drift allowlist has not been broadened.
- [ ] Run `for file in scripts/collaboration-schema-db.test.mjs scripts/collaboration-test-database.mjs scripts/collaboration-workflows-db.test.mjs scripts/collaboration-workflows-e2e.mjs; do node --check "$file" || exit 1; done` and expect no ESM/TypeScript syntax error; then execute the schema suite to prove package resolution.
- [ ] Run database gates only with `COLLABORATION_TEST_DATABASE_URL`; verify logs name a `collaboration_test_*` schema and never `public`.
- [ ] Run `git diff --check` and expect no whitespace errors.
- [ ] Run `rg -n "review:decide|collaboration_approve|collaboration_reassign|collaboration_cancel" agentwiki/apps/server/src/mcp agentwiki/packages/local-sync/src/gateway` and confirm there is no Agent-callable human-control tool.
- [ ] Run `rg -n "process\.env|child_process|eval\(|new Function|webhook" agentwiki/apps/server/src/collaboration-workflows agentwiki/apps/client/src/features/collaboration` and confirm user template data is never executed.
- [ ] Run the Task 13 complete local release gate and preserve fresh command output as evidence.
- [ ] Run `rg -n "0\\.5\\.0|0\\.6\\.0|LOCAL_SYNC_VERSION|packageVersion" agentwiki/apps/server agentwiki/apps/client agentwiki/packages/local-sync` and confirm every active local-sync/onboarding and server/client package surface is `0.6.0`; sync-protocol keeps independent semver, and historical docs may retain `0.5.0` only when explicitly labelled intermediate.
- [ ] Execute the real-client acceptance runbook with at least two connected client types before claiming full feature acceptance.
- [ ] Before any production action, obtain explicit user authorization, perform read-only host/database/app preflight, create verified PostgreSQL and application rollback backups, run migration checks, deploy, observe services, verify public health, and run business smoke.
- [ ] After an authorized release, report alignment separately for local `master`, GitHub `origin/master`, npm packages if any, and production; local test success alone does not imply any of those were updated.
