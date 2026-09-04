# @neomei/agentwiki-sync-protocol

Browser-compatible canonicalization, hashing, normalization, and strict schema primitives for AgentWiki Sync v1-v3.

This package contains no Node built-ins, performs no network requests, and persists no credentials. Hashing uses Web Crypto.

## Usage

```ts
import { contentHash, pathKey, canonicalBytes } from "@neomei/agentwiki-sync-protocol";

const hash = await contentHash("Hello\n");
const key = pathKey("Straße/İ.MD");
const bytes = canonicalBytes({ protocolVersion: "1", spaceId: "space-a" });
```

## Sync v3 referenced images

Sync v3 adds referenced PNG, JPEG, WebP, and GIF attachments to the immutable Folder/Page revision. Import the public contract from the package root:

```ts
import {
  SYNC_PROTOCOL_V3,
  SyncAttachmentV3Schema,
  SyncPageV3Schema,
  TreeRevisionContentManifestV3Schema,
  treeRevisionContentHashV3,
} from "@neomei/agentwiki-sync-protocol";

const manifest = TreeRevisionContentManifestV3Schema.parse(input);
const revisionContentHash = await treeRevisionContentHashV3(manifest);
```

The schemas reject unknown fields. Attachment paths are portable, flat `assets/<file>` paths; Page paths retain the v2 `pages/**/*.md` rules. Attachment identities use the same public ID grammar as existing AgentWiki Space, Page, and Revision IDs (`^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`), accepting both existing CUIDs and UUIDs. `referencedAttachmentIds` must contain sorted unique public IDs, and a revision's Attachment set must exactly equal the union referenced by its Pages.

Canonical revision order is Folder parent-first, then Page and Attachment by Unicode `pathKey` and ID. Canonical delta/confirmation/batch order guarantees Attachment upserts precede dependent Page upserts and detaches follow Page changes. Structured v3 hashes are SHA-256 over `domain + NUL + canonical JSON`, with these domains:

- `agentwiki:sync-v3:capabilities`
- `agentwiki:sync-v3:revision`
- `agentwiki:sync-v3:delta`
- `agentwiki:sync-v3:confirmation`
- `agentwiki:sync-v3:batch`

Blob and chunk content hashes remain lowercase SHA-256 of the raw bytes so content-addressed storage can verify them directly.

The fixed client/server safety ceiling is exported as `TREE_SYNC_V3_HARD_LIMITS`: 10 MiB per image, 1,000 referenced images per revision, 100 MiB transferred per revision, 1 MiB chunks, at most 10 chunks per image, concurrency 2, 10,000 pixels per side, and 40,000,000 decoded pixels. Negotiated capabilities may only lower these values.

Sync v3 errors use `SyncV3ErrorEnvelopeSchema`, whose only payload fields are `protocolVersion`, `error.code`, and `error.retryable`. `SYNC_V3_ERROR_CODES` is the shared, closed set of attachment and protocol-upgrade codes; the strict envelope intentionally has no free-form message or data field that could carry paths, credentials, Markdown, Blob bytes, or storage keys.

Shared cross-runtime fixtures are published at `@neomei/agentwiki-sync-protocol/test-vectors/sync-v3.json`. They pin revision, delta, confirmation, batch, and raw Blob digests for ESM/CJS consumers.
