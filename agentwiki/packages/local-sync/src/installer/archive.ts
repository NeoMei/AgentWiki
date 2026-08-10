/**
 * Archive legacy ~/.agentwiki state before activating a clean 0.3.0 layout.
 *
 * The archive is read-only and timestamped. Legacy children are moved (except
 * the active onboarding/ session directory), never deleted. If archiving
 * fails the legacy children are left untouched.
 */
import { chmod, mkdir, readdir, rename } from 'node:fs/promises';
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
  } catch {
    return null; // no legacy state
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '');
  const dest = join(archiveRoot(home), `state-${stamp}`);
  const moved: string[] = [];

  for (const child of children) {
    if (child === ACTIVE_ONBOARDING_DIR) continue;
    const src = join(root, child);
    const dst = join(dest, child);
    try {
      await mkdir(dest, { recursive: true });
      await rename(src, dst);
      moved.push(child);
    } catch {
      // Best-effort: leave the child in place if move fails.
    }
  }

  if (moved.length === 0) return null;

  await chmod(dest, 0o500).catch(() => undefined); // read + execute, no write
  return { archivePath: dest, movedChildren: moved };
}

/** Initialize a clean 0.3.0 state layout beside the preserved onboarding dir. */
export async function initCleanState(home: string = homedir()): Promise<void> {
  const root = agentwikiRoot(home);
  await mkdir(root, { recursive: true, mode: 0o700 });
  await chmod(root, 0o700);
  await mkdir(join(root, 'spaces'), { recursive: true, mode: 0o700 }).catch(() => undefined);
  await mkdir(join(root, 'runtime'), { recursive: true, mode: 0o700 }).catch(() => undefined);
}
