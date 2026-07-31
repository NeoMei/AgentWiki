import { createHash } from 'node:crypto';
import { spawn, type SpawnOptions } from 'node:child_process';
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
} from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import { getOrCreateSourceKey } from './config.js';

const DEFAULT_STAGING_LIMITS = {
  maxInputFiles: 10_000,
  maxInputBytes: 100 * 1024 * 1024,
  maxInputFileBytes: 1024 * 1024,
};
const MAX_DOCUMENTS = 500;
const MAX_ENVELOPE_BYTES = 10 * 1024 * 1024;
const MAX_ARCHITECTURE_BYTES = 50 * 1024;
const COMMAND_TIMEOUT_MS = 30 * 60 * 1_000;

const DOCUMENT_EXTENSIONS = new Set(['.md', '.markdown', '.txt', '.pdf', '.docx']);
const CONVERTIBLE_DOCUMENT_EXTENSIONS = new Set(['.pdf', '.docx']);
const CODE_EXTENSIONS = new Set([
  '.c', '.cc', '.cpp', '.cs', '.css', '.go', '.h', '.hpp', '.html', '.java', '.js', '.jsx',
  '.kt', '.mjs', '.php', '.py', '.rb', '.rs', '.sh', '.sql', '.swift', '.ts', '.tsx', '.vue', '.yml', '.yaml',
]);

export interface ToolStatus {
  command: string;
  available: boolean;
  version?: string;
}

export interface SourceInspection {
  displayName: string;
  kind: 'code' | 'documents' | 'mixed';
  files: { code: number; documents: number; unsupported: number };
  dependencies: {
    markitdown: ToolStatus;
    git: ToolStatus;
    codebaseMemory: ToolStatus;
  };
}

export interface PrepareInput {
  path: string;
  allowRemoteModel: boolean;
  codebaseMemorySummary?: string;
}

export interface OkfEnvelope {
  okfVersion: '0.1';
  sourceKey: string;
  name: string;
  kind: 'code' | 'documents' | 'mixed';
  producer: { name: 'agentwiki-local-sync'; version: string };
  documents: Array<{
    path: string;
    content: string;
    contentHash: string;
    evidence: Array<{ sourcePath: string; sourceHash: string; quote: string }>;
  }>;
}

export interface PreparedKnowledge {
  envelope: OkfEnvelope;
  envelopeBytes: Uint8Array;
  sourceKey: string;
  processedFiles: number;
  skippedFiles: Array<{ path: string; reason: string }>;
}

export interface CommandResult {
  status: number | null;
  error?: Error;
  stdout?: string | Buffer;
  stderr?: string | Buffer;
}

export type CommandRunner = (
  command: string,
  args: string[],
  options?: SpawnOptions,
) => CommandResult | Promise<CommandResult>;

export interface LocalKnowledgeDeps {
  home: string;
  run: CommandRunner;
  now: () => Date;
  limits?: Partial<StagingLimits>;
}

export interface StagingLimits {
  maxInputFiles: number;
  maxInputBytes: number;
  maxInputFileBytes: number;
}

export interface KnowledgeSyncStateLike {
  documents: Array<{ path: string; contentHash: string }>;
}

export interface KnowledgePreviewDiff {
  added: number;
  updated: number;
  deleted: number;
  unchanged: number;
}

interface SourceFile {
  absolutePath: string;
  relativePath: string;
}

interface SourceCounts {
  code: number;
  documents: number;
  unsupported: number;
}

interface ExtractedDocument {
  path: string;
  content: string;
}

interface CodebaseMemorySummary {
  files?: Array<{ path: string; summary?: string }>;
  summary?: string;
  [key: string]: unknown;
}

/**
 * Inspects a local source and available command line dependencies without uploading data.
 *
 * @param path Local source directory.
 * @param deps Optional clock, home directory, and command runner dependencies.
 * @returns A path-safe source inspection.
 */
export async function inspectLocalSource(path: string, deps?: LocalKnowledgeDeps): Promise<SourceInspection> {
  const dependencies = deps ?? defaultDependencies();
  const root = await resolveRoot(path);
  const [files, tools] = await Promise.all([
    listSourceFiles(root),
    Promise.all(['markitdown', 'git', 'codebase-memory-mcp'].map((command) => inspectTool(command, dependencies.run))),
  ]);
  const counts = classifyFiles(files);

  return {
    displayName: basename(root),
    kind: sourceKind(counts),
    files: counts,
    dependencies: { markitdown: tools[0], git: tools[1], codebaseMemory: tools[2] },
  };
}

