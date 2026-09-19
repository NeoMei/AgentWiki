# AgentWiki v0.11.7

Taskboard multi-agent collaboration hardening.

- Task claims: entering in_progress/in_review/done requires holding the task claim; a claim held by another actor returns a conflict unless the caller passes takeover=true.
- Dependency enforcement: tasks with depends_on cannot enter in_progress until every dependency is done.
- Actor attribution: status history entries and the new board event log record the acting user or agent.
- Optimistic concurrency: status updates accept expected_status and fail with a conflict when the live status moved.
- Live board updates: board changes publish over Redis and reach open taskboard pages through the collaboration socket, which now auto-refreshes.
- New endpoint: GET /api/spaces/:spaceId/taskboard/events (recent board activity).
- Schema: adds ProjectBoard.eventSequence and ProjectBoardEvent (applied via prisma migrate deploy).
- Local Sync and sync protocol versions remain 0.10.0 and 0.6.0.
