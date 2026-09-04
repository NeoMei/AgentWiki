import { createHash } from 'node:crypto';
import { constants, type Stats } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { extname } from 'node:path';
import { Worker } from 'node:worker_threads';
import type * as FileType from 'file-type';
import type { AttachmentConfig } from './attachment.config';

const MAX_FILENAME_CODE_POINTS = 200;
const MAX_FILENAME_UTF8_BYTES = 512;
const MAX_IMAGE_HEADER_BYTES = 512 * 1024;

const MIME_BY_EXTENSION = new Map<string, PreparedAttachment['mimeType']>([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.gif', 'image/gif'],
]);

const ALLOWED_MIME_TYPES = new Set<PreparedAttachment['mimeType']>(
  MIME_BY_EXTENSION.values(),
);

type DetectedFileType = Awaited<ReturnType<typeof FileType.fileTypeFromFile>>;

export class AttachmentValidationError extends Error {
  readonly code = 'ATTACHMENT_INPUT_INVALID';

  constructor(message: string) {
    super(message);
    this.name = 'AttachmentValidationError';
  }
}

function errorWithCause(message: string, cause: unknown): Error {
  const error = new Error(message) as Error & { cause?: unknown };
  error.cause = cause;
  return error;
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}

async function detectFileTypeInJest(path: string): Promise<DetectedFileType> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      `
        const { parentPort, workerData } = require('node:worker_threads');
        import('file-type')
          .then(({ fileTypeFromFile }) => fileTypeFromFile(workerData))
          .then(
            (result) => parentPort.postMessage({ result }),
            (error) => parentPort.postMessage({ error: error?.message || String(error) }),
          );
      `,
      { eval: true, workerData: path },
    );
    let settled = false;
    worker.once('message', (message: { result?: DetectedFileType; error?: string }) => {
      settled = true;
      if (message.error) {
        reject(new Error(message.error));
      } else {
        resolve(message.result);
      }
    });
    worker.once('error', (error) => {
      settled = true;
      reject(error);
    });
    worker.once('exit', (code) => {
      if (!settled) {
        reject(new Error(`file-type worker exited with code ${code}`));
      }
    });
  });
}

function hasUnsafeFilenameCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    if (
      character === '/' ||
      character === '\\' ||
      codePoint <= 0x1f ||
      (codePoint >= 0x7f && codePoint <= 0x9f)
    ) {
      return true;
    }
  }
  return false;
}

async function detectFileType(path: string): Promise<DetectedFileType> {
  if (process.env.JEST_WORKER_ID) {
    return detectFileTypeInJest(path);
  }
  const { fileTypeFromFile } = await import('file-type');
  return fileTypeFromFile(path);
}

export interface PreparedAttachment {
  displayName: string;
  nameKey: string;
  contentHash: string;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';
  sizeBytes: bigint;
  width: number;
  height: number;
  tempPath: string;
}

function validateFilename(originalName: string): { displayName: string; nameKey: string } {
  const displayName = originalName.normalize('NFC');
  if (
    displayName.length === 0 ||
    displayName === '.' ||
    displayName === '..' ||
    hasUnsafeFilenameCharacter(displayName)
  ) {
    throw new AttachmentValidationError('Attachment filename is unsafe');
  }
  if ([...displayName].length > MAX_FILENAME_CODE_POINTS) {
    throw new AttachmentValidationError('Attachment filename exceeds 200 Unicode code points');
  }
  if (Buffer.byteLength(displayName, 'utf8') > MAX_FILENAME_UTF8_BYTES) {
    throw new AttachmentValidationError('Attachment filename exceeds 512 UTF-8 bytes');
  }
  return { displayName, nameKey: displayName.toLocaleLowerCase('und') };
}

function sameFile(
  opened: Stats,
  current: Stats,
): boolean {
  return (
    opened.dev === current.dev &&
    opened.ino === current.ino &&
    opened.size === current.size &&
    opened.mtimeMs === current.mtimeMs &&
    opened.ctimeMs === current.ctimeMs
  );
}

