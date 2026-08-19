# CodeGraph-Backed Local Code Analysis — Design

Date: 2026-08-18
Status: Approved

## Goal

Replace AgentWiki's `codebase-memory-mcp` code-scanning path with a CodeGraph-backed pipeline while keeping ownership explicit:

- CodeGraph independently installs, upgrades, indexes, and scans local code.
- AgentWiki normalizes and analyzes CodeGraph results, generates shareable derived knowledge, and decides what may enter a Preview and be synchronized.
- AgentWiki and CodeGraph do not share release version numbers and do not require lockstep upgrades.
- Standard scans stay deterministic and inexpensive. Deeper module and semantic analysis runs only after an explicit user request.

## Current State

- The local Gateway exposes `local_scan_sources`, `knowledge_prepare`, `knowledge_confirm_and_sync`, and `knowledge_pull`.
- `knowledge_prepare` currently hard-codes the code adapter as `codebase-memory`.
- `AdapterManager` can automatically reinstall `codebase-memory-mcp@0.9.0`, even though the binary is no longer installed on the current machine.
- The established downstream contract is already suitable for reuse: `SourceArtifact` → `KnowledgeBundle` → local Preview → explicit confirmation → server sync/review.
- CodeGraph is independently installed and has successfully indexed AgentWiki. Its project-local `.codegraph/` is scanner-owned data, not uploadable knowledge.
- CodeGraph's public capabilities include local indexing, incremental sync, file/symbol/relationship access through supported surfaces, and semantic exploration. Its default MCP surface is optimized for exploration rather than acting as AgentWiki's storage contract.

## Approved Decisions

1. Use a two-mode product flow:
   - `standard`: deterministic base scan and overview; default.
   - `deep`: optional module analysis, aggregated relationships, and local Agent enrichment; only after an explicit user request.
2. Use an AgentWiki-owned `CodeGraphProvider` compatibility boundary. Do not add a separately installed AgentWiki provider process.
3. CodeGraph remains independently installed and upgraded. AgentWiki never installs, downgrades, or automatically upgrades it.
4. Compatibility is capability-based, not an exact CodeGraph version check.
5. Allow CodeGraph to create and maintain `.codegraph/` in the selected repository, but only after an explicit local scan-plan confirmation.
6. Permit a one-time knowledge rebuild. New CodeGraph-derived pages need not preserve old Codebase Memory page IDs or paths.
7. Use module-first deep analysis. Do not create one Wiki page per symbol.
8. Remove Codebase Memory completely. There is no hidden or automatic fallback.
9. Upload only AgentWiki-generated derived knowledge. Never upload the `.codegraph` database, raw source files, binaries, credentials, or absolute local paths.
10. AgentWiki Local Sync will align with the project's supported Node lines (`>=24 <25 || >=26 <27`); compatibility with CodeGraph is still negotiated through provider capabilities rather than release-number equality.

## Domain Language

- **Scanner**: the external code-intelligence system that owns indexing and structural extraction. CodeGraph is the scanner in this design.
- **Scan Index**: scanner-owned, project-local data under `.codegraph/`. It is never an AgentWiki upload artifact.
- **Code Snapshot**: AgentWiki's scanner-independent, normalized structural dataset (`agentwiki-code-snapshot@1`).
- **Base Analysis**: deterministic knowledge generated during every standard scan.
- **Deep Analysis**: user-requested, higher-cost module and semantic analysis.
- **Derived Knowledge**: generated Markdown and `SourceArtifact` records eligible for Preview and synchronization.

## Architecture

```text
CodeGraph (independent lifecycle)
  init / sync / index / query
              |
              v
CodeGraphProvider
  discovery / capability negotiation / scan plan / normalization
              |
              v
CodeSnapshotStore
  agentwiki-code-snapshot@1
              |
              v
DeterministicAnalyzer ---- optional ----> LocalAgentEnricher
              |                                |
              +---------------+----------------+
                              v
GeneratedKnowledgeStore
  base/ + enrichment/ + publish/
                              |
                              v
GeneratedKnowledgeAdapter
  SourceArtifact -> KnowledgeBundle -> Preview -> confirmation -> sync
```

### Component Responsibilities

#### CodeGraphProvider

- Discover `codegraph` from `PATH` or an explicit AgentWiki configuration.
- Read the detected version for diagnostics only.
- Probe required and optional capabilities.
- Inspect index presence, completeness, freshness, and the intended `.codegraph/` write target.
- Produce a local scan plan without mutating the repository.
- After confirmation, ask CodeGraph to initialize or synchronize its index.
- Normalize scanner output into `agentwiki-code-snapshot@1`.
- Never install, upgrade, downgrade, or delete CodeGraph.

