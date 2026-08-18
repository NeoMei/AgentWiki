import { isAbsolute, relative, resolve, sep } from 'node:path';
import { z } from 'zod';
import { OnboardingError } from '../onboarding/errors.js';
import { contentHash } from '../utils/hash.js';
import { CodeGraphCapabilitiesSchema, StandardCodeFileSchema, type CodeGraphCapabilities, type StandardCodeFile } from './contracts.js';

export const CodeSnapshotManifestSchema = z.object({
  schemaVersion: z.literal('agentwiki-code-snapshot@1'),
  sourceKey: z.string().regex(/^[a-f0-9]{64}$/u),
  scanner: z.object({ provider: z.literal('codegraph'), detectedVersion: z.string(), capabilities: CodeGraphCapabilitiesSchema }).strict(),
  index: z.object({ state: z.literal('complete'), indexedAt: z.string().datetime() }).strict(),
  counts: z.object({ files: z.number().int().nonnegative(), modules: z.literal(0), symbols: z.literal(0), relations: z.literal(0) }).strict(),
  datasets: z.object({ files: z.string(), modules: z.string(), symbols: z.string(), relations: z.string() }).strict(),
  snapshotHash: z.string().regex(/^[a-f0-9]{64}$/u),
  complete: z.literal(true),
  warnings: z.array(z.string()),
}).strict();
export type CodeSnapshotManifest = z.infer<typeof CodeSnapshotManifestSchema>;

export interface NormalizeCodeGraphFilesOptions {
  sourceKey: string;
  sourceRoot: string;
  scanner: { provider: 'codegraph'; detectedVersion: string; capabilities: CodeGraphCapabilities };
  indexedAt: string;
  maxFiles: number;
  maxGeneratedBytes: number;
}

export interface NormalizedCodeSnapshot {
  manifest: CodeSnapshotManifest;
  files: StandardCodeFile[];
  filesNdjson: string;
  modulesNdjson: string;
  symbolsNdjson: string;
  relationsNdjson: string;
}

function invalidSnapshot(message: string, diagnostic: string): OnboardingError {
  const error = new OnboardingError({ code: 'CODE_SNAPSHOT_INVALID', message: `Code snapshot is invalid: ${message}`, retryable: false });
  Object.assign(error, { diagnostic });
  return error;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function nonnegativeInteger(value: unknown, name: string): number {
  if (value === undefined) return 0;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw invalidSnapshot(`invalid ${name}`, `Scanner ${name} was not a non-negative integer`);
  }
  return value;
}

function firstDefined(record: Record<string, unknown>, keys: string[]): unknown {
  return keys.map((key) => record[key]).find((value) => value !== undefined);
}

function normalizedRelativePath(rawPath: unknown, sourceRoot: string): string {
  if (typeof rawPath !== 'string' || rawPath.length === 0 || rawPath.includes('\0')) {
    throw invalidSnapshot('missing path', 'Scanner file record did not provide a path');
  }
  const slashPath = rawPath.replace(/\\/g, '/');
  let candidate = slashPath;
  if (isAbsolute(slashPath)) {
    const absolute = resolve(slashPath);
    const root = resolve(sourceRoot);
    const pathRelative = relative(root, absolute);
    if (pathRelative === '' || pathRelative === '..' || pathRelative.startsWith(`..${sep}`) || isAbsolute(pathRelative)) {
      throw invalidSnapshot('path is outside the source', 'Scanner file path escaped the confirmed source root');
    }
    candidate = pathRelative;
  }
  candidate = candidate.replace(/\\/g, '/');
  if (/^[A-Za-z]:\//u.test(candidate) || candidate.startsWith('/') || candidate.split('/').some((part) => part === '' || part === '.' || part === '..')) {
    throw invalidSnapshot('path is not a normalized relative path', 'Scanner file path contained traversal or an absolute path');
  }
  return candidate;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    return Object.keys(value).sort().reduce<Record<string, unknown>>((result, key) => {
      result[key] = canonicalize((value as Record<string, unknown>)[key]);
      return result;
    }, {});
  }
  return value;
}

function snapshotHash(sourceKey: string, scanner: NormalizeCodeGraphFilesOptions['scanner'], datasets: CodeSnapshotManifest['datasets']): string {
  return contentHash(JSON.stringify(canonicalize({ sourceKey, scanner, datasets })));
}

