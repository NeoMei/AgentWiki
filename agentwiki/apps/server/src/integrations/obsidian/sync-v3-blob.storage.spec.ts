import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdtemp, open, readFile, readdir, rm, symlink } from 'node:fs/promises';
import * as fsPromises from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { SyncV3BlobStorage } from './sync-v3-blob.storage';

const roots = new Set<string>();
const contentHash = 'a'.repeat(64);

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'agentwiki-attachment-test-blob-'));
  roots.add(root);
  return root;
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function stageAndCommit(
  storage: SyncV3BlobStorage,
  sessionId: string,
  index: number,
  bytes: Buffer,
  maxBytes = 1024,
) {
  const staged = await storage.stageChunk(
    sessionId, contentHash, index, Readable.from([bytes]), maxBytes,
  );
  return storage.commitStagedChunk(staged);
}

describe('SyncV3BlobStorage', () => {
  afterEach(async () => {
    for (const root of roots) {
      await rm(root, { recursive: true, force: true });
      roots.delete(root);
    }
  });

  it('keeps unique staging private until a canonical commit and permits explicit discard', async () => {
    const storage = new SyncV3BlobStorage(await makeRoot());
    const sessionId = randomUUID();
    const rejected = await storage.stageChunk(
      sessionId, contentHash, 0, Readable.from([Buffer.from('rejected')]), 1024,
    );
    await storage.discardStagedChunk(rejected);
    const bytes = Buffer.from('accepted');
    const accepted = await storage.stageChunk(
      sessionId, contentHash, 0, Readable.from([bytes]), 1024,
    );
    const committed = await storage.commitStagedChunk(accepted);

    expect(committed).toEqual({ chunkIndex: 0, chunkHash: sha256(bytes), sizeBytes: bytes.length });
  });

  it('lets a later transaction replace an unreceipted canonical orphan', async () => {
    const storage = new SyncV3BlobStorage(await makeRoot());
    const sessionId = randomUUID();
    const orphan = await storage.stageChunk(
      sessionId, contentHash, 0, Readable.from([Buffer.from('orphan')]), 1024,
    );
    await storage.commitStagedChunk(orphan);
    const bytes = Buffer.from('correct');
    const replacement = await storage.stageChunk(
      sessionId, contentHash, 0, Readable.from([bytes]), 1024,
    );

    await expect(storage.commitStagedChunk(replacement)).resolves.toMatchObject({
      chunkHash: sha256(bytes), sizeBytes: bytes.length,
    });
  });

  it('stops an oversized stream without publishing a chunk', async () => {
    const storage = new SyncV3BlobStorage(await makeRoot());
    const sessionId = randomUUID();

    await expect(storage.stageChunk(
      sessionId, contentHash, 0, Readable.from([Buffer.alloc(700), Buffer.alloc(400)]), 1024,
    )).rejects.toMatchObject({ code: 'ATTACHMENT_QUOTA_EXCEEDED' });

    await expect(stageAndCommit(
      storage, sessionId, 0, Buffer.from('valid'),
    )).resolves.toMatchObject({ chunkHash: sha256(Buffer.from('valid')), sizeBytes: 5 });
  });

  it('closes and removes an incoming file when the request stream disconnects', async () => {
    const root = await makeRoot();
    const storage = new SyncV3BlobStorage(root);
    const sessionId = randomUUID();
    async function* disconnected(): AsyncGenerator<Buffer> {
      yield Buffer.from('partial');
      throw Object.assign(new Error('client disconnected'), { code: 'ECONNRESET' });
    }

    await expect(storage.stageChunk(
      sessionId, contentHash, 0, disconnected(), 1024,
    )).rejects.toMatchObject({ code: 'ECONNRESET' });
    const files = (await readdir(join(root, '.sync-v3-staging'), {
      recursive: true,
      withFileTypes: true,
    })).filter((entry) => entry.isFile());
    expect(files).toEqual([]);
  });

  it('never maps traversal-shaped identifiers into staging paths', async () => {
    const storage = new SyncV3BlobStorage(await makeRoot());

    await expect(storage.stageChunk(
      '../../session', contentHash, 0, Readable.from([Buffer.from('x')]), 1024,
    )).rejects.toMatchObject({ code: 'PAYLOAD_INVALID' });
    await expect(storage.stageChunk(
      randomUUID(), '../hash', 0, Readable.from([Buffer.from('x')]), 1024,
    )).rejects.toMatchObject({ code: 'PAYLOAD_INVALID' });
  });

  it('rejects a symbolic-link staging root', async () => {
    const root = await makeRoot();
    const outside = await makeRoot();
    await symlink(outside, join(root, '.sync-v3-staging'));
    const storage = new SyncV3BlobStorage(root);

    await expect(storage.stageChunk(
      randomUUID(), contentHash, 0, Readable.from([Buffer.from('x')]), 1024,
    )).rejects.toThrow(/symbolic link/u);
  });

  it('streams ordered chunks into the destination and verifies every receipt', async () => {
    const root = await makeRoot();
    const storage = new SyncV3BlobStorage(root);
    const sessionId = randomUUID();
    const leftBytes = Buffer.from('left-');
    const rightBytes = Buffer.from('right');
    const left = await stageAndCommit(storage, sessionId, 0, leftBytes);
    const right = await stageAndCommit(storage, sessionId, 1, rightBytes);
    const destination = join(root, 'combined.tmp');
    const handle = await open(
      destination,
      constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | constants.O_NOFOLLOW,
      0o600,
    );
    await handle.writeFile(Buffer.alloc(64, 0xa5));
    await handle.sync();
    await handle.close();

    const result = await storage.combineChunks(
      sessionId,
      contentHash,
      [
        { chunkIndex: 0, chunkHash: left.chunkHash, sizeBytes: left.sizeBytes },
        { chunkIndex: 1, chunkHash: right.chunkHash, sizeBytes: right.sizeBytes },
      ],
      destination,
      1024,
    );

    expect(result).toEqual({
      contentHash: sha256(Buffer.concat([leftBytes, rightBytes])),
      sizeBytes: leftBytes.length + rightBytes.length,
    });
    expect(await readFile(destination)).toEqual(Buffer.concat([leftBytes, rightBytes]));
  });

  it('fails closed when a staged chunk is replaced by a symbolic link', async () => {
    const root = await makeRoot();
    const storage = new SyncV3BlobStorage(root);
    const sessionId = randomUUID();
    const bytes = Buffer.from('chunk');
    const receipt = await stageAndCommit(storage, sessionId, 0, bytes);
    const paths = (await readdir(join(root, '.sync-v3-staging'), {
      recursive: true,
      withFileTypes: true,
    })).filter((entry) => entry.isFile() && entry.name === 'chunk-0');
    expect(paths).toHaveLength(1);
    const chunkPath = join(paths[0]!.parentPath, paths[0]!.name);
    await rm(chunkPath);
    await symlink('/dev/null', chunkPath);
    const destination = join(root, 'combined.tmp');
    const handle = await open(destination, constants.O_CREAT | constants.O_EXCL | constants.O_RDWR, 0o600);
    await handle.close();

    await expect(storage.combineChunks(
      sessionId,
      contentHash,
      [{ chunkIndex: 0, chunkHash: receipt.chunkHash, sizeBytes: receipt.sizeBytes }],
      destination,
      1024,
    )).rejects.toThrow(/symbolic link/u);
  });

  it('closes a directory handle when validation stat fails', async () => {
    const root = await makeRoot();
    const seedStorage = new SyncV3BlobStorage(root);
    const sessionId = randomUUID();
    await stageAndCommit(seedStorage, sessionId, 0, Buffer.from('seed'));
    const entry = (await readdir(join(root, '.sync-v3-staging'), {
      recursive: true,
      withFileTypes: true,
    })).find((candidate) => candidate.isFile() && candidate.name === 'chunk-0')!;
    const sessionDirectory = entry.parentPath;
    let closeSpy: jest.SpyInstance | undefined;
    const storage = new SyncV3BlobStorage(root, { openFile: (async (...args: any[]) => {
      const handle = await (fsPromises.open as any)(...args);
      if (String(args[0]) === sessionDirectory && (Number(args[1]) & constants.O_DIRECTORY) !== 0) {
        closeSpy = jest.spyOn(handle, 'close');
        jest.spyOn(handle, 'stat').mockRejectedValueOnce(new Error('injected stat failure'));
      }
      return handle;
    }) as typeof fsPromises.open });
    await expect(storage.stageChunk(
      sessionId, contentHash, 1, Readable.from([Buffer.from('next')]), 1024,
    )).rejects.toThrow('injected stat failure');
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });

  it('closes a regular-file handle when validation stat fails', async () => {
    const root = await makeRoot();
    const seedStorage = new SyncV3BlobStorage(root);
    const sessionId = randomUUID();
    const receipt = await stageAndCommit(seedStorage, sessionId, 0, Buffer.from('chunk'));
    const destination = join(root, 'regular-stat-failure.tmp');
    const destinationHandle = await open(
      destination, constants.O_CREAT | constants.O_EXCL | constants.O_RDWR, 0o600,
    );
    await destinationHandle.close();
    let closeSpy: jest.SpyInstance | undefined;
    const storage = new SyncV3BlobStorage(root, { openFile: (async (...args: any[]) => {
      const handle = await (fsPromises.open as any)(...args);
      if (String(args[0]) === destination) {
        closeSpy = jest.spyOn(handle, 'close');
        jest.spyOn(handle, 'stat').mockRejectedValueOnce(new Error('injected file stat failure'));
      }
      return handle;
    }) as typeof fsPromises.open });
    await expect(storage.combineChunks(
      sessionId,
      contentHash,
      [{ chunkIndex: 0, chunkHash: receipt.chunkHash, sizeBytes: receipt.sizeBytes }],
      destination,
      1024,
    )).rejects.toThrow('injected file stat failure');
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });

  it('preserves physical reservation when a combined write fails with ENOSPC', async () => {
    const root = await makeRoot();
    const seedStorage = new SyncV3BlobStorage(root);
    const sessionId = randomUUID();
    const receipt = await stageAndCommit(seedStorage, sessionId, 0, Buffer.from('chunk'));
    const destination = join(root, 'enospc.tmp');
    const destinationHandle = await open(
      destination, constants.O_CREAT | constants.O_EXCL | constants.O_RDWR, 0o600,
    );
    await destinationHandle.writeFile(Buffer.alloc(64, 0xa5));
    await destinationHandle.close();
    const storage = new SyncV3BlobStorage(root, { openFile: (async (...args: any[]) => {
      const handle = await (fsPromises.open as any)(...args);
      if (String(args[0]) === destination) {
        jest.spyOn(handle, 'write').mockRejectedValueOnce(
          Object.assign(new Error('disk full'), { code: 'ENOSPC' }),
        );
      }
      return handle;
    }) as typeof fsPromises.open });
    await expect(storage.combineChunks(
      sessionId,
      contentHash,
      [{ chunkIndex: 0, chunkHash: receipt.chunkHash, sizeBytes: receipt.sizeBytes }],
      destination,
      1024,
    )).rejects.toMatchObject({ code: 'ENOSPC' });
    expect((await fsPromises.stat(destination)).size).toBe(64);
  });
});
