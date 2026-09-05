# AgentWiki–Obsidian Sync API v3

Status: local release-candidate contract for `@neomei/agentwiki-sync-protocol` 0.5.0. The package schemas and canonical hashing functions are normative; this document is the public HTTP map.

## Transport, authentication, and authorization

All routes are below the server `/api` prefix and require `Authorization: Bearer <device credential>`. The bearer value is an activated human-device credential created by the Obsidian installation/exchange flow; it is not a web JWT or Agent API key. The server rechecks credential state, human-account state, and current Space membership on every request. Missing, expired, revoked, or inactive credentials fail closed.

Space roles are `owner`, `admin`, `editor`, and `viewer`. All four can list/read permitted Spaces and immutable revisions. `owner`, `admin`, and `editor` can create/upload/finalize Push sessions; `viewer` receives `SPACE_READ_ONLY`. Bootstrap is readable by all roles, while confirmed migration follows the live authorization rules returned by bootstrap preview. A removed membership or downgraded role takes effect immediately.

Successful responses are the exact strict response objects exported by the protocol package—there is no generic `{data: ...}` wrapper. Unknown request or response fields are rejected by strict schemas. Every v3 failure is exactly:

```json
{"protocolVersion":"3","error":{"code":"PAYLOAD_INVALID","retryable":false}}
```

No message, details, stack, path, storage key, token, or server-internal field is allowed on the v3 wire. `retryable` is true only for classified transient errors such as `RATE_LIMITED` and `INTERNAL_ERROR`; clients must branch on the public code, not HTTP text.

## Routes

| Method | Route | Strict result and purpose |
| --- | --- | --- |
| `GET` | `/sync/v3/capabilities` | Protocol `3`, bounded capabilities, and `capabilitiesHash` |
| `GET` | `/sync/v3/spaces` | Spaces visible to the credential, live role, publish capability, and current head |
| `GET` | `/sync/v3/spaces/:spaceId/head` | Current immutable Revision metadata and content hash |
| `GET` | `/sync/v3/spaces/:spaceId/snapshot?revision=:fixed&cursor=:cursor&limit=:limit` | Paged folders, Pages, referenced attachments, and fixed-Revision counts |
| `GET` | `/sync/v3/spaces/:spaceId/delta?from=:fixed&cursor=:cursor&limit=:limit` | Paged canonical changes from a retained Revision to current |
| `GET` | `/sync/v3/spaces/:spaceId/bootstrap-preview` | Hash-bound preview for a legacy Space that has no native v3 head |
| `POST` | `/sync/v3/spaces/:spaceId/bootstrap` | Confirm a preview with `baseRevision` and `confirmationHash` |
| `POST` | `/sync/v3/spaces/:spaceId/push-sessions` | Create or replay a hash-bound Push session |
| `PUT` | `/sync/v3/spaces/:spaceId/push-sessions/:sessionId/batches/:batchIndex` | Upload one strict JSON change batch with `batchHash` |
| `GET` | `/sync/v3/spaces/:spaceId/push-sessions/:sessionId` | Session state, received batches/Blobs, and terminal result |
| `DELETE` | `/sync/v3/spaces/:spaceId/push-sessions/:sessionId` | Abort a non-terminal session; success is `204` |
| `PUT` | `/sync/v3/spaces/:spaceId/push-sessions/:sessionId/blobs/:contentHash/chunks/:chunkIndex` | Upload one `application/octet-stream` Blob chunk |
| `POST` | `/sync/v3/spaces/:spaceId/push-sessions/:sessionId/blobs/:contentHash/complete` | Verify size/chunk count/content hash and publish staged Blob |
| `POST` | `/sync/v3/spaces/:spaceId/push-sessions/:sessionId/finalize` | Atomically validate and publish, or replay the stored terminal result |
| `GET` | `/sync/v3/spaces/:spaceId/revisions/:revisionId/attachments/:attachmentId/content` | Authorize and stream a Blob owned by a fixed retained Revision |

Except for snapshot/delta, query parameters are forbidden. `revisionId=current` is forbidden for Blob downloads: authorization is always pinned to a fixed Revision.

## Capabilities and limits

