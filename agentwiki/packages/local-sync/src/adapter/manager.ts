import { createHash, randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ManagedRuntimeDescriptor, SourceAdapter } from '../protocol/adapter.js';
import { CodebaseMemoryAdapter } from './codebase-memory.js';
import { MarkitdownAdapter } from './markitdown.js';

const execFileAsync = promisify(execFile);

export type RuntimeStatus =
  | { installed: false }
  | {
      installed: true;
      path: string;
      version: string;
      checksum: string;
    };

export interface ManagedAdapter {
  adapterId: string;
  displayName: string;
  descriptor: ManagedRuntimeDescriptor;
  factory: (runtimePath: string) => SourceAdapter;
}

export class AdapterRuntimeError extends Error {
  constructor(
    message: string,
    public readonly adapterId: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'AdapterRuntimeError';
  }
}

const DEFAULT_RUNTIME_HOME = join(homedir(), '.agentwiki', 'runtime');

const MANAGED_ADAPTERS: ManagedAdapter[] = [
  {
    adapterId: 'codebase-memory',
    displayName: 'codebase-memory-mcp',
    descriptor: {
      kind: 'node-module',
      packageName: 'codebase-memory-mcp',
      packageVersion: '0.9.0',
      installCommand: ['npm', 'install', 'codebase-memory-mcp@0.9.0'],
    },
    factory: (runtimePath) => new CodebaseMemoryAdapter(runtimePath),
  },
  {
    adapterId: 'markitdown',
    displayName: 'markitdown',
    descriptor: {
      kind: 'python-venv',
      packageName: 'markitdown',
      packageVersion: '0.1.6',
      packageExtras: ['pdf', 'docx'],
    },
    factory: (runtimePath) => new MarkitdownAdapter(runtimePath),
  },
];

export type ExecFn = (
  file: string,
  args?: readonly string[] | null,
  options?: {
    cwd?: string;
    env?: Record<string, string | undefined>;
    timeout?: number;
    maxBuffer?: number;
  },
) => Promise<{ stdout: string; stderr: string }>;

export interface AdapterManagerOptions {
  runtimeHome?: string;
  exec?: ExecFn;
  managedAdapters?: ManagedAdapter[];
}

export class AdapterManager {
  private readonly runtimeHome: string;
  private readonly exec: ExecFn;
  private readonly managedAdapters: Map<string, ManagedAdapter>;
  private readonly statusCache = new Map<string, RuntimeStatus>();

  constructor(options: AdapterManagerOptions = {}) {
    this.runtimeHome = options.runtimeHome ?? DEFAULT_RUNTIME_HOME;
    this.exec = options.exec ?? (execFileAsync as unknown as ExecFn);
    this.managedAdapters = new Map(
      (options.managedAdapters ?? MANAGED_ADAPTERS).map((a) => [a.adapterId, a]),
    );
  }

  listManaged(): ManagedAdapter[] {
    return Array.from(this.managedAdapters.values());
  }

  private runtimeDir(adapterId: string): string {
    return join(this.runtimeHome, adapterId);
  }

  private manifestPath(adapterId: string): string {
    return join(this.runtimeDir(adapterId), '.agentwiki-runtime.json');
  }

  private async readRuntimeManifest(adapterId: string): Promise<RuntimeStatus> {
    this.runtimeDir(adapterId); // ensure side-effect free path computation
    try {
      const raw = await readFile(this.manifestPath(adapterId), 'utf8');
      const parsed = JSON.parse(raw) as {
        installed: boolean;
        path?: string;
        version?: string;
        checksum?: string;
      };
      if (!parsed.installed || !parsed.path || !parsed.version || !parsed.checksum) {
        return { installed: false };
      }
      const stats = await stat(parsed.path);
      if (!stats.isDirectory()) {
        return { installed: false };
      }
      return {
        installed: true,
        path: parsed.path,
        version: parsed.version,
        checksum: parsed.checksum,
      };
    } catch (error: unknown) {
      if (isNotFound(error)) {
        return { installed: false };
      }
      throw error;
    }
  }

  async detect(adapterId: string): Promise<RuntimeStatus> {
    const cached = this.statusCache.get(adapterId);
    if (cached) return cached;

    const managed = this.managedAdapters.get(adapterId);
    if (!managed) {
      throw new AdapterRuntimeError(`Unknown adapter "${adapterId}"`, adapterId);
    }

    const status = await this.readRuntimeManifest(adapterId);
    this.statusCache.set(adapterId, status);
    return status;
  }

