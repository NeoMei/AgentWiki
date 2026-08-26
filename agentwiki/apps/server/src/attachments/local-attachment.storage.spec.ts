import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import {
  access,
  chmod,
  lstat,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadAttachmentConfig, type AttachmentConfig } from './attachment.config';
import { LocalAttachmentStorage } from './local-attachment.storage';

const roots = new Set<string>();

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'agentwiki-attachment-test-'));
  roots.add(root);
  return root;
}

function config(storagePath: string): AttachmentConfig {
  return {
    storagePath,
    maxFileBytes: 10n * 1024n * 1024n,
    maxSpaceBytes: 500n * 1024n * 1024n,
    maxDimension: 10_000,
    maxPixels: 40_000_000n,
    minFreeBytes: 1n,
    retentionMs: 30 * 24 * 60 * 60 * 1000,
    orphanGraceMs: 24 * 60 * 60 * 1000,
  };
}

describe('attachment config', () => {
  it('fails closed in production when the storage path is missing', () => {
    expect(() => loadAttachmentConfig({ NODE_ENV: 'production' })).toThrow(
      'ATTACHMENT_STORAGE_PATH',
    );
  });

  it('rejects a relative configured storage path', () => {
    expect(() =>
      loadAttachmentConfig({
        NODE_ENV: 'production',
        ATTACHMENT_STORAGE_PATH: 'relative/attachments',
      }),
    ).toThrow('absolute');
  });

  it.each(['/', '.', '..'])('rejects the broad storage path %s', (storagePath) => {
    expect(() =>
      loadAttachmentConfig({ NODE_ENV: 'production', ATTACHMENT_STORAGE_PATH: storagePath }),
    ).toThrow();
  });
});

