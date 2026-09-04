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

console.log("Sync v3 ESM/CJS build parity: 5 digests and 8 error codes match");
