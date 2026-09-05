import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as protocol from "./index.js";
import {
  BlobChunkReceiptV3Schema,
  CompletedBlobV3Schema,
  CreateTreePushSessionRequestV3Schema,
  FlatAttachmentPathSchema,
  SYNC_ERROR_CODES,
  SYNC_V3_ERROR_CODES,
  SYNC_PROTOCOL_V3,
  TREE_SYNC_V3_HARD_LIMITS,
  SyncAttachmentV3Schema,
  SyncErrorCodeSchema,
  SyncPageV3Schema,
  SyncV3ErrorCodeSchema,
  SyncV3ErrorEnvelopeSchema,
  SyncV3WireErrorCodeSchema,
  TreeBootstrapPreviewV3Schema,
  TreeCapabilitiesResponseV3Schema,
  TreeDetachAttachmentV3Schema,
  TreeDeltaItemV3Schema,
  TreeDeltaPageV3Schema,
  TreeFinalizePushRequestV3Schema,
  TreeFinalizePushResponseV3Schema,
  TreePushBatchV3Schema,
  TreePushBatchReceiptV3Schema,
  TreePushConfirmationManifestV3Schema,
  TreePushChangeV3Schema,
  TreeRevisionContentManifestV3Schema,
  TreeRevisionDeltaManifestV3Schema,
  TreeRevisionHeadResponseV3Schema,
  TreeSnapshotPageV3Schema,
  TreeSyncCapabilitiesV3Schema,
  blobChunkHashV3,
  blobContentHashV3,
  canonicalTreeDeltaItemsV3,
  canonicalTreeRevisionManifestV3,
  treeBatchHashV3,
  treeConfirmationHashV3,
  treeRevisionContentHashV2,
  treeRevisionContentHashV3,
  treeRevisionDeltaHashV3,
  treeRevisionDeltaV3,
  type BlobRequirementV3,
  type CreateTreePushSessionRequestV3,
  type TreeDeltaItemV3,
  type SyncErrorCode,
  type SyncV3WireErrorCode,
} from "./index.js";

const hash = "a".repeat(64);
const timestamp = "2026-09-04T00:00:00.000Z";
const cuidAttachmentId = "cmf6z2k8a0001qwertyuiop12";
const malformedAttachmentIds = [
  "",
  " attachment-id",
  "attachment-id ",
  "attachment id",
  "attachment\tid",
  "attachment/id",
  String.raw`attachment\id`,
  "a".repeat(129),
];
const inheritedSyncErrorCodes = [
  "AUTHENTICATION_REQUIRED",
  "DEVICE_CREDENTIAL_REVOKED",
  "DEVICE_CREDENTIAL_EXPIRED",
  "USER_INACTIVE",
  "SPACE_FORBIDDEN",
  "SPACE_READ_ONLY",
  "INSTALLATION_NOT_FOUND",
  "INSTALLATION_REVOKED",
  "INSTALLATION_ALREADY_EXCHANGED",
  "INSTALLATION_CODE_INVALID",
  "INSTALLATION_CODE_EXPIRED",
  "CREDENTIAL_COLLISION",
  "PROTOCOL_UNSUPPORTED",
  "SYNC_PROTOCOL_UPGRADE_REQUIRED",
  "REVISION_GONE",
  "CURSOR_INVALID",
  "BASE_STALE",
  "CONFIRMATION_REQUIRED",
  "CONFIRMATION_MISMATCH",
  "PAYLOAD_INVALID",
  "PATH_COLLISION",
  "PAGE_ID_CONFLICT",
  "PAGE_TOO_LARGE",
  "BATCH_TOO_LARGE",
  "SPACE_TOO_LARGE",
  "BATCH_MISMATCH",
  "PUSH_SESSION_EXPIRED",
  "PUSH_SESSION_NOT_FOUND",
  "PUSH_SESSION_STATE_INVALID",
  "PUSH_SESSION_INCOMPLETE",
  "IDEMPOTENCY_MISMATCH",
  "CAPABILITIES_CHANGED",
  "QUOTA_EXCEEDED",
  "RATE_LIMITED",
  "INTERNAL_ERROR",
] as const satisfies readonly SyncErrorCode[];
const requiredInheritedV3WireCodes = [
  "CURSOR_INVALID",
  "REVISION_GONE",
  "SPACE_FORBIDDEN",
  "DEVICE_CREDENTIAL_REVOKED",
] as const satisfies readonly SyncV3WireErrorCode[];
const forbiddenV3ErrorEnvelopeFields = [
  ["message", "internal diagnostic"],
  ["details", { internal: true }],
  ["path", "/Users/example/private.png"],
  ["credential", "secret"],
  ["markdown", "![private](assets/private.png)"],
  ["blob", [1, 2, 3]],
  ["storageKey", "internal/blob/key"],
] as const;
const vector = JSON.parse(readFileSync("test-vectors/sync-v3.json", "utf8")) as {
  errorCodes: string[];
  revision: { input: unknown; expectedHash: string };
  delta: { input: unknown; expectedHash: string };
  confirmation: { input: unknown; expectedHash: string };
  batch: { input: unknown; expectedHash: string };
  blob: { base64: string; expectedHash: string };
};

const attachment = (overrides: Record<string, unknown> = {}) => ({
  attachmentId: "11111111-1111-4111-8111-111111111111",
  path: "assets/photo.png",
  mimeType: "image/png",
  sizeBytes: "4",
  width: 1,
  height: 1,
  contentHash: hash,
  updatedAt: timestamp,
  ...overrides,
});