  async install(adapterId: string): Promise<RuntimeStatus> {
    const managed = this.managedAdapters.get(adapterId);
    if (!managed) {
      throw new AdapterRuntimeError(`Unknown adapter "${adapterId}"`, adapterId);
    }

    const dir = this.runtimeDir(adapterId);
    const tmpId = randomUUID();
    const tmpDir = join(dir, `.install-${tmpId}`);

    await mkdir(tmpDir, { recursive: true, mode: 0o700 });

    try {
      if (managed.descriptor.kind === 'python-venv') {
        await this.installPythonRuntime(managed, tmpDir);
      } else {
        const command = managed.descriptor.installCommand;
        if (!command || command.length === 0) {
          throw new AdapterRuntimeError(
            `Adapter "${adapterId}" has no install command`,
            adapterId,
          );
        }
        await this.exec(command[0], command.slice(1) ?? null, {
          cwd: tmpDir,
          env: {
            ...process.env,
            npm_config_cache: join(this.runtimeHome, '.npm-cache'),
            npm_config_global: 'false',
            npm_config_save: 'false',
          },
          timeout: 5 * 60_000,
          maxBuffer: 8 * 1024 * 1024,
        });
      }

      const version = await this.resolveVersion(adapterId, tmpDir);
      const checksum = await hashDirectory(tmpDir);
      const versionedDir = join(dir, `${managed.descriptor.packageName ?? adapterId}@${version}`);
      await rm(versionedDir, { recursive: true, force: true });
      await rename(tmpDir, versionedDir);

      const status: RuntimeStatus = {
        installed: true,
        path: versionedDir,
        version,
        checksum,
      };

      await this.writeRuntimeManifest(adapterId, status);
      this.statusCache.set(adapterId, status);
      return status;
    } catch (error: unknown) {
      await rm(tmpDir, { recursive: true, force: true });
      throw new AdapterRuntimeError(
        `Failed to install adapter "${adapterId}": ${formatError(error)}`,
        adapterId,
        error,
      );
    }
  }

  async ensure(adapterId: string): Promise<SourceAdapter> {
    const managed = this.managedAdapters.get(adapterId);
    if (!managed) {
      throw new AdapterRuntimeError(`Unknown adapter "${adapterId}"`, adapterId);
    }

    let status = await this.detect(adapterId);
    if (!status.installed) {
      status = await this.install(adapterId);
    } else {
      const expectedChecksum = await hashDirectory(status.path);
      if (expectedChecksum !== status.checksum) {
        status = await this.install(adapterId);
      }
    }

    if (!status.installed) {
      throw new AdapterRuntimeError(
        `Adapter "${adapterId}" is not available after install`,
        adapterId,
      );
    }

    return managed.factory(status.path);
  }

  async verify(adapterId: string): Promise<void> {
    const status = await this.detect(adapterId);
    if (!status.installed) {
      throw new AdapterRuntimeError(
        `Adapter "${adapterId}" is not installed`,
        adapterId,
      );
    }

    const expectedChecksum = await hashDirectory(status.path);
    if (expectedChecksum !== status.checksum) {
      throw new AdapterRuntimeError(
        `Adapter "${adapterId}" checksum mismatch: expected ${status.checksum}, got ${expectedChecksum}`,
        adapterId,
      );
    }
  }

  async remove(adapterId: string): Promise<void> {
    const dir = this.runtimeDir(adapterId);
    await rm(dir, { recursive: true, force: true });
    this.statusCache.delete(adapterId);
  }

  private async resolveVersion(adapterId: string, runtimePath: string): Promise<string> {
    const managed = this.managedAdapters.get(adapterId);
    if (!managed) {
      throw new AdapterRuntimeError(`Unknown adapter "${adapterId}"`, adapterId);
    }

    if (managed.descriptor.kind === 'node-module') {
      const packageJsonPath = join(runtimePath, 'node_modules', managed.descriptor.packageName ?? adapterId, 'package.json');
      try {
        const raw = await readFile(packageJsonPath, 'utf8');
        const parsed = JSON.parse(raw) as { version?: string };
        if (parsed.version) return parsed.version;
      } catch (error: unknown) {
        if (!isNotFound(error)) throw error;
      }

      // Fallback: read root package.json if dependency was flattened.
      try {
        const rootRaw = await readFile(join(runtimePath, 'package.json'), 'utf8');
        const rootParsed = JSON.parse(rootRaw) as { dependencies?: Record<string, string> };
        const depVersion = rootParsed.dependencies?.[managed.descriptor.packageName ?? adapterId];
        if (depVersion) return depVersion.replace(/^[^0-9]/u, '');
      } catch (error: unknown) {
        if (!isNotFound(error)) throw error;
      }
    }

    return managed.descriptor.packageVersion ?? 'unknown';
  }

