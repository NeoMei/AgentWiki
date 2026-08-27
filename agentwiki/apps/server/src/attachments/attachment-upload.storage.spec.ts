import { createReadStream } from 'node:fs';
import { access, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import type { Request } from 'express';
import type { AttachmentConfig } from './attachment.config';
import {
  AttachmentUploadStorage,
  PostgresAttachmentCapacityCoordinator,
} from './attachment-upload.storage';
import { LocalAttachmentStorage } from './local-attachment.storage';

type MulterFile = Express.Multer.File;

const roots = new Set<string>();

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'agentwiki-attachment-test-'));
  roots.add(root);
  return root;
}

function config(storagePath: string, maxFileBytes = 10n): AttachmentConfig {
  return {
    storagePath,
    maxFileBytes,
    maxSpaceBytes: 500n * 1024n * 1024n,
    maxDimension: 10_000,
    maxPixels: 40_000_000n,
    minFreeBytes: 1n,
    retentionMs: 30 * 24 * 60 * 60 * 1000,
    orphanGraceMs: 24 * 60 * 60 * 1000,
    contentLockTimeoutMs: 5_000,
  };
}

const immediateCapacity = {
  withLock: <T,>(work: () => Promise<T>) => work(),
};

function uploadFile(stream: Readable): MulterFile {
  return {
    fieldname: 'file',
    originalname: 'photo.png',
    encoding: '7bit',
    mimetype: 'image/png',
    size: 0,
    stream,
    destination: '',
    filename: '',
    path: '',
    buffer: Buffer.alloc(0),
  };
}

function handle(
  upload: AttachmentUploadStorage,
  file: MulterFile,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    upload._handleFile(
      {} as Request,
      file,
      (error: Error | null, info?: Partial<Express.Multer.File>) => {
      if (error) {
        reject(error);
      } else {
        resolve(info as unknown as Record<string, unknown>);
      }
      },
    );
  });
}

function remove(upload: AttachmentUploadStorage, file: MulterFile): Promise<void> {
  return new Promise((resolve, reject) => {
    upload._removeFile({} as Request, file, (error: Error | null) =>
      error ? reject(error) : resolve(),
    );
  });
}