Clients must fetch capabilities immediately before creating a Push session and submit the returned `capabilitiesHash`. A changed hash fails with `CAPABILITIES_CHANGED` without consuming an idempotency key. Server hard ceilings include a 10 MiB attachment, 1,000 referenced attachments per Revision, 100 MiB transferred Blobs per session, 1 MiB chunks, ten chunks per Blob, two concurrent Blobs, 10,000 pixels per dimension, and 40 million decoded pixels. The response also publishes allowed image MIME types and staging/download authorization lifetimes. These are ceilings, not permission grants.

## Canonical tree and attachment contract

v3 represents folders below `pages/`, Markdown Pages below `pages/`, and flat referenced images below `assets/`. Page `body`, `contentHash`, RFC 3339 `updatedAt`, and sorted unique `referencedAttachmentIds` are revision material. An attachment includes public ID, canonical `assets/<filename>` path, MIME, decimal byte size, dimensions, SHA-256 content hash, and update time.

Web upload and rename return the only canonical filename/path that a client may persist. Names must pass the public portable-path validator, Unicode/path-key collision rules, MIME/extension checks, and Markdown-safety checks; clients must never derive a canonical path from an original filename. Page saves parse supported Markdown image forms and atomically reject missing, archived, ambiguous, unsafe, or cross-Space references.

Attachment removal in the revision protocol is `detach_attachment`: it removes the current Revision reference/metadata only. It never promises immediate physical deletion. There is deliberately no `delete_attachment` operation. Fixed retained Revisions keep their exact attachment rows and remain authorized until retention removes the Revision.

## Blob transfer

`blobRequirements` are sorted and unique and bind content hash, byte count, MIME, width, and height. Each chunk path index is canonical decimal; the body is raw octets and the optional `Content-Length` may not exceed the negotiated chunk size. Chunk receipts bind the session, index, chunk hash, and received count. `complete` binds the path hash again in the JSON body plus canonical decimal `sizeBytes` and `chunkCount`. The server reconstructs and validates bytes before making the Blob available. Missing required Blobs prevent finalize with `PUSH_SESSION_INCOMPLETE` or `ATTACHMENT_BLOB_MISSING`.

Blob identity is content-addressed, but authorization is not: download requires a live device credential, current Space read access, a retained fixed Revision, and an attachment row owned by that Revision. Responses are `private, no-store` and `nosniff`.

## Push state machine and idempotency

A create request binds protocol, Space, base Revision, UUID idempotency key, capabilities hash, confirmation hash/byte length, change/body/attachment totals, transfer byte total, and Blob requirements. The confirmation manifest is canonicalized and domain-separated; batches have independent canonical hashes.

The observable progression is `uploading` → `ready_to_finalize` → terminal `published` or `noop`; a non-terminal session can become `aborted` or `expired`. Batch and chunk replay is accepted only when bytes/hashes match. Reusing the create idempotency key with identical input returns the same session; different input returns `IDEMPOTENCY_MISMATCH`. Finalize requires `userConfirmed: true` and the original confirmation hash. A successful finalize and its terminal response are committed together, so retry returns the same result and never publishes twice. A failed transaction leaves the prior head, Pages, attachment ownership, ChangeSet, and session terminal result unchanged.

Finalized v3 publications create governed ChangeSets for audit, but they are explicitly `revertible: false`. The legacy ChangeSet revert endpoint rejects them: replaying an old Page-only inverse would violate folder/attachment/revision invariants. Recovery is a new forward v3 Push or an operator database-and-attachment rollback, never a legacy review revert.

## Retention and compatibility

Snapshots, deltas, and Blob downloads work only while their fixed Revision is retained; an expired base returns `REVISION_GONE`. A v3 head is not projected through v1/v2: legacy head/snapshot/delta/Push routes return `SYNC_PROTOCOL_UPGRADE_REQUIRED`. Clients must upgrade rather than guessing a lossy Page-only view.

Public error codes include the inherited authentication, authorization, cursor, stale-base, confirmation, collision, quota, session, idempotency, rate-limit and internal codes plus v3 attachment codes: `ATTACHMENT_REFERENCE_INVALID`, `ATTACHMENT_MISSING`, `ATTACHMENT_CONTENT_INVALID`, `ATTACHMENT_NAME_CONFLICT`, `ATTACHMENT_REFERENCED`, `ATTACHMENT_BLOB_MISSING`, `ATTACHMENT_QUOTA_EXCEEDED`, and `SYNC_PROTOCOL_UPGRADE_REQUIRED`.
