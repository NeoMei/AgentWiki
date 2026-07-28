import { createHash } from 'node:crypto';
import { spawn, type SpawnOptions } from 'node:child_process';
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
} from 'node:fs/promises';
import { isIP } from 'node:net';
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

export interface OpenWikiProvider {
  provider: string;
  model?: string;
  baseUrl?: string;
  local: boolean;
}

export interface SourceInspection {
  displayName: string;
  kind: 'code' | 'documents' | 'mixed';
  files: { code: number; documents: number; unsupported: number };
  provider: OpenWikiProvider;
  dependencies: { openwiki: ToolStatus; markitdown: ToolStatus; git: ToolStatus };
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
  producer: { name: 'openwiki'; version: string };
  documents: Array<{
    path: string;
    content: string;
    contentHash: string;
    evidence?: Array<{ sourcePath: string; sourceHash: string; quote: string }>;
  }>;
}

export interface PreparedKnowledge {
  envelope: OkfEnvelope;
  envelopeBytes: Uint8Array;
  sourceKey: string;
  processedFiles: number;
  skippedFiles: Array<{ path: string; reason: string }>;
  provider: SourceInspection['provider'];
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

interface ConvertibleDocument {
  inputPath: string;
  relativePath: string;
}

/**
 * Classifies the configured OpenWiki provider without returning credentials.
 *
 * @param environment Environment values from the process and OpenWiki env file.
 * @returns A safe provider disclosure for the confirmation UI.
 */
export function inspectOpenWikiProvider(environment: Record<string, string | undefined>): OpenWikiProvider {
  const provider = environment.OPENWIKI_PROVIDER?.trim() || 'openai';
  const model = environment.OPENWIKI_MODEL_ID?.trim() || undefined;
  const baseUrl = providerBaseUrl(provider, environment);
  const local = provider === 'ollama'
    ? isLoopbackUrl(baseUrl ?? '127.0.0.1:11434')
    : isLoopbackUrl(baseUrl);

  return {
    provider,
    ...(model ? { model } : {}),
    ...(baseUrl ? { baseUrl } : {}),
    local,
  };
}

/**
 * Inspects a local source and available command line dependencies without invoking OpenWiki.
 *
 * @param path Local source directory.
 * @param deps Optional clock, home directory, and command runner dependencies.
 * @returns A path-safe source inspection.
 */
export async function inspectLocalSource(path: string, deps?: LocalKnowledgeDeps): Promise<SourceInspection> {
  const dependencies = deps ?? defaultDependencies();
  const root = await resolveRoot(path);
  const [files, providerEnvironment, tools] = await Promise.all([
    listSourceFiles(root),
    loadProviderEnvironment(dependencies.home),
    Promise.all(['openwiki', 'markitdown', 'git'].map((command) => inspectTool(command, dependencies.run))),
  ]);
  const counts = classifyFiles(files);

  return {
    displayName: basename(root),
    kind: sourceKind(counts),
    files: counts,
    provider: inspectOpenWikiProvider(providerEnvironment),
    dependencies: { openwiki: tools[0], markitdown: tools[1], git: tools[2] },
  };
}

/**
 * Builds a private OpenWiki knowledge bundle from a local source directory.
 *
 * @param input Source and consent inputs.
 * @param deps Optional clock, home directory, and command runner dependencies.
 * @returns A self-contained OKF envelope with no absolute source paths.
 */
export async function prepareKnowledgeSync(input: PrepareInput, deps?: LocalKnowledgeDeps): Promise<PreparedKnowledge> {
  const dependencies = deps ?? defaultDependencies();
  const provider = inspectOpenWikiProvider(await loadProviderEnvironment(dependencies.home));
  if (!provider.local && input.allowRemoteModel !== true) {
    throw new Error('Remote OpenWiki model consent is required');
  }

  const root = await resolveRoot(input.path);
  const files = await sourceFilesForStaging(root, dependencies.run);
  const stagingLimits = { ...DEFAULT_STAGING_LIMITS, ...dependencies.limits };
  const counts = classifyFiles(files);
  const skippedFiles: PreparedKnowledge['skippedFiles'] = [];
  const sourceKey = await getOrCreateSourceKey(dependencies.home, root);
  const staging = await mkdtemp(join(tmpdir(), 'agentwiki-local-sync-'));

  try {
    const staged = await stageFiles(root, files, staging, skippedFiles, stagingLimits);
    await convertDocuments(staged.convertible, staging, dependencies.run, skippedFiles);
    await initializeStagingGitRepository(staging, dependencies.run);
    await runChecked(dependencies.run, 'openwiki', ['code', '--update', '--print'], {
      cwd: staging,
      env: { ...process.env, ...(await loadProviderEnvironment(dependencies.home)), DO_NOT_TRACK: '1' },
    });

    const envelope: OkfEnvelope = {
      okfVersion: '0.1',
      sourceKey,
      name: basename(root),
      kind: sourceKind(counts),
      producer: { name: 'openwiki', version: 'unknown' },
      documents: [],
    };

    await appendGeneratedDocuments(envelope, staging, skippedFiles);
    if (input.codebaseMemorySummary) {
      appendDocument(envelope, 'architecture/codebase-memory.md', truncateUtf8(input.codebaseMemorySummary, MAX_ARCHITECTURE_BYTES), skippedFiles);
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
      provider,
    };
  } finally {
    await rm(staging, { recursive: true, force: true });
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
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, COMMAND_TIMEOUT_MS);

    child.stdout?.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.once('error', (error) => {
      clearTimeout(timeout);
      resolveResult({ status: null, error, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) });
    });
    child.once('close', (status) => {
      clearTimeout(timeout);
      resolveResult({
        status,
        ...(timedOut ? { error: new Error(`${command} timed out after 30 minutes`) } : {}),
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
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

async function loadProviderEnvironment(home: string): Promise<Record<string, string | undefined>> {
  const envPath = join(home, '.openwiki', '.env');
  let fromFile: Record<string, string | undefined> = {};
  try {
    fromFile = parseEnvFile(await readFile(envPath, 'utf8'));
  } catch (error: unknown) {
    if (!isNotFound(error)) throw error;
  }
  return { ...fromFile, ...process.env };
}

function parseEnvFile(contents: string): Record<string, string | undefined> {
  const result: Record<string, string | undefined> = {};
  for (const line of contents.split(/\r?\n/u)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/u);
    if (!match) continue;
    const value = match[2].replace(/^(['"])(.*)\1$/u, '$2');
    result[match[1]] = value;
  }
  return result;
}

function providerBaseUrl(provider: string, environment: Record<string, string | undefined>): string | undefined {
  const candidates = provider === 'openai-compatible'
    ? ['OPENAI_COMPATIBLE_BASE_URL', 'OPENAI_BASE_URL', 'OPENWIKI_BASE_URL']
    : provider === 'anthropic'
      ? ['ANTHROPIC_BASE_URL', 'OPENWIKI_BASE_URL']
      : provider === 'ollama'
        ? ['OLLAMA_HOST', 'OPENWIKI_BASE_URL']
        : ['OPENAI_BASE_URL', 'OPENWIKI_BASE_URL'];
  return candidates.map((name) => environment[name]?.trim()).find((value) => Boolean(value));
}

function isLoopbackUrl(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.includes('://') ? value : `http://${value}`;
  try {
    const host = new URL(normalized).hostname.toLowerCase();
    const ipAddress = host.replace(/^\[|\]$/gu, '');
    return host === 'localhost'
      || (isIP(ipAddress) === 4 && ipAddress.split('.')[0] === '127')
      || (isIP(ipAddress) === 6 && ipAddress === '::1');
  } catch {
    return false;
  }
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

async function sourceFilesForStaging(root: string, run: CommandRunner): Promise<SourceFile[]> {
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

async function stageFiles(
  root: string,
  files: SourceFile[],
  staging: string,
  skippedFiles: PreparedKnowledge['skippedFiles'],
  limits: StagingLimits,
): Promise<{ convertible: ConvertibleDocument[] }> {
  const convertible: ConvertibleDocument[] = [];
  let stagedCount = 0;
  let stagedBytes = 0;
  for (const file of files) {
    const extension = extensionOf(file.relativePath);
    if (!DOCUMENT_EXTENSIONS.has(extension) && !CODE_EXTENSIONS.has(extension)) {
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
      if (stagedCount >= limits.maxInputFiles) {
        skippedFiles.push({ path: file.relativePath, reason: 'Staging file limit of 10,000 reached' });
        continue;
      }
      if (stagedBytes + details.size > limits.maxInputBytes) {
        skippedFiles.push({ path: file.relativePath, reason: 'Staging size limit of 100 MiB reached' });
        continue;
      }
      const destination = join(staging, file.relativePath);
      await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
      await copyFile(filePath, destination);
      stagedCount += 1;
      stagedBytes += details.size;
      if (CONVERTIBLE_DOCUMENT_EXTENSIONS.has(extension)) {
        convertible.push({ inputPath: destination, relativePath: file.relativePath });
      }
    } catch (error: unknown) {
      skippedFiles.push({ path: file.relativePath, reason: errorMessage(error) });
    }
  }
  return { convertible };
}

async function safeSourcePath(root: string, file: SourceFile): Promise<string> {
  const details = await lstat(file.absolutePath);
  if (!details.isSymbolicLink()) return file.absolutePath;
  const target = await realpath(file.absolutePath);
  if (!isWithin(root, target)) throw new Error('Symlink escapes source root');
  return target;
}

async function convertDocuments(
  documents: ConvertibleDocument[],
  staging: string,
  run: CommandRunner,
  skippedFiles: PreparedKnowledge['skippedFiles'],
): Promise<void> {
  const conversionDir = join(staging, '_converted');
  await mkdir(conversionDir, { recursive: true, mode: 0o700 });
  for (const document of documents) {
    try {
      const outputPath = join(conversionDir, `${document.relativePath}.md`);
      await mkdir(dirname(outputPath), { recursive: true, mode: 0o700 });
      await runChecked(run, 'markitdown', [document.inputPath, '-o', outputPath], {
        cwd: staging,
        env: markItDownEnvironment(),
      });
    } catch (error: unknown) {
      skippedFiles.push({ path: document.relativePath, reason: errorMessage(error) });
    }
  }
}

async function initializeStagingGitRepository(staging: string, run: CommandRunner): Promise<void> {
  try {
    await lstat(join(staging, '.git'));
    return;
  } catch (error: unknown) {
    if (!isNotFound(error)) throw error;
  }
  await runChecked(run, 'git', ['init'], { cwd: staging, stdio: 'pipe' });
}

function markItDownEnvironment(): NodeJS.ProcessEnv {
  const environment = { ...process.env };
  delete environment.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT;
  delete environment.AZURE_DOCUMENT_INTELLIGENCE_KEY;
  delete environment.OPENAI_API_KEY;
  return environment;
}

async function runChecked(run: CommandRunner, command: string, args: string[], options: SpawnOptions): Promise<CommandResult> {
  const result = await run(command, args, options);
  if (!result.error && result.status === 0) return result;
  const details = commandOutput(result.stderr).trim();
  throw new Error(`Unable to run ${command}${details ? `: ${details}` : ''}`, { cause: result.error });
}

async function appendGeneratedDocuments(
  envelope: OkfEnvelope,
  staging: string,
  skippedFiles: PreparedKnowledge['skippedFiles'],
): Promise<void> {
  const outputRoot = join(staging, 'openwiki');
  try {
    const outputFiles = await listSourceFiles(outputRoot);
    for (const file of outputFiles) {
      if (extensionOf(file.relativePath) !== '.md' || file.relativePath === 'INSTRUCTIONS.md') continue;
      try {
        const path = await safeSourcePath(outputRoot, file);
        appendDocument(envelope, `openwiki/${file.relativePath}`, await readFile(path, 'utf8'), skippedFiles);
      } catch (error: unknown) {
        skippedFiles.push({ path: `openwiki/${file.relativePath}`, reason: errorMessage(error) });
      }
    }
  } catch (error: unknown) {
    if (!isNotFound(error)) throw error;
  }
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
  const document = { path: toPosixPath(path), content, contentHash: contentHash(content) };
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