/**
 * Builds a local knowledge bundle from a source directory using markitdown for documents
 * and codebase-memory-mcp for code summaries. No remote model is invoked.
 *
 * @param input Source and consent inputs.
 * @param deps Optional clock, home directory, and command runner dependencies.
 * @returns A self-contained OKF envelope with no absolute source paths.
 */
export async function prepareKnowledgeSync(input: PrepareInput, deps?: LocalKnowledgeDeps): Promise<PreparedKnowledge> {
  const dependencies = deps ?? defaultDependencies();
  // allowRemoteModel is kept for parameter compatibility but ignored; no remote model is used.
  void input.allowRemoteModel;

  const root = await resolveRoot(input.path);
  const files = await sourceFilesForProcessing(root, dependencies.run);
  const stagingLimits = { ...DEFAULT_STAGING_LIMITS, ...dependencies.limits };
  const counts = classifyFiles(files);
  const skippedFiles: PreparedKnowledge['skippedFiles'] = [];
  const sourceKey = await getOrCreateSourceKey(dependencies.home, root);
  const processing = await mkdtemp(join(tmpdir(), 'agentwiki-local-sync-'));

  try {
    const { documents: extractedDocuments } = await extractDocuments(root, files, processing, skippedFiles, stagingLimits, dependencies.run);
    const codeSummary = await summarizeCode(root, files, skippedFiles, dependencies.run);

    const envelope: OkfEnvelope = {
      okfVersion: '0.1',
      sourceKey,
      name: basename(root),
      kind: sourceKind(counts),
      producer: { name: 'agentwiki-local-sync', version: '0.2.0' },
      documents: [],
    };

    for (const extracted of extractedDocuments) {
      appendDocument(envelope, extracted.path, extracted.content, skippedFiles);
    }
    if (input.codebaseMemorySummary) {
      appendDocument(envelope, 'architecture/codebase-memory.md', truncateUtf8(input.codebaseMemorySummary, MAX_ARCHITECTURE_BYTES), skippedFiles);
    } else if (codeSummary) {
      appendDocument(envelope, 'architecture/codebase-memory.md', truncateUtf8(codeSummary, MAX_ARCHITECTURE_BYTES), skippedFiles);
    }

    const envelopeBytes = new TextEncoder().encode(JSON.stringify(envelope));
    if (envelopeBytes.byteLength > MAX_ENVELOPE_BYTES) {
      throw new Error('Prepared knowledge bundle exceeds 10 MiB');
    }

    return {
      envelope,
      envelopeBytes,
      sourceKey,
      processedFiles: envelope.documents.length,
      skippedFiles,
    };
  } finally {
    await rm(processing, { recursive: true, force: true });
  }
}

/**
 * Computes a preview diff from server path/hash state.
 *
 * @param envelope Newly prepared local bundle.
 * @param state Last confirmed server state.
 * @returns Counts suitable for a confirmation prompt.
 */
export function buildPreview(envelope: OkfEnvelope, state: KnowledgeSyncStateLike): KnowledgePreviewDiff {
  const current = new Map(envelope.documents.map((document) => [document.path, document.contentHash]));
  const previous = new Map(state.documents.map((document) => [document.path, document.contentHash]));
  let added = 0;
  let updated = 0;
  let unchanged = 0;

  for (const [path, hash] of current) {
    const oldHash = previous.get(path);
    if (oldHash === undefined) added += 1;
    else if (oldHash === hash) unchanged += 1;
    else updated += 1;
  }

  let deleted = 0;
  for (const path of previous.keys()) {
    if (!current.has(path)) deleted += 1;
  }
  return { added, updated, deleted, unchanged };
}

function defaultDependencies(): LocalKnowledgeDeps {
  return { home: homedir(), run: spawnCommand, now: () => new Date() };
}

