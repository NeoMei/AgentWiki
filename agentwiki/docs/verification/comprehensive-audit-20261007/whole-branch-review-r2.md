# Independent whole-branch code review — round 2

Decision: APPROVE the bounded local product candidate. No new actionable finding established in round 2. This is code-review approval, not a claim that root's still-running final regression, native UI, actual model, deployment or publication gates have completed.

Reviewed baseline `165c207bf4b644efa810ea6c9a3da11d28c4f96e` → fixed product HEAD `3fa75091337c9c3bee214856e92a8cc8c3c56250`. Began with HEAD 3c201e51 plus the frozen ReviewPage patch; verified the final HEAD and that its commit contains that reviewed two-file frontend patch. Remaining working-tree differences at completion are documentation/current/task/spec only. Git uses explicit work-tree throughout. No product edits, build, DB/runtime, browser or model calls.

## Findings disposition

- F1 Source metadata rollback on historical receipt replay: fixed by d449dcf4; independent immutable patch review and 13/13 tests recorded in `intake-fix-review-r2.md`. New accepted metadata remains updated; replay is inert. Mismatched-input ordering test is not misrepresented as an old committed-transaction corruption bug.
- F2 foreign Run source/evidence/changeSet associations: fixed by 409fa3b5; independent immutable patch review and 67/67 tests recorded in `run-boundary-fix-review-r2.md`. Both direct Run reads and Source.get reverse-linked Run entry checked. Normal authorized history/null and same-Space payload references remain readable.
- ReviewPage loss-of-access handling: examined final epoch/sequence/scope invalidation and background-summary merging against server projection responses. A denial clears stale details/permissions; old requests cannot reinstate them. Owner→viewer writes are followed by fresh read/membership verification. No further issue established; separate frontend reviewer owns its detailed race/UI receipt.

## Cross-path coverage

Reviewed accepted source head and receipt semantics through intake, Run creation/retry/worker proposal and final publication; A→B→A generations, historical null and archived Source behavior; identity→Space advisory/row→Source order; current tracked proposals cannot auto-publish or self-attest generation. Confirmed worker and publication checks occur before the respective final candidate/publication mutations.

Checked Page body/format/source-link invalidation against Page direct update/restore, ordinary and collaboration publication, attachments, content-tree and Obsidian writers; exact revert restores recorded before generation without changing source head. The helper compares actual values, so title/placement and same-value body submissions do not clear a valid review unnecessarily. General unrelated identity/scoping refactors were not inferred from this slice.

Checked the public API wiring rather than only the comparator: Page list/detail/hierarchy/search and REST/MCP/resource calls use returned Page snapshots; graph and Review projections enforce independent source permissions; personal source scopes are live checked; evidence fields are allowlisted and source/version/run ownership checked. Review mutations returning ChangeSets are projected. decideItem intentionally returns only `{success:true}`, so it is not an omitted raw ChangeItem leakage path.

Checked local gateway named/legacy normalization against SpaceMcpBridge: conflicting selectors/values are rejected, required query/page ID is checked after merging, callers are not mutated, legacy single-Space behavior remains in the bridge, multi-Space calls route through an immutable selected bridge and forwarded selector is constrained by the remote schema. No changes to authorization or unsupported stdio resources were inferred. Recalled fallback retains only demonstrated compatibility and objective source-state semantics, with no unsupported retrieval-quality claim.

Checked runtime harness adjustment: newly required DB environment gates match the full-test intent; stdout/stderr forwarding awaits completion before exit status/zero-skip enforcement. No services were started to validate this here.

## Independent round-2 verification

From `agentwiki/packages/local-sync`:
`./node_modules/.bin/vitest run src/gateway/knowledge-read-tools.spec.ts src/gateway/server.spec.ts --maxWorkers=1 --no-file-parallelism`
Result: 2 files PASS, 60/60 tests PASS, 346 ms. These use mocked/in-memory gateway interactions, not a user provider/runtime.

From `agentwiki/apps/server`:
`./node_modules/.bin/jest --runInBand --no-cache --runTestsByPath src/knowledge-pipeline/source-head.spec.ts src/core/source-freshness/source-freshness.service.spec.ts src/core/source-freshness/source-response-boundaries.spec.ts src/review/page-publication.service.spec.ts`
Result: 4 suites PASS, 42/42 tests PASS, 4.529 s.

No new failing test or reproducible code defect was found. Unit/mock coverage is not evidence for actual DB race behavior, rendered UI or model quality. Root is responsible for centralized final regression/runtime receipts and final resource cleanup. No push, merge or deployment authorization is implied by this review.