/**
 * Converts documented flat CodeGraph file output into the private, scanner-independent
 * standard snapshot. Unknown scanner fields and internal identifiers are deliberately
 * ignored rather than persisted.
 */
export function normalizeCodeGraphFiles(output: unknown, options: NormalizeCodeGraphFilesOptions): NormalizedCodeSnapshot {
  const envelope = Array.isArray(output) ? output : asRecord(output)?.files;
  if (!Array.isArray(envelope)) throw invalidSnapshot('invalid files response', 'CodeGraph files output was not an array or { files: [] }');
  if (!Number.isInteger(options.maxFiles) || options.maxFiles <= 0 || envelope.length > options.maxFiles) {
    throw invalidSnapshot('file count exceeds the confirmed limit', `Received ${envelope.length} files with maxFiles ${options.maxFiles}`);
  }
  if (!Number.isInteger(options.maxGeneratedBytes) || options.maxGeneratedBytes <= 0) {
    throw invalidSnapshot('invalid output limit', 'Confirmed maxGeneratedBytes was invalid');
  }
  const sourceKey = z.string().regex(/^[a-f0-9]{64}$/u).parse(options.sourceKey);
  const scanner = z.object({ provider: z.literal('codegraph'), detectedVersion: z.string(), capabilities: CodeGraphCapabilitiesSchema }).strict().parse(options.scanner);
  if (Number.isNaN(Date.parse(options.indexedAt))) throw invalidSnapshot('invalid indexed timestamp', 'indexedAt was not an ISO timestamp');

  const paths = new Set<string>();
  const files = envelope.map((entry): StandardCodeFile => {
    const record = asRecord(entry);
    if (!record) throw invalidSnapshot('invalid file record', 'Scanner files array contained a non-object value');
    const path = normalizedRelativePath(record.path, options.sourceRoot);
    if (paths.has(path)) throw invalidSnapshot('duplicate file path', `Duplicate normalized file path: ${path}`);
    paths.add(path);
    const language = firstDefined(record, ['language', 'lang']);
    if (language !== undefined && (typeof language !== 'string' || language.length === 0)) {
      throw invalidSnapshot('invalid language', 'Scanner language was not a non-empty string');
    }
    return StandardCodeFileSchema.parse({
      fileId: contentHash(`${sourceKey}:${path}`),
      path,
      language: language ?? 'unknown',
      nodeCount: nonnegativeInteger(firstDefined(record, ['nodeCount', 'nodes']), 'nodeCount'),
      sizeBytes: nonnegativeInteger(firstDefined(record, ['sizeBytes', 'bytes', 'size']), 'sizeBytes'),
    });
  }).sort((left, right) => left.path.localeCompare(right.path));

  const filesNdjson = files.map((file) => JSON.stringify(file)).join('\n') + (files.length > 0 ? '\n' : '');
  const modulesNdjson = '';
  const symbolsNdjson = '';
  const relationsNdjson = '';
  if (Buffer.byteLength(filesNdjson) + Buffer.byteLength(modulesNdjson) + Buffer.byteLength(symbolsNdjson) + Buffer.byteLength(relationsNdjson) > options.maxGeneratedBytes) {
    throw invalidSnapshot('normalized output exceeds the confirmed limit', 'Normalized datasets exceeded maxGeneratedBytes');
  }
  const datasets = {
    files: contentHash(filesNdjson),
    modules: contentHash(modulesNdjson),
    symbols: contentHash(symbolsNdjson),
    relations: contentHash(relationsNdjson),
  };
  const manifest = CodeSnapshotManifestSchema.parse({
    schemaVersion: 'agentwiki-code-snapshot@1',
    sourceKey,
    scanner,
    index: { state: 'complete', indexedAt: options.indexedAt },
    counts: { files: files.length, modules: 0, symbols: 0, relations: 0 },
    datasets,
    snapshotHash: snapshotHash(sourceKey, scanner, datasets),
    complete: true,
    warnings: [],
  });
  return { manifest, files, filesNdjson, modulesNdjson, symbolsNdjson, relationsNdjson };
}

export function hashCodeSnapshot(manifest: Pick<CodeSnapshotManifest, 'sourceKey' | 'scanner' | 'datasets'>): string {
  return snapshotHash(manifest.sourceKey, manifest.scanner, manifest.datasets);
}