const folder = (overrides: Record<string, unknown> = {}) => ({
  folderId: "folder-a",
  parentFolderId: null,
  name: "folder-a",
  path: "pages/folder-a",
  sortOrder: 0,
  updatedAt: timestamp,
  ...overrides,
});

const page = (overrides: Record<string, unknown> = {}) => ({
  pageId: "page-a",
  folderId: null,
  path: "pages/a.md",
  title: "a",
  body: "![[assets/a.png]]",
  contentHash: "b".repeat(64),
  updatedAt: timestamp,
  referencedAttachmentIds: ["11111111-1111-4111-8111-111111111111"],
  ...overrides,
});

const capabilities = (overrides: Record<string, unknown> = {}) => ({
  maxPageBytes: 1_048_576,
  maxBatchBytes: 4_194_304,
  maxBatchItems: 100,
  maxChangeCount: 100,
  maxConfirmationBytes: 4_194_304,
  maxClientSpacePages: 5_000,
  maxClientSpaceFolders: 10_000,
  maxSnapshotObjects: 15_000,
  maxClientManifestBytes: 4_194_304,
  maxClientTotalBodyBytes: 2_097_152,
  maxDeltaItems: 15_000,
  maxResponseBytes: 4_194_304,
  maxPageItems: 100,
  pushSessionTtlSeconds: 900,
  maxAttachmentBytes: 10 * 1024 * 1024,
  maxRevisionAttachments: 1_000,
  maxTransferBlobBytes: 100 * 1024 * 1024,
  blobChunkBytes: 1024 * 1024,
  maxBlobChunks: 10,
  maxConcurrentBlobs: 2,
  maxImageDimension: 10_000,
  maxDecodedPixels: 40_000_000,
  allowedMimeTypes: ["image/gif", "image/jpeg", "image/png", "image/webp"],
  blobStagingTtlSeconds: 900,
  downloadAuthorizationTtlSeconds: 60,
  ...overrides,
});

type BlobRequirementSchemaLike = {
  parse(value: unknown): BlobRequirementV3;
  safeParse(value: unknown): { success: boolean };
};

const blobRequirement = (overrides: Record<string, unknown> = {}): BlobRequirementV3 => ({
  contentHash: hash,
  sizeBytes: "4",
  mimeType: "image/png",
  width: 1,
  height: 1,
  ...overrides,
} as BlobRequirementV3);

const blobRequirementSchema = (): BlobRequirementSchemaLike => {
  const schema = (protocol as unknown as {
    BlobRequirementV3Schema?: BlobRequirementSchemaLike;
  }).BlobRequirementV3Schema;
  expect(schema).toBeDefined();
  return schema!;
};

const createPushSessionRequest = (
  overrides: Record<string, unknown> = {},
): CreateTreePushSessionRequestV3 => ({
  protocolVersion: "3",
  baseRevision: "rev-1",
  idempotencyKey: "11111111-1111-4111-8111-111111111111",
  capabilitiesHash: hash,
  confirmationHash: hash,
  confirmationByteLength: 1,
  changeCount: 1,
  totalBodyBytes: 0,
  attachmentCount: 1,
  transferBlobBytes: 4,
  blobRequirements: [blobRequirement()],
  ...overrides,
} as CreateTreePushSessionRequestV3);

const indexedHash = (index: number): string => index.toString(16).padStart(64, "0");

