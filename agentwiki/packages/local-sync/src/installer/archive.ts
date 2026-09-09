/**
 * Archive legacy ~/.agentwiki state before activating the unified gateway layout.
 *
 * The archive is read-only and timestamped. Legacy children are moved (except
 * the active onboarding/ session directory), never deleted. If archiving
 * fails the legacy children are left untouched.
 */
import { chmod, lstat, mkdir, mkdtemp, readdir, rename, rm, rmdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const ACTIVE_ONBOARDING_DIR = 'onboarding';

export function agentwikiRoot(home: string = homedir()): string {
  return join(home, '.agentwiki');
}

export function archiveRoot(home: string = homedir()): string {
  return join(home, '.agentwiki-archive');
}

export interface ArchiveResult {
  archivePath: string;
  movedChildren: string[];
}

/**
 * Move every legacy child of ~/.agentwiki except the active onboarding/
 * directory into a timestamped archive. Marks the archive read-only.
 */
export async function archiveLegacyState(home: string = homedir()): Promise<ArchiveResult | null> {
  const root = agentwikiRoot(home);
  let children: string[];
  try {
    children = await readdir(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new Error('ARCHIVE_FAILED: unable to inspect active local state', { cause: error });
  }
  children = children.filter((child) => child !== ACTIVE_ONBOARDING_DIR);
  if (children.length === 0) return null;

  const stamp = new Date().toISOString().replace(/[:.]/g, '');
  await mkdir(archiveRoot(home), { recursive: true, mode: 0o700 });
  // A separate directory per attempt cannot merge with an earlier archive.
  const dest = await mkdtemp(join(archiveRoot(home), `state-${stamp}-`));
  const moved: string[] = [];

  try {
    for (const child of children) {
      await rename(join(root, child), join(dest, child));
      moved.push(child);
    }
    await chmod(dest, 0o500);
    return { archivePath: dest, movedChildren: moved };
  } catch (error) {
    // initialize/save have not run: never use restoreArchivedState here, since
    // it removes active children that may not have been archived at all.
    let restored = true;
    await chmod(dest, 0o700).catch(() => { restored = false; });
    for (const child of moved.reverse()) {
      try {
        const target = join(root, child);
        const exists = await lstat(target).then(() => true, (failure: NodeJS.ErrnoException) => {
          if (failure.code === 'ENOENT') return false;
          throw failure;
        });
        if (exists) throw new Error('active child was replaced during archival', { cause: error });
        await rename(join(dest, child), target);
      } catch {
        restored = false;
      }
    }
    if (restored) await rmdir(dest).catch(() => undefined);
    throw Object.assign(new Error(restored
      ? 'ARCHIVE_FAILED: local state archival failed; original active files were preserved'
      : `ARCHIVE_FAILED: archival rollback incomplete; preserve and recover remaining files in ${dest} before retrying`,
    { cause: error }), { retryable: restored });
  }
}

/** Initialize a clean unified-gateway state layout beside the preserved onboarding dir. */
export async function initCleanState(home: string = homedir()): Promise<void> {
  const root = agentwikiRoot(home);
  await mkdir(root, { recursive: true, mode: 0o700 });
  await chmod(root, 0o700);
  await mkdir(join(root, 'spaces'), { recursive: true, mode: 0o700 }).catch(() => undefined);
  await mkdir(join(root, 'runtime'), { recursive: true, mode: 0o700 }).catch(() => undefined);
}

/** Restore the pre-install state after a failed activation. */
export async function restoreArchivedState(home: string, archive: ArchiveResult | null): Promise<void> {
  const root = agentwikiRoot(home);
  const currentChildren = await readdir(root).catch(() => []);
  for (const child of currentChildren) {
    if (child === ACTIVE_ONBOARDING_DIR) continue;
    await rm(join(root, child), { recursive: true, force: true });
  }

  if (archive === null) return;
  await chmod(archive.archivePath, 0o700);
  for (const child of archive.movedChildren) {
    await rename(join(archive.archivePath, child), join(root, child));
  }
  await chmod(archive.archivePath, 0o500).catch(() => undefined);
}
