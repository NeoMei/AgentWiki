# AgentWiki Folder-aware Sync API v2

## Status and scope

- Protocol version: `2`
- Public base path: `/api/sync/v2`
- Authentication: `Authorization: Bearer <human device credential>`
- Consumers: Local Sync and the AgentWiki Sync Obsidian plugin
- Scope: server-side immutable Folder/Page revisions and atomic remote publish. Local filesystem apply and plugin UI are separate contracts.

Every JSON success or failure envelope carries `protocolVersion: "2"`; `204 No Content` is the only bodyless success. Requests are validated by strict runtime schemas from `@neomei/agentwiki-sync-protocol`, so unknown fields fail with `PAYLOAD_INVALID`.

## Canonical tree objects

`SyncFolderV2` contains `folderId`, `parentFolderId`, `name`, canonical directory `path`, `sortOrder`, and RFC 3339 `updatedAt`. `SyncPageV2` contains `pageId`, `folderId`, canonical Markdown `path`, `title`, normalized `body`, `contentHash`, and `updatedAt`.

All managed paths are under `pages/`. A Page's `folderId` and path directory must identify the same active Folder; `null` means the `pages/` root. Folder IDs and Page IDs are separate namespaces. Page body hashes use normalized LF Markdown. The hard limits are 100 changes per push and 2 MiB total active document body bytes.

The immutable revision manifest is:

```ts
interface TreeRevisionContentManifestV2 {
  protocolVersion: "2";
  spaceId: string;
  folders: SyncFolderV2[];
  pages: SyncPageV2[];
}
```

Folders are canonicalized parent before child, then by portable path key and ID. Pages follow all Folders and are ordered by portable path key and ID. `treeRevisionContentHashV2` hashes the canonical manifest bytes; empty trees retain the SHA-256 empty-byte hash and zero manifest bytes. `folderCount`, `pageCount`, `revisionManifestByteLength`, and `revisionBodyBytes` are decimal strings in HTTP responses.

Delta order is fixed: archived Pages; archived Folders deepest-child first; upserted Folders parent first; upserted Pages. Move and rename operations are represented by upserts with stable IDs. Recursive Folder archive emits Page archives before child/parent Folder archives. Complete deletion-batch restore emits parent/child Folder upserts before Page upserts.

## Read endpoints

| Method | Path | Result |
|---|---|---|
| GET | `/spaces` | readable Spaces and current revision/count metadata |
| GET | `/spaces/:spaceId/head` | current immutable v2 head |
| GET | `/spaces/:spaceId/snapshot?revision=current&limit=100&cursor=...` | Folder and Page page |
| GET | `/spaces/:spaceId/delta?from=:revision&limit=100&cursor=...` | fixed from/to delta page |

Snapshot cursors bind the Space and immutable revision. Delta cursors additionally bind both the requested `fromRevision` and the fixed `toRevision`. Cross-route, cross-Space, cross-revision, malformed, or expired revision replay fails closed. Pagination never splits object identity: resume begins strictly after the last returned combined Folder/Page key or delta ordinal. The server measures the actual UTF-8 JSON response, including metadata and next cursor, against `maxResponseBytes`; a single object that cannot fit fails with `SPACE_TOO_LARGE`.

An explicit unavailable immutable revision returns `REVISION_GONE`. `current` on a Space with no revision returns revision `0`, empty arrays, empty hash, and zero metrics.

Persisted revisions form one strict Space-local chain. Sequence `1` has a null `parentRevisionId`; every later revision points to the same-Space revision at exactly `sequence - 1`, which is the head held by the writer when the revision is created. Each Head, Snapshot, or Delta logical read runs all revision, ancestor, checkpoint, immutable Folder/Page, sidecar, and delta queries inside one PostgreSQL `REPEATABLE READ` transaction; Delta loads both endpoints in that same snapshot. The transaction may wait up to 10 seconds for a connection and has a 30-second execution budget so a large valid immutable read does not inherit Prisma's shorter default. Readers validate the complete retained ancestor chain with one set-based lookup before serving an immutable revision. Missing, cross-Space, self, future, skipped, cyclic, or otherwise inconsistent links return the same non-enumerating, non-retryable `REVISION_GONE` response. An explicit immutable-integrity failure has the same result, while an existing Sync API exception is preserved; transaction expiry/serialization/acquire failure and every other unknown reader failure return a safe protocol-v2 `INTERNAL_ERROR / 500` with `retryable: true` and never expose database details as a false 410. Any v2 marker on the current revision or its immediate parent—including schema, recipe, sidecar, Folder/Page placement, tree delta, or migration evidence—requires the complete v2 metadata and canonical parent-to-current delta contract; a partial marker cannot downgrade to legacy reconstruction.

Retention keeps the head and the existing 31-day/25-hour safety windows, and deletes at most 64 revisions from one contiguous oldest eligible prefix under the same Space advisory lock as writers. One tick loads only that 64-row batch plus its required retained anchor and rebuilds all Folder rows, Page/content rows, sidecars, and tree deltas with four set-based queries; query count and lock hold work therefore do not grow with total retained history. A fresh row or chain hole stops the tick, while later ticks resume from the single checkpoint anchor until the eligible prefix is exhausted. Before deleting any v2 revision, it verifies the immutable snapshot, body hashes and sizes, sidecar, exact parent-relative delta, and chain. In that same transaction it advances one `revision-chain-checkpoint@1` row for the Space. The evidence binds the last deleted v2 boundary, its parent/content identity and rolling chain hash, plus the first retained anchor's sequence, ID, parent, content hash, and hash of its exact canonical stored delta rows. Readers and writers require the retained chain to start at `boundary + 1`, require the anchor to point to the boundary, and verify the live anchor metadata and delta hash; checkpoint absence or any field, hash, Space, sequence, parent, or anchor mismatch fails as `REVISION_GONE`. Retention never rewrites an immutable revision, delta, or sidecar, never skips a fresh or missing row, and keeps only one checkpoint row per Space.

