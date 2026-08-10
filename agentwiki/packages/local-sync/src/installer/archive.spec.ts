import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile, stat, chmod, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { archiveLegacyState, initCleanState, agentwikiRoot, ACTIVE_ONBOARDING_DIR } from './archive.js';

let tempHome = '';
async function freshHome(): Promise<string> {
  tempHome = await mkdtemp(join(tmpdir(), 'aw-archive-'));
  return tempHome;
}
async function chmodRecursive(dir: string, mode: number): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  await chmod(dir, mode);
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await chmodRecursive(full, mode);
    else await chmod(full, mode);
  }
}

afterEach(async () => {
  if (tempHome) {
    await chmodRecursive(tempHome, 0o777).catch(() => undefined);
    await rm(tempHome, { recursive: true, force: true });
  }
  tempHome = '';
});

describe('archive legacy state', () => {
  it('returns null when there is no ~/.agentwiki', async () => {
    const home = await freshHome();
    expect(await archiveLegacyState(home)).toBeNull();
  });

  it('moves legacy children but preserves the active onboarding directory', async () => {
    const home = await freshHome();
    const root = agentwikiRoot(home);
    await mkdir(join(root, 'spaces'), { recursive: true });
    await mkdir(join(root, ACTIVE_ONBOARDING_DIR), { recursive: true });
    await writeFile(join(root, ACTIVE_ONBOARDING_DIR, 'sess-1.json'), '{}');

    const result = await archiveLegacyState(home);
    expect(result?.movedChildren).toContain('spaces');
    expect(result?.movedChildren).not.toContain(ACTIVE_ONBOARDING_DIR);

    // The onboarding session file is still in place.
    const surviving = await readFile(join(root, ACTIVE_ONBOARDING_DIR, 'sess-1.json'), 'utf8');
    expect(surviving).toBe('{}');
  });

  it('marks the archive read-only', async () => {
    const home = await freshHome();
    const root = agentwikiRoot(home);
    await mkdir(join(root, 'legacy'), { recursive: true });
    const result = await archiveLegacyState(home);
    const s = await stat(result!.archivePath);
    expect(s.mode & 0o777).toBe(0o500);
  });
});

describe('initCleanState', () => {
  it('creates the clean layout with 0700 permissions', async () => {
    const home = await freshHome();
    await initCleanState(home);
    const s = await stat(agentwikiRoot(home));
    expect(s.mode & 0o777).toBe(0o700);
    const spaces = await stat(join(agentwikiRoot(home), 'spaces'));
    expect(spaces.isDirectory()).toBe(true);
  });
});
