import { describe, expect, it } from "vitest";
import { canonicalBytes } from "./canonical.js";
import {
  batchHash,
  confirmationHash,
  contentHash,
  idFileKey,
  pathKey,
  sha256Hex,
} from "./index.js";

const encoder = new TextEncoder();

describe("contract 3.5 fixed fixtures", () => {
  it("contentHash of Hello newline", async () => {
    expect(await contentHash("Hello\n")).toBe(
      "66a045b452102c59d840ec097d59d9467e13a3f34f6494e539ffd32c1bb35f18",
    );
  });

  it("confirmationHash canonical manifest", async () => {
    const manifest = {
      baseRevision: "rev-7",
      changes: [
        {
          contentHash:
            "66a045b452102c59d840ec097d59d9467e13a3f34f6494e539ffd32c1bb35f18",
          operation: "upsert" as const,
          pageId: "11111111-1111-4111-8111-111111111111",
          path: "Guide.md",
          title: "Guide",
        },
        {
          operation: "archive" as const,
          pageId: "22222222-2222-4222-8222-222222222222",
          previousPath: "Old.md",
        },
      ],
      protocolVersion: "1" as const,
      spaceId: "space-a",
    };
    expect(await confirmationHash(manifest)).toBe(
      "212c1be142dfc093c9c8974080b7f0b9b8ae956c137284fd58a8db1248e4a3d5",
    );
  });

  it("batchHash batch 0 without hash", async () => {
    const batch = {
      protocolVersion: "1" as const,
      batchIndex: 0,
      changes: [
        {
          operation: "upsert" as const,
          pageId: "11111111-1111-4111-8111-111111111111",
          path: "Guide.md",
          title: "Guide",
          body: "Hello\n",
          contentHash:
            "66a045b452102c59d840ec097d59d9467e13a3f34f6494e539ffd32c1bb35f18",
        },
        {
          operation: "archive" as const,
          pageId: "22222222-2222-4222-8222-222222222222",
          previousPath: "Old.md",
        },
      ],
    };
    expect(await batchHash(batch)).toBe(
      "a2a748fe94c9c1d63c26bf35d4a50e32d085e352033f4f52126cb80545f25276",
    );
  });

  it("maxBatchBytes counts 428", async () => {
    const withoutHash = {
      protocolVersion: "1" as const,
      batchIndex: 0,
      changes: [
        {
          operation: "upsert" as const,
          pageId: "11111111-1111-4111-8111-111111111111",
          path: "Guide.md",
          title: "Guide",
          body: "Hello\n",
          contentHash:
            "66a045b452102c59d840ec097d59d9467e13a3f34f6494e539ffd32c1bb35f18",
        },
        {
          operation: "archive" as const,
          pageId: "22222222-2222-4222-8222-222222222222",
          previousPath: "Old.md",
        },
      ],
    };
    const hash = await batchHash(withoutHash);
    const full = { ...withoutHash, batchHash: hash };
    expect(canonicalBytes(full).byteLength).toBe(428);
  });

  it("pathKey fixture", () => {
    expect(pathKey("Straße/İ.MD")).toBe("strasse/i\u0307.md");
  });

  it("idFileKey is stable sha256 of UTF-8 bytes", async () => {
    expect(await idFileKey("Abc")).toBe(await sha256Hex(encoder.encode("Abc")));
    expect(await idFileKey("Abc")).not.toBe(await idFileKey("abc"));
  });
});
