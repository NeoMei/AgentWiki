import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const vector = JSON.parse(await readFile(join(packageRoot, "test-vectors/sync-v3.json"), "utf8"));
const esm = await import(pathToFileURL(join(packageRoot, "dist/esm/index.js")).href);
const require = createRequire(import.meta.url);
const cjs = require(join(packageRoot, "dist/cjs/index.js"));
const blobBytes = Uint8Array.from(Buffer.from(vector.blob.base64, "base64"));
const requirement = {
  contentHash: "a".repeat(64),
  sizeBytes: "4",
  mimeType: "image/png",
  width: 1,
  height: 1,
};
const createRequest = {
  protocolVersion: "3",
  baseRevision: "rev-1",
  idempotencyKey: "11111111-1111-4111-8111-111111111111",
  capabilitiesHash: "b".repeat(64),
  confirmationHash: "c".repeat(64),
  confirmationByteLength: 1,
  changeCount: 2,
  totalBodyBytes: 0,
  attachmentCount: 2,
  transferBlobBytes: 4,
  blobRequirements: [requirement],
};

async function digests(api) {
  return {
    revision: await api.treeRevisionContentHashV3(
      api.TreeRevisionContentManifestV3Schema.parse(vector.revision.input),
    ),
    delta: await api.treeRevisionDeltaHashV3(vector.delta.input),
    confirmation: await api.treeConfirmationHashV3(vector.confirmation.input),
    batch: await api.treeBatchHashV3(vector.batch.input),
    blob: await api.blobContentHashV3(blobBytes),
  };
}

const expected = Object.fromEntries(
  ["revision", "delta", "confirmation", "batch", "blob"].map((key) => [key, vector[key].expectedHash]),
);
const esmDigests = await digests(esm);
const cjsDigests = await digests(cjs);

assert.deepEqual(esmDigests, expected, "ESM digests must match the shared Sync v3 vector");
assert.deepEqual(cjsDigests, expected, "CJS digests must match the shared Sync v3 vector");
assert.deepEqual(esmDigests, cjsDigests, "ESM and CJS Sync v3 digests must be identical");
assert.deepEqual([...esm.SYNC_V3_ERROR_CODES], vector.errorCodes, "ESM error codes must match the shared vector");
assert.deepEqual([...cjs.SYNC_V3_ERROR_CODES], vector.errorCodes, "CJS error codes must match the shared vector");

for (const [name, api] of [["ESM", esm], ["CJS", cjs]]) {
  assert.deepEqual(
    api.BlobRequirementV3Schema.parse(requirement),
    requirement,
    `${name} must export the strict Blob requirement schema`,
  );
  assert.throws(
    () => api.BlobRequirementV3Schema.parse({
      ...requirement,
      path: "assets/photo.png",
    }),
    `${name} Blob requirement schema must reject attachment identity fields`,
  );
  assert.deepEqual(
    api.CreateTreePushSessionRequestV3Schema.parse(createRequest).blobRequirements,
    [requirement],
    `${name} create request must consume Blob requirements`,
  );
  assert.throws(
    () => api.CreateTreePushSessionRequestV3Schema.parse({
      ...createRequest,
      contentHashes: [requirement.contentHash],
    }),
    `${name} create request must reject the legacy contentHashes field`,
  );
  assert.throws(
    () => api.CreateTreePushSessionRequestV3Schema.parse({
      ...createRequest,
      transferBlobBytes: 3,
    }),
    `${name} create request must bind transferBlobBytes to requirement sizes`,
  );
}

console.log("Sync v3 ESM/CJS build parity: 5 digests, 8 error codes, and Blob requirements match");
