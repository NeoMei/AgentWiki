import { canonicalBytes, comparePushChanges } from "./canonical.js";
import type {
  PushBatchWithoutHash,
  PushConfirmationManifest,
  RevisionContentManifest,
} from "./types.js";

const encoder = new TextEncoder();

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const input = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const digest = await crypto.subtle.digest("SHA-256", input);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function contentHash(body: string): Promise<string> {
  return sha256Hex(encoder.encode(body.replace(/\r\n?/g, "\n")));
}

export async function confirmationHash(
  manifest: PushConfirmationManifest,
): Promise<string> {
  return sha256Hex(
    canonicalBytes({
      ...manifest,
      changes: [...manifest.changes].sort(comparePushChanges),
    }),
  );
}

export async function batchHash(batch: PushBatchWithoutHash): Promise<string> {
  return sha256Hex(
    canonicalBytes({
      ...batch,
      changes: [...batch.changes].sort(comparePushChanges),
    }),
  );
}

export async function revisionContentHash(
  manifest: RevisionContentManifest,
): Promise<string> {
  if (manifest.pages.length === 0) return sha256Hex(new Uint8Array());
  return sha256Hex(
    canonicalBytes({
      ...manifest,
      pages: [...manifest.pages].sort((a, b) =>
        a.pageId < b.pageId ? -1 : a.pageId > b.pageId ? 1 : 0,
      ),
    }),
  );
}

export async function capabilitiesHash(capabilities: object): Promise<string> {
  return sha256Hex(canonicalBytes(capabilities));
}

/**
 * Returns SHA-256 lowercase hex of the UTF-8 bytes of a validated ID.
 * Used to derive a safe local control-file name without changing the ID.
 */
export async function idFileKey(id: string): Promise<string> {
  return sha256Hex(encoder.encode(id));
}

/**
 * Computes the requestHash for an exchange request: the canonical bytes of
 * the request with `code` removed and `credential` replaced by the SHA-256
 * of its raw bytes. The plaintext credential must never reach general logs.
 */
export async function exchangeRequestHash(
  request: ExchangeObsidianCredentialRequest,
): Promise<string> {
  const { code: _code, credential, ...rest } = request;
  const credentialHash = await sha256Hex(encoder.encode(credential));
  return sha256Hex(canonicalBytes({ ...rest, credential: credentialHash }));
}
import type { ExchangeObsidianCredentialRequest } from "./types.js";
