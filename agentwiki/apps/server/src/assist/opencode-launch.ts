import { existsSync, readFileSync, realpathSync, statSync } from 'fs';
import { dirname, extname, join, resolve } from 'path';

export interface OpencodeLaunch {
  command: string;
  argsPrefix: string[];
}

export function resolveOpencodeLaunchFile(
  target: string,
  platform: NodeJS.Platform,
): OpencodeLaunch | undefined {
  try {
    if (!statSync(target).isFile()) return undefined;
    const realTarget = realpathSync(target);
    const extension = extname(realTarget).toLowerCase();
    if (['.js', '.cjs', '.mjs'].includes(extension)) {
      return { command: process.execPath, argsPrefix: [realTarget] };
    }
    const header = readFileSync(realTarget).subarray(0, 128);
    if (/^#!.*\bnode\b/u.test(header.toString('utf8'))) {
      return { command: process.execPath, argsPrefix: [realTarget] };
    }
    const native = platform === 'win32'
      ? header[0] === 0x4d && header[1] === 0x5a
      : platform === 'linux'
        ? header[0] === 0x7f && header.subarray(1, 4).toString('ascii') === 'ELF'
        : platform === 'darwin' && [
          'feedface', 'feedfacf', 'cefaedfe', 'cffaedfe', 'cafebabe',
        ].includes(header.subarray(0, 4).toString('hex'));
    return native ? { command: realTarget, argsPrefix: [] } : undefined;
  } catch {
    return undefined;
  }
}

export function resolveBundledOpencodeLaunch(
  cwd: string,
  platform: NodeJS.Platform,
  arch: string,
): OpencodeLaunch | undefined {
  for (const root of [cwd, join(cwd, '..'), join(cwd, '..', '..')]) {
    const packageJsonPath = join(root, 'node_modules', 'opencode-ai', 'package.json');
    try {
      if (!existsSync(packageJsonPath)) continue;
      const manifest = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
        bin?: string | Record<string, string>;
      };
      const bin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.opencode;
      if (!bin) continue;
      const realPackageJson = realpathSync(packageJsonPath);
      const target = resolve(dirname(realPackageJson), bin);
      const genericLaunch = existsSync(target)
        ? resolveOpencodeLaunchFile(target, platform)
        : undefined;
      if (genericLaunch) return genericLaunch;

      const platformName = platform === 'win32' ? 'windows' : platform;
      const executableName = platform === 'win32' ? 'opencode.exe' : 'opencode';
      for (const suffix of ['', '-baseline']) {
        const nativeTarget = resolve(
          dirname(realPackageJson), '..', `opencode-${platformName}-${arch}${suffix}`,
          'bin', executableName,
        );
        const nativeLaunch = existsSync(nativeTarget)
          ? resolveOpencodeLaunchFile(nativeTarget, platform)
          : undefined;
        if (nativeLaunch) return nativeLaunch;
      }
    } catch {
      // Ignore an invalid or inaccessible package and try the next root.
    }
  }
  return undefined;
}
