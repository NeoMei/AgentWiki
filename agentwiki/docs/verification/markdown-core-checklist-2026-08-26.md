# Markdown core convergence evidence — 2026-08-26

## Candidate and scope

- Branch: `codex/markdown-rendering-attachments`.
- GitHub `master` base: `27eee7ab576476aa241e8241730f4fbf8467e284`, confirmed both by the local `origin/master` ref and `git ls-remote origin refs/heads/master` on 2026-08-26.
- Final application candidate reviewed and gated: `43b7be9d023da2818e29293dbece717b547d8720` (`27eee7ab576476aa241e8241730f4fbf8467e284..43b7be9d023da2818e29293dbece717b547d8720`).
- The initial Task 7 pass added `dc30335 fix(page): ignore stale version history loads` and `a737a90 fix(markdown): classify uppercase external schemes` after the Task 1–6 checkpoint `3df849f`. Reviewer convergence then added `6d4cefb fix(page): isolate version restore lifecycle`, `bcfe298 fix(page): isolate auxiliary route loads`, and `43b7be9 fix(page): cancel restore effects on unmount`.

## Focused verification

Initial Task 7 verification on `a737a90`:

```bash
pnpm --filter @agentwiki/client exec vitest run src/components/markdown src/components/Markdown.spec.tsx src/components/MarkdownWorkspace.spec.tsx src/features/page/PagePreview.spec.tsx src/features/page/PageEditor.spec.tsx src/features/page/PageVersionHistory.spec.tsx
```

Result: 7/7 files passed, 80/80 tests passed. `PageVersionHistory.spec.tsx` is deliberately included beyond the brief's original five paths because Task 7 found and fixed a version-route race there.

```bash
pnpm --filter @agentwiki/server test -- --runTestsByPath src/core/page/page.controller.spec.ts src/core/page/page.service.spec.ts
```

Result: 2/2 suites passed, 58/58 tests passed.

## Fresh review passes and regressions

An independent reviewer re-read the complete base-to-`a737a90` diff after checking the following paths. Two actionable defects were validated in that initial pass; each was reproduced by a failing regression before its implementation changed. A subsequent convergence review found the additional restore and auxiliary-request lifecycle gaps recorded below.

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

The final independent review of `43b7be9` reported zero Critical and zero Important findings. It noted one non-blocking, coverage-only Minor: PageEditor directly proves stale Space-index success for A→B but does not duplicate PagePreview's A→B→A and stale-rejection matrix cells. The production PageEditor path was independently checked as safe through its aborted-signal, route-generation, and page-ID guards.

## Initial real-browser acceptance (`a737a90`)

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

## Initial repository gates (`a737a90`)

The final gates ran in this order, and every command exited 0:

1. `pnpm test`: runtime 104 executed / 51 skipped; server 1,222 executed / 4 skipped; client 772/772; sync protocol 42/42; local sync 748/748. Total executed coverage: 2,888 tests. Total environment-gated skips, reported separately and excluded from executed coverage: 55.
2. `pnpm lint`: passed with no diagnostics.
3. `pnpm typecheck`: passed for server, client, sync protocol, and local sync.
4. `pnpm build`: passed; Vite transformed 2,624 modules. The existing warning for chunks larger than 500 kB remains non-blocking.
5. `git diff --check`: passed with no whitespace errors.

## Reviewer convergence follow-up (`43b7be9`)

The convergence review validated two Important lifecycle gaps and required a fresh regression-first pass. A later independent pass found one additional unmount variant in the restore lifecycle. All three production defects were reproduced before implementation changes:

1. Restore lifecycle: the first RED run had 4 failed / 4 passed. It proved that late A success and failure still caused effects after routing to B, a reused version ID could leave B disabled, and other Restore buttons remained enabled during an in-flight restore. `6d4cefb` added one global restore lock plus active route-generation guards and route reset. GREEN: 8/8.
2. Auxiliary route loads: PagePreview RED was 6 failed / 12 passed, covering stale related-page and Space-index state, A→B→A overwrite, and stale rejection; PageEditor RED was 2 failed / 27 passed, covering visible stale A index during B and deferred A data resolving B's preview link. `bcfe298` clears auxiliary state on route generation and gates or aborts stale completions. GREEN: PagePreview 18/18 and PageEditor 29/29.
3. Restore after unmount: the fresh reviewer showed that leaving version history entirely could still permit a late success to alert/navigate or a late failure to alert. RED: 2 failed / 8 passed. `43b7be9` added a mounted-lifecycle guard. GREEN: 10/10.

Final focused affected-client verification passed 3/3 files and 57/57 tests. The complete client suite passed 71/71 files and 787/787 tests. On the final application candidate, client TypeScript, client ESLint, client production build, and `git diff --check` all exited 0; Vite transformed 2,624 modules and repeated only the existing >500 kB chunk advisory.

The final independent production review reported 0 Critical and 0 Important findings. Its single Minor was coverage-only: PageEditor does not repeat every A→B→A and stale-rejection Space-index cell already exercised in PagePreview, while the production path has aborted-signal, route-generation, and current-page guards.

### Final-candidate browser rerun and cleanup

The fresh rerun used only schema `markdown_core_task7_followup_20260826_1800` in `agentwiki_collaboration_test`; all 43 migrations were applied there. Real Chrome ran `e2e/markdown-core.spec.ts` against `http://127.0.0.1:5173` and `http://127.0.0.1:3000/api/`: 1/1 passed in 12.8 s. The acceptance test's browser warning/error assertion remained clean.

Passing-run screenshots:

- `/var/folders/0n/49qgdd8x7kgcvh719fw743mh0000gn/T/agentwiki-markdown-core-qa/1787738694274-1d3c5998526a88/owner-persisted.png`
- `/var/folders/0n/49qgdd8x7kgcvh719fw743mh0000gn/T/agentwiki-markdown-core-qa/1787738694274-1d3c5998526a88/viewer-read-only.png`
- `/var/folders/0n/49qgdd8x7kgcvh719fw743mh0000gn/T/agentwiki-markdown-core-qa/1787738694274-1d3c5998526a88/mobile-390.png`

Before service teardown, active fixture users/Spaces/pages were exactly `0/0/0`. Both services were stopped, ports 3000 and 5173 had zero listeners, the exact schema was dropped, and its final PostgreSQL namespace count was `0`. No shared/public schema was migrated or removed. The only non-browser warnings were the expected Node `NO_COLOR`/`FORCE_COLOR` notice and optional embedding generation being skipped without a local OpenRouter key.

## Release state (kept separate)

- **Local:** final application candidate `43b7be9` is committed and all final-candidate evidence above is green. The verification-record update is a documentation-only follow-up commit.
- **GitHub:** not pushed by Task 7. A live read-only `git ls-remote` showed GitHub `master` still at `27eee7ab576476aa241e8241730f4fbf8467e284`; local success is not GitHub release proof.
- **npm:** not published by Task 7. The base-to-candidate diff contains no files under `packages/local-sync` or `packages/sync-protocol`; local and registry versions independently match at `@neomei/agentwiki-local-sync@0.6.1` and `@neomei/agentwiki-sync-protocol@0.3.0`.
- **Production:** not deployed or probed by Task 7. The loopback browser run is local acceptance evidence only and is not production evidence.

No push, npm publish, or production deployment was authorized or performed.
