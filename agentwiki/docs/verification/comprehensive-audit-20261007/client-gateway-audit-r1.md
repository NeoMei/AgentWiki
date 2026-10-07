# Client / gateway independent audit R1

Candidate: e0f2d12ab5d4214c6e326affe305fdc3c609ca3f; base: 165c207b. Read-only review; no runtime/browser/DB/build started. Repository has no .codegraph. Read AGENTS, current, spec index and four frontend rules, both October 7 plans. Prior acceptance conclusions were not rewritten.

## Finding 1 — P2: Review authorization failures keep cached source/evidence and decision controls visible

Location: `/Users/neomei/.codex/worktrees/knowledge-capabilities/AgentWiki /agentwiki/apps/client/src/features/review/ReviewPage.tsx:171` and `:203-207`; rendering at `:396-400` and evidence at `:84-107`.

Reproduce: use a normal non-platform-admin viewer and open `/review?spaceId=SPACE`, then expand a review with source name/evidence. The Space owner removes this viewer from another session, then focus the viewer's review window. The Space-filtered URL is required: the global `/review` returns an empty array and removes the row successfully. For stale decision controls, start as owner, transfer ownership and remove the former owner; a last owner cannot simply be removed. Both GET /review (Space-filtered) and GET /change-sets/:id now reject 403. `load` only calls setError, `expandChangeSet` likewise only calls setError; neither clears cached items, detailedIds or permissions. Expanded candidate, evidence and enabled controls remain indefinitely. A subsequent mutation fails server-side; no server write bypass is claimed.

Related source-projection variant: a fresh summary that redacts its run/source fields is merged into a detailed cached row by replacing only status/items, discarding the fresh run and sourceStatus. If the detail refetch fails, stale source identity persists. This variant can be demonstrated with synthetic responses; normal JWT source access and Space access share membership, so do not claim a standalone production source-scope revocation UI scenario without a suitable credential setup.

Impact: frontend does not honor newly observed authorization denial; this branch newly renders source/evidence status on the existing cache path. The cache retention itself predates this branch, so classify as an adjacent existing defect, not a newly introduced server authorization regression. Recommended fix: clear sensitive detail/permissions on authoritative 401/403/404; merge source projections from successful summaries and invalidate stale details as appropriate. Do not discard cached data on ordinary transient 5xx without a separate UX decision.

Validation: control-flow/code verified. Live UI reproduction not performed because root owns runtime. Existing focused suite passes; no existing test asserts post-denial removal. Root should confirm with real membership revocation and/or a deferred mocked detail GET.

## Coverage / checks

- All branch client diff: PagePreview optimistic source status and rollback, SourceStatusNotice, PageInfoPanel evidence state, Review conflict handling and candidate notices, KnowledgeGraph fallback copy, locale messages.
- Shared PageSourceStatus DTO inspected with server projection consumer; unknown/untracked/unavailable/current semantics and version/generation labels checked.
- Local gateway typed read fields, transport versus post-merge validation, same-valued duplicates, conflicts, malformed legacy input, unknown tool names, explicit Space routing and single-Space compatibility, per-Space immutable credential bridge, remote errors and generic write wrapping.
- Shipped skill diff preserves objective status semantics and content-as-data instruction; no unsupported retrieval benefit claim found.
- No additional confirmed issue in changed gateway normalization. Layout classes reviewed, but this is not native/browser layout acceptance.

Executed without build:
- client: `pnpm exec vitest run src/features/page/PagePreview.spec.tsx src/features/review/ReviewPage.spec.tsx src/features/space-workspace/PageInfoPanel.spec.tsx` — 3 files / 96 tests passed.
- local-sync: `pnpm exec vitest run src/gateway/knowledge-read-tools.spec.ts src/gateway/server.spec.ts src/gateway/multi-space.integration.spec.ts src/agent-clients.spec.ts` — 4 files / 81 tests passed.

## Suggested root UI / SDK acceptance

1. Open Review with actual source evidence; revoke membership; focus and wait for denied GETs; assert candidate/evidence and decision controls disappear.
2. Expand then collapse Review, change source head, focus, reopen while delaying detail response; verify new source status and consistent provenance, no old data after authoritative denial.
3. Checkbox current→optimistic needs_review→500 rollback, queued toggles plus 409 rebase, navigation A→B→A with delayed saves; assert content and status share response identity.
4. Page/Review at 390/1280/1600 widths with 64-character version IDs, wide table, long source path and no provenance; inspect overflow and labels in Chinese/English.
5. Actual stdio SDK direct/legacy mixed fields, duplicate conflict, missing query/pageId, A revoked while B works; verify no fallback credential switching and no upstream call for invalid arguments.

## Authorization-path clarification

`authorization.service.ts:94-98` checks `sources:read` separately only for personal credentials (`!agentId && credentialId`). JWT human Source/Review reads both use live Space membership; no separate JWT source-only policy was found. `review.controller.ts:21-25` throws 403 when the requested Space is no longer in accessible Spaces; unfiltered review instead returns remaining/empty list. `api/client.ts:23-41` globally redirects 401, so the retained-cache live UI reproduction specifically uses 403 (not 401). Source-only PAT redaction is a valid API contract, but not a normal login UI capability; do not claim that variant as a real JWT UI exploit.

Ordinary source-head updates are distinct: summary.items contains freshly projected per-item sourceStatus, so the rendered item notice adopts new source state even though cached top-level sourceStatus is stale. No blanket claim that ordinary background freshness notices fail is made.
