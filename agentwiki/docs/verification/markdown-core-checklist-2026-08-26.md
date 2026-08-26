# Markdown core convergence evidence — 2026-08-26

## Candidate and scope

- Branch: `codex/markdown-rendering-attachments`.
- GitHub `master` base: `27eee7ab576476aa241e8241730f4fbf8467e284`, confirmed both by the local `origin/master` ref and `git ls-remote origin refs/heads/master` on 2026-08-26.
- Application candidate reviewed and gated: `a737a90b80448f627437062316aae80304987f8f` (`27eee7ab576476aa241e8241730f4fbf8467e284..a737a90b80448f627437062316aae80304987f8f`).
- Task 7 added two review fixes after the Task 1–6 checkpoint `3df849f`: `dc30335 fix(page): ignore stale version history loads` and `a737a90 fix(markdown): classify uppercase external schemes`.

## Focused verification

Run after both Task 7 fixes:

```bash
pnpm --filter @agentwiki/client exec vitest run src/components/markdown src/components/Markdown.spec.tsx src/components/MarkdownWorkspace.spec.tsx src/features/page/PagePreview.spec.tsx src/features/page/PageEditor.spec.tsx src/features/page/PageVersionHistory.spec.tsx
```

Result: 7/7 files passed, 80/80 tests passed. `PageVersionHistory.spec.tsx` is deliberately included beyond the brief's original five paths because Task 7 found and fixed a version-route race there.

```bash
pnpm --filter @agentwiki/server test -- --runTestsByPath src/core/page/page.controller.spec.ts src/core/page/page.service.spec.ts
```

Result: 2/2 suites passed, 58/58 tests passed.

## Fresh review passes and regressions

An independent reviewer re-read the complete base-to-candidate diff and approved `a737a90` after checking the following paths. Two actionable defects were validated; each was reproduced by a failing regression before its implementation changed.

| Review surface | Evidence and conclusion |
| --- | --- |
| Task source offsets, quoted/nested lists, CRLF, duplicate signatures | Source-slice task parsing and its focused tests preserve exact line endings and disambiguate structurally identical tasks. No remaining finding. |
| Rapid clicks and serialization | Page preview/editor tests cover queued toggles and one in-flight save. No remaining finding. |
| 409 retry | Recovery tests cover one conflict refetch/reapply/retry and fail closed after the bounded retry. No remaining finding. |
| Route switches | Finding: late page/version responses for route A could overwrite route B and expose A's Restore capability. RED: the new `ignores stale page and capability responses after a version-history route switch` regression failed 1/3 on the old implementation. `dc30335` adds effect-local cancellation plus route-state reset. GREEN: 3/3. |
| Viewer and historical modes | Viewer and version render modes force checkboxes read-only; the browser acceptance exercises both. No remaining finding. |
| Raw HTML | The renderer does not enable `rehypeRaw`; literal HTML remains non-executable. No remaining finding. |
| External URLs | Finding: scheme matching was case-sensitive, so `HTTPS://example.com` lacked the external-link protections. RED: the new uppercase-scheme regression failed with 20 passing/1 failing test on the old implementation. `a737a90` makes scheme classification case-insensitive. GREEN: 21/21. |
| Mobile overflow | Markdown containers and wide tables remain bounded/scrollable; the 390 px browser assertion found no document overflow. No remaining finding. |

The final independent review reported no remaining actionable defect in the required review surfaces.

## Real-browser acceptance

The local server used the isolated PostgreSQL schema `markdown_core_task7_20260826_1719`; all 43 migrations were applied only to that schema. The browser target was Chrome (`channel: chrome`) at `http://127.0.0.1:5173`, with API target `http://127.0.0.1:3000/api/`.

```bash
AGENTWIKI_WEB_URL='http://127.0.0.1:5173' AGENTWIKI_API_URL='http://127.0.0.1:3000/api/' pnpm --filter @agentwiki/client exec playwright test e2e/markdown-core.spec.ts
```

Result: 1/1 passed in 13.0 s. The flow covered owner persistence, editor eligibility, viewer read-only behavior, immutable historical preview, literal code, wiki links/callouts/highlights, one checklist PageVersion snapshot, and 390 px overflow. The test's warning/error listener observed zero browser-console issues.

Screenshots retained from this passing run:

- `/var/folders/0n/49qgdd8x7kgcvh719fw743mh0000gn/T/agentwiki-markdown-core-qa/1787736315934-fac947e09acd68/owner-persisted.png`
- `/var/folders/0n/49qgdd8x7kgcvh719fw743mh0000gn/T/agentwiki-markdown-core-qa/1787736315934-fac947e09acd68/viewer-read-only.png`
- `/var/folders/0n/49qgdd8x7kgcvh719fw743mh0000gn/T/agentwiki-markdown-core-qa/1787736315934-fac947e09acd68/mobile-390.png`

No trace was retained because Playwright uses `trace: retain-on-failure` and the run passed. Expected non-browser warnings were limited to Node reporting `NO_COLOR` overridden by `FORCE_COLOR` and the local server declining optional embedding generation because no OpenRouter key was configured; neither affected Markdown persistence or rendering.

Cleanup was verified before teardown: active fixture users/spaces/pages were `0/0/0` (the APIs intentionally soft-delete their audit rows). Both dev services were stopped, listeners on ports 3000 and 5173 were `0`, the exact disposable schema was dropped, and its final PostgreSQL namespace count was `0`. No shared/public schema was migrated or removed.

## Repository gates on the fixed candidate

The final gates ran in this order, and every command exited 0:

1. `pnpm test`: runtime 104 executed / 51 skipped; server 1,222 executed / 4 skipped; client 772/772; sync protocol 42/42; local sync 748/748. Total executed coverage: 2,888 tests. Total environment-gated skips, reported separately and excluded from executed coverage: 55.
2. `pnpm lint`: passed with no diagnostics.
3. `pnpm typecheck`: passed for server, client, sync protocol, and local sync.
4. `pnpm build`: passed; Vite transformed 2,624 modules. The existing warning for chunks larger than 500 kB remains non-blocking.
5. `git diff --check`: passed with no whitespace errors.

## Release state (kept separate)

- **Local:** application candidate `a737a90` is committed and all evidence above is green. This verification document is a documentation-only follow-up commit.
- **GitHub:** not pushed by Task 7. A live read-only `git ls-remote` showed GitHub `master` still at `27eee7ab576476aa241e8241730f4fbf8467e284`; local success is not GitHub release proof.
- **npm:** not published by Task 7. The base-to-candidate diff contains no files under `packages/local-sync` or `packages/sync-protocol`; local and registry versions independently match at `@neomei/agentwiki-local-sync@0.6.1` and `@neomei/agentwiki-sync-protocol@0.3.0`.
- **Production:** not deployed or probed by Task 7. The loopback browser run is local acceptance evidence only and is not production evidence.

No push, npm publish, or production deployment was authorized or performed.