The provider may contain capability drivers for supported CodeGraph API families. Drivers are selected by observed methods and result shapes, not by an exact package version. A driver may use the independently installed CodeGraph CLI, MCP, or public SDK surface, but it must not bundle an exact CodeGraph dependency or read internal SQLite tables. A new CodeGraph release that preserves the required capabilities requires no AgentWiki release. A breaking capability change may require a provider update, but it does not impose lockstep version numbering.

#### CodeSnapshotStore

- Persist a complete normalized snapshot atomically under `~/.agentwiki/workspaces/<source-key>/codegraph/`.
- Preserve the last successful snapshot after a failed scan, but never silently submit it as current.
- Validate schema, hashes, relative paths, stable identifiers, and size limits before analysis.

#### DeterministicAnalyzer

- Read only the AgentWiki snapshot contract.
- Produce identical base output for identical snapshot content.
- Generate the standard repository overview and, in deep mode, module pages and aggregated module relations.
- Never depend on CodeGraph-specific database tables or internal node IDs.

#### LocalAgentEnricher

- Run only in explicitly requested deep mode.
- Use the local Agent and CodeGraph semantic queries to add explanations, not foundational facts.
- Cite normalized module, file, or symbol identifiers.
- Never overwrite deterministic base facts.
- Fail independently: enrichment failure produces warnings and does not invalidate base analysis.

#### GeneratedKnowledgeAdapter

- Read the locally generated publish set as a normal Source Adapter.
- Convert derived Markdown and relationship manifests into existing `SourceArtifact` records.
- Leave all server-side bundle, Preview, conflict, and review behavior unchanged.

## Capability Negotiation

The provider reports a normalized capability result similar to:

```json
{
  "provider": "codegraph",
  "detectedVersion": "1.5.0",
  "required": {
    "index.status": true,
    "index.sync": true,
    "files.list": true
  },
  "optional": {
    "symbols.list": true,
    "relations.read": true,
    "semantic.explore": true,
    "impact.read": true,
    "routes.read": true
  },
  "snapshotSchema": "agentwiki-code-snapshot@1"
}
```

Rules:

- Missing `index.status`, `index.sync`, or `files.list` blocks all code scans.
- Missing `symbols.list` or `relations.read` may allow standard overview generation but blocks deep module analysis.
- Missing semantic or impact capabilities disables only the corresponding enrichment, with a Preview warning.
- Unstructured semantic text is never parsed as the deterministic graph contract.
- The detected CodeGraph version is included in evidence and diagnostics, not used as the sole compatibility decision.

## Local Scan Planning and Consent

`local_scan_sources` becomes a read-only planning operation for code sources. It returns:

- canonical source identity and display path;
- detected scanner and capabilities;
- current index state;
- proposed `.codegraph/` location;
- whether initialization, incremental sync, or rebuild is required;
- selected analysis mode;
- estimated output scope and deep-analysis cost when applicable;
- `localScanPlanHash`.

The plan hash binds the source identity, CodeGraph executable identity, detected capabilities and version, index write target, analysis mode, and relevant limits. If CodeGraph changes between confirmation and execution, `knowledge_prepare` rejects the stale plan and requires a new confirmation.

Onboarding adds the local scan plan to its existing confirmation view. Its local hash remains distinct from the server authorization-plan hash. Direct MCP usage follows the same two-step plan/confirm flow.

AgentWiki may create or update `.codegraph/` only after the confirmed plan is validated. It does not edit `.gitignore` or Git configuration. A `.codegraph` symlink that resolves outside the expected project location is rejected.

## Code Snapshot Contract

The store layout is:

```text
~/.agentwiki/workspaces/<source-key>/codegraph/
├── snapshot.json
├── files.ndjson
├── modules.ndjson
├── symbols.ndjson
├── relations.ndjson
└── diagnostics.json
```

`snapshot.json` includes:

- schema version;
- scanner identity, diagnostic version, and capabilities;
- irreversible source key and optional VCS revision metadata;
- index state and timestamps;
- file, symbol, and relationship counts;
- per-file dataset hashes and one overall snapshot hash;
- completeness and warnings.

Normalization rules:

- Use only project-relative paths.
- Generate stable AgentWiki IDs from source key, relative path, node kind, and qualified name. Never persist CodeGraph node IDs as AgentWiki identity.
- Sort every dataset deterministically before writing NDJSON.
- Keep structural facts such as names, kinds, line ranges, and relationship types local in the snapshot.
- Do not include raw source bodies.
- Ignore unknown scanner fields.
- Reject missing core fields, invalid paths, duplicate normalized identities, or inconsistent references.