function spawnCommand(command: string, args: string[], options: SpawnOptions = {}): Promise<CommandResult> {
  return new Promise((resolveResult) => {
    const child = spawn(command, args, { ...options, shell: false, stdio: 'pipe' });
    const stdout: string[] = [];
    const stderr: string[] = [];
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, COMMAND_TIMEOUT_MS);

    child.stdout?.on('data', (chunk: string | Buffer) => stdout.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8')));
    child.stderr?.on('data', (chunk: string | Buffer) => stderr.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8')));
    child.once('error', (error) => {
      clearTimeout(timeout);
      resolveResult({ status: null, error, stdout: stdout.join(''), stderr: stderr.join('') });
    });
    child.once('close', (status) => {
      clearTimeout(timeout);
      resolveResult({
        status,
        ...(timedOut ? { error: new Error(`${command} timed out after 30 minutes`) } : {}),
        stdout: stdout.join(''),
        stderr: stderr.join(''),
      });
    });
  });
}

async function resolveRoot(path: string): Promise<string> {
  if (!isAbsolute(path)) throw new Error('Source path must be absolute');
  const root = await realpath(path);
  if (!(await stat(root)).isDirectory()) throw new Error('Source path must be a directory');
  return root;
}

async function inspectTool(command: string, run: CommandRunner): Promise<ToolStatus> {
  try {
    const result = await run(command, ['--version'], { stdio: 'pipe' });
    const output = commandOutput(result.stdout).trim();
    return { command, available: !result.error && result.status === 0, ...(output ? { version: output } : {}) };
  } catch {
    return { command, available: false };
  }
}

async function sourceFilesForProcessing(root: string, run: CommandRunner): Promise<SourceFile[]> {
  const gitDirectory = join(root, '.git');
  try {
    await lstat(gitDirectory);
    const result = await run('git', ['ls-files', '-co', '--exclude-standard', '-z'], { cwd: root, stdio: 'pipe' });
    if (!result.error && result.status === 0) {
      return commandOutput(result.stdout).split('\0').filter(Boolean).map((path) => sourceFile(root, path));
    }
  } catch (error: unknown) {
    if (!isNotFound(error)) throw error;
  }
  return listSourceFiles(root);
}

async function listSourceFiles(root: string): Promise<SourceFile[]> {
  const files: SourceFile[] = [];
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name === '.git') continue;
      const absolutePath = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(absolutePath);
      } else if (entry.isFile() || entry.isSymbolicLink()) {
        files.push(sourceFile(root, absolutePath));
      }
    }
  };
  await visit(root);
  return files;
}

function sourceFile(root: string, path: string): SourceFile {
  const absolutePath = resolve(root, path);
  const relativePath = relative(root, absolutePath);
  if (!relativePath || relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    throw new Error('Source file escapes source root');
  }
  return { absolutePath, relativePath: toPosixPath(relativePath) };
}

function classifyFiles(files: SourceFile[]): SourceCounts {
  const counts: SourceCounts = { code: 0, documents: 0, unsupported: 0 };
  for (const file of files) {
    const extension = extensionOf(file.relativePath);
    if (DOCUMENT_EXTENSIONS.has(extension)) counts.documents += 1;
    else if (CODE_EXTENSIONS.has(extension)) counts.code += 1;
    else counts.unsupported += 1;
  }
  return counts;
}

function sourceKind(counts: SourceCounts): 'code' | 'documents' | 'mixed' {
  if (counts.code > 0 && counts.documents > 0) return 'mixed';
  return counts.code > 0 ? 'code' : 'documents';
}

async function extractDocuments(
  root: string,
  files: SourceFile[],
  processing: string,
  skippedFiles: PreparedKnowledge['skippedFiles'],
  limits: StagingLimits,
  run: CommandRunner,
): Promise<{ documents: ExtractedDocument[] }> {
  const convertedDir = join(processing, '_converted');
  const documents: ExtractedDocument[] = [];
  let processedCount = 0;
  let processedBytes = 0;
  for (const file of files) {
    const extension = extensionOf(file.relativePath);
    if (!DOCUMENT_EXTENSIONS.has(extension) && !CONVERTIBLE_DOCUMENT_EXTENSIONS.has(extension)) {
      skippedFiles.push({ path: file.relativePath, reason: 'Unsupported file type' });
      continue;
    }
    try {
      const filePath = await safeSourcePath(root, file);
      const details = await stat(filePath);
      if (details.size > limits.maxInputFileBytes) {
        skippedFiles.push({ path: file.relativePath, reason: 'File exceeds 1 MiB limit' });
        continue;
      }
      if (processedCount >= limits.maxInputFiles) {
        skippedFiles.push({ path: file.relativePath, reason: 'Staging file limit of 10,000 reached' });
        continue;
      }
      if (processedBytes + details.size > limits.maxInputBytes) {
        skippedFiles.push({ path: file.relativePath, reason: 'Staging size limit of 100 MiB reached' });
        continue;
      }
      if (CONVERTIBLE_DOCUMENT_EXTENSIONS.has(extension)) {
        const convertedPath = join(convertedDir, `${file.relativePath}.md`);
        await mkdir(dirname(convertedPath), { recursive: true, mode: 0o700 });
        const result = await run('markitdown', [filePath, '-o', convertedPath], { env: markItDownEnvironment() });
        if (!result.error && result.status === 0) {
          const content = await readFile(convertedPath, 'utf8');
          documents.push({ path: `${file.relativePath}.md`, content });
          processedCount += 1;
          processedBytes += details.size;
        } else {
          skippedFiles.push({ path: file.relativePath, reason: commandOutput(result.stderr) || 'markitdown failed' });
        }
      } else {
        const content = await readFile(filePath, 'utf8');
        documents.push({ path: file.relativePath, content });
        processedCount += 1;
        processedBytes += details.size;
      }
    } catch (error: unknown) {
      skippedFiles.push({ path: file.relativePath, reason: errorMessage(error) });
    }
  }
  return { documents };
}