interface ImageDimensions {
  width: number;
  height: number;
}

function parsePngDimensions(header: Buffer): ImageDimensions {
  const signature = Buffer.from('89504e470d0a1a0a', 'hex');
  if (
    header.length < 24
    || !header.subarray(0, signature.length).equals(signature)
    || header.readUInt32BE(8) !== 13
    || header.toString('ascii', 12, 16) !== 'IHDR'
  ) {
    throw new Error('Invalid PNG header');
  }
  return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
}

function parseGifDimensions(header: Buffer): ImageDimensions {
  if (
    header.length < 10
    || !['GIF87a', 'GIF89a'].includes(header.toString('ascii', 0, 6))
  ) {
    throw new Error('Invalid GIF header');
  }
  return { width: header.readUInt16LE(6), height: header.readUInt16LE(8) };
}

function isJpegStartOfFrame(marker: number): boolean {
  return (
    marker >= 0xc0
    && marker <= 0xcf
    && ![0xc4, 0xc8, 0xcc].includes(marker)
  );
}

function parseJpegDimensions(header: Buffer): ImageDimensions {
  if (header.length < 4 || header[0] !== 0xff || header[1] !== 0xd8) {
    throw new Error('Invalid JPEG header');
  }

  let offset = 2;
  while (offset < header.length) {
    while (offset < header.length && header[offset] === 0xff) offset += 1;
    if (offset >= header.length) break;

    const marker = header[offset];
    offset += 1;
    if (marker === 0x00) throw new Error('Invalid JPEG marker');
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > header.length) break;

    const segmentLength = header.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > header.length) {
      throw new Error('Invalid JPEG segment');
    }
    if (isJpegStartOfFrame(marker)) {
      if (segmentLength < 7) throw new Error('Invalid JPEG frame');
      return {
        height: header.readUInt16BE(offset + 3),
        width: header.readUInt16BE(offset + 5),
      };
    }
    offset += segmentLength;
  }
  throw new Error('JPEG dimensions were not found');
}

function parseWebpDimensions(header: Buffer): ImageDimensions {
  if (
    header.length < 20
    || header.toString('ascii', 0, 4) !== 'RIFF'
    || header.toString('ascii', 8, 12) !== 'WEBP'
  ) {
    throw new Error('Invalid WebP header');
  }

  let offset = 12;
  while (offset + 8 <= header.length) {
    const chunkType = header.toString('ascii', offset, offset + 4);
    const chunkLength = header.readUInt32LE(offset + 4);
    const dataOffset = offset + 8;
    const dataEnd = dataOffset + chunkLength;
    if (dataEnd > header.length) throw new Error('Invalid WebP chunk');

    if (chunkType === 'VP8X') {
      if (chunkLength < 10) throw new Error('Invalid extended WebP header');
      return {
        width: header.readUIntLE(dataOffset + 4, 3) + 1,
        height: header.readUIntLE(dataOffset + 7, 3) + 1,
      };
    }
    if (chunkType === 'VP8 ') {
      if (
        chunkLength < 10
        || header[dataOffset + 3] !== 0x9d
        || header[dataOffset + 4] !== 0x01
        || header[dataOffset + 5] !== 0x2a
      ) {
        throw new Error('Invalid lossy WebP header');
      }
      return {
        width: header.readUInt16LE(dataOffset + 6) & 0x3fff,
        height: header.readUInt16LE(dataOffset + 8) & 0x3fff,
      };
    }
    if (chunkType === 'VP8L') {
      if (chunkLength < 5 || header[dataOffset] !== 0x2f) {
        throw new Error('Invalid lossless WebP header');
      }
      const dimensions = header.readUInt32LE(dataOffset + 1);
      return {
        width: (dimensions & 0x3fff) + 1,
        height: ((dimensions >>> 14) & 0x3fff) + 1,
      };
    }

    offset = dataEnd + (chunkLength % 2);
  }
  throw new Error('WebP dimensions were not found');
}

