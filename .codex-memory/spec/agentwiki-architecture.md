# AgentWiki stable architecture rules

- React/Vite + React Router is the only current frontend baseline; NestJS + Prisma/PostgreSQL is the backend baseline.
- Global IA: Spaces, Agents, Review, Search and a personal menu containing Profile/Integrations/Guide/About. Space IA: Pages, Graph, Sources, Runs, Members, Settings.
- Human JWT/PAT and AgentCredential are distinct identities. JWT/WebSocket authentication rechecks the current non-deleted human User; Agent access requires current credential Scope, Space Grant and active status. Agents never receive `review:decide`.
- Source → SourceVersion → IngestRun → Artifact/Evidence → ChangeSet/Approval → Page/Relation is the canonical knowledge-production chain.
- Agent memory is scoped by Space; private memories are limited to the target Agent while explicitly shared memories are visible to authorized Agents in that Space. Only episodic and semantic types are claimed. Recall explanations expose lexical, persisted-embedding (with trigram fallback), actual knowledge-graph and importance signals.
- Remote MCP uses Streamable HTTP at `/api/mcp`, Host allowlisting and the same service-layer authorization. Agents cannot approve change sets.
- Agent REST and MCP content writes both enter ChangeSets; only accepted items publish. Page/relation create, update and archive changes preserve prior state, reject stale candidates and support rollback.
- Page and Relation retain origin provenance separately from the latest modifier. Published page changes synchronously maintain `PageSearchDocument`; semantic embedding is optional enrichment.
- API and ingestion Worker are separate process roles. Workers use renewable fenced leases, periodically reclaim only expired work, and re-check the current requesting credential/authorization at multiple stages.
- The remote application uses direct Node.js deployment, not Docker: user-level systemd separately supervises API, ingestion Worker and the Vite production frontend. Releases mirror source to remove stale files, build before switching, run Prisma deploy and require `/api/health` plus business smoke checks.
- API and Worker production module graphs must each compile in automated Nest tests; TypeScript compilation alone is not a sufficient deployment gate.
- Legacy `/spaces/:id/docs` only redirects to Sources for compatibility; legacy backend code/models are removed and historical jobs are migrated to Source/Run records.
