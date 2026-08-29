/**
 * Prisma models expose BigInt columns (for example Space.contentTreeRevision).
 * JSON.stringify throws on BigInt, so any controller returning a raw entity
 * would fail with a 500. The wire format for BigInt values elsewhere in the
 * API is a decimal string (see decimalTreeRevision), so serialize them the
 * same way globally.
 */
export function installBigIntJsonSerialization(target: typeof globalThis = globalThis): void {
  const prototype = target.BigInt?.prototype as (BigInt & { toJSON?: unknown }) | undefined;
  if (!prototype || typeof prototype.toJSON === 'function') return;
  Object.defineProperty(prototype, 'toJSON', {
    value: function toJSON(this: bigint): string {
      return this.toString();
    },
    enumerable: false,
    writable: true,
    configurable: true,
  });
}
