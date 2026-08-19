import { OnboardingError } from '../onboarding/errors.js';
import { contentHash } from '../utils/hash.js';
import { BaseAnalysisResultSchema, GeneratedKnowledgeRecordSchema, StandardCodeFileSchema, type BaseAnalysisResult, type GeneratedKnowledgeRecord } from './contracts.js';
import { CodeSnapshotManifestSchema, type NormalizedCodeSnapshot } from './normalizer.js';

const DEFAULT_MAX_GENERATED_BYTES = 1_000_000;

export interface GeneratedKnowledgeDocument {
  record: GeneratedKnowledgeRecord;
  content: string;
}

export interface BaseAnalysisOutput extends BaseAnalysisResult {
  documents: GeneratedKnowledgeDocument[];
}

export interface BaseAnalysisOptions {
  maxGeneratedBytes: number;
  /** Kept as an injection seam; base analysis deliberately never reads the clock. */
  now?: () => Date;
}

function analysisError(message: string): OnboardingError {
  return new OnboardingError({ code: 'CODE_ANALYSIS_FAILED', message: `CODE_ANALYSIS_FAILED: ${message}`, retryable: false });
}

function codeUnitCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function displayLanguage(path: string): string {
  const extension = path.split('/').at(-1)?.split('.').at(-1)?.toLowerCase() ?? '';
  const known: Record<string, string> = {
    c: 'C', go: 'Go', java: 'Java', js: 'JavaScript', json: 'JSON', jsx: 'JavaScript', md: 'Markdown', py: 'Python', rs: 'Rust', toml: 'TOML', ts: 'TypeScript', tsx: 'TypeScript', yaml: 'YAML', yml: 'YAML',
  };
  return known[extension] ?? 'Unknown';
}

