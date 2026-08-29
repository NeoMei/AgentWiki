import { describe, expect, it } from "vitest";
import {
  CreateTreePushSessionRequestV2Schema,
  SYNC_PROTOCOL_V2,
  TREE_SYNC_V2_LIMITS,
  TreeDeltaPageV2Schema,
  TreeCapabilitiesResponseV2Schema,
  TreePushBatchV2Schema,
  TreeRevisionContentManifestV2Schema,
  TreeSnapshotPageV2Schema,
  canonicalTreeRevisionManifestV2,
  partitionTreePushChangesV2,
  treeRevisionDeltaV2,
  treeBatchHashV2,
  treeConfirmationHashV2,
  treeRevisionContentHashV2,
} from "./index.js";

const hash = "a".repeat(64);
const timestamp = "2026-08-28T00:00:00.000Z";
const folder = (overrides: Record<string, unknown> = {}) => ({
  folderId: "folder-a",
  parentFolderId: null,
  name: "项目",
  path: "pages/项目",
  sortOrder: 0,
  updatedAt: timestamp,
  ...overrides,
});
const page = (overrides: Record<string, unknown> = {}) => ({
  pageId: "page-a",
  folderId: "folder-a",
  path: "pages/项目/介绍.md",
  title: "介绍",
  body: "# 介绍\n",
  contentHash: hash,
  updatedAt: timestamp,
  ...overrides,
});

