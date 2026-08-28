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

Persisted revisions form one strict Space-local chain. Sequence `1` has a null `parentRevisionId`; every later revision points to the same-Space revision at exactly `sequence - 1`, which is the head held by the writer when the revision is created. Readers validate the complete stored ancestor chain with one set-based lookup before serving an immutable revision. Missing, cross-Space, self, future, skipped, cyclic, or otherwise inconsistent links return the same non-enumerating `REVISION_GONE` response. Any v2 marker on the current revision or its immediate parent—including schema, recipe, sidecar, Folder/Page placement, tree delta, or migration evidence—requires the complete v2 metadata and canonical parent-to-current delta contract; a partial marker cannot downgrade to legacy reconstruction.

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