function safeRenderedPath(path: string): string {

  const unsafeCharacter = [...path].some((character) => {
    const codePoint = character.codePointAt(0)!;
    return codePoint <= 0x1f || codePoint === 0x7f || (codePoint >= 0x202a && codePoint <= 0x202e) || (codePoint >= 0x2066 && codePoint <= 0x2069);
  });
  if (unsafeCharacter) throw analysisError('normalized filename contained control or bidi characters');
  return path.split('/').map((segment) => encodeURIComponent(segment).replace(/[!'()*]/gu, (character) => `%${character.codePointAt(0)!.toString(16).toUpperCase()}`)).join('/');
}

function filenameHints(paths: string[]): string[] {
  const names = new Set(paths.map((path) => path.split('/').at(-1)!));
  const hints: Array<[string, string]> = [
    ['package.json', 'Node.js package manifest: package.json'],
    ['pnpm-workspace.yaml', 'pnpm workspace configuration: pnpm-workspace.yaml'],
    ['tsconfig.json', 'TypeScript configuration: tsconfig.json'],
    ['vite.config.ts', 'Vite configuration: vite.config.ts'],
    ['vite.config.js', 'Vite configuration: vite.config.js'],
    ['pyproject.toml', 'Python project configuration: pyproject.toml'],
    ['go.mod', 'Go module manifest: go.mod'],
    ['Cargo.toml', 'Rust package manifest: Cargo.toml'],
  ];
  return hints.filter(([name]) => names.has(name)).map(([, hint]) => hint);
}

function entryPointPaths(paths: string[]): string[] {
  return paths.filter((path) => {
    const base = path.split('/').at(-1) ?? '';
    const stem = base.replace(/\.[^.]+$/u, '');
    return /^(main|index|server|cli)$/u.test(stem) || path.startsWith('cmd/');
  }).sort(codeUnitCompare);
}

function document(record: Omit<GeneratedKnowledgeRecord, 'contentHash'>, content: string): GeneratedKnowledgeDocument {
  return {
    record: GeneratedKnowledgeRecordSchema.parse({ ...record, contentHash: contentHash(content) }),
    content,
  };
}

function markdown(title: string, snapshotHash: string, files: Array<{ path: string; nodeCount: number; sizeBytes: number }>, hints: string[], entryPoints: string[], warnings: string[], body: string[]): string {
  const languageCounts = new Map<string, number>();
  for (const file of files) languageCounts.set(displayLanguage(file.path), (languageCounts.get(displayLanguage(file.path)) ?? 0) + 1);
  const languageLines = Array.from(languageCounts.entries()).sort(([left], [right]) => codeUnitCompare(left, right)).map(([language, count]) => `- ${language}: ${count} file(s)`);
  const nodeCount = files.reduce((total, file) => total + file.nodeCount, 0);
  const byteCount = files.reduce((total, file) => total + file.sizeBytes, 0);
  return [
    `# ${title}`,
    '',
    '## Scan evidence',
    `- Snapshot hash: ${snapshotHash}`,
    '- Index completeness: complete',
    '- Scanner facts: normalized standard snapshot',
    '',
    '## Repository shape',
    files.length === 0 ? '- No normalized files were available.' : `- Files: ${files.length}`,
    files.length === 0 ? '- Nodes: 0' : `- Nodes: ${nodeCount}`,
    files.length === 0 ? '- Reported file bytes: 0' : `- Reported file bytes: ${byteCount}`,
    '',
    '## Languages',
    ...(languageLines.length > 0 ? languageLines : ['- No language facts were available.']),
    '',
    '## Ecosystem hints',
    ...(hints.length > 0 ? hints.map((hint) => `- ${hint}`) : ['- No recognized manifest or configuration filename evidence was found.']),
    '',
    '## Entry points',
    ...(entryPoints.length > 0 ? entryPoints.map((path) => `- ${safeRenderedPath(path)}`) : ['- No deterministic entry-point filename evidence was found.']),
    ...body.length > 0 ? ['', ...body] : [],
    '',
    '## Warnings',
    ...(warnings.length > 0 ? warnings.map((warning) => `- ${warning}`) : ['- None.']),
    '',
  ].join('\n');
}

/**
 * Creates bounded, deterministic Markdown from the scanner-independent snapshot.
 * It intentionally reads no source body, source root, scanner IDs, or wall clock.
 */
export function analyzeBaseKnowledge(snapshot: NormalizedCodeSnapshot, options: BaseAnalysisOptions): BaseAnalysisOutput {
  if (!Number.isInteger(options.maxGeneratedBytes) || options.maxGeneratedBytes <= 0) throw analysisError('confirmed generated-byte limit is invalid');
  const manifest = CodeSnapshotManifestSchema.parse(snapshot.manifest);
  if (!manifest.complete || manifest.index.state !== 'complete') throw analysisError('snapshot is incomplete');
  const files = snapshot.files.map((file) => StandardCodeFileSchema.parse(file)).sort((left, right) => codeUnitCompare(left.path, right.path));
  if (files.length !== manifest.counts.files) throw analysisError('snapshot file count did not match its manifest');
  if (new Set(files.map((file) => file.path)).size !== files.length) throw analysisError('snapshot contained duplicate normalized filenames');
  files.forEach((file) => { safeRenderedPath(file.path); });
  const paths = files.map((file) => file.path);
  const hints = filenameHints(paths);
  const entryPoints = entryPointPaths(paths);
  const warnings: string[] = [];
  const common = { schemaVersion: 'agentwiki-generated-code-knowledge@1' as const, analysisLayer: 'base' as const, sourceKey: manifest.sourceKey, snapshotHash: manifest.snapshotHash };
  const documents: GeneratedKnowledgeDocument[] = [document({
    ...common,
    relativePath: 'architecture/overview.md',
    logicalKey: 'codegraph/architecture/overview',
    title: 'Repository overview',
    evidenceIds: ['snapshot:architecture/overview.md'],
  }, markdown('Repository overview', manifest.snapshotHash, files, hints, entryPoints, warnings, []))];
  if (entryPoints.length > 0) {
    documents.push(document({
      ...common,
      relativePath: 'architecture/entry-points.md',
      logicalKey: 'codegraph/architecture/entry-points',
      title: 'Repository entry points',
      evidenceIds: ['snapshot:architecture/entry-points.md'],
    }, markdown('Repository entry points', manifest.snapshotHash, files, hints, entryPoints, warnings, ['This page is present only because normalized filename evidence matched known entry-point names.'])));
  }
  documents.sort((left, right) => codeUnitCompare(left.record.logicalKey, right.record.logicalKey));
  const byteLength = documents.reduce((total, item) => total + Buffer.byteLength(item.content), 0);
  if (byteLength > Math.min(options.maxGeneratedBytes, DEFAULT_MAX_GENERATED_BYTES)) throw analysisError('generated base knowledge exceeds the confirmed byte cap');
  const result = BaseAnalysisResultSchema.parse({ records: documents.map((item) => item.record), warnings });
  return { ...result, documents };
}
