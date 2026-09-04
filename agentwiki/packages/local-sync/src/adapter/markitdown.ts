import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { lstat, readdir, readFile, realpath, stat } from 'node:fs/promises';
import type { AdapterInput, AdapterManifest, SourceAdapter, SourceDescriptor } from '../protocol/adapter.js';
import { ArtifactBatch } from '../protocol/adapter.js';
import type { SourceArtifact } from '../protocol/artifact.js';
import { contentHash } from '../utils/hash.js';
import { artifactId } from '../utils/id.js';
import { classifySensitivity } from '../utils/redact.js';

const execFileAsync = promisify(execFile);

const ADAPTER_ID = 'markitdown';
const ADAPTER_VERSION = '0.2.0';
const PROTOCOL_VERSION = '1.0';

const SUPPORTED_EXTENSIONS = new Set(['.md', '.markdown', '.txt', '.pdf', '.docx', '.doc']);
const DEFAULT_LIMITS = {
  maxFiles: 1_000,
  maxBytes: 100 * 1024 * 1024,
  maxFileBytes: 10 * 1024 * 1024,
};

export type MarkitdownExecFn = (
  file: string,
  args: readonly string[],
  options: { cwd: string; maxBuffer: number; timeout: number },
) => Promise<{ stdout: string; stderr: string }>;

export class MarkitdownAdapter implements SourceAdapter {
  constructor(
    private readonly runtimePath: string,
    private readonly exec: MarkitdownExecFn = execFileAsync as unknown as MarkitdownExecFn,
  ) {}

  manifest(): AdapterManifest {
    return {
      adapterId: ADAPTER_ID,
      version: ADAPTER_VERSION,
      protocolVersion: PROTOCOL_VERSION,
      inputKinds: ['directory'],
      artifactKinds: ['document'],
      supportsIncremental: true,
      permissions: ['read-source-path', 'run-managed-runtime'],
      runtime: {
        kind: 'python-venv',
        packageName: 'markitdown',
        packageVersion: '0.1.6',
        packageExtras: ['pdf', 'docx'],
      },
    };
  }

  async inspect(input: AdapterInput): Promise<SourceDescriptor> {
    assertSourcePath(input.sourcePath);
    const canonicalSourcePath = await realpath(input.sourcePath);
    const files = await listSupportedFiles(canonicalSourcePath, input.limits);
    const sourceHash = await computeDirectoryHash(canonicalSourcePath, files);

    return {
      adapterId: ADAPTER_ID,
      sourcePath: input.sourcePath,
      displayName: `Documents ${input.sourcePath}`,
      kind: 'documents',
      estimatedArtifacts: files.length,
      sourceHash,
      metadata: {
        fileCount: files.length,
        requiresManagedRuntime: files.some((file) => !isPlainText(file)),
      },
    };
  }

  async collect(input: AdapterInput): Promise<ArtifactBatch> {
    assertSourcePath(input.sourcePath);
    const canonicalSourcePath = await realpath(input.sourcePath);
    const files = await listSupportedFiles(canonicalSourcePath, input.limits);
    const sourceHash = await computeDirectoryHash(canonicalSourcePath, files);

    const artifacts: SourceArtifact[] = [];
    for (const file of files) {
      const logicalKey = relative(canonicalSourcePath, file).replace(/\\/g, '/');
      let text: string;
      try {
        text = await convertToText(this.runtimePath, file, this.exec);
      } catch (error: unknown) {
        throw new Error(`Failed to convert ${logicalKey}: ${formatError(error)}`, { cause: error });
      }

      const sensitivity = classifySensitivity(text);
      if (sensitivity === 'local-only') {
        continue;
      }

      const id = artifactId(ADAPTER_ID, input.spaceId, logicalKey);
      const title = deriveTitle(file);
      const body = [
        `# ${title}`,
        `Source: ${logicalKey}`,
        '',
        text,
      ].join('\n');

      artifacts.push({
        artifactId: id,
        adapterId: ADAPTER_ID,
        adapterVersion: ADAPTER_VERSION,
        sourceId: sourceHash,
        logicalKey,
        contentHash: contentHash(body),
        updatedAt: new Date().toISOString(),
        kind: 'document',
        content: {
          title,
          summary: text.slice(0, 500),
          body,
          fields: { path: logicalKey, extension: extname(file) },
          tags: ['document', extname(file).replace('.', '') || 'unknown'],
        },
        evidence: [
          {
            evidenceId: id,
            sourceUri: `file://${file}`,
            sourceHash,
            quote: text.slice(0, 500),
          },
        ],
        sensitivity,
      });
    }

    return { artifacts, hasMore: false };
  }
}