## Analysis Modes

### Standard Mode

`analysisMode: "standard"` is the default and runs no Agent/LLM analysis.

It produces deterministic base knowledge:

- repository overview;
- language and framework summary;
- index state and scan evidence;
- high-level file statistics;
- basic entry-point information when available.

Standard mode is intended for onboarding and normal incremental synchronization.

### Deep Mode

`analysisMode: "deep"` is accepted only when the user explicitly requests deep codebase analysis. The Gateway must not autonomously promote a standard request to deep mode.

The confirmed plan shows:

- modules to be analyzed;
- whether the local Agent will run;
- estimated time and output size;
- model/token cost when known;
- page and relationship caps.

Deep mode reuses a current CodeGraph index and snapshot. It does not force a full re-index when incremental sync is sufficient.

Deep output includes:

- workspace/package/module pages;
- aggregated module dependencies;
- entry flows and important call paths;
- optional responsibility, risk-area, and reading-order explanations from the local Agent.

Module boundaries are selected in this order:

1. workspace and package manifests (`pnpm-workspace.yaml`, `package.json`, `Cargo.toml`, `go.mod`, and equivalents);
2. scanner-reported module/package boundaries;
3. stable source-directory boundaries;
4. top-level directory fallback.

Symbol relations are aggregated between module IDs. The publish set contains relationship types and counts, not thousands of individual symbol edges. Symbols remain sections or evidence within module pages rather than separate Wiki pages.

## Analysis-Layer Ownership

Every derived artifact has `analysisLayer: "base" | "deep"` and the snapshot hash that produced it.

- Standard scans reconcile only the base layer.
- Standard scans never delete deep pages merely because deep analysis did not run.
- When the source snapshot changes, prior deep output is marked stale locally and surfaced as a warning; it is not automatically regenerated.
- A later explicit deep run re-analyzes changed or affected modules and reconciles the deep layer.
- Removing stale deep knowledge is a separately previewed user decision.
- The synchronization assembler carries forward untouched deep artifacts when only the base layer runs, preventing global bundle-diff logic from treating them as deletions.

## Generated Knowledge

Generated files live outside the source repository:

```text
~/.agentwiki/workspaces/<source-key>/generated/codegraph/
├── base/
├── enrichment/
└── publish/
```

Expected publish paths include:

- `architecture/overview.md`
- `architecture/modules/<module>.md` (deep only)
- `architecture/dependencies.md` (deep only)
- `architecture/entry-points.md` (when supported)
- a machine-readable relationship manifest consumed locally by the adapter.

The base directory is immutable to the Agent. Enrichment is stored separately and merged into publish output only after validation. Generated files are disposable local derivatives; the server Revision remains authoritative after synchronization.

## Privacy and Security

- All indexing, normalization, deterministic analysis, and enrichment happen locally.
- Never upload `.codegraph`, the normalized raw snapshot, raw source files, binaries, absolute paths, or local diagnostics.
- Do not include source bodies in generated knowledge.
- Run secret-pattern checks, path redaction, sensitivity classification, file-count limits, per-file byte limits, and total upload limits before creating a Preview.
- Require provenance and snapshot hashes for every published artifact.
- Serialize scans per source key and use atomic directory replacement for snapshots and generated output.
- Reject unsafe source roots, unexpected index symlinks, path traversal, and output references outside the private workspace.

## Error Handling

Public diagnostics distinguish:

- `CODEGRAPH_NOT_FOUND`
- `CODEGRAPH_CAPABILITY_UNSUPPORTED`
- `CODEGRAPH_SCAN_PLAN_CHANGED`
- `CODEGRAPH_INDEX_INCOMPLETE`
- `CODEGRAPH_SCAN_FAILED`
- `CODE_SNAPSHOT_INVALID`
- `CODE_ANALYSIS_FAILED`
- `CODE_ENRICHMENT_SKIPPED`

Behavior:

- Missing scanner or missing core capabilities blocks scanning with an actionable next step.
- An incomplete, partial, or failed index never enters analysis.
- A stale confirmed plan is rejected before mutation.
- Snapshot or base-analysis failure blocks Preview.
- Deep enrichment failure is non-blocking and visible in Preview warnings.
- The last successful snapshot may support diagnostics but is never silently submitted as a fresh result.
- No error path invokes or reinstalls Codebase Memory.

## Migration

