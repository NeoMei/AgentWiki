---
name: agentwiki-local-sync
description: Synchronize locally-organized knowledge to AgentWiki through a deterministic orchestrator. No OpenWiki init, remote model key, or daemon is required.
license: MIT
compatibility: codex, claude-code, opencode
---

# AgentWiki Local Sync

Use the `agentwiki-local-sync` MCP tools for local knowledge synchronization.

1. Call `start_knowledge_job` with the target Space and recipe (e.g. `code-wiki@1` for code, `document-library@1` for documents). This creates a deterministic local job and returns a `jobId`.
2. Repeatedly call `get_next_work_item` with the `jobId`. The Orchestrator returns one structured work item at a time.
3. For `collect-artifacts` or `inspect-adapter` work items, use `read_artifacts` to inspect source summaries. For code, use the available codebase-memory MCP architecture/search tools first and pass a concise structure summary; never paste secrets or full source files.
4. For `organize-*` work items, produce the requested page, memory, or relation content. The Orchestrator handles stable IDs, paths, provenance, and hashes.
5. Call `submit_organized_item` after each work item. The Orchestrator advances the job phase when all items in the current phase are complete.
6. When the job reaches `validate`, call `validate_knowledge_job`. If validation reports issues, retry only the failed work items.
7. When the job reaches `preview`, call `preview_knowledge_job`. Show the target Space, added/updated/deleted/unchanged items, skipped files, upload size, and source boundaries exactly as returned.
8. Ask: “是否同步到 AgentWiki？” Do not infer consent from an earlier install or recipe selection.
9. Only after a clear yes in the current conversation, call `confirm_and_push` with `confirmed: true`.
10. To refresh the local workspace from the server, call `pull_space`. If pull reports conflicts, use `resolve_conflict` with a merge proposal before pushing.

Never approve a ChangeSet on the Agent's behalf, run OpenWiki interactively, expose API keys, or upload raw source files or binary documents.
