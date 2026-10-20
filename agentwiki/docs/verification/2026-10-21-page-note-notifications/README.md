# 页面笔记协作人和消息通知验收

## Candidate

- Deployed commit: `209bbaa8` (`perf: lazy load notification navigation`)
- Branch: `codex/agent-autochat-external-opencode`
- Migration: `20261021120000_page_note_notifications`

## Automated checks

- Server full suite: 181 passed suites, 3,507 passed tests, 44 skipped.
- Client full suite: 164 passed files, 2,739 passed tests.
- Server typecheck and lint: passed.
- Client TypeScript check and lint: passed.
- Production build: passed; initial JavaScript `550441/551000` bytes.
- Prisma schema validation and production migration status: passed.
- `git diff --check`: passed.

## Production checks

- `GET /api/health`: `status=ok`, `database=ok`, `redis=ok`, `auditPersistence=ok`, `attachmentStorage=ok`.
- `agentwiki-api.service`, `agentwiki-worker.service`, `agentwiki-frontend.service`: active.
- External OpenCode: `opencode v2.1.1`.
- Migration applied successfully; database schema is up to date.

## Browser readback

Using the existing logged-in AgentWiki Chrome session:

1. The global navigation rendered the `消息通知` bell.
2. Opening the bell showed the empty-state dropdown and `查看全部通知` link.
3. Opening the link rendered `/notifications` with `全部 / 未读`, `全部已读`, refresh, and empty-state controls.
4. On a real editable page, selecting text rendered `添加页面笔记`; opening it rendered `协作人（可选）` and the Space member picker.
5. The picker returned six human Space members and excluded Agent grants. The test note was cancelled without saving.

## Boundary

The browser account had no existing notification, so the production session did not create a persistent cross-account notification. Multi-recipient creation, recipient authorization, idempotency, notification isolation, read state, and deep-link activation are covered by the client/server automated suites; the deployed browser verified the real picker and notification surfaces without leaving test data behind.
