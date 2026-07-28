---
name: agentwiki-local-sync
description: Build a local OpenWiki knowledge base from code or documents, preview its AgentWiki diff, ask the user, and sync only after explicit confirmation.
license: MIT
compatibility: codex, claude-code, opencode
---

# AgentWiki Local Sync

Use the `agentwiki-local-sync` MCP tools for local knowledge synchronization.

1. Call `inspect_local_source` first. Do not run OpenWiki when it reports a non-local model provider until you disclose the provider and the user explicitly agrees.
2. For a code repository, call the available codebase-memory MCP architecture/search tools first. Pass a concise structure summary to `prepare_knowledge_sync`; never paste secrets or full source files into the summary.
3. Call `prepare_knowledge_sync`. This processes files locally and returns a preview; it does not upload.
4. Show the target Space, added/updated/deleted/unchanged pages, skipped files, upload size, and provider boundary exactly as returned.
5. Ask: “是否同步到 AgentWiki？” Do not infer consent from an earlier install or model-provider approval.
6. Only after a clear yes in the current conversation, call `sync_prepared_knowledge` with the returned preview ID and `confirmed: true`.
7. Report Source, Run, and review status. Never approve a ChangeSet on the Agent's behalf.

If the user refuses, stop. Do not retry, upload, or retain a reusable confirmation.