describe("Sync Protocol v3", () => {
  it("exports the shared Public ID schema and accepts existing CUID attachment identities", () => {
    const publicIdSchema = (protocol as unknown as {
      PublicIdSchema?: { parse(value: unknown): string };
    }).PublicIdSchema;
    expect(publicIdSchema).toBeDefined();
    expect(publicIdSchema?.parse(cuidAttachmentId)).toBe(cuidAttachmentId);
    expect(publicIdSchema?.parse("a".repeat(128))).toBe("a".repeat(128));
    for (const invalidId of malformedAttachmentIds) {
      expect(() => publicIdSchema?.parse(invalidId)).toThrow();
    }
    expect(SyncAttachmentV3Schema.parse(attachment({ attachmentId: cuidAttachmentId })).attachmentId)
      .toBe(cuidAttachmentId);
    expect(SyncPageV3Schema.parse(page({ referencedAttachmentIds: [cuidAttachmentId] })).referencedAttachmentIds)
      .toEqual([cuidAttachmentId]);
    expect(TreeDetachAttachmentV3Schema.parse({
      operation: "detach_attachment",
      attachmentId: cuidAttachmentId,
      previousPath: "assets/photo.png",
    }).attachmentId).toBe(cuidAttachmentId);
  });

  it.each(malformedAttachmentIds)("rejects malformed Public ID %j in every attachment identity field", (invalidId) => {
    expect(() => SyncAttachmentV3Schema.parse(attachment({ attachmentId: invalidId }))).toThrow();
    expect(() => SyncPageV3Schema.parse(page({ referencedAttachmentIds: [invalidId] }))).toThrow();
    expect(() => TreeDetachAttachmentV3Schema.parse({
      operation: "detach_attachment",
      attachmentId: invalidId,
      previousPath: "assets/photo.png",
    })).toThrow();
  });

  it("carries CUID attachment identities through revision, snapshot, delta, confirmation and batch schemas", () => {
    const cuidAttachment = attachment({ attachmentId: cuidAttachmentId });
    const cuidPage = page({ referencedAttachmentIds: [cuidAttachmentId] });
    const revision = {
      protocolVersion: "3" as const,
      spaceId: "space-a",
      folders: [],
      pages: [cuidPage],
      attachments: [cuidAttachment],
    };
    const changes = [
      { operation: "upsert_attachment" as const, attachment: cuidAttachment },
      { operation: "upsert_page" as const, page: cuidPage },
      {
        operation: "detach_attachment" as const,
        attachmentId: cuidAttachmentId,
        previousPath: "assets/old.png",
      },
    ];
    const { body: _body, ...cuidPageManifest } = cuidPage;
    const manifestChanges = [
      changes[0],
      { operation: "upsert_page" as const, page: cuidPageManifest },
      changes[2],
    ];
    expect(TreeRevisionContentManifestV3Schema.parse(revision)).toEqual(revision);
    expect(TreeSnapshotPageV3Schema.parse({
      protocolVersion: "3",
      spaceId: "space-a",
      revision: "rev-1",
      sequence: 1,
      revisionContentHash: hash,
      folderCount: "0",
      pageCount: "1",
      attachmentCount: "1",
      revisionManifestByteLength: "1",
      revisionBodyBytes: "1",
      revisionAttachmentBytes: "1",
      folders: [],
      pages: [cuidPage],
      attachments: [cuidAttachment],
      nextCursor: null,
    }).attachments[0]?.attachmentId).toBe(cuidAttachmentId);
    expect(TreeRevisionDeltaManifestV3Schema.parse({
      protocolVersion: "3",
      spaceId: "space-a",
      fromRevision: "rev-1",
      toRevision: "rev-2",
      items: changes,
    }).items).toEqual(changes);
    expect(TreeDeltaPageV3Schema.parse({
      protocolVersion: "3",
      spaceId: "space-a",
      fromRevision: "rev-1",
      toRevision: "rev-2",
      toSequence: 2,
      toRevisionContentHash: hash,
      toFolderCount: "0",
      toPageCount: "1",
      toAttachmentCount: "1",
      toRevisionManifestByteLength: "1",
      toRevisionBodyBytes: "1",
      toRevisionAttachmentBytes: "1",
      items: changes,
      nextCursor: null,
    }).items).toEqual(changes);
    expect(TreePushConfirmationManifestV3Schema.parse({
      protocolVersion: "3",
      spaceId: "space-a",
      baseRevision: "rev-1",
      capabilitiesHash: hash,
      changes: manifestChanges,
    }).changes).toEqual(manifestChanges);
    expect(TreePushBatchV3Schema.parse({
      protocolVersion: "3",
      batchIndex: 0,
      changes,
      batchHash: hash,
    }).changes).toEqual(changes);
    for (const change of changes) expect(TreePushChangeV3Schema.parse(change)).toEqual(change);
  });

  it("rejects unknown fields and non-flat attachment paths", () => {
    const valid = attachment();
    expect(() => SyncAttachmentV3Schema.parse({ ...valid, extra: true })).toThrow();
    expect(() =>
      SyncAttachmentV3Schema.parse({ ...valid, path: "assets/nested/photo.png" }),
    ).toThrow();
    expect(SyncAttachmentV3Schema.parse(valid).path).toBe("assets/photo.png");
  });

  it.each([
    "assets/bad|alias.png",
    "assets/bad]]close.png",
    "assets/bad%.png",
    "assets/bad%2G.png",
    "assets/a%20b.png",
    "assets/a#b.png",
    "assets/bad:name.png",
  ])("rejects managed attachment paths that cannot round-trip through Markdown %j", (path) => {
    expect(() => FlatAttachmentPathSchema.parse(path)).toThrow();
  });

  it.each([
    "assets/road map (final).png",
    "assets/路线图（最终）.webp",
    "assets/emoji 🖼️.gif",
  ])("accepts managed attachment paths that round-trip through Markdown %j", (path) => {
    expect(FlatAttachmentPathSchema.parse(path)).toBe(path.normalize("NFC"));
  });

  it("requires sorted unique page attachment ids", () => {
    expect(() =>
      SyncPageV3Schema.parse({
        ...page(),
        referencedAttachmentIds: ["b", "a", "a"],
      }),
    ).toThrow();
    expect(() => SyncPageV3Schema.parse(page({
      referencedAttachmentIds: [
        "22222222-2222-4222-8222-222222222222",
        "11111111-1111-4111-8111-111111111111",
      ],
    }))).toThrow(/sorted/iu);
  });

  it("fails closed when negotiated attachment capabilities exceed hard limits", () => {
    expect(SYNC_PROTOCOL_V3).toBe("3");
    expect(TreeSyncCapabilitiesV3Schema.parse(capabilities())).toEqual(capabilities());
    expect(() => TreeSyncCapabilitiesV3Schema.parse(capabilities({
      maxAttachmentBytes: TREE_SYNC_V3_HARD_LIMITS.maxAttachmentBytes + 1,
    }))).toThrow();
    expect(() => TreeSyncCapabilitiesV3Schema.parse(capabilities({
      maxRevisionAttachments: TREE_SYNC_V3_HARD_LIMITS.maxRevisionAttachments + 1,
    }))).toThrow();
    expect(() => TreeSyncCapabilitiesV3Schema.parse(capabilities({
      maxTransferBlobBytes: TREE_SYNC_V3_HARD_LIMITS.maxTransferBlobBytes + 1,
    }))).toThrow();
    expect(() => TreeSyncCapabilitiesV3Schema.parse(capabilities({
      maxBlobChunks: TREE_SYNC_V3_HARD_LIMITS.maxBlobChunks + 1,
    }))).toThrow();
    expect(() => TreeSyncCapabilitiesV3Schema.parse(capabilities({
      maxConcurrentBlobs: TREE_SYNC_V3_HARD_LIMITS.maxConcurrentBlobs + 1,
    }))).toThrow();
    expect(() => TreeSyncCapabilitiesV3Schema.parse(capabilities({
      maxImageDimension: TREE_SYNC_V3_HARD_LIMITS.maxImageDimension + 1,
    }))).toThrow();
    expect(() => TreeSyncCapabilitiesV3Schema.parse(capabilities({
      maxDecodedPixels: TREE_SYNC_V3_HARD_LIMITS.maxDecodedPixels + 1,
    }))).toThrow();
  });

  it("orders Folder parents first and Page/Attachment entries by path key then ID", () => {
    const manifest = canonicalTreeRevisionManifestV3(
      TreeRevisionContentManifestV3Schema.parse(vector.revision.input),
    );
    expect(manifest.folders.map((item) => item.folderId)).toEqual(["root", "child"]);
    expect(manifest.pages.map((item) => item.pageId)).toEqual(["page-a", "page-b"]);
    expect(manifest.attachments.map((item) => item.attachmentId)).toEqual([
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
    ]);
  });

  it("binds sorted attachment references into a domain-separated revision hash", async () => {
    const manifest = TreeRevisionContentManifestV3Schema.parse(vector.revision.input);
    expect(await treeRevisionContentHashV3(manifest)).toBe(vector.revision.expectedHash);
    const changed = {
      ...manifest,
      pages: manifest.pages.map((item) => ({
        ...item,
        referencedAttachmentIds: item.pageId === "page-a"
          ? ["22222222-2222-4222-8222-222222222222"]
          : ["11111111-1111-4111-8111-111111111111"],
      })),
    };
    expect(await treeRevisionContentHashV3(changed)).not.toBe(vector.revision.expectedHash);
    expect(await treeRevisionContentHashV3({
      protocolVersion: "3",
      spaceId: manifest.spaceId,
      folders: manifest.folders,
      pages: manifest.pages,
      attachments: manifest.attachments,
    })).not.toBe(await treeRevisionContentHashV2({
      protocolVersion: "2",
      spaceId: manifest.spaceId,
      folders: manifest.folders,
      pages: manifest.pages.map(({ referencedAttachmentIds: _ids, ...item }) => item),
    }));
  });

  it("orders attachment upserts before dependent Pages and detaches after Pages", () => {
    const ordered = canonicalTreeDeltaItemsV3((vector.delta.input as { items: never[] }).items);
    expect(ordered.map((item) => item.operation)).toEqual([
      "upsert_attachment",
      "upsert_page",
      "detach_attachment",
    ]);
  });

  it("derives detach only after the Page no longer references the attachment", () => {
    const parent = TreeRevisionContentManifestV3Schema.parse(vector.revision.input);
    const current = TreeRevisionContentManifestV3Schema.parse({
      ...parent,
      pages: parent.pages.map((item) => item.pageId === "page-b"
        ? { ...item, body: "# no image\n", contentHash: "e".repeat(64), referencedAttachmentIds: [] }
        : item),
      attachments: parent.attachments.filter((item) => item.attachmentId !== "22222222-2222-4222-8222-222222222222"),
    });
    expect(treeRevisionDeltaV3(parent, current).map((item) => item.operation)).toEqual([
      "upsert_page",
      "detach_attachment",
    ]);
  });

  it("reproduces the shared revision, delta, confirmation, batch and Blob vectors", async () => {
    expect(await treeRevisionContentHashV3(TreeRevisionContentManifestV3Schema.parse(vector.revision.input)))
      .toBe(vector.revision.expectedHash);
    expect(await treeRevisionDeltaHashV3(vector.delta.input as never)).toBe(vector.delta.expectedHash);
    expect(await treeConfirmationHashV3(vector.confirmation.input as never)).toBe(vector.confirmation.expectedHash);
    expect(await treeBatchHashV3(vector.batch.input as never)).toBe(vector.batch.expectedHash);
    expect(await blobContentHashV3(Uint8Array.from(atob(vector.blob.base64), (char) => char.charCodeAt(0))))
      .toBe(vector.blob.expectedHash);
  });

  it("strictly validates v3 request and response envelopes", () => {
    const metadata = {
      protocolVersion: "3",
      spaceId: "space-a",
      revision: "rev-2",
      sequence: 2,
      revisionContentHash: hash,
      folderCount: "0",
      pageCount: "0",
      attachmentCount: "0",
      revisionManifestByteLength: "2",
      revisionBodyBytes: "0",
      revisionAttachmentBytes: "0",
      publishedAt: timestamp,
    };
    expect(TreeCapabilitiesResponseV3Schema.parse({
      protocolVersion: "3", capabilities: capabilities(), capabilitiesHash: hash,
    }).protocolVersion).toBe("3");
    expect(TreeRevisionHeadResponseV3Schema.parse(metadata).attachmentCount).toBe("0");
    const { publishedAt: _publishedAt, ...snapshotMetadata } = metadata;
    expect(TreeSnapshotPageV3Schema.parse({
      ...snapshotMetadata, folders: [], pages: [], attachments: [], nextCursor: null,
    }).attachments).toEqual([]);
    expect(TreeDeltaPageV3Schema.parse({
      protocolVersion: "3", spaceId: "space-a", fromRevision: "rev-1", toRevision: "rev-2", toSequence: 2,
      toRevisionContentHash: hash, toFolderCount: "0", toPageCount: "0", toAttachmentCount: "0",
      toRevisionManifestByteLength: "2", toRevisionBodyBytes: "0", toRevisionAttachmentBytes: "0",
      items: [], nextCursor: null,
    }).items).toEqual([]);
    expect(CreateTreePushSessionRequestV3Schema.parse(createPushSessionRequest({
      changeCount: 0,
      attachmentCount: 0,
      transferBlobBytes: 0,
      blobRequirements: [],
    })).blobRequirements).toEqual([]);
    expect(TreePushBatchV3Schema.parse({
      protocolVersion: "3", batchIndex: 0,
      changes: [{ operation: "upsert_attachment", attachment: attachment() }], batchHash: hash,
    }).changes).toHaveLength(1);
    expect(TreePushBatchReceiptV3Schema.parse({
      protocolVersion: "3", sessionId: "11111111-1111-4111-8111-111111111111", batchIndex: 0,
      batchHash: hash, receipt: "receipt", receivedBatchCount: 1,
    }).receivedBatchCount).toBe(1);
    expect(TreeFinalizePushRequestV3Schema.parse({
      protocolVersion: "3", confirmationHash: hash, userConfirmed: true,
    }).userConfirmed).toBe(true);
    expect(TreeFinalizePushResponseV3Schema.parse({
      protocolVersion: "3", status: "published", revision: "rev-2", sequence: 2, publishedAt: timestamp,
      revisionContentHash: hash, folderCount: "0", pageCount: "0", attachmentCount: "0",
      revisionManifestByteLength: "2", revisionBodyBytes: "0", revisionAttachmentBytes: "0", changeSetId: null,
    }).status).toBe("published");
    expect(BlobChunkReceiptV3Schema.parse({
      contentHash: hash, chunkIndex: 0, chunkHash: hash, receipt: "receipt",
    }).chunkIndex).toBe(0);
    expect(CompletedBlobV3Schema.parse({
      contentHash: hash, sizeBytes: "4", mimeType: "image/png", width: 1, height: 1, verifiedAt: timestamp,
    }).sizeBytes).toBe("4");
    expect(() => TreeFinalizePushRequestV3Schema.parse({
      protocolVersion: "3", confirmationHash: hash, userConfirmed: true, extra: true,
    })).toThrow();
  });

  it("publishes a strict BlobRequirementV3 schema and accepts canonical metadata", () => {
    expect(blobRequirementSchema().parse(blobRequirement())).toEqual(blobRequirement());
  });

  it.each([
    ["zero size", { sizeBytes: "0" }],
    ["non-canonical size", { sizeBytes: "01" }],
    ["oversized Blob", { sizeBytes: String(TREE_SYNC_V3_HARD_LIMITS.maxAttachmentBytes + 1) }],
    ["unsupported MIME", { mimeType: "image/svg+xml" }],
    ["zero width", { width: 0 }],
    ["oversized height", { height: TREE_SYNC_V3_HARD_LIMITS.maxImageDimension + 1 }],
    ["decoded pixel overflow", { width: 10_000, height: 4_001 }],
    ["malformed content hash", { contentHash: "A".repeat(64) }],
  ])("rejects BlobRequirementV3 %s", (_label, overrides) => {
    expect(() => blobRequirementSchema().parse(blobRequirement(overrides))).toThrow();
  });

  it.each(["attachmentId", "path", "updatedAt"])(
    "keeps BlobRequirementV3 content-addressed by rejecting %s",
    (field) => {
      expect(() => blobRequirementSchema().parse({
        ...blobRequirement(),
        [field]: "not-part-of-the-blob-contract",
      })).toThrow();
    },
  );

  it.each(["x", "1e2"])(
    "returns safe Zod failures for malformed decimal size %j at every public request boundary",
    (sizeBytes) => {
      const parseOperations = [
        () => SyncAttachmentV3Schema.safeParse(attachment({ sizeBytes })),
        () => blobRequirementSchema().safeParse(blobRequirement({ sizeBytes })),
        () => TreePushBatchV3Schema.safeParse({
          protocolVersion: "3",
          batchIndex: 0,
          changes: [{ operation: "upsert_attachment", attachment: attachment({ sizeBytes }) }],
          batchHash: hash,
        }),
        () => CreateTreePushSessionRequestV3Schema.safeParse(createPushSessionRequest({
          transferBlobBytes: 0,
          blobRequirements: [blobRequirement({ sizeBytes })],
        })),
      ];
      for (const safeParse of parseOperations) {
        let result: { success: boolean } | undefined;
        expect(() => {
          result = safeParse();
        }).not.toThrow();
        expect(result?.success).toBe(false);
      }
    },
  );

  it("accepts zero requirements and one canonical requirement", () => {
    expect(CreateTreePushSessionRequestV3Schema.parse(createPushSessionRequest({
      changeCount: 0,
      attachmentCount: 0,
      transferBlobBytes: 0,
      blobRequirements: [],
    })).blobRequirements).toEqual([]);
    expect(CreateTreePushSessionRequestV3Schema.parse(createPushSessionRequest()).blobRequirements)
      .toEqual([blobRequirement()]);
  });

  it("allows multiple attachment upserts to share one required Blob", () => {
    expect(CreateTreePushSessionRequestV3Schema.parse(createPushSessionRequest({
      changeCount: 2,
      attachmentCount: 2,
    })).blobRequirements).toEqual([blobRequirement()]);
  });

  it("requires attachment upserts to fit within the total change count", () => {
    expect(CreateTreePushSessionRequestV3Schema.safeParse(createPushSessionRequest({
      changeCount: 1,
      attachmentCount: 2,
    })).success).toBe(false);
  });

  it("requires a nonempty Blob requirement set when attachment upserts exist", () => {
    expect(CreateTreePushSessionRequestV3Schema.safeParse(createPushSessionRequest({
      attachmentCount: 1,
      transferBlobBytes: 0,
      blobRequirements: [],
    })).success).toBe(false);
  });

  it("rejects the legacy contentHashes field", () => {
    expect(() => CreateTreePushSessionRequestV3Schema.parse({
      ...createPushSessionRequest(),
      contentHashes: [hash],
    })).toThrow();
  });

  it("requires Blob requirements to be strictly sorted and unique by content hash", () => {
    const first = blobRequirement({ contentHash: "a".repeat(64) });
    const second = blobRequirement({ contentHash: "b".repeat(64) });
    expect(() => CreateTreePushSessionRequestV3Schema.parse(createPushSessionRequest({
      attachmentCount: 2,
      transferBlobBytes: 8,
      blobRequirements: [second, first],
    }))).toThrow(/sorted/iu);
    expect(() => CreateTreePushSessionRequestV3Schema.parse(createPushSessionRequest({
      attachmentCount: 2,
      transferBlobBytes: 8,
      blobRequirements: [first, first],
    }))).toThrow(/unique/iu);
  });

  it("rejects more Blob requirements than attachment upserts", () => {
    expect(() => CreateTreePushSessionRequestV3Schema.parse(createPushSessionRequest({
      attachmentCount: 1,
      transferBlobBytes: 8,
      blobRequirements: [
        blobRequirement({ contentHash: "a".repeat(64) }),
        blobRequirement({ contentHash: "b".repeat(64) }),
      ],
    }))).toThrow(/attachment/iu);
  });

  it("binds transferBlobBytes to the exact unique requirement sum", () => {
    expect(() => CreateTreePushSessionRequestV3Schema.parse(createPushSessionRequest({
      transferBlobBytes: 3,
    }))).toThrow(/sum/iu);
  });

  it("accepts the 100 MiB transfer edge and rejects overflow", () => {
    const edgeRequirements = Array.from({ length: 10 }, (_, index) => blobRequirement({
      contentHash: indexedHash(index + 1),
      sizeBytes: String(TREE_SYNC_V3_HARD_LIMITS.maxAttachmentBytes),
    }));
    expect(CreateTreePushSessionRequestV3Schema.parse(createPushSessionRequest({
      changeCount: edgeRequirements.length,
      attachmentCount: edgeRequirements.length,
      transferBlobBytes: TREE_SYNC_V3_HARD_LIMITS.maxTransferBlobBytes,
      blobRequirements: edgeRequirements,
    })).transferBlobBytes).toBe(TREE_SYNC_V3_HARD_LIMITS.maxTransferBlobBytes);

    const overflowRequirements = [...edgeRequirements, blobRequirement({
      contentHash: indexedHash(11),
      sizeBytes: String(TREE_SYNC_V3_HARD_LIMITS.maxAttachmentBytes),
    })];
    expect(() => CreateTreePushSessionRequestV3Schema.parse(createPushSessionRequest({
      attachmentCount: overflowRequirements.length,
      transferBlobBytes: TREE_SYNC_V3_HARD_LIMITS.maxTransferBlobBytes
        + TREE_SYNC_V3_HARD_LIMITS.maxAttachmentBytes,
      blobRequirements: overflowRequirements,
    }))).toThrow();
  });

  it("allows at most 1,000 unique Blob requirements", () => {
    const maximum = Array.from(
      { length: TREE_SYNC_V3_HARD_LIMITS.maxRevisionAttachments },
      (_, index) => blobRequirement({ contentHash: indexedHash(index + 1), sizeBytes: "1" }),
    );
    expect(CreateTreePushSessionRequestV3Schema.parse(createPushSessionRequest({
      changeCount: maximum.length,
      attachmentCount: maximum.length,
      transferBlobBytes: maximum.length,
      blobRequirements: maximum,
    })).blobRequirements).toHaveLength(1_000);
    expect(() => CreateTreePushSessionRequestV3Schema.parse(createPushSessionRequest({
      attachmentCount: maximum.length,
      transferBlobBytes: maximum.length + 1,
      blobRequirements: [
        ...maximum,
        blobRequirement({ contentHash: indexedHash(maximum.length + 1), sizeBytes: "1" }),
      ],
    }))).toThrow();
  });

  it("rejects unknown create-session request and Blob requirement fields", () => {
    expect(() => CreateTreePushSessionRequestV3Schema.parse({
      ...createPushSessionRequest(),
      unexpected: true,
    })).toThrow();
    expect(() => CreateTreePushSessionRequestV3Schema.parse(createPushSessionRequest({
      blobRequirements: [{ ...blobRequirement(), unexpected: true }],
    }))).toThrow();
  });

  it("enforces MIME, decoded-pixel and flat path identity invariants", () => {
    expect(() => SyncAttachmentV3Schema.parse(attachment({ mimeType: "image/jpeg" }))).toThrow(/MIME/iu);
    expect(() => SyncAttachmentV3Schema.parse(attachment({ width: 10_000, height: 10_000 }))).toThrow(/pixels/iu);
    const input = vector.revision.input as { attachments: Array<Record<string, unknown>> };
    expect(() => TreeRevisionContentManifestV3Schema.parse({
      ...input,
      attachments: input.attachments.map((item, index) => index === 1 ? { ...item, path: "assets/Z.PNG" } : item),
    })).toThrow(/path keys/iu);
  });

  it("maps chunk and complete Blob hard-limit failures to the shared quota code", async () => {
    const quotaCode = "ATTACHMENT_QUOTA_EXCEEDED";
    expect(SYNC_V3_ERROR_CODES).toContain(quotaCode);
    const oversizedChunk = new Uint8Array(TREE_SYNC_V3_HARD_LIMITS.blobChunkBytes + 1);
    await expect(blobChunkHashV3(oversizedChunk)).rejects.toThrow(quotaCode);
    await expect(blobContentHashV3(oversizedChunk)).resolves.toMatch(/^[0-9a-f]{64}$/u);
    const oversizedBlob = new Uint8Array(TREE_SYNC_V3_HARD_LIMITS.maxAttachmentBytes + 1);
    await expect(blobContentHashV3(oversizedBlob)).rejects.toThrow(quotaCode);
  });

  it("keeps the static v3 upsert_page type aligned with its strict runtime schema", () => {
    const { referencedAttachmentIds: _references, ...legacyPage } = page();
    // @ts-expect-error Sync v3 Page delta items must declare referencedAttachmentIds.
    const invalid: TreeDeltaItemV3 = { operation: "upsert_page", page: legacyPage };
    expect(() => TreeDeltaItemV3Schema.parse(invalid)).toThrow();

    const valid: TreeDeltaItemV3 = { operation: "upsert_page", page: page() };
    expect(TreeDeltaItemV3Schema.parse(valid)).toEqual(valid);
  });

  it.each(requiredInheritedV3WireCodes)("accepts inherited %s in the strict v3 wire envelope", (code) => {
    expect(SyncV3ErrorEnvelopeSchema.parse({
      protocolVersion: "3",
      error: { code, retryable: false },
    })).toEqual({ protocolVersion: "3", error: { code, retryable: false } });
  });

  it("exports one runtime source for inherited errors and a de-duplicated v3 wire schema", () => {
    expect(SYNC_ERROR_CODES).toEqual(inheritedSyncErrorCodes);
    for (const code of inheritedSyncErrorCodes) {
      expect(SyncErrorCodeSchema.parse(code)).toBe(code);
      expect(SyncV3WireErrorCodeSchema.parse(code)).toBe(code);
    }
    for (const code of vector.errorCodes) {
      expect(SyncV3WireErrorCodeSchema.parse(code)).toBe(code);
    }
    expect(new Set([...inheritedSyncErrorCodes, ...vector.errorCodes]).size).toBe(42);
  });

  it("keeps eight v3-specific action codes exact and the wire envelope data-free", () => {
    expect([...SYNC_V3_ERROR_CODES]).toEqual(vector.errorCodes);
    for (const code of vector.errorCodes) {
      expect(SyncV3ErrorCodeSchema.parse(code)).toBe(code);
      expect(SyncV3ErrorEnvelopeSchema.parse({
        protocolVersion: "3",
        error: { code, retryable: false },
      })).toEqual({ protocolVersion: "3", error: { code, retryable: false } });
    }
    for (const code of requiredInheritedV3WireCodes) {
      expect(() => SyncV3ErrorCodeSchema.parse(code)).toThrow();
    }
    expect(() => SyncV3ErrorEnvelopeSchema.parse({
      protocolVersion: "3",
      error: { code: "UNLISTED_WIRE_ERROR", retryable: false },
    })).toThrow();
    expect(() => SyncV3ErrorEnvelopeSchema.parse({
      protocolVersion: "3",
      error: { code: "ATTACHMENT_MISSING", retryable: false },
      extra: true,
    })).toThrow();
  });

  it.each(forbiddenV3ErrorEnvelopeFields)("rejects error.%s from the strict v3 wire envelope", (field, value) => {
    expect(() => SyncV3ErrorEnvelopeSchema.parse({
      protocolVersion: "3",
      error: {
        code: "ATTACHMENT_MISSING",
        retryable: false,
        [field]: value,
      },
    })).toThrow();
  });

  it("uses the shared v3 error-code schema for every bootstrap blocker", () => {
    const blockers = vector.errorCodes.map((code, index) => ({ pageId: `page-${index}`, code }));
    const parsed = TreeBootstrapPreviewV3Schema.parse({
      protocolVersion: "3",
      mode: "bootstrap_required",
      baseRevision: "rev-1",
      candidateHash: hash,
      attachmentCount: "0",
      transferBytes: "0",
      blockers,
    });
    expect(parsed.blockers.map((blocker) => blocker.code)).toEqual(vector.errorCodes);
    expect(() => TreeBootstrapPreviewV3Schema.parse({
      ...parsed,
      blockers: [{ pageId: "page-a", code: "UNLISTED_RECOVERY_ERROR" }],
    })).toThrow();
  });

  it("removes legacy Blob limit error strings from the public v3 helper source", () => {
    const source = readFileSync("src/sync-v3.ts", "utf8");
    expect(source).not.toContain("ATTACHMENT_TOO_LARGE");
    expect(source).not.toContain("BLOB_CHUNK_TOO_LARGE");
  });

  it("accepts 10,000 active Folders and rejects 10,001", () => {
    const folders = Array.from({ length: 10_001 }, (_, index) => {
      const id = `folder-${String(index).padStart(5, "0")}`;
      return folder({
        folderId: id,
        parentFolderId: null,
        name: id,
        path: `pages/${id}`,
      });
    });
    const manifest = canonicalTreeRevisionManifestV3({
      protocolVersion: "3",
      spaceId: "space-a",
      folders: folders.slice(0, 10_000).reverse(),
      pages: [],
      attachments: [],
    });
    expect(manifest.folders[0]?.folderId).toBe("folder-00000");
    expect(manifest.folders.at(-1)?.folderId).toBe("folder-09999");
    expect(() => canonicalTreeRevisionManifestV3({
      protocolVersion: "3",
      spaceId: "space-a",
      folders,
      pages: [],
      attachments: [],
    })).toThrow(/10,000 active Folders/iu);
  }, 10_000);

  it("accepts exactly 32 Folder levels and rejects level 33", () => {
    const nestedFolders = Array.from({ length: 33 }, (_, index) => {
      const folderId = `level-${String(index + 1).padStart(2, "0")}`;
      const segments = Array.from(
        { length: index + 1 },
        (_unused, segment) => `level-${String(segment + 1).padStart(2, "0")}`,
      );
      return folder({
        folderId,
        parentFolderId: index === 0 ? null : `level-${String(index).padStart(2, "0")}`,
        name: folderId,
        path: `pages/${segments.join("/")}`,
      });
    });
    const manifest = (folders: ReturnType<typeof folder>[]) => ({
      protocolVersion: "3" as const,
      spaceId: "space-a",
      folders,
      pages: [],
      attachments: [],
    });
    expect(canonicalTreeRevisionManifestV3(manifest(nestedFolders.slice(0, 32))).folders)
      .toHaveLength(32);
    expect(() => canonicalTreeRevisionManifestV3(manifest(nestedFolders)))
      .toThrow(/32 levels/iu);
  });

  it("fails closed for folder cycles and missing parents", () => {
    const manifest = (folders: ReturnType<typeof folder>[]) => ({
      protocolVersion: "3" as const,
      spaceId: "space-a",
      folders,
      pages: [],
      attachments: [],
    });
    expect(() => canonicalTreeRevisionManifestV3(manifest([
      folder({ folderId: "a", parentFolderId: "b", path: "pages/a" }),
      folder({ folderId: "b", parentFolderId: "a", path: "pages/b" }),
    ]))).toThrow(/cycle/iu);
    expect(() => canonicalTreeRevisionManifestV3(manifest([
      folder({ folderId: "a", parentFolderId: "missing", path: "pages/a" }),
    ]))).toThrow(/unknown parent/iu);
  });

  it("enforces the complete Folder and Page placement invariants", () => {
    const manifest = (folders: ReturnType<typeof folder>[], pages: ReturnType<typeof page>[] = []) => ({
      protocolVersion: "3" as const,
      spaceId: "space-a",
      folders,
      pages,
      attachments: [],
    });
    expect(() => canonicalTreeRevisionManifestV3(manifest([
      folder({ folderId: "duplicate", name: "first", path: "pages/first" }),
      folder({ folderId: "duplicate", name: "second", path: "pages/second" }),
    ]))).toThrow(/duplicate IDs/iu);
    expect(() => canonicalTreeRevisionManifestV3(manifest([
      folder({ folderId: "a", name: "same", path: "pages/same" }),
      folder({ folderId: "b", name: "same", path: "pages/same" }),
    ]))).toThrow(/folder path/iu);
    expect(() => canonicalTreeRevisionManifestV3(manifest([
      folder({ folderId: "parent", name: "parent", path: "pages/parent" }),
      folder({ folderId: "child", parentFolderId: "parent", name: "child", path: "pages/wrong/child" }),
    ]))).toThrow(/parent path/iu);
    expect(() => canonicalTreeRevisionManifestV3(manifest([
      folder({ folderId: "a", name: "wrong", path: "pages/actual" }),
    ]))).toThrow(/folder name/iu);
    expect(() => canonicalTreeRevisionManifestV3(manifest([
      folder({ folderId: "a", name: "a.md", path: "pages/a.md" }),
    ], [page({ pageId: "page-a", folderId: null, path: "pages/a.md", referencedAttachmentIds: [] })])))
      .toThrow(/folder and page paths/iu);
    expect(() => canonicalTreeRevisionManifestV3(manifest([
      folder({ folderId: "a", name: "a", path: "pages/a" }),
    ], [page({ pageId: "page-a", folderId: "a", path: "pages/wrong.md", referencedAttachmentIds: [] })])))
      .toThrow(/page folder path/iu);
    expect(() => canonicalTreeRevisionManifestV3(manifest([], [
      page({ pageId: "page-a", folderId: null, path: "pages/nested/a.md", referencedAttachmentIds: [] }),
    ]))).toThrow(/root page path/iu);
    expect(() => canonicalTreeRevisionManifestV3(manifest([], [
      page({ pageId: "page-a", folderId: null, path: "pages/same.md", referencedAttachmentIds: [] }),
      page({ pageId: "page-b", folderId: null, path: "pages/same.md", referencedAttachmentIds: [] }),
    ]))).toThrow(/duplicate paths/iu);
  });
});