  private async installPythonRuntime(managed: ManagedAdapter, runtimePath: string): Promise<void> {
    const packageName = managed.descriptor.packageName;
    const packageVersion = managed.descriptor.packageVersion;
    if (!packageName || !packageVersion) {
      throw new AdapterRuntimeError(
        `Python adapter "${managed.adapterId}" requires an exact package name and version`,
        managed.adapterId,
      );
    }

    const python = await this.selectPython(runtimePath, managed.adapterId);
    await this.exec(python.file, [...python.prefixArgs, '-m', 'venv', '.venv'], {
      cwd: runtimePath,
      env: process.env,
      timeout: 2 * 60_000,
      maxBuffer: 8 * 1024 * 1024,
    });

    const venvPython = process.platform === 'win32'
      ? join(runtimePath, '.venv', 'Scripts', 'python.exe')
      : join(runtimePath, '.venv', 'bin', 'python');
    const extras = managed.descriptor.packageExtras?.length
      ? `[${managed.descriptor.packageExtras.join(',')}]`
      : '';
    await this.exec(venvPython, [
      '-m', 'pip', 'install', '--disable-pip-version-check', '--no-input',
      `${packageName}${extras}==${packageVersion}`,
    ], {
      cwd: runtimePath,
      env: process.env,
      timeout: 30 * 60_000,
      maxBuffer: 16 * 1024 * 1024,
    });
  }

  private async selectPython(
    runtimePath: string,
    adapterId: string,
  ): Promise<{ file: string; prefixArgs: string[] }> {
    const configured = process.env.AGENTWIKI_PYTHON?.trim();
    const candidates = configured
      ? [{ file: configured, prefixArgs: [] }]
      : process.platform === 'win32'
        ? ['3.14', '3.13', '3.12', '3.11', '3.10'].map((version) => ({
            file: 'py', prefixArgs: [`-${version}`],
          }))
        : ['python3.14', 'python3.13', 'python3.12', 'python3.11', 'python3.10', 'python3']
            .map((file) => ({ file, prefixArgs: [] }));
    const probe = 'import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)';

    for (const candidate of candidates) {
      try {
        await this.exec(candidate.file, [...candidate.prefixArgs, '-c', probe], {
          cwd: runtimePath,
          env: process.env,
          timeout: 10_000,
          maxBuffer: 1024 * 1024,
        });
        return candidate;
      } catch {
        // Try the next explicitly versioned interpreter.
      }
    }

    throw new AdapterRuntimeError(
      `Adapter "${adapterId}" requires Python 3.10 or later; set AGENTWIKI_PYTHON to a compatible interpreter`,
      adapterId,
    );
  }

  private async writeRuntimeManifest(adapterId: string, status: RuntimeStatus): Promise<void> {
    const path = this.manifestPath(adapterId);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const tmpPath = join(dirname(path), `.manifest-${randomUUID()}.tmp`);
    await writeFile(tmpPath, JSON.stringify(status, null, 2), { mode: 0o600 });
    await rename(tmpPath, path);
  }
}

function isNotFound(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

async function hashDirectory(dir: string): Promise<string> {
  // Deterministic but lightweight: hash sorted list of relative paths + file sizes.
  const entries: string[] = [];
  await walk(dir, '', entries);
  entries.sort();
  const hash = createHash('sha256');
  for (const entry of entries) {
    hash.update(entry);
    hash.update('\n');
  }
  return hash.digest('hex');
}

async function walk(root: string, prefix: string, entries: string[]): Promise<void> {
  const names = await readdirSafe(join(root, prefix));
  for (const name of names.sort()) {
    const relativePath = prefix ? `${prefix}/${name}` : name;
    const fullPath = join(root, relativePath);
    const stats = await stat(fullPath);
    if (stats.isDirectory()) {
      await walk(root, relativePath, entries);
    } else if (stats.isFile()) {
      entries.push(`${relativePath}:${stats.size}`);
    }
  }
}

async function readdirSafe(path: string): Promise<string[]> {
  try {
    const { readdir } = await import('node:fs/promises');
    return await readdir(path);
  } catch (error: unknown) {
    if (isNotFound(error)) return [];
    throw error;
  }
}
