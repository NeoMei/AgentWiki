import { createHash } from 'node:crypto';
import { constants, type Stats } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { extname } from 'node:path';
import { Worker } from 'node:worker_threads';
import type * as FileType from 'file-type';
import { imageSize } from 'image-size';
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
    let dimensions: ReturnType<typeof imageSize>;
    try {
      dimensions = imageSize(header.subarray(0, bytesRead));
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
