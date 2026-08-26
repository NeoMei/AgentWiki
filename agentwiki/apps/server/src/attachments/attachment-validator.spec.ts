import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import type { AttachmentConfig } from './attachment.config';
import { validateUploadedImage } from './attachment-validator';

type MulterFile = Express.Multer.File;

const FIXTURES = {
  png: Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z3GAAAAAASUVORK5CYII=',
    'base64',
  ),
  jpeg: Buffer.from(
    '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAEf/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABAf/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPxB//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPxB//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxB//9k=',
    'base64',
  ),
  webp: Buffer.from(
    'UklGRkoAAABXRUJQVlA4ID4AAADQAQCdASoBAAEAAUAmJQBOgCHwAP7/2J9P/7gPP//0f//X/9H/8V//x//R//9f/1f/8f/0f//X/9H/8V//x//R//9f/1c=',
    'base64',
  ),
  gif: Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64'),
};

const MIME = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
} as const;

const EXTENSION = { png: '.png', jpeg: '.jpg', webp: '.webp', gif: '.gif' } as const;
const roots = new Set<string>();

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'agentwiki-attachment-test-'));
  roots.add(root);
  return root;
}

function config(storagePath: string, overrides: Partial<AttachmentConfig> = {}): AttachmentConfig {
  return {
    storagePath,
    maxFileBytes: 10n * 1024n * 1024n,
    maxSpaceBytes: 500n * 1024n * 1024n,
    maxDimension: 10_000,
    maxPixels: 40_000_000n,
    minFreeBytes: 1n,
    retentionMs: 30 * 24 * 60 * 60 * 1000,
    orphanGraceMs: 24 * 60 * 60 * 1000,
    ...overrides,
  };
}

async function uploadedFile(
  root: string,
  originalname: string,
  mimetype: string,
  bytes: Buffer,
): Promise<MulterFile> {
  const path = join(root, `upload-${Math.random().toString(16).slice(2)}${extname(originalname)}`);
  await writeFile(path, bytes, { mode: 0o600 });
  return {
    fieldname: 'file',
    originalname,
    encoding: '7bit',
    mimetype,
    size: bytes.length,
    destination: root,
    filename: originalname,
    path,
    buffer: Buffer.alloc(0),
    stream: undefined as never,
  };
}

function pngWithDimensions(width: number, height: number): Buffer {
  const png = Buffer.from(FIXTURES.png);
  png.writeUInt32BE(width, 16);
  png.writeUInt32BE(height, 20);
  return png;
}

