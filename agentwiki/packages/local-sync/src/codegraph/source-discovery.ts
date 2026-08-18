import { lstat, realpath, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { contentHash } from '../utils/hash.js';
import { OnboardingError } from '../onboarding/errors.js';

const CODE_FILENAMES = new Set([
  'package.json', 'pnpm-workspace.yaml', 'package-lock.json', 'yarn.lock', 'cargo.toml', 'go.mod',
  'pyproject.toml', 'requirements.txt', 'gemfile', 'composer.json', 'pom.xml', 'build.gradle',
]);
const CODE_EXTENSIONS = new Set([
  '.c', '.cc', '.cpp', '.cs', '.css', '.go', '.h', '.hpp', '.html', '.java', '.js', '.jsx', '.kt',
  '.kts', '.mjs', '.mts', '.php', '.py', '.rb', '.rs', '.scala', '.sh', '.sql', '.swift', '.ts', '.tsx', '.vue',
]);
const DOCUMENT_EXTENSIONS = new Set(['.csv', '.doc', '.docx', '.md', '.odt', '.pdf', '.ppt', '.pptx', '.rtf', '.txt', '.xls', '.xlsx']);
const IGNORED_DIRECTORIES = new Set(['.codegraph', '.git', '.hg', '.svn', 'dist', 'node_modules', 'vendor']);
const MAX_FILENAME_INSPECTIONS = 2_000;
const MAX_DIRECTORY_DEPTH = 8;

export interface DiscoverCodeSourcesInput {
  sourcePaths: string[];
  sourceType: 'auto' | 'code' | 'documents';
}

export interface DiscoveredCodeSource {
  sourceKey: string;
  displayPath: string;
  canonicalSourcePath: string;
  indexPath: string;
}

function planningError(message: string, diagnostic: string): OnboardingError {
  const error = new OnboardingError({
    code: 'CODEGRAPH_CAPABILITY_UNSUPPORTED',
    message,
    retryable: false,
  });
  Object.assign(error, { diagnostic });
  return error;
}

function isWithin(path: string, parent: string): boolean {
  const difference = relative(parent, path);
  return difference === '' || (!difference.startsWith(`..${sep}`) && difference !== '..' && !isAbsolute(difference));
}

function hasTraversalSegment(path: string): boolean {
  return path.split(/[\\/]/u).includes('..');
}

async function canonicalHomeDirectory(): Promise<string> {
  try {
    return await realpath(homedir());
  } catch {
    return resolve(homedir());
  }
}

async function validateSourcePath(sourcePath: string): Promise<DiscoveredCodeSource> {
  if (!sourcePath || hasTraversalSegment(sourcePath)) {
    throw planningError('CodeGraph source path is not allowed', `Rejected source path: ${sourcePath}`);
  }

  let canonicalSourcePath: string;
  try {
    canonicalSourcePath = await realpath(resolve(sourcePath));
  } catch {
    throw planningError('CodeGraph source must be an existing directory', `Unable to resolve source path: ${sourcePath}`);
  }

  let sourceStats;
  try {
    sourceStats = await stat(canonicalSourcePath);
  } catch {
    throw planningError('CodeGraph source must be an existing directory', `Unable to stat source path: ${canonicalSourcePath}`);
  }
  if (!sourceStats.isDirectory()) {
    throw planningError('CodeGraph source must be a directory', `Source is not a directory: ${canonicalSourcePath}`);
  }

  const homeDirectory = await canonicalHomeDirectory();
  if (canonicalSourcePath === resolve(sep) || canonicalSourcePath === homeDirectory) {
    throw planningError('CodeGraph source path is not allowed', `Rejected filesystem root or home directory: ${canonicalSourcePath}`);
  }

  const indexPath = join(canonicalSourcePath, '.codegraph');
  try {
    const indexStats = await lstat(indexPath);
    if (indexStats.isSymbolicLink()) {
      const canonicalIndexPath = await realpath(indexPath);
      if (!isWithin(canonicalIndexPath, indexPath)) {
        throw planningError('CodeGraph index path is not allowed', `CodeGraph index symlink escapes source root: ${indexPath} -> ${canonicalIndexPath}`);
      }
    }
  } catch (error) {
    if (error instanceof OnboardingError) throw error;
    // A missing index is expected before a confirmed initialization.
  }

  return {
    sourceKey: contentHash(canonicalSourcePath),
    displayPath: basename(canonicalSourcePath),
    canonicalSourcePath,
    indexPath,
  };
}

function extension(filename: string): string {
  const index = filename.lastIndexOf('.');
  return index === -1 ? '' : filename.slice(index).toLowerCase();
}

async function containsCodeFilename(root: string): Promise<boolean> {
  const pending = [{ directory: root, depth: 0 }];
  let inspected = 0;

  while (pending.length > 0 && inspected < MAX_FILENAME_INSPECTIONS) {
    const current = pending.shift()!;
    const entries = await readdir(current.directory, { withFileTypes: true });
    for (const entry of entries) {
      inspected += 1;
      const filename = entry.name.toLowerCase();
      if (CODE_FILENAMES.has(filename) || CODE_EXTENSIONS.has(extension(filename))) return true;
      if (entry.isDirectory() && current.depth < MAX_DIRECTORY_DEPTH && !IGNORED_DIRECTORIES.has(filename)) {
        pending.push({ directory: join(current.directory, entry.name), depth: current.depth + 1 });
      }
      if (inspected >= MAX_FILENAME_INSPECTIONS) break;
    }
  }
  return false;
}

/**
 * Validates local roots and, for `auto`, classifies them by directory-entry
 * names only. It never opens a source file or an index database.
 */
export async function discoverCodeSources(input: DiscoverCodeSourcesInput): Promise<DiscoveredCodeSource[]> {
  const discovered: DiscoveredCodeSource[] = [];
  const sourceKeys = new Set<string>();

  for (const sourcePath of input.sourcePaths) {
    const source = await validateSourcePath(sourcePath);
    if (sourceKeys.has(source.sourceKey)) {
      throw planningError('CodeGraph source paths must be unique', `Duplicate canonical source path: ${source.canonicalSourcePath}`);
    }
    sourceKeys.add(source.sourceKey);

    if (input.sourceType === 'documents') continue;
    if (input.sourceType === 'auto' && !(await containsCodeFilename(source.canonicalSourcePath))) continue;
    discovered.push(source);
  }

  return discovered;
}

export const SOURCE_DISCOVERY_LIMITS = {
  maxFilenameInspections: MAX_FILENAME_INSPECTIONS,
  maxDirectoryDepth: MAX_DIRECTORY_DEPTH,
  documentExtensions: DOCUMENT_EXTENSIONS,
} as const;
