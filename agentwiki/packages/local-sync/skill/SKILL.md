---
name: agentwiki-local-sync
description: Use the single AgentWiki MCP gateway for remote wiki work, local source inspection, and confirmed knowledge synchronization. No second MCP, remote model key, or daemon is required.
license: MIT
compatibility: codex, claude-code, opencode
---

# AgentWiki Unified Gateway

Use the one MCP entry named `agentwiki`, installed by `@neomei/agentwiki-local-sync`. It exposes all AgentWiki capabilities through stable tool families:

- `wiki_*` calls remote AgentWiki tools.
- `local_*` inspects local sources without uploading.
- `knowledge_*` coordinates local preparation with confirmed server synchronization.

Never create a second direct AgentWiki MCP connection, a credential-specific MCP name, or a separate local-sync MCP entry. API credentials shown in AgentWiki are for APIs, scripts, and external systems; Agent access always uses this gateway.

For local knowledge synchronization:

1. Use `wiki_list_spaces` to find the authorized target Space and its internal ID.
2. Call `local_scan_sources` to inspect the requested local paths. For code, use available codebase-memory architecture/search tools and concise structural summaries; never paste secrets or full source files.
3. Call `knowledge_prepare` with the Space ID, source paths, and source type. This organizes and validates locally, then returns a reviewable preview without uploading it.
4. Show the returned target Space, added/updated/deleted/unchanged items, skipped files, upload size, preview hash, and data/model boundaries.
5. Ask: “是否同步到 AgentWiki？” Do not infer consent from installation, Agent authorization, Space selection, or an earlier request.
6. Only after a clear yes in the current conversation, call `knowledge_confirm_and_sync` with the exact `jobId`, `previewHash`, and `confirmed: true`.
7. Report the resulting revision, submission, ChangeSet, and review state. Never approve a ChangeSet on the user's behalf.
8. Use `knowledge_pull` when the local workspace must be refreshed from the authoritative server revision.

Remote `wiki_*` tools may be used directly for normal AgentWiki work. Never expose API keys, upload raw source files or binary documents, or use retired low-level tools such as `start_knowledge_job`, `confirm_and_push`, `pull_space`, or `resolve_conflict`.