describe("Sync Protocol v2", () => {
  it("strictly validates negotiated v2 capabilities and their binding hash", () => {
    const capabilities = {
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
      maxResponseBytes: 4_194_304,
      maxPageItems: 100,
      pushSessionTtlSeconds: 900,
    };
    expect(TreeCapabilitiesResponseV2Schema.parse({
      protocolVersion: "2", capabilities, capabilitiesHash: hash,
    })).toEqual({ protocolVersion: "2", capabilities, capabilitiesHash: hash });
    expect(() => TreeCapabilitiesResponseV2Schema.parse({
      protocolVersion: "2", capabilities, capabilitiesHash: hash, unexpected: true,
    })).toThrow();
    const { maxSnapshotObjects: _missing, ...incomplete } = capabilities;
    expect(() => TreeCapabilitiesResponseV2Schema.parse({
      protocolVersion: "2", capabilities: incomplete, capabilitiesHash: hash,
    })).toThrow();
  });

  it("uses strict v2 envelopes and validates Folder and Page paths independently", () => {
    expect(TreePushBatchV2Schema.parse({
      protocolVersion: SYNC_PROTOCOL_V2,
      batchIndex: 0,
      changes: [
        { operation: "upsert_folder", folder: folder() },
        { operation: "upsert_page", page: page() },
      ],
      batchHash: hash,
    }).protocolVersion).toBe("2");
    expect(() => TreePushBatchV2Schema.parse({
      protocolVersion: "1", batchIndex: 0, changes: [], batchHash: hash,
    })).toThrow();
    expect(() => TreePushBatchV2Schema.parse({
      protocolVersion: "2", batchIndex: 0, changes: [{ operation: "upsert_folder", folder: { ...folder(), path: "pages/项目.md" } }], batchHash: hash,
      unexpected: true,
    })).toThrow();
  });

  it("rejects paths outside the managed pages directory", () => {
    const batch = (changes: unknown[]) => ({
      protocolVersion: "2",
      batchIndex: 0,
      changes,
      batchHash: hash,
    });
    expect(() => TreePushBatchV2Schema.parse(batch([
      { operation: "upsert_folder", folder: folder({ path: "outside/folder" }) },
    ]))).toThrow(/pages/);
    expect(() => TreePushBatchV2Schema.parse(batch([
      { operation: "upsert_page", page: page({ path: "outside.md" }) },
    ]))).toThrow(/pages/);
    expect(() => TreePushBatchV2Schema.parse(batch([
      { operation: "archive_folder", folderId: "folder-a", previousPath: "outside/folder" },
    ]))).toThrow(/pages/);
    expect(() => TreePushBatchV2Schema.parse(batch([
      { operation: "upsert_folder", folder: folder({ path: "pages" }) },
    ]))).toThrow(/pages/);
  });

  it("orders revision manifests with parents before children and Pages by path key then ID", async () => {
    const manifest = canonicalTreeRevisionManifestV2({
      protocolVersion: "2",
      spaceId: "space-a",
      folders: [
        folder({ folderId: "child", parentFolderId: "root", path: "pages/root/child", name: "child" }),
        folder({ folderId: "root", path: "pages/root", name: "root" }),
      ],
      pages: [
        page({ pageId: "page-b", path: "pages/root/Z.md" }),
        page({ pageId: "page-a", path: "pages/root/a.md" }),
      ],
    });
    expect(manifest.folders.map((item) => item.folderId)).toEqual(["root", "child"]);
    expect(manifest.pages.map((item) => item.pageId)).toEqual(["page-a", "page-b"]);
    expect(await treeRevisionContentHashV2(manifest)).toBe(
      await treeRevisionContentHashV2({ ...manifest, folders: [...manifest.folders].reverse(), pages: [...manifest.pages].reverse() }),
    );
  });

  it("derives the one canonical tree delta from parent and current immutable manifests", () => {
    const parent = canonicalTreeRevisionManifestV2({
      protocolVersion: "2",
      spaceId: "space-a",
      folders: [
        folder({ folderId: "root", path: "pages/root", name: "root" }),
        folder({ folderId: "removed", parentFolderId: "root", path: "pages/root/removed", name: "removed" }),
      ],
      pages: [
        page({ pageId: "removed-page", folderId: "removed", path: "pages/root/removed/old.md" }),
        page({ pageId: "unchanged", folderId: "root", path: "pages/root/same.md" }),
      ],
    });
    const current = canonicalTreeRevisionManifestV2({
      protocolVersion: "2",
      spaceId: "space-a",
      folders: [
        folder({ folderId: "root", path: "pages/root", name: "root" }),
        folder({ folderId: "added", parentFolderId: "root", path: "pages/root/added", name: "added" }),
      ],
      pages: [
        page({ pageId: "unchanged", folderId: "root", path: "pages/root/same.md" }),
        page({ pageId: "added-page", folderId: "added", path: "pages/root/added/new.md" }),
      ],
    });

    expect(treeRevisionDeltaV2(parent, current)).toEqual([
      { operation: "archive_page", pageId: "removed-page", previousPath: "pages/root/removed/old.md" },
      { operation: "archive_folder", folderId: "removed", previousPath: "pages/root/removed" },
      { operation: "upsert_folder", folder: expect.objectContaining({ folderId: "added", parentFolderId: "root" }) },
      { operation: "upsert_page", page: expect.objectContaining({ pageId: "added-page", folderId: "added" }) },
    ]);
  });

  it("treats a non-v2 parent as an empty manifest and emits parent-first full upserts", () => {
    const current = canonicalTreeRevisionManifestV2({
      protocolVersion: "2",
      spaceId: "space-a",
      folders: [
        folder({ folderId: "child", parentFolderId: "root", path: "pages/root/child", name: "child" }),
        folder({ folderId: "root", path: "pages/root", name: "root" }),
      ],
      pages: [page({ folderId: "child", path: "pages/root/child/page.md" })],
    });

    expect(treeRevisionDeltaV2(null, current).map((item) => item.operation)).toEqual([
      "upsert_folder", "upsert_folder", "upsert_page",
    ]);
    expect(treeRevisionDeltaV2(null, current)[0]).toEqual(expect.objectContaining({
      folder: expect.objectContaining({ folderId: "root" }),
    }));
  });

  it("orders canonical path keys by Unicode code point rather than UTF-16 code unit", () => {
    const manifest = canonicalTreeRevisionManifestV2({
      protocolVersion: "2",
      spaceId: "space-a",
      folders: [],
      pages: [
        page({ pageId: "astral", folderId: null, path: "pages/\u{10000}.md" }),
        page({ pageId: "bmp", folderId: null, path: "pages/\uE000.md" }),
      ],
    });
    expect(manifest.pages.map((item) => item.pageId)).toEqual(["bmp", "astral"]);
  });

  it("hashes canonical Folder/Page confirmation and batches independent of input order", async () => {
    const changes = [
      { operation: "archive_page" as const, pageId: "page-a", previousPath: "pages/项目/旧.md" },
      { operation: "upsert_folder" as const, folder: folder() },
    ];
    const manifest = { protocolVersion: "2" as const, spaceId: "space-a", baseRevision: "rev-1", changes };
    expect(await treeConfirmationHashV2(manifest)).toBe(
      await treeConfirmationHashV2({ ...manifest, changes: [...changes].reverse() }),
    );
    const batch = { protocolVersion: "2" as const, batchIndex: 0, changes };
    expect(await treeBatchHashV2(batch)).toBe(
      await treeBatchHashV2({ ...batch, changes: [...changes].reverse() }),
    );
  });

  it("keeps tree push limits at 100 changes and document-tree input at 2 MiB", async () => {
    expect(TREE_SYNC_V2_LIMITS.maxPushChanges).toBe(100);
    expect(TREE_SYNC_V2_LIMITS.maxDocumentTreeBytes).toBe(2 * 1024 * 1024);
    await expect(partitionTreePushChangesV2(
      Array.from({ length: 101 }, (_, index) => ({ operation: "archive_folder" as const, folderId: `folder-${index}`, previousPath: `pages/folder-${index}` })),
      { maxBatchBytes: 1_000_000, maxBatchItems: 100, maxChangeCount: 100, maxPageBytes: 1_000_000 },
    )).rejects.toThrow("BATCH_TOO_LARGE");
    expect(() => CreateTreePushSessionRequestV2Schema.parse({
      protocolVersion: "2", baseRevision: "rev-1", idempotencyKey: "11111111-1111-4111-8111-111111111111", capabilitiesHash: hash,
      confirmationHash: hash, confirmationByteLength: 1, changeCount: 101, totalBodyBytes: 0,
    })).toThrow();
  });

  it("exposes strict snapshot and delta responses with separate object counts", () => {
    expect(TreeSnapshotPageV2Schema.parse({
      protocolVersion: "2", spaceId: "space-a", revision: "rev-1", sequence: 1, revisionContentHash: hash,
      folderCount: "1", pageCount: "1", revisionManifestByteLength: "1", revisionBodyBytes: "1",
      folders: [folder()], pages: [page()], nextCursor: null,
    }).folders).toHaveLength(1);
    expect(TreeDeltaPageV2Schema.parse({
      protocolVersion: "2", spaceId: "space-a", fromRevision: "rev-1", toRevision: "rev-2", toSequence: 2,
      toRevisionContentHash: hash, toFolderCount: "1", toPageCount: "1", toRevisionManifestByteLength: "1",
      toRevisionBodyBytes: "1", items: [{ operation: "archive_folder", folderId: "folder-a", previousPath: "pages/项目" }], nextCursor: null,
    }).items).toHaveLength(1);
  });

  it("accepts canonical revision manifests through their strict schema", () => {
    expect(TreeRevisionContentManifestV2Schema.parse({
      protocolVersion: "2", spaceId: "space-a", folders: [folder()], pages: [page()],
    }).folders[0]?.path).toBe("pages/项目");
  });
});
