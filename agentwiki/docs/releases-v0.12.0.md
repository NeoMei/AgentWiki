# AgentWiki v0.12.0

Plan import rework and claim visibility for multi-agent work.

- import-plan accepts pageId: the server reads the plan from an AgentWiki markdown page in the same space (stable ID via agentwiki-page:<id>); content stays supported for CLI push.
- Import dialog rebuilt with three sources — paste, local file upload (read in the browser), and wiki-page picker. The old "计划文件路径" field is now 计划标识 and clearly documented as an ID-alignment key; the server never reads local files.
- Task claim visibility: the inspector shows claim owner/time/takeover chain, and the status editor offers an explicit takeover switch (409 conflicts surface claimed_by).
- Local Sync and sync protocol versions remain 0.10.0 and 0.6.0.
