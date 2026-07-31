import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { readdir, readFile, stat } from 'node:fs/promises';
import type { AdapterInput, AdapterManifest, SourceAdapter, SourceDescriptor } from '../protocol/adapter.js';
import { ArtifactBatch } from '../protocol/adapter.js';
import type { SourceArtifact } from '../protocol/artifact.js';
import { contentHash } from '../utils/hash.js';
import { artifactId } from '../utils/id.js';
import { classifySensitivity } from '../utils/redact.js';

const execFileAsync = promisify(execFile);

const ADAPTER_ID = 'markitdown';
const ADAPTER_VERSION = '0.1.0';
const PROTOCOL_VERSION = '1.0';

const SUPPORTED_EXTENSIONS = new Set(['.md', '.markdown', '.txt', '.pdf', '.docx', '.doc']);

export class MarkitdownAdapter implements SourceAdapter {
  constructor(private readonly runtimePath: string) {}

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
        kind: 'node-module',
        packageName: 'markitdown',
        packageVersion: '^0.1.0',
        installCommand: ['npm', 'install', 'markitdown@^0.1.0'],
      },
    };
  }

  async inspect(input: AdapterInput): Promise<SourceDescriptor> {
    assertSourcePath(input.sourcePath);
    const files = await listSupportedFiles(input.sourcePath, input.limits);
    const sourceHash = await computeDirectoryHash(input.sourcePath, files);

    return {
      adapterId: ADAPTER_ID,
      sourcePath: input.sourcePath,
      displayName: `Documents ${input.sourcePath}`,
      kind: 'documents',
      estimatedArtifacts: files.length,
      sourceHash,
      metadata: {
        fileCount: files.length,
      },
    };
  }

  async collect(input: AdapterInput): Promise<ArtifactBatch> {
    assertSourcePath(input.sourcePath);
    const files = await listSupportedFiles(input.sourcePath, input.limits);
    const sourceHash = await computeDirectoryHash(input.sourcePath, files);

    const artifacts: SourceArtifact[] = [];
    for (const file of files) {
      const logicalKey = relative(input.sourcePath, file).replace(/\\/g, '/');
      let text: string;
      try {
        text = await convertToText(this.runtimePath, file);
      } catch (error: unknown) {
        text = `Conversion failed: ${formatError(error)}`;
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
  let bytes = 0;
  await walk(sourcePath, '', files, limits, bytes);
  return files;
}

async function walk(
  root: string,
  prefix: string,
  files: string[],
  limits: { maxFiles?: number; maxBytes?: number; maxFileBytes?: number } | undefined,
  bytesRef: number,
): Promise<number> {
  const dir = prefix ? resolve(root, prefix) : root;
  const names = await readdir(dir);
  names.sort();

  let bytes = bytesRef;
  for (const name of names) {
    if (name.startsWith('.')) continue;
    const relativePath = prefix ? `${prefix}/${name}` : name;
    const fullPath = resolve(root, relativePath);
    const stats = await stat(fullPath);

    if (stats.isDirectory()) {
      bytes = await walk(root, relativePath, files, limits, bytes);
    } else if (stats.isFile() && SUPPORTED_EXTENSIONS.has(extname(name).toLowerCase())) {
      if (limits?.maxFileBytes !== undefined && stats.size > limits.maxFileBytes) {
        continue;
      }
      if (limits?.maxBytes !== undefined && bytes + stats.size > limits.maxBytes) {
        break;
      }
      files.push(fullPath);
      bytes += stats.size;
      if (limits?.maxFiles !== undefined && files.length >= limits.maxFiles) {
        return bytes;
      }
    }
  }
  return bytes;
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

async function convertToText(runtimePath: string, filePath: string): Promise<string> {
  const ext = extname(filePath).toLowerCase();
  if (ext === '.md' || ext === '.markdown' || ext === '.txt') {
    return await readFile(filePath, 'utf8');
  }

  const binary = join(runtimePath, 'node_modules', '.bin', 'markitdown');
  const { stdout } = await execFileAsync(process.execPath, [binary, filePath], {
    cwd: runtimePath,
    maxBuffer: 64 * 1024 * 1024,
    timeout: 120_000,
  });
  return stdout;
}
