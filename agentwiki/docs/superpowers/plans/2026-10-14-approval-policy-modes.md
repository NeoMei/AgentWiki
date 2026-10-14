# Agent approval policy modes

## Goal

Make the Space approval switch express two clear modes: `always-review` (all Agent ChangeSets require human review) and `no-review` (write-capable Agent grants, including Editor, may auto-publish within their existing scopes).

## Decisions

- Keep Reader read-only and keep Publisher's additional folder/delete scopes.
- An Editor may auto-publish page, graph, source, and run writes when the Space is in no-review mode and the Agent is otherwise active and authorized.
- Agents never receive human `review:decide` and never approve a ChangeSet themselves.
- Preserve tracked-source freshness safety: tracked OKF/source-head updates that explicitly require human review must remain pending even in no-review mode.
- Preserve backward compatibility for persisted `scoped-auto-publish` values by treating them as the no-review policy during rollout; new UI/API writes use `no-review`.
- Update user-facing labels and MCP/docs text so the policy names are “始终审核” and “无需审核”.

## Tasks

## Task 1

Update server policy validation, auto-publish gates, source pipeline exception, and focused server/MCP tests.

## Task 2

Update client/API policy types, settings labels, dashboard/agent/docs copy, and focused client tests.

## Task 3

Run focused tests, typechecks, and review the final diff without touching unrelated existing worktree changes.

## Global constraints

- Do not reset or reformat unrelated existing changes in this worktree.
- Do not grant Agents human review decision scopes.
- Do not bypass source freshness validation.