function parseImageDimensions(
  header: Buffer,
  mimeType: PreparedAttachment['mimeType'],
): ImageDimensions {
  switch (mimeType) {
    case 'image/png':
      return parsePngDimensions(header);
    case 'image/jpeg':
      return parseJpegDimensions(header);
    case 'image/webp':
      return parseWebpDimensions(header);
    case 'image/gif':
      return parseGifDimensions(header);
  }
}

export async function validateUploadedImage(
  file: Express.Multer.File,
  config: AttachmentConfig,
): Promise<PreparedAttachment> {
  const { displayName, nameKey } = validateFilename(file.originalname);
  const expectedMime = MIME_BY_EXTENSION.get(extname(displayName).toLowerCase());
  if (!expectedMime || file.mimetype !== expectedMime) {
    throw new AttachmentValidationError('Unsupported attachment image type or MIME disagreement');
  }

  let handle;
  try {
    handle = await open(file.path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    if (isNodeError(error, 'ELOOP')) {
      throw errorWithCause('Attachment temp path must not be a symbolic link', error);
    }
    throw error;
  }

  try {
    const openedMetadata = await handle.stat();
    if (!openedMetadata.isFile()) {
      throw new Error('Attachment temp path must be a regular file');
    }

    const hash = createHash('sha256');
    let sizeBytes = 0n;
    const stream = handle.createReadStream({ autoClose: false, start: 0 });
    for await (const chunk of stream) {
      const bytes = chunk as Buffer;
      sizeBytes += BigInt(bytes.length);
      if (sizeBytes > config.maxFileBytes) {
        stream.destroy();
        throw new AttachmentValidationError(
          `Attachment exceeds the ${config.maxFileBytes.toString()} byte limit`,
        );
      }
      hash.update(bytes);
    }
    if (sizeBytes === 0n) {
      throw new AttachmentValidationError('Attachment image is empty');
    }

    const detected = await detectFileType(file.path);
    if (
      !detected ||
      !ALLOWED_MIME_TYPES.has(detected.mime as PreparedAttachment['mimeType']) ||
      detected.mime !== expectedMime
    ) {
      throw new AttachmentValidationError(
        'Attachment image detected MIME type does not agree with its extension',
      );
    }

    const headerLength = Math.min(openedMetadata.size, MAX_IMAGE_HEADER_BYTES);
    const header = Buffer.alloc(headerLength);
    const { bytesRead } = await handle.read(header, 0, headerLength, 0);
    let dimensions: ImageDimensions;
    try {
      dimensions = parseImageDimensions(header.subarray(0, bytesRead), expectedMime);
    } catch {
      throw new AttachmentValidationError(
        'Attachment image header is malformed or exceeds the bounded header read',
      );
    }
    const { width, height } = dimensions;
    if (
      !Number.isSafeInteger(width) ||
      !Number.isSafeInteger(height) ||
      width === undefined ||
      height === undefined ||
      width <= 0 ||
      height <= 0
    ) {
      throw new AttachmentValidationError('Attachment image dimensions are invalid');
    }
    if (width > config.maxDimension || height > config.maxDimension) {
      throw new AttachmentValidationError(
        `Attachment image dimension exceeds ${config.maxDimension} pixels`,
      );
    }
    if (BigInt(width) * BigInt(height) > config.maxPixels) {
      throw new AttachmentValidationError(
        `Attachment image pixel count exceeds ${config.maxPixels.toString()}`,
      );
    }

    const currentMetadata = await lstat(file.path);
    if (!currentMetadata.isFile() || currentMetadata.isSymbolicLink() || !sameFile(openedMetadata, currentMetadata)) {
      throw new Error('Attachment temp file changed during validation');
    }

    return {
      displayName,
      nameKey,
      contentHash: hash.digest('hex'),
      mimeType: expectedMime,
      sizeBytes,
      width,
      height,
      tempPath: file.path,
    };
  } finally {
    await handle.close();
  }
}
