import type { ConfigService } from '@nestjs/config';
import { AttachmentRenamePreviewTokenService } from './attachment-rename-preview-token.service';

const payload = {
  spaceId: 'space-1',
  attachmentId: 'attachment-1',
  sourcePath: 'assets/Photo.png',
  targetPath: 'assets/Renamed.png',
  displayName: 'Renamed.png',
  attachmentUpdatedAt: '2026-09-05T00:00:00.000Z',
  contentTreeRevision: '7',
  head: { id: 'revision-7', hash: 'a'.repeat(64) },
  evidenceHash: 'b'.repeat(64),
};

function service(secret = 'shared-across-pods-test-pepper') {
  const config = {
    get: jest.fn((key: string) => key === 'AGENTWIKI_SERVER_PEPPER' ? secret : undefined),
  } as unknown as ConfigService;
  return new AttachmentRenamePreviewTokenService(config);
}

describe('AttachmentRenamePreviewTokenService', () => {
  beforeEach(() => jest.useFakeTimers({ now: new Date('2026-09-05T00:00:00.000Z') }));
  afterEach(() => jest.useRealTimers());

  it('round-trips exact rename evidence without embedding Markdown, storage keys, or the secret', () => {
    const token = service().encode(payload);
    expect(service().decode(token, 'space-1', 'attachment-1')).toMatchObject(payload);
    expect(token).not.toMatch(/secret markdown|storageKey|shared-across-pods-test-pepper/iu);
  });

  it('rejects tampering, cross-Space use, cross-attachment use, oversize, and expiry', () => {
    const tokens = service();
    const token = tokens.encode(payload);
    const tampered = `${token.slice(0, -1)}${token.endsWith('a') ? 'b' : 'a'}`;
    for (const [value, spaceId, attachmentId] of [
      [tampered, 'space-1', 'attachment-1'],
      [token, 'space-2', 'attachment-1'],
      [token, 'space-1', 'attachment-2'],
      ['x'.repeat(16_385), 'space-1', 'attachment-1'],
    ]) {
      expect(() => tokens.decode(value, spaceId, attachmentId)).toThrow();
    }
    jest.advanceTimersByTime(15 * 60 * 1_000 + 1);
    expect(() => tokens.decode(token, 'space-1', 'attachment-1')).toThrow();
  });

  it('uses a random nonce while keeping payload verification stable across pod instances', () => {
    const first = service();
    const tokenA = first.encode(payload);
    const tokenB = first.encode(payload);
    expect(tokenA).not.toBe(tokenB);
    expect(service().decode(tokenA, 'space-1', 'attachment-1')).toMatchObject(payload);
  });
});