function assertSourcePath(sourcePath: string): void {
  if (!isAbsolute(sourcePath)) {
    throw new Error('Source path must be absolute');
  }
}

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function extname(path: string): string {
  const base = path.split(/[/\\]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot) : '';
}

function deriveTitle(filePath: string): string {
  const base = filePath.split(/[/\\]/).pop() ?? '';
  const name = base.replace(/\.[^.]+$/u, '');
  return name.replace(/[-_]/gu, ' ');
}

async function listSupportedFiles(
  sourcePath: string,
  limits?: { maxFiles?: number; maxBytes?: number; maxFileBytes?: number },
): Promise<string[]> {
  const files: string[] = [];
  const bytes = { value: 0 };
  const root = await realpath(sourcePath);
  await walk(root, '', files, { ...DEFAULT_LIMITS, ...limits }, bytes, new Set([root]));
  return files;
}

async function walk(
  root: string,
  prefix: string,
  files: string[],
  limits: { maxFiles: number; maxBytes: number; maxFileBytes: number },
  bytesRef: { value: number },
  visitedDirectories: Set<string>,
): Promise<number> {
  const dir = prefix ? resolve(root, prefix) : root;
  const names = await readdir(dir);
  names.sort();

  let bytes = bytesRef.value;
  for (const name of names) {
    if (files.length >= limits.maxFiles) break;
    if (name.startsWith('.')) continue;
    const relativePath = prefix ? `${prefix}/${name}` : name;
    const fullPath = resolve(root, relativePath);
    const linkStats = await lstat(fullPath);
    if (linkStats.isSymbolicLink()) continue;
    const stats = linkStats;

    if (stats.isDirectory()) {
      const canonicalDirectory = await realpath(fullPath);
      if (visitedDirectories.has(canonicalDirectory)) continue;
      visitedDirectories.add(canonicalDirectory);
      bytes = await walk(root, relativePath, files, limits, { value: bytes }, visitedDirectories);
    } else if (stats.isFile() && SUPPORTED_EXTENSIONS.has(extname(name).toLowerCase())) {
      if (stats.size > limits.maxFileBytes) {
        continue;
      }
      if (bytes + stats.size > limits.maxBytes) {
        break;
      }
      files.push(fullPath);
      bytes += stats.size;
      if (files.length >= limits.maxFiles) {
        bytesRef.value = bytes;
        return bytesRef.value;
      }
    }
  }
  bytesRef.value = bytes;
  return bytesRef.value;
}

async function computeDirectoryHash(sourcePath: string, files: string[]): Promise<string> {
  const parts: string[] = [];
  for (const file of files) {
    const stats = await stat(file);
    const rel = relative(sourcePath, file).replace(/\\/g, '/');
    parts.push(`${rel}:${stats.mtimeMs}:${stats.size}`);
  }
  return contentHash(parts.join('\n'));
}

async function convertToText(runtimePath: string, filePath: string, exec: MarkitdownExecFn): Promise<string> {
  if (isPlainText(filePath)) {
    return await readFile(filePath, 'utf8');
  }

  const python = process.platform === 'win32'
    ? join(runtimePath, '.venv', 'Scripts', 'python.exe')
    : join(runtimePath, '.venv', 'bin', 'python');
  const { stdout } = await exec(python, ['-m', 'markitdown', filePath], {
    cwd: runtimePath,
    maxBuffer: 64 * 1024 * 1024,
    timeout: 120_000,
  });
  return stdout;
}

function isPlainText(filePath: string): boolean {
  return ['.md', '.markdown', '.txt'].includes(extname(filePath).toLowerCase());
}
