import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdtemp, open, readdir, rm, symlink } from 'node:fs/promises';
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

describe('SyncV3BlobStorage', () => {
  afterEach(async () => {
    for (const root of roots) {
      await rm(root, { recursive: true, force: true });
      roots.delete(root);
    }
  });

  it('makes repeated identical chunk writes converge and rejects different bytes', async () => {
    const storage = new SyncV3BlobStorage(await makeRoot());
    const sessionId = randomUUID();
    const bytes = Buffer.from('same chunk');

    const first = await storage.putChunk(sessionId, contentHash, 0, Readable.from([bytes]), 1024);
    const retry = await storage.putChunk(sessionId, contentHash, 0, Readable.from([bytes]), 1024);

    expect(retry).toEqual(first);
    await expect(storage.putChunk(
      sessionId, contentHash, 0, Readable.from([Buffer.from('different')]), 1024,
    )).rejects.toMatchObject({ code: 'ATTACHMENT_CONTENT_INVALID' });
  });

  it('makes concurrent identical chunk writes converge on one durable file', async () => {
    const storage = new SyncV3BlobStorage(await makeRoot());
    const sessionId = randomUUID();
    const bytes = Buffer.alloc(64 * 1024, 0x5a);

    const [left, right] = await Promise.all([
      storage.putChunk(sessionId, contentHash, 0, Readable.from([bytes]), 1024 * 1024),
      storage.putChunk(sessionId, contentHash, 0, Readable.from([bytes]), 1024 * 1024),
    ]);

    expect(left).toEqual({ chunkHash: sha256(bytes), sizeBytes: bytes.length });
    expect(right).toEqual(left);
  });

  it('stops an oversized stream without publishing a chunk', async () => {
    const storage = new SyncV3BlobStorage(await makeRoot());
    const sessionId = randomUUID();

    await expect(storage.putChunk(
      sessionId, contentHash, 0, Readable.from([Buffer.alloc(700), Buffer.alloc(400)]), 1024,
    )).rejects.toMatchObject({ code: 'ATTACHMENT_QUOTA_EXCEEDED' });

    await expect(storage.putChunk(
      sessionId, contentHash, 0, Readable.from([Buffer.from('valid')]), 1024,
    )).resolves.toEqual({ chunkHash: sha256(Buffer.from('valid')), sizeBytes: 5 });
  });

  it('never maps traversal-shaped identifiers into staging paths', async () => {
    const storage = new SyncV3BlobStorage(await makeRoot());

    await expect(storage.putChunk(
      '../../session', contentHash, 0, Readable.from([Buffer.from('x')]), 1024,
    )).rejects.toMatchObject({ code: 'PAYLOAD_INVALID' });
    await expect(storage.putChunk(
      randomUUID(), '../hash', 0, Readable.from([Buffer.from('x')]), 1024,
    )).rejects.toMatchObject({ code: 'PAYLOAD_INVALID' });
  });

  it('rejects a symbolic-link staging root', async () => {
    const root = await makeRoot();
    const outside = await makeRoot();
    await symlink(outside, join(root, '.sync-v3-staging'));
    const storage = new SyncV3BlobStorage(root);

    await expect(storage.putChunk(
      randomUUID(), contentHash, 0, Readable.from([Buffer.from('x')]), 1024,
    )).rejects.toThrow(/symbolic link/u);
  });

  it('streams ordered chunks into the destination and verifies every receipt', async () => {
    const root = await makeRoot();
    const storage = new SyncV3BlobStorage(root);
    const sessionId = randomUUID();
    const leftBytes = Buffer.from('left-');
    const rightBytes = Buffer.from('right');
    const left = await storage.putChunk(sessionId, contentHash, 0, Readable.from([leftBytes]), 1024);
    const right = await storage.putChunk(sessionId, contentHash, 1, Readable.from([rightBytes]), 1024);
    const destination = join(root, 'combined.tmp');
    const handle = await open(
      destination,
      constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | constants.O_NOFOLLOW,
      0o600,
    );
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
  });

  it('fails closed when a staged chunk is replaced by a symbolic link', async () => {
    const root = await makeRoot();
    const storage = new SyncV3BlobStorage(root);
    const sessionId = randomUUID();
    const bytes = Buffer.from('chunk');
    const receipt = await storage.putChunk(sessionId, contentHash, 0, Readable.from([bytes]), 1024);
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
});