describe('LocalAttachmentStorage', () => {
  afterEach(async () => {
    for (const root of roots) {
      await rm(root, { recursive: true, force: true });
      roots.delete(root);
    }
  });

  it('creates only private storage directories and temporary files', async () => {
    const parent = await makeRoot();
    const root = join(parent, 'attachments');
    const storage = new LocalAttachmentStorage(config(root));

    const tempPath = await storage.createTempPath();

    expect(tempPath.startsWith(join(root, '.tmp') + '/')).toBe(true);
    expect((await stat(root)).mode & 0o777).toBe(0o700);
    expect((await stat(join(root, '.tmp'))).mode & 0o777).toBe(0o700);
    expect((await stat(tempPath)).mode & 0o777).toBe(0o600);
  });

  it('repairs overly broad modes on pre-existing private directories', async () => {
    const parent = await makeRoot();
    const root = join(parent, 'attachments');
    await writeFile(join(parent, 'sentinel'), 'keep');
    const storage = new LocalAttachmentStorage(config(root));
    const tempPath = await storage.createTempPath();
    await chmod(root, 0o755);
    await chmod(join(root, '.tmp'), 0o755);

    await storage.createTempPath();

    expect((await stat(root)).mode & 0o777).toBe(0o700);
    expect((await stat(join(root, '.tmp'))).mode & 0o777).toBe(0o700);
    expect(await readFile(join(parent, 'sentinel'), 'utf8')).toBe('keep');
    expect((await stat(tempPath)).mode & 0o777).toBe(0o600);
  });

  it('publishes identical files to one sharded hash path without replacing the first', async () => {
    const parent = await makeRoot();
    const root = join(parent, 'attachments');
    const storage = new LocalAttachmentStorage(config(root));
    const bytes = Buffer.from('identical attachment bytes');
    const hash = createHash('sha256').update(bytes).digest('hex');
    const firstTemp = await storage.createTempPath();
    const secondTemp = await storage.createTempPath();
    await writeFile(firstTemp, bytes, { mode: 0o600 });
    await writeFile(secondTemp, bytes, { mode: 0o600 });

    const first = await storage.publish(firstTemp, hash, BigInt(bytes.length));
    const firstStat = await stat(join(root, first.storageKey));
    const second = await storage.publish(secondTemp, hash, BigInt(bytes.length));
    const secondStat = await stat(join(root, second.storageKey));

    expect(first).toEqual({
      contentHash: hash,
      storageKey: `sha256/${hash.slice(0, 2)}/${hash.slice(2, 4)}/${hash}`,
      sizeBytes: BigInt(bytes.length),
      created: true,
    });
    expect(second).toEqual({ ...first, created: false });
    expect(secondStat.ino).toBe(firstStat.ino);
    expect(secondStat.mode & 0o777).toBe(0o600);
    expect(await readFile(join(root, first.storageKey))).toEqual(bytes);
    await expect(access(firstTemp, constants.F_OK)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(access(secondTemp, constants.F_OK)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('marks pre-existing content as not created so DB-failure cleanup cannot delete it', async () => {
    const parent = await makeRoot();
    const root = join(parent, 'attachments');
    const storage = new LocalAttachmentStorage(config(root));
    const bytes = Buffer.from('already referenced bytes');
    const hash = createHash('sha256').update(bytes).digest('hex');
    const firstTemp = await storage.createTempPath();
    await writeFile(firstTemp, bytes);
    const existing = await storage.publish(firstTemp, hash, BigInt(bytes.length));
    const retryTemp = await storage.createTempPath();
    await writeFile(retryTemp, bytes);

    const retried = await storage.publish(retryTemp, hash, BigInt(bytes.length));
    if (retried.created) {
      await storage.removeIfUnreferenced(retried.storageKey);
    }

    expect(existing.created).toBe(true);
    expect(retried.created).toBe(false);
    expect(await readFile(join(root, existing.storageKey))).toEqual(bytes);
  });

  it('opens, probes, and precisely removes a published content file', async () => {
    const root = await makeRoot();
    const storage = new LocalAttachmentStorage(config(root));
    const bytes = Buffer.from('streamed content');
    const hash = createHash('sha256').update(bytes).digest('hex');
    const tempPath = await storage.createTempPath();
    await writeFile(tempPath, bytes);
    const published = await storage.publish(tempPath, hash, BigInt(bytes.length));

    const stream = await storage.open(published.storageKey);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk as Buffer));
    }
    const probe = await storage.probe();
    await storage.removeIfUnreferenced(published.storageKey);

    expect(Buffer.concat(chunks)).toEqual(bytes);
    expect(probe.writable).toBe(true);
    expect(probe.availableBytes).toBeGreaterThan(0n);
    await expect(storage.open(published.storageKey)).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await stat(root)).isDirectory()).toBe(true);
  });

  it.each([
    '../outside',
    'sha256/ab/cd/../../outside',
    'sha256/AB/cd/' + 'a'.repeat(64),
    'sha256/aa/aa/' + 'b'.repeat(64),
    'sha256/aa/aa/' + 'a'.repeat(63),
  ])('rejects an uncontrolled storage key: %s', async (storageKey) => {
    const root = await makeRoot();
    const storage = new LocalAttachmentStorage(config(root));

    await expect(storage.open(storageKey)).rejects.toThrow('storage key');
    await expect(storage.removeIfUnreferenced(storageKey)).rejects.toThrow('storage key');
  });

  it('rejects a symlinked configured root and does not touch its target', async () => {
    const parent = await makeRoot();
    const target = join(parent, 'target');
    const root = join(parent, 'attachments');
    await writeFile(target, 'target-bytes');
    await symlink(target, root);
    const storage = new LocalAttachmentStorage(config(root));

    await expect(storage.createTempPath()).rejects.toThrow('symbolic link');
    expect(await readFile(target, 'utf8')).toBe('target-bytes');
    expect((await lstat(root)).isSymbolicLink()).toBe(true);
  });

  it('rejects a temp-file symlink swap before publishing', async () => {
    const parent = await makeRoot();
    const root = join(parent, 'attachments');
    const outside = join(parent, 'outside');
    await writeFile(outside, 'outside-bytes');
    const storage = new LocalAttachmentStorage(config(root));
    const tempPath = await storage.createTempPath();
    await rm(tempPath);
    await symlink(outside, tempPath);
    const hash = createHash('sha256').update('outside-bytes').digest('hex');

    await expect(storage.publish(tempPath, hash, 13n)).rejects.toThrow();
    expect(await readFile(outside, 'utf8')).toBe('outside-bytes');
  });

  it('refuses a caller-supplied hash that does not match the temp bytes', async () => {
    const root = await makeRoot();
    const storage = new LocalAttachmentStorage(config(root));
    const tempPath = await storage.createTempPath();
    await writeFile(tempPath, 'real bytes');

    await expect(storage.publish(tempPath, 'a'.repeat(64), 10n)).rejects.toThrow('hash');
    await expect(access(join(root, 'sha256/aa/aa/' + 'a'.repeat(64)))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});
