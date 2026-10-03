# Multi-Space Agent Connection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let one installed `agentwiki` gateway retain and route multiple Space-scoped connections safely.

**Architecture:** Keep server credentials one-Space-per-grant. Merge local connection records instead of replacing them, then resolve each gateway operation by its explicit `spaceId`; fail closed when no matching connection exists.

**Tech Stack:** TypeScript, Vitest, MCP Streamable HTTP, Node JSON config, NestJS server contracts.

**Spec:** `docs/superpowers/specs/2026-10-03-multi-space-agent-connection-design.md`

## Global Constraints

- `AgentCredential` remains bound to exactly one `AgentGrant` and one Space.
- The local gateway remains a single `agentwiki` MCP entry.
- Space-scoped operations must not fall back to another Space credential.
- Existing single-Space configuration remains readable.

---

### Task 1: Space-scoped local connection registry

**Files:**
- Modify: `packages/local-sync/src/config.ts`
- Test: `packages/local-sync/src/config.spec.ts`

- [ ] Add a failing test proving saving a second connection preserves the first and can resolve both by `spaceId`.
- [ ] Run the focused config test and observe the failure.
- [ ] Add `spaceId` to `LocalSyncConnection`; add a helper that finds a connection for a Space and throws a clear error when absent.
- [ ] Change the persistence helper used by onboarding to merge by connection id instead of replacing the complete record.
- [ ] Run the focused config test and the existing config tests.

### Task 2: Route gateway handlers by Space

**Files:**
- Modify: `packages/local-sync/src/gateway/entry.ts`
- Modify: `packages/local-sync/src/onboarding/runtime.ts`
- Modify: `packages/local-sync/src/gateway/server.ts`
- Test: `packages/local-sync/src/gateway/entry.spec.ts`

- [ ] Add failing tests with two connections and distinct API keys; assert pull/remote calls use the requested Space's key and unknown Space rejects.
- [ ] Run the focused gateway tests and observe the failure.
- [ ] Implement a registry resolver and use it for SyncEngine and RemoteMcpBridge construction; require `spaceId` for remote tools that declare it.
- [ ] Keep local-only tools unchanged and preserve explicit `spaceId` validation for knowledge tools.
- [ ] Run the focused gateway tests.

### Task 3: Onboarding and compatibility updates

**Files:**
- Modify: `packages/local-sync/src/onboarding/install.ts`
- Modify: `packages/local-sync/src/onboarding/attach.ts`
- Modify: `packages/local-sync/src/agentwiki-client.ts`
- Test: `packages/local-sync/src/onboarding/install.spec.ts`

- [ ] Add a failing regression test showing a second installation does not archive or erase the first local connection.
- [ ] Run the focused installer test and observe the failure.
- [ ] Persist `spaceId` with the exchanged connection and merge credentials/config atomically; preserve replay and rollback behavior.
- [ ] Run installer, attach, and client tests.

### Task 4: Server contract and end-to-end checks

**Files:**
- Modify: `apps/server/src/core/agent/local-sync-installation.service.ts` only if the exchange contract needs a stable Space identity field.
- Test: existing local-sync service/composition tests and package tests.

- [ ] Verify exchange results always include the internal `spaceId` and remain one-grant scoped.
- [ ] Add/adjust a service regression test for two Space grants on the same Agent.
- [ ] Run package tests, server targeted tests, type checks, and build.
- [ ] Review the diff for fallback or cross-Space credential leakage.
