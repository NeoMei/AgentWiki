import { BadRequestException } from '@nestjs/common';
import { decodeUtf8Source, normalizeUploadFilename } from './source-upload';

describe('source upload boundaries', () => {
  it('repairs a UTF-8 filename decoded as Latin-1', () => {
    const mojibake = Buffer.from('图片内容总结.md', 'utf8').toString('latin1');
    expect(normalizeUploadFilename(mojibake)).toBe('图片内容总结.md');
  });

  it('preserves an already-correct filename', () => {
    expect(normalizeUploadFilename('图片内容总结.md')).toBe('图片内容总结.md');
  });

  it('rejects invalid UTF-8 instead of persisting replacement characters', () => {
    expect(() => decodeUtf8Source(Buffer.from([0xc3, 0x28]))).toThrow(BadRequestException);
  });
});