describe('validateUploadedImage', () => {
  afterEach(async () => {
    for (const root of roots) {
      await rm(root, { recursive: true, force: true });
      roots.delete(root);
    }
  });

  it.each(Object.keys(FIXTURES) as Array<keyof typeof FIXTURES>)(
    'accepts a valid %s fixture',
    async (kind) => {
      const root = await makeRoot();
      const filename = `Photo${EXTENSION[kind]}`;
      const file = await uploadedFile(root, filename, MIME[kind], FIXTURES[kind]);

      const prepared = await validateUploadedImage(file, config(root));

      expect(prepared).toMatchObject({
        displayName: filename,
        nameKey: filename.toLowerCase(),
        mimeType: MIME[kind],
        sizeBytes: BigInt(FIXTURES[kind].length),
        width: 1,
        height: 1,
        tempPath: file.path,
      });
      expect(prepared.contentHash).toMatch(/^[0-9a-f]{64}$/);
    },
  );

  it('normalizes a filename to NFC for display and key identity', async () => {
    const root = await makeRoot();
    const file = await uploadedFile(root, 'Cafe\u0301.PNG', 'image/png', FIXTURES.png);

    const prepared = await validateUploadedImage(file, config(root));

    expect(prepared.displayName).toBe('Café.PNG');
    expect(prepared.nameKey).toBe('café.png');
  });

  it.each([
    '../photo.png',
    '..\\photo.png',
    'folder/photo.png',
    'folder\\photo.png',
    'bad\u0000name.png',
    '.',
    '..',
    '',
  ])('rejects an unsafe filename %j', async (originalname) => {
    const root = await makeRoot();
    const file = await uploadedFile(root, originalname || 'placeholder.png', 'image/png', FIXTURES.png);
    file.originalname = originalname;

    await expect(validateUploadedImage(file, config(root))).rejects.toThrow('filename');
  });

  it('rejects names over 200 Unicode code points', async () => {
    const root = await makeRoot();
    const file = await uploadedFile(root, `${'😀'.repeat(197)}.png`, 'image/png', FIXTURES.png);

    await expect(validateUploadedImage(file, config(root))).rejects.toThrow('200');
  });

  it('rejects names over 512 UTF-8 bytes even when they fit the code-point limit', async () => {
    const root = await makeRoot();
    const file = await uploadedFile(root, `${'😀'.repeat(128)}.png`, 'image/png', FIXTURES.png);

    await expect(validateUploadedImage(file, config(root))).rejects.toThrow('512');
  });

  it('rejects extension, declared MIME, and detected magic disagreement', async () => {
    const root = await makeRoot();
    const wrongExtension = await uploadedFile(root, 'photo.jpg', 'image/png', FIXTURES.png);
    const wrongDeclaredMime = await uploadedFile(root, 'photo.png', 'image/jpeg', FIXTURES.png);
    const wrongMagic = await uploadedFile(root, 'photo.png', 'image/png', FIXTURES.jpeg);

    await expect(validateUploadedImage(wrongExtension, config(root))).rejects.toThrow('MIME');
    await expect(validateUploadedImage(wrongDeclaredMime, config(root))).rejects.toThrow('MIME');
    await expect(validateUploadedImage(wrongMagic, config(root))).rejects.toThrow('MIME');
  });

  it('rejects SVG even when its declared MIME and extension agree', async () => {
    const root = await makeRoot();
    const file = await uploadedFile(
      root,
      'image.svg',
      'image/svg+xml',
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
    );

    await expect(validateUploadedImage(file, config(root))).rejects.toThrow('image');
  });

  it('accepts exactly 10 MiB and rejects 10 MiB plus one byte based on streamed bytes', async () => {
    const root = await makeRoot();
    const exact = Buffer.concat([
      FIXTURES.png,
      Buffer.alloc(10 * 1024 * 1024 - FIXTURES.png.length),
    ]);
    const over = Buffer.concat([exact, Buffer.from([0])]);
    const exactFile = await uploadedFile(root, 'exact.png', 'image/png', exact);
    const overFile = await uploadedFile(root, 'over.png', 'image/png', over);
    exactFile.size = 1;
    overFile.size = 1;

    await expect(validateUploadedImage(exactFile, config(root))).resolves.toMatchObject({
      sizeBytes: 10n * 1024n * 1024n,
    });
    await expect(validateUploadedImage(overFile, config(root))).rejects.toThrow('10');
  });

  it('rejects a 10,001 px dimension at the exact default boundary', async () => {
    const root = await makeRoot();
    const file = await uploadedFile(
      root,
      'wide.png',
      'image/png',
      pngWithDimensions(10_001, 1),
    );

    await expect(validateUploadedImage(file, config(root))).rejects.toThrow('dimension');
  });

  it('rejects exactly 40,000,001 pixels', async () => {
    const root = await makeRoot();
    const file = await uploadedFile(
      root,
      'pixels.png',
      'image/png',
      pngWithDimensions(40_000_001, 1),
    );

    await expect(
      validateUploadedImage(file, config(root, { maxDimension: 50_000_000 })),
    ).rejects.toThrow('pixel');
  });

  it('rejects malformed and truncated image headers without unbounded reads', async () => {
    const root = await makeRoot();
    const file = await uploadedFile(
      root,
      'broken.png',
      'image/png',
      Buffer.from('89504e470d0a1a0a', 'hex'),
    );

    await expect(validateUploadedImage(file, config(root))).rejects.toThrow('image');
  });
});
