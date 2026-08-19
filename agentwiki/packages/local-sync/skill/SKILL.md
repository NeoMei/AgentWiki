---
name: agentwiki-local-sync
description: Use when working with AgentWiki pages or preparing confirmed local code or document knowledge synchronization through the installed AgentWiki gateway.
license: MIT
compatibility: codex, claude-code, opencode
---

# AgentWiki Unified Gateway

Use the one MCP entry named `agentwiki`, installed by `@neomei/agentwiki-local-sync`. It exposes all AgentWiki capabilities through stable tool families:

- `wiki_*` calls remote AgentWiki tools.
- `local_*` inspects local sources without uploading.
- `knowledge_*` coordinates local preparation with confirmed server synchronization.

Never create a second direct AgentWiki MCP connection, a credential-specific MCP name, or a separate local-sync MCP entry. API credentials shown in AgentWiki are for APIs, scripts, and external systems; Agent access always uses this gateway.

For local knowledge synchronization, use one gateway and two distinct confirmations. CodeGraph is installed and managed independently for its own lifecycle; AgentWiki only probes its supported local surfaces and never installs or upgrades it.

1. Use `wiki_list_spaces` to find the authorized target Space and its internal ID.
2. For code, call `local_scan_sources` with the requested paths and `analysisMode: standard`. It is read-only: it returns a CodeGraph plan and `localScanPlanHash`, without initializing, syncing, writing `.codegraph/`, creating a Preview, or uploading.
3. Show the source plan, CodeGraph status, intended `.codegraph/` action, and exact `localScanPlanHash`. Ask for a clear, current confirmation of this scan plan. Installation, an earlier confirmation, selecting a Space, or Agent authorization is not that confirmation.
4. Only after the user confirms that exact plan, call `knowledge_prepare` with the same paths, Space ID, `analysisMode: standard`, `confirmedLocalScan: true`, and the exact `localScanPlanHash`. This may perform the confirmed local scan and creates a reviewable Preview; it does not upload.
5. Show the Preview's target Space, added/updated/deleted/unchanged items, skipped files, upload size, `previewHash`, and data/model boundaries. Raw source files, credentials, absolute paths, CodeGraph databases, and `.codegraph/` never enter the Preview.
6. Ask separately: “是否将此 Preview 同步到 AgentWiki？” Do not infer sync consent from scan consent, installation, Agent authorization, Space selection, or an earlier request.
7. Only after a clear yes in the current conversation, call `knowledge_confirm_and_sync` with the exact `jobId`, `previewHash`, and `confirmed: true`.
8. Report the resulting revision, submission, ChangeSet, and review state. Never approve a ChangeSet on the user's behalf.
9. Use `knowledge_pull` when the local workspace must be refreshed from the authoritative server revision.

Deep analysis is Stage 2 only. Do not request or run `analysisMode: deep` unless the user explicitly asks for deep analysis.

Remote `wiki_*` tools may be used directly for normal AgentWiki work. Never expose API keys, upload raw source files or binary documents, or use retired low-level tools such as `start_knowledge_job`, `confirm_and_push`, `pull_space`, or `resolve_conflict`.
