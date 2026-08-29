import { installBigIntJsonSerialization } from './bigint-json';

describe('installBigIntJsonSerialization', () => {
  it('serializes BigInt values as decimal strings', () => {
    installBigIntJsonSerialization();
    expect(JSON.stringify({ revision: 42n })).toBe('{"revision":"42"}');
    expect(JSON.parse(JSON.stringify({ revision: 0n })).revision).toBe('0');
  });

  it('is idempotent', () => {
    installBigIntJsonSerialization();
    const first = (BigInt.prototype as unknown as { toJSON: unknown }).toJSON;
    installBigIntJsonSerialization();
    expect((BigInt.prototype as unknown as { toJSON: unknown }).toJSON).toBe(first);
    expect(JSON.stringify({ revision: 7n })).toBe('{"revision":"7"}');
  });
});
