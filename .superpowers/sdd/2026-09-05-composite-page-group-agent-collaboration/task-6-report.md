# Task 6 implementation report

## Status

DONE

## Implementation

- Added `PageAgentBindingService.setBindings` as a no-nested-transaction primitive for callers already holding the Space tree lock in a serializable transaction.
- Added `setBindingsInScope` with an exact explicit `pageIds` set, duplicate rejection, `expectedTreeRevision`, live human content authorization, and one serializable transaction. Binding changes do not advance the tree revision.
- Added the separately authorized `previewBindings` read entry point. It returns only explicitly requested Pages and ISO `updatedAt` binding versions.
- Binding validation reads actual Page ownership, active Agent and live owner state, same-Space AgentGrant, and the Grant-derived `collaboration:execute` capability. It does not require realtime presence and never creates, changes, or restores a Grant or Credential.
- Added CAS create/update/delete behavior, monotonic update timestamps, exact no-op suppression, and immutable before/after/actor audit events. No Run or task-assignee write path was added.
- Added `resolveParticipants`: enabled tasks only, deterministic missing/conflict issues, per-task assignments, and de-duplicated participant Agents.
- Registered the binding service in `PageTemplateModule` without adding a controller or Run wiring.

## RED evidence

Command:

```text
pnpm --filter @agentwiki/server test -- run-page-selection.spec.ts page-agent-binding.service.spec.ts
```

Expected failure observed before production files existed:

```text
FAIL src/page-templates/run-page-selection.spec.ts
TS2307: Cannot find module './run-page-selection'
FAIL src/page-templates/page-agent-binding.service.spec.ts
TS2307: Cannot find module './page-agent-binding.service'
Test Suites: 2 failed, 2 total
```

## GREEN and regression evidence

- New specs: `2 passed`, `19 passed`.
- Existing authorization and collaboration Run specs: `2 passed`, `81 passed`.
- Agent role/protocol suite: `10 files passed`, `101 passed`.
- Server typecheck: passed.
- Server lint: passed.
- Server build: passed.
- Dedicated PostgreSQL test, using a random schema through the shared safe helper: `1 passed`. The test calls the public batch wrapper, injects failure on the second audit insert, then proves zero bindings, zero audit events, and unchanged `contentTreeRevision`.

Commands:

```text
pnpm --filter @agentwiki/server test -- run-page-selection.spec.ts page-agent-binding.service.spec.ts
pnpm --filter @agentwiki/server test -- core/authorization/authorization.service.spec.ts collaboration-workflows/run.service.spec.ts
pnpm --filter @neomei/agentwiki-sync-protocol test -- src/agent-access-role.spec.ts
pnpm --filter @agentwiki/server typecheck
pnpm --filter @agentwiki/server lint
pnpm --filter @agentwiki/server build
PAGE_TEMPLATE_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:62341/agentwiki_composite_test PG_DUMP_BIN=/opt/homebrew/opt/postgresql@16/bin/pg_dump node --test scripts/page-agent-binding-db.test.mjs
```

## Files

- `agentwiki/apps/server/src/page-templates/page-agent-binding.service.ts`
- `agentwiki/apps/server/src/page-templates/page-agent-binding.service.spec.ts`
- `agentwiki/apps/server/src/page-templates/run-page-selection.ts`
- `agentwiki/apps/server/src/page-templates/run-page-selection.spec.ts`
- `agentwiki/apps/server/src/page-templates/page-template.module.ts`
- `agentwiki/scripts/page-agent-binding-db.test.mjs`

## Self-review

- Scope is Page-only; no Folder binding, Grant/Credential mutation, Run mutation, Sync v3, attachment, or image changes.
- The public mutation preserves the repository lock prefix `live human -> Space advisory`; the transaction primitive does not acquire Agent/owner locks after the Space lock. Fresh Agent/owner/Grant checks run in the caller's serializable transaction, and the existing database trigger remains the write-time same-Space Grant invariant.
- Unbound Pages are normal, no-op edits emit no invalid audit row, and unbinding deletes only the current relationship.
- Preview and commit both use explicit Page IDs, so a new child created after preview is never implicitly included; the commit rejects a stale tree revision.

## Concerns

- Task 8 must invoke `setBindings` only from its existing serializable, Space-tree-locked creation transaction, and must separately run startup Credential/readiness checks. This task deliberately does not make saved bindings depend on realtime Agent presence.

## Reviewer fix 1

- Replaced the ambiguous role-only participant binding with an explicit union:
  - `task_default`: `{kind,nodeId,roleSlotId,agentId}`
  - `role_override`: `{kind,roleSlotId,agentId}`
- Task defaults now participate only when both `nodeId` and `roleSlotId` match an enabled task. A disabled task sharing the same role can no longer create a false conflict or participant.
- A single explicit override takes precedence over task defaults for a used role; distinct overrides for one used role return stable `ROLE_BINDING_CONFLICT`; overrides for unused roles are omitted.
- Tightened the `setBindings` transaction parameter from `Prisma.TransactionClient | SpaceTreeLockedTransaction` to only `SpaceTreeLockedTransaction`. The spec now carries a branded fixture and a compile-only negative type assertion.

RED:

```text
TS2353: 'kind' does not exist in type 'RunPageSelectionBinding'
TS2578: Unused '@ts-expect-error' directive for an unbranded Prisma transaction
Test Suites: 2 failed, 2 total
```

GREEN:

```text
pnpm --filter @agentwiki/server test -- run-page-selection.spec.ts page-agent-binding.service.spec.ts
Test Suites: 2 passed, 2 total
Tests: 22 passed, 22 total

pnpm --filter @agentwiki/server typecheck
passed

pnpm --filter @agentwiki/server lint
passed

git --work-tree='/Users/neomei/.codex/worktrees/69d8/AgentWiki ' diff --check
passed
```

The PostgreSQL binding transaction runtime was unchanged by this fix, so the previously passing dedicated rollback test was not rerun.