Legacy rows already pruned before v2 do not receive invented checkpoint evidence. The sole cutover trust boundary is the exact Task 6 first-v2 migration revision: migration origin, `space-folders-v1:<spaceId>` batch/input evidence, complete `content-tree@2` metadata and sidecar, canonical full snapshot, and full-upsert delta must all validate, and no earlier retained revision may carry any v2 marker. When the same-Space row at `genesis.sequence - 1` remains, it must exist under that exact ID and the retained legacy suffix is followed backward with exact Space/sequence/ID/parent links until sequence `1` or one parent that is demonstrably physically absent. A wrong, missing, or cross-Space genesis parent while that immediate predecessor remains fails both readers and writers; so does any v2 marker anywhere before the genesis, including below an older physical gap. If the immediate predecessor itself was physically pruned, the same strict absent-parent and no-earlier-v2-evidence bootstrap applies. An ordinary v2 revision with a missing ancestor is never accepted as a genesis. An explicit cursor for a physically pruned revision still returns `REVISION_GONE`.

Content-row producers use one global transaction-scoped content-store advisory lock. A structural producer that also mutates a Space always locks `Space -> global content store`; v1/v2 upload staging locks `global content store -> PushSession`; finalize locks `Space -> global content store -> PushSession`. Content GC runs after the Space retention transaction commits, in a separate best-effort transaction that takes only the global lock. It deletes a `SyncPageContentRow` only when no `SyncRevisionPageRow` and no `PushSessionChange` with any operation has its non-null `contentHash`; the legacy body store follows the equivalent revision/staging rule. A GC failure therefore leaks content but cannot roll back or disguise a committed checkpoint, and a later tick retries it. GC never takes the global lock before a Space lock because it never takes a Space lock at all.

## Push sessions

| Method | Path | Result |
|---|---|---|
| POST | `/spaces/:spaceId/push-sessions` | create or exactly replay an idempotent session |
| PUT | `/spaces/:spaceId/push-sessions/:sessionId/batches/:batchIndex` | stage a canonical v2 batch |
| POST | `/spaces/:spaceId/push-sessions/:sessionId/finalize` | atomically publish or return `noop` |
| GET | `/spaces/:spaceId/push-sessions/:sessionId` | status, received indexes, persisted result |
| DELETE | `/spaces/:spaceId/push-sessions/:sessionId` | abort an unpublished session |

Create binds user, credential family, Space, base revision, idempotency UUID, capability hash, confirmation hash and byte length, change count, and body-byte total. An exact replay returns the same session/result; any changed binding returns `IDEMPOTENCY_MISMATCH`. Unpublished sessions cannot be recovered or mutated by a rotated credential. Capability mismatch returns `CAPABILITIES_CHANGED`.

Batch changes are strict `upsert_folder`, `archive_folder`, `upsert_page`, or `archive_page` values. The canonical batch hash is verified before staging. The staging table stores `folder:<id>` and `page:<id>` entity keys, preventing namespace collision and duplicate mutation across batches. Body hash, page and batch byte caps, declared counts, and contiguous batch indexes are rechecked.

Finalize requires:

```json
{ "protocolVersion": "2", "confirmationHash": "<sha256>", "userConfirmed": true }
```

The server strictly decodes all staged changes, rebuilds the body-free confirmation manifest, verifies its canonical hash and byte length, and invokes exactly one `ContentTreeService` publish boundary. That boundary acquires the global Space advisory lock before the Space row lock, rechecks live human membership and publish role after locking, verifies the base revision and current tree revision, resolves every Folder reference, and writes the whole mixed batch, ChangeSet provenance, Page versions, aliases, deletion evidence, content-tree revision, and immutable sync revision in one database transaction.

Folder-aware publish follows the Space Folder role matrix: Owner and Editor may publish; Space Admin and Viewer are read-only. Platform Super Admin retains its existing bypass. Session creation performs the same check, and finalize repeats it inside the locked transaction so a role downgrade cannot race publication.

Folder deletion batches can only be restored as the exact complete Folder/Page membership. Partial resurrection fails closed. Current-path uniqueness includes archived Pages; path changes retain bounded aliases. New Folder/Page `sourceChangeSetId`, ongoing `lastChangeSetId`, and revision `sourceChangeSetId` preserve publish provenance. A committed session stores its complete response and later finalize calls return that response without replaying mutations.

## Deterministic errors

Errors use the shared v2 envelope. Important conflicts include:

- `BASE_STALE`: base/head or locked tree state changed.
- `CONFIRMATION_MISMATCH`: staged confirmation hash or byte length differs.
- `PAYLOAD_INVALID`: strict schema, stored change, content hash, or Folder reference is invalid.
- `PATH_COLLISION` / `PAGE_ID_CONFLICT`: canonical identity, path, or deletion-batch invariant conflicts.
- `PUSH_SESSION_INCOMPLETE`: missing batch indexes or staged changes.
- `SPACE_FORBIDDEN` / `SPACE_READ_ONLY`: live locked authorization denies publish.
- `REVISION_GONE` / `CURSOR_INVALID`: immutable read or resume cannot be honored safely.

No controller or push-session service directly mutates Folder/Page structural paths. PostgreSQL transaction rollback is the atomicity boundary for every validation or write failure.
