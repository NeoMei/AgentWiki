# Agent session runtime boundary

AgentWiki owns durable sessions, source authorization, queue state and candidate
review. The runtime generates an answer or candidate; it never publishes Pages.
The first provider is the existing server-side OpenCode router/CLI. All turns use
`AssistTask` and the existing leased worker queue.

## Public HTTP contract

These paths are relative to the existing `/api` base. They require a human JWT.
The server derives the requester from authentication; a client-supplied user ID
cannot select another account's conversation.

| Operation | Response |
| --- | --- |
| `POST /assist/sessions {spaceId,title?}` | `AgentSessionSummary` |
| `GET /assist/sessions?spaceId=...` | Latest 50 authorized summaries |
| `GET /assist/sessions/:id` | Flat summary fields plus `turns` |
| `POST /assist/sessions/:id/turns` | Durable queued `AgentTurnView` or original idempotent turn |
| `POST /assist/tasks/:id/cancel` | Canonical session turn after cancellation |

```json
{
  "clientRequestId": "client-generated-retry-key",
  "mode": "question",
  "intent": "Explain the selected statement",
  "pageId": "page-a",
  "snapshot": {
    "title": "Original title",
    "content": "Original source",
    "updatedAt": "2026-10-06T12:00:00.000Z",
    "draftRevision": 3,
    "remoteRevision": 1
  },
  "referencePageIds": ["page-b"],
  "noteIds": ["local-note-a"],
  "annotations": [{"id":"local-note-a","body":"Why does this hold?","quote":"Original source"}]
}
```

`snapshot` is optional: omission captures the current saved Page on the server.
Supplying it captures the explicitly sent draft. Its saved `updatedAt` is checked
against the current Page; local revision numbers remain opaque client metadata,
never durable versions. `assistTarget` keeps the existing exact source/range rules.
References are always read from same-Space Pages by the server. Request bodies
cannot replace referenced Page content. `annotations` is optional and includes
only explicitly sent note IDs, comments and original quotes; note IDs must be
selected in `noteIds`. Nonempty quotes must occur in the sent current snapshot.
The backend never reads the local note store or marks a note resolved.

```json
{
  "id": "session-a",
  "spaceId": "space-a",
  "title": "Explain the selected statement",
  "createdAt": "2026-10-06T12:00:00.000Z",
  "updatedAt": "2026-10-06T12:01:00.000Z",
  "turns": [{
    "id": "turn-a", "sessionId": "session-a", "pageId": "page-a",
    "mode": "question", "intent": "Explain the selected statement",
    "status": "done", "createdAt": "2026-10-06T12:01:00.000Z",
    "pageSnapshot": {"title":"Original title","content":"Original source","updatedAt":"2026-10-06T12:00:00.000Z","draftRevision":3,"remoteRevision":1},
    "references": [{"pageId":"page-b","title":"Reference at send time","updatedAt":"2026-10-06T11:00:00.000Z"}],
    "noteIds": ["local-note-a"],
    "annotations": [{"id":"local-note-a","body":"Why does this hold?","quote":"Original source"}],
    "progressText": "The explanation.", "result": {"summary":"The explanation."}, "error": null
  }]
}
```

An untouched default title becomes the first intent, whitespace-normalized and
bounded to 120 characters. Explicit titles are retained. All historical source
metadata remains the originally sent value after route changes and refresh.

Questions require current read access. Proposals additionally require existing
edit access and return a nonempty full Markdown `changes` value. A question
response containing nonempty or malformed `changes` fails validation. Public
results contain only `summary`/`changes`; model names, costs, usage, raw provider
text, internal context and lease ownership never enter the session response.
Existing task list/get endpoints exclude session rows entirely, and the legacy
Socket relay refuses session messages even if injected into Redis.

## Bounds and failure behavior

Limits count JavaScript UTF-16 characters, including JSON encoding where stated:

- 100 turns per session; attempt 101 returns an explicit new-conversation error.
- 50 summaries per list; the returned session detail includes all its turns.
- 10,000 intent characters; 128 per ID; 5 unique reference IDs; 100 unique note IDs.
- 50,000 serialized snapshot characters, preserving the previous snapshot bound.
- 10,000 serialized annotation characters; all annotations must name selected IDs.
- 100,000 serialized snapshot plus context characters. References are never silently dropped.
- History is the newest contiguous suffix of at most 10 completed turns within
  120,000 serialized characters. `historyWindow` explicitly reports included and
  omitted counts to the runtime; history contains canonical answers/candidates and
  explicitly sent annotations. Failed/cancelled turns are not replayed as answers.
- An answer is at most 50,000 characters; combined serialized `summary`/`changes`
  is at most 100,000. Oversized output fails rather than truncating a document.
  The public task error is `Assistant output exceeds the limit (answer 50000; total 100000 characters)`.
- The existing configured per-user/Space outstanding-task quota remains active.

A different send while a turn is queued/running returns HTTP 409. Reusing the
same `clientRequestId` returns the original turn before applying active-turn and
capacity checks. Sends lock User → Space → session rows; cancellation shares the User → Space
lock order. Unique `(sessionId,clientRequestId)` and a partial unique active-session index
provide database backstops. Small bounded retries re-read winners after unique or
serialization conflicts. Task/source/owner bindings are validated on every read
and execution boundary. A removed source or revoked membership fails closed,
including historical turns; source updates preserve readable historical versions
but prevent execution/publication of a stale active snapshot.

## Runtime port and cancellation

`AgentRuntimePort.run(AssistInput): Promise<AssistRunResult>` receives intent,
mode, captured snapshot, canonical explicit context, bounded history/window,
`AbortSignal`, lease deadline and active-state callback. Its capabilities are:

```ts
{ questions: true, proposals: true, cancellation: true,
  tools: false, permissions: false, resume: false }
```

`onAnswerText` contains only complete, parsed answer summaries from real CLI text
steps. It is step-level progress, not token streaming. It excludes raw JSON,
reasoning, tools, usage and synthetic timeline events. REST polling of persisted
turns is the authoritative session transport. Legacy events remain separate.

The worker polls persisted cancellation, live authorization and lease ownership
every 500 ms and has an independent lease-deadline timer. An abort sends SIGTERM
to the CLI immediately; a process that ignores it receives SIGKILL after five
seconds. Router cancellation is global and cannot trigger another model attempt.
Progress and completion require running status, current owner and an unexpired
lease; publication checks live user/Space/source authorization under the same
User → Space locks as membership and Page writers. A cancellation committed first
cannot be overwritten by a late model result. Lease recovery also fences its
writes against cancellation/completion that occurred after scanning expired rows.

## Future local ACP connector

The future local connector owns the user's stdio child process and uses stable
ACP v1 JSON-RPC. The browser does not launch local executables directly.

| AgentWiki boundary | Future ACP mapping |
| --- | --- |
| Create provider context, bound to authenticated user + Space + session | `session/new` |
| Prompt with explicitly captured source context | `session/prompt` |
| Normalized provider updates | `session/update` |
| Cancel active turn and block publication | `session/cancel` |
| Actual tool events, only if capability enabled | ACP tool call updates |
| Explicit permission request, only if capability enabled | `session/request_permission` |
| Native resume, only after implemented and negotiated | ACP session resume/load capability |

Tool access to AgentWiki still requires independent explicit Space-scoped MCP
credentials and grants. Web session ownership does not confer MCP access.
Permission UI, native Agent connection, native resume, remote ACP/HTTP transport,
Follow Mode, and atomic multi-document changes are not implemented here. Server
history replay is not native provider session resume.

Protocol references: [ACP v1 overview](https://agentclientprotocol.com/protocol/v1/overview),
[transports](https://agentclientprotocol.com/protocol/transports),
[session setup](https://agentclientprotocol.com/protocol/session-setup),
[tool calls](https://agentclientprotocol.com/protocol/tool-calls).