async function summarizeCode(
  root: string,
  files: SourceFile[],
  skippedFiles: PreparedKnowledge['skippedFiles'],
  run: CommandRunner,
): Promise<string> {
  const codeFiles = files.filter((file) => CODE_EXTENSIONS.has(extensionOf(file.relativePath)));
  if (codeFiles.length === 0) return '';
  try {
    const result = await run('codebase-memory-mcp', ['--json', 'summary', '--root', root], { cwd: root, env: cleanModelEnvironment() });
    if (result.error || result.status !== 0) {
      skippedFiles.push({ path: '.', reason: `codebase-memory-mcp summary failed: ${commandOutput(result.stderr) || result.status}` });
      return '';
    }
    const output = commandOutput(result.stdout);
    if (!output.trim()) return '';
    let parsed: CodebaseMemorySummary;
    try {
      parsed = JSON.parse(output) as CodebaseMemorySummary;
    } catch {
      return output.slice(0, MAX_ARCHITECTURE_BYTES);
    }
    if (parsed.summary) return parsed.summary;
    if (Array.isArray(parsed.files)) {
      const parts = parsed.files
        .filter((entry) => entry && typeof entry.path === 'string')
        .map((entry) => `## ${entry.path}\n${entry.summary ?? ''}`);
      return parts.join('\n\n');
    }
    return output.slice(0, MAX_ARCHITECTURE_BYTES);
  } catch (error: unknown) {
    skippedFiles.push({ path: '.', reason: errorMessage(error) });
    return '';
  }
}

async function safeSourcePath(root: string, file: SourceFile): Promise<string> {
  const details = await lstat(file.absolutePath);
  if (!details.isSymbolicLink()) return file.absolutePath;
  const target = await realpath(file.absolutePath);
  if (!isWithin(root, target)) throw new Error('Symlink escapes source root');
  return target;
}

function markItDownEnvironment(): NodeJS.ProcessEnv {
  const environment = { ...process.env };
  delete environment.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT;
  delete environment.AZURE_DOCUMENT_INTELLIGENCE_KEY;
  delete environment.OPENAI_API_KEY;
  return environment;
}

function cleanModelEnvironment(): NodeJS.ProcessEnv {
  const environment = { ...process.env };
  delete environment.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT;
  delete environment.AZURE_DOCUMENT_INTELLIGENCE_KEY;
  delete environment.OPENAI_API_KEY;
  delete environment.ANTHROPIC_API_KEY;
  return environment;
}


function appendDocument(
  envelope: OkfEnvelope,
  path: string,
  content: string,
  skippedFiles: PreparedKnowledge['skippedFiles'],
): void {
  if (envelope.documents.length >= MAX_DOCUMENTS) {
    skippedFiles.push({ path, reason: 'Document limit of 500 reached' });
    return;
  }
  const document = {
    path: toPosixPath(path),
    content,
    contentHash: contentHash(content),
    evidence: [],
  };
  const candidate: OkfEnvelope = { ...envelope, documents: [...envelope.documents, document] };
  if (new TextEncoder().encode(JSON.stringify(candidate)).byteLength > MAX_ENVELOPE_BYTES) {
    skippedFiles.push({ path, reason: 'Document exceeds 10 MiB bundle limit' });
    return;
  }
  envelope.documents.push(document);
}

function contentHash(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

function truncateUtf8(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, 'utf8') <= maxBytes) return value;
  let result = '';
  for (const character of value) {
    if (Buffer.byteLength(result, 'utf8') + Buffer.byteLength(character, 'utf8') > maxBytes) break;
    result += character;
  }
  return result;
}

function extensionOf(path: string): string {
  const index = path.lastIndexOf('.');
  return index === -1 ? '' : path.slice(index).toLowerCase();
}

function commandOutput(value: string | Buffer | undefined): string {
  return typeof value === 'string' ? value : value?.toString('utf8') ?? '';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isNotFound(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

function isWithin(root: string, path: string): boolean {
  const between = relative(root, path);
  return between !== '..' && !between.startsWith(`..${sep}`) && !isAbsolute(between);
}

function toPosixPath(path: string): string {
  return path.split(sep).join('/');
}
