import { describe, expect, it } from "vitest";
import {
  batchHash,
  canonicalBytes,
  confirmationHash,
  contentHash,
  pathKey,
} from "./index.js";

// Contract 3.5 fixtures, asserted through the built public entry point so the
// exact ESM surface (not internal helpers) is what is verified.
describe("contract 3.5 fixtures via public entry", () => {
  it("reproduces content, confirmation, batch hash and byte count", async () => {
    expect(await contentHash("Hello\n")).toBe(
      "66a045b452102c59d840ec097d59d9467e13a3f34f6494e539ffd32c1bb35f18",
    );

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
    const hash = await batchHash(batch);
    expect(hash).toBe(
      "a2a748fe94c9c1d63c26bf35d4a50e32d085e352033f4f52126cb80545f25276",
    );
    expect(canonicalBytes({ ...batch, batchHash: hash }).byteLength).toBe(428);

    expect(pathKey("Straße/İ.MD")).toBe("strasse/i\u0307.md");
  });
});