- Delete `CodebaseMemoryAdapter`, its managed-runtime descriptor, automatic install logic, production callers, diagnostic checks, tests, and user documentation.
- Remove `codebase-memory-mcp` from all production-path strings and runtime expectations.
- Route both current Gateway preparation and any still-supported legacy local preparation entry through the new provider/snapshot/analyzer boundary, or delete retired paths rather than maintaining a second scanner.
- New derived knowledge uses CodeGraph-era identities and paths. It does not preserve Codebase Memory page IDs.
- This 2026-08-18 deletion requirement is superseded by the [2026-08-19 final hardening design](2026-08-19-codegraph-final-hardening-design.md): historical bases have no strict verifiable legacy ownership marker, so legacy-looking pages carry forward with a stable opaque migration-candidate warning and zero automatic deletion. Only a future, separately designed strict marker contract may propose deletion; new pages and relations remain reviewable in Preview with total upload volume.
- Additions are synchronized only after confirmation. Existing server revision history remains available; any future marker-backed deletion proposal must use the separately designed contract and Preview.

## Tool Contract Changes

`local_scan_sources` returns the local scan plan and hash.

`knowledge_prepare` gains explicit fields similar to:

```json
{
  "spaceId": "space-id",
  "sourcePaths": ["/absolute/project/path"],
  "sourceType": "code",
  "analysisMode": "standard",
  "localScanPlanHash": "confirmed-hash",
  "confirmedLocalScan": true
}
```

Deep mode uses the same tool with `analysisMode: "deep"`. Tool descriptions and Agent instructions state that deep mode requires an explicit user request.

`knowledge_confirm_and_sync` remains unchanged: it confirms the exact generated Preview, pulls the authoritative revision, checks conflicts, and synchronizes only the confirmed bundle.

## Testing

### Provider Contract

- Scanner discovery through PATH and explicit configuration.
- Capability negotiation across multiple compatible result shapes without exact-version matching.
- Core-capability failure and optional-capability degradation.
- Plan-hash invalidation after executable, capability, version, source, index target, or mode changes.
- Healthy init/sync, partial index, failed index, interrupted index, and lock contention.

### Snapshot and Determinism

- Fixture repositories for TypeScript monorepos, mixed-language projects, dirty worktrees, untracked files, submodules, and symlinks.
- Golden `agentwiki-code-snapshot@1` outputs.
- Identical scanner facts produce byte-identical normalized datasets and base Markdown.
- Unknown scanner fields do not change normalized output.
- Absolute paths, raw source bodies, and scanner-internal IDs never enter publish output.

### Analysis

- Manifest-first module boundaries and directory fallbacks.
- Aggregation of symbol edges into bounded module relations.
- Standard mode never calls the Agent.
- Deep mode cannot run without explicit user intent and a confirmed deep plan.
- Enrichment cannot overwrite base facts.
- Enrichment failure or timeout preserves usable base output with warnings.
- Standard scans preserve prior deep artifacts and mark stale results without deleting them.

### Migration and End to End

- No production-path `codebase-memory-mcp` references remain.
- Per the [2026-08-19 final hardening design](2026-08-19-codegraph-final-hardening-design.md), a first CodeGraph migration Preview carries historical legacy-looking items with a stable opaque warning and zero automatic deletion when no strict verifiable legacy ownership marker exists; only a future separately designed marker contract may propose deletion, while new additions remain previewed.
- Real CodeGraph scan → normalized snapshot → generated files → Preview → confirmation → server review/publish.
- Codex, Claude Code, and OpenCode complete standard onboarding and sync.
- A separately requested deep-analysis flow completes without changing standard-mode defaults.
- Package typecheck, lint, build, unit suites, runtime tests, and disposable real-database sync tests pass.

## Delivery Stages

### Stage 1 — Standard Scan Cutover

- CodeGraphProvider and capability negotiation.
- Local scan planning and confirmation.
- Snapshot v1 and atomic store.
- Deterministic repository overview.
- GeneratedKnowledgeAdapter integration.
- One-time migration Preview.
- Complete Codebase Memory removal.
- Real three-client standard-scan verification.

### Stage 2 — Optional Deep Analysis

- Module recognition and module pages.
- Aggregated module relationships.
- Changed/affected-module targeting.
- Explicit deep-analysis planning and cost display.
- Local Agent enrichment with evidence and bounds.
- Deep-layer staleness and independent reconciliation.

Stage 2 is a product option, not an automatic continuation of every standard scan.

## Non-Goals

- Uploading or serving the CodeGraph database.
- Reimplementing CodeGraph indexing inside AgentWiki.
- Lockstep AgentWiki/CodeGraph release numbers.
- Automatically installing or upgrading CodeGraph.
- Server-side source-code analysis.
- Automatic deep analysis without explicit user intent.
- One Wiki page per code symbol.
- Preserving Codebase Memory page identities.
