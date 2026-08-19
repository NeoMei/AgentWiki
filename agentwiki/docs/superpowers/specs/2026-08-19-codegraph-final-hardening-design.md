# CodeGraph Stage 1 Final Hardening — Design

Date: 2026-08-19
Status: Approved (user selected approach A)

## Goal

Close the final cross-task correctness and privacy gaps without changing the approved product model: CodeGraph scans independently; AgentWiki keeps scanner state private, performs deterministic standard analysis, shows a safe plan, and synchronizes only an explicitly confirmed Preview.

## Chosen Architecture

Use one source-key consistency boundary from confirmed scanner execution through snapshot validation, deterministic analysis, generated publish, and artifact adaptation. Keep full local plans and filesystem capabilities inside the package; expose only a redacted planning DTO through the AgentWiki gateway. Treat absence as a deletion only when strict ownership proves that the absent item belongs to the current input scope.

Alternatives rejected:

- Immutable snapshot versions plus compare-and-swap publishing would work, but adds a second versioned storage model and more crash-recovery states than Stage 1 needs.
- A final hash recheck alone leaves a check-to-publish race and does not provide the selected end-to-end source transaction.

## Public Planning Boundary

`local_scan_sources` returns a public DTO containing only:

- schema version, provider, safe diagnostic version, capabilities, analysis mode, limits, and `localScanPlanHash`;
- per source: irreversible `sourceKey`, relative `displayPath`, proposed action, index state, and estimated file count.

It never returns `canonicalSourcePath`, `indexPath`, `executableIdentity`, the executable path, or local diagnostics. The full `LocalScanPlan` remains local and is freshly recomputed by `knowledge_prepare`; the hash is the only confirmation value crossing the gateway. Onboarding applies the same `publicLocalScanPlan` converter and strict public schema to every live provider plan before calculating a confirmation hash, emitting an initial/drift preview, or persisting a checkpoint. An invalid provider plan fails with a stable redacted error before confirmation, bootstrap, prepare, or sync.

The npm package exports no `dist/codegraph/*` subpath, including `index.js` and the mutable `generated-store.js` facade. Production consumers use the single `agentwiki` gateway. Internal relative imports remain available to the package itself.

## Snapshot Private-Root Safety

`CodeSnapshotStore` treats `<home>/.agentwiki/workspaces` as a private root:

- every existing path component is checked with `lstat` and must be a real directory, never a symlink;
- newly created private directories use mode `0700`;
- files are opened with `O_NOFOLLOW`, validated through their handles, and written mode `0600`;
- directory device/inode identity is recorded and revalidated before and after staging, promotion, rollback, recovery, cleanup, and reads;
- cleanup removes only staging/backup entries whose identity belongs to the current operation;
- a chain change fails closed and never follows or removes an external target.

The safe store API acquires the same source-key lock when used directly. Code that already owns a valid lease uses lease-bound read/write operations, preventing deadlock while preserving one lock domain.

## End-to-End Source Transaction

The provider exposes an internal callback operation that:

1. validates the confirmed plan hash and freshly replans;
2. acquires every involved source lock in stable source-key order;
3. runs CodeGraph init/sync/files and persists the normalized snapshot under those leases;
4. supplies immutable validated snapshots and their hashes to the callback;
5. releases locks only after analysis, generated-store base writing, batch publication, and artifact adaptation return successfully.

`CodeGraphPipeline.collect` performs all analysis and generated publication inside that callback. Concurrent scans sharing any source therefore serialize; a caller can never return artifacts derived from another scan's snapshot. Multi-source locking uses stable ordering to avoid deadlock.

The pipeline receives the runtime `home` explicitly and constructs its internal generated store from that same home. It never changes `process.env.HOME` and never silently falls back to a different user's home when a runtime home was injected.

## Reconciliation Safety

CodeGraph scans continue using strict analysis-layer ownership reconciliation.

For document-only scans, current bundle items may add or update matching IDs, but an unmatched base item is carried forward unless strict document-source ownership proves it belongs to the current input scope. Stage 1 has no such persisted document ownership contract, so document scans propose no absence-based deletions. A historical Codebase Memory path/title tuple also carries forward: historical data has no durable, verifiable legacy producer marker, so it produces only a stable opaque migration-candidate warning. This deliberately prefers stale knowledge over deleting manual, CodeGraph base/deep, or another source's knowledge. Explicit deletion can be added later with a separately specified ownership contract and Preview.

## Failure Behavior

- Unsafe local plan fields are impossible in the public schema and are rejected by gateway contract tests.
- A symlink, inode swap, malformed snapshot, stale lease, or cross-source race fails closed before Preview creation.
- A failed source transaction retains the last complete snapshot/generated publish and returns no mixed artifacts.
- Scanner execution remains unavailable through exported package subpaths.
- Standard mode remains deterministic and never invokes deep/LLM behavior.

## Verification

Required evidence:

- gateway tests prove public plan redaction and exact hash continuity;
- package-resolution and tarball tests prove no mutable CodeGraph subpath (index or generated store) is exported;
- real filesystem tests cover snapshot symlink ancestors, inode swaps at each mutation boundary, rollback, recovery, foreign cleanup, direct-call serialization, and lease-bound operations;
- controlled concurrency barriers prove same-source scans cannot mix snapshots or generated artifacts while different sources remain independent;
- document workflow tests prove manual, deep, CodeGraph base, and foreign-document pages are retained;
- injected-home E2E proves snapshot and generated data share the same disposable home without changing process-global HOME;
- real CodeGraph, three-client onboarding, privacy, lint, typecheck, build, package, and full local-sync gates remain green.

The final unrestricted runner closed the former release-evidence limitations: full `pnpm test` passed with loopback coverage, and a checksum-verified official Node 26.7 executable passed the 21 runtime-contract tests plus the 718-test local-sync suite. The temporary verification environment was removed afterward.