describe('AttachmentUploadStorage', () => {
  afterEach(async () => {
    for (const root of roots) {
      await rm(root, { recursive: true, force: true });
      roots.delete(root);
    }
  });

  it('uses a fixed transaction-scoped PostgreSQL advisory lock with a bounded allocation timeout', async () => {
    const events: string[] = [];
    const tx = {
      $executeRawUnsafe: jest.fn(async () => { events.push('advisory-lock'); }),
    };
    const prisma = {
      $transaction: jest.fn(async (work: (client: typeof tx) => Promise<unknown>) => work(tx)),
    };
    const coordinator = new PostgresAttachmentCapacityCoordinator(prisma as any);

    await coordinator.withLock(async () => { events.push('reservation'); });

    expect(events).toEqual(['advisory-lock', 'reservation']);
    expect(tx.$executeRawUnsafe).toHaveBeenCalledWith(
      'SELECT pg_advisory_xact_lock(1096243028, 1)',
    );
    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { maxWait: 30_000, timeout: 120_000 },
    );
  });

  it('streams an exact-limit upload into a private storage temp file', async () => {
    const root = await makeRoot();
    const storage = new LocalAttachmentStorage(config(root));
    const upload = new AttachmentUploadStorage(storage, config(root), immediateCapacity);
    const file = uploadFile(Readable.from(Buffer.from('0123456789')));

    const info = await handle(upload, file);

    expect(info).toMatchObject({
      fieldname: 'file',
      originalname: 'photo.png',
      encoding: '7bit',
      mimetype: 'image/png',
      size: 10,
    });
    expect(typeof info.path).toBe('string');
    expect(await readFile(info.path as string, 'utf8')).toBe('0123456789');
  });

  it('coordinates admission, reserves the maximum, then truncates to actual upload bytes', async () => {
    const root = await makeRoot();
    const local = new LocalAttachmentStorage(config(root), {
      availableBytes: async () => 11n,
    } as any);
    const reserve = jest.spyOn(local as any, 'createReservedTempPath');
    const capacity = {
      withLock: jest.fn(async (work: () => Promise<unknown>) => work()),
    };
    const upload = new AttachmentUploadStorage(local, config(root), capacity as any);

    const info = await handle(upload, uploadFile(Readable.from('abc')));

    expect(capacity.withLock).toHaveBeenCalledTimes(1);
    expect(reserve).toHaveBeenCalledWith(10n, 1n);
    expect((await readFile(info.path as string)).length).toBe(3);
  });

  it('serializes reservation admission across concurrent uploads and releases it after failure', async () => {
    const root = await makeRoot();
    const local = new LocalAttachmentStorage(config(root), {
      availableBytes: async () => 21n,
    } as any);
    let tail = Promise.resolve();
    const capacity = {
      withLock: jest.fn(async <T,>(work: () => Promise<T>) => {
        const previous = tail;
        let release!: () => void;
        tail = new Promise<void>((resolve) => { release = resolve; });
        await previous;
        try {
          return await work();
        } finally {
          release();
        }
      }),
    };
    const originalReserve = (local as any).createReservedTempPath?.bind(local);
    let firstEntered!: () => void;
    const entered = new Promise<void>((resolve) => { firstEntered = resolve; });
    let releaseFirst!: () => void;
    const firstRelease = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let calls = 0;
    (local as any).createReservedTempPath = jest.fn(async (...args: unknown[]) => {
      calls += 1;
      if (calls === 1) {
        firstEntered();
        await firstRelease;
        throw new Error('reservation failed');
      }
      return originalReserve(...args);
    });
    const upload = new AttachmentUploadStorage(local, config(root), capacity as any);

    const first = handle(upload, uploadFile(Readable.from('first')));
    await entered;
    const second = handle(upload, uploadFile(Readable.from('second')));
    await Promise.resolve();
    expect(calls).toBe(1);
    releaseFirst();

    await expect(first).rejects.toThrow('reservation failed');
    await expect(second).resolves.toMatchObject({ size: 6 });
    expect(calls).toBe(2);
  });

  it('rejects a stream as soon as it exceeds the byte limit and removes the partial temp file', async () => {
    const root = await makeRoot();
    const storage = new LocalAttachmentStorage(config(root));
    const upload = new AttachmentUploadStorage(storage, config(root), immediateCapacity);
    const file = uploadFile(Readable.from([Buffer.from('0123456789'), Buffer.from('x')]));

    await expect(handle(upload, file)).rejects.toMatchObject({ code: 'LIMIT_FILE_SIZE' });
    expect(await readdir(join(root, '.tmp'))).toEqual([]);
  });

  it('removes a partial temp file when the incoming stream errors', async () => {
    const root = await makeRoot();
    const storage = new LocalAttachmentStorage(config(root, 100n));
    const upload = new AttachmentUploadStorage(storage, config(root, 100n), immediateCapacity);
    const stream = new PassThrough();
    const completion = handle(upload, uploadFile(stream));
    stream.write('partial');
    stream.destroy(new Error('client disconnected'));

    await expect(completion).rejects.toThrow('client disconnected');
    const tempDirectory = await import('node:fs/promises').then((fs) =>
      fs.readdir(join(root, '.tmp')),
    );
    expect(tempDirectory).toEqual([]);
  });

  it('unlinks only the exact temp path returned for that upload', async () => {
    const root = await makeRoot();
    const outside = join(root, 'outside.txt');
    await writeFile(outside, 'keep');
    const storage = new LocalAttachmentStorage(config(root));
    const upload = new AttachmentUploadStorage(storage, config(root), immediateCapacity);
    const file = uploadFile(Readable.from('abc'));
    const info = await handle(upload, file);
    const tempPath = info.path as string;

    await expect(remove(upload, { ...file, path: outside })).rejects.toThrow('temp path');
    expect(await readFile(outside, 'utf8')).toBe('keep');
    file.path = tempPath;
    await remove(upload, file);
    await expect(access(tempPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not follow a temp path that is swapped to a symlink before removal', async () => {
    const root = await makeRoot();
    const outside = join(root, 'outside.txt');
    await writeFile(outside, 'keep');
    const storage = new LocalAttachmentStorage(config(root));
    const upload = new AttachmentUploadStorage(storage, config(root), immediateCapacity);
    const source = join(root, 'source.bin');
    await writeFile(source, 'abc');
    const file = uploadFile(createReadStream(source));
    const info = await handle(upload, file);
    const tempPath = info.path as string;
    file.path = tempPath;
    await rm(tempPath);
    await import('node:fs/promises').then((fs) => fs.symlink(outside, tempPath));

    await expect(remove(upload, file)).rejects.toThrow('symbolic link');
    expect(await readFile(outside, 'utf8')).toBe('keep');
  });
});
