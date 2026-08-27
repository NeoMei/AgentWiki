import { homedir, tmpdir } from 'node:os';
import { cwd } from 'node:process';
import { basename, dirname, isAbsolute, join, parse, resolve, sep } from 'node:path';

const MIB = 1024n * 1024n;
const GENERATED_DEVELOPMENT_PATH = resolve(
  join(tmpdir(), 'agentwiki-development-attachments'),
);
const TEST_STORAGE_BASENAME_PATTERN = /^agentwiki-attachment-test-[A-Za-z0-9_-]+$/;

type StoragePathException = 'none' | 'implicit-development' | 'explicit-test';

export interface AttachmentConfig {
  storagePath: string;
  maxFileBytes: bigint;
  maxSpaceBytes: bigint;
  maxDimension: number;
  maxPixels: bigint;
  minFreeBytes: bigint;
  retentionMs: number;
  orphanGraceMs: number;
  contentLockTimeoutMs: number;
}

function positiveBigInt(value: string | undefined, fallback: bigint, name: string): bigint {
  if (value === undefined || value === '') {
    return fallback;
  }
  if (!/^[1-9][0-9]*$/.test(value)) {
    throw new Error(`${name} must be a positive integer`);
  }
  return BigInt(value);
}

function positiveSafeInteger(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value === '') {
    return fallback;
  }
  if (!/^[1-9][0-9]*$/.test(value)) {
    throw new Error(`${name} must be a positive integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${name} must be a safe integer`);
  }
  return parsed;
}

function isWithin(path: string, parent: string): boolean {
  return path === parent || path.startsWith(parent + sep);
}

function permitsTemporaryPath(
  normalized: string,
  pathException: StoragePathException,
): boolean {
  if (pathException === 'implicit-development') {
    return normalized === GENERATED_DEVELOPMENT_PATH;
  }
  if (pathException === 'explicit-test') {
    return (
      resolve(dirname(normalized)) === resolve(tmpdir()) &&
      TEST_STORAGE_BASENAME_PATTERN.test(basename(normalized))
    );
  }
  return false;
}

function validateStoragePath(
  value: string,
  pathException: StoragePathException = 'none',
): string {
  if (value !== value.trim() || !isAbsolute(value)) {
    throw new Error('ATTACHMENT_STORAGE_PATH must be an absolute path');
  }
  const normalized = resolve(value);
  const root = parse(normalized).root;
  const broadPaths = new Set([
    root,
    '/tmp',
    '/var',
    resolve(tmpdir()),
    resolve(homedir()),
    resolve(cwd()),
  ]);
  const pathSegments = normalized.slice(root.length).split(sep).filter(Boolean);
  if (broadPaths.has(normalized) || pathSegments.length < 3) {
    throw new Error('ATTACHMENT_STORAGE_PATH must be a narrow directory, not a filesystem root');
  }
  if (
    !permitsTemporaryPath(normalized, pathException) &&
    [resolve(tmpdir()), '/tmp', '/private/tmp', resolve(homedir()), resolve(cwd())].some(
      (parent) => isWithin(normalized, parent),
    )
  ) {
    throw new Error(
      'ATTACHMENT_STORAGE_PATH must be outside temporary, home, and deployment trees',
    );
  }
  const forbiddenSystemTrees = [
    '/Applications',
    '/Library',
    '/System',
    '/bin',
    '/dev',
    '/etc',
    '/proc',
    '/sbin',
    '/sys',
    '/usr',
  ];
  if (forbiddenSystemTrees.some((parent) => isWithin(normalized, parent))) {
    throw new Error('ATTACHMENT_STORAGE_PATH must be outside system-managed trees');
  }
  return normalized;
}

export function loadAttachmentConfig(
  environment: NodeJS.ProcessEnv = process.env,
): AttachmentConfig {
  const configuredPath = environment.ATTACHMENT_STORAGE_PATH;
  if (!configuredPath && environment.NODE_ENV === 'production') {
    throw new Error('ATTACHMENT_STORAGE_PATH is required in production');
  }

  const pathException: StoragePathException =
    configuredPath === undefined
      ? 'implicit-development'
      : environment.NODE_ENV === 'test'
        ? 'explicit-test'
        : 'none';
  const storagePath = validateStoragePath(
    configuredPath ?? GENERATED_DEVELOPMENT_PATH,
    pathException,
  );
  const retentionDays = positiveSafeInteger(
    environment.ATTACHMENT_RETENTION_DAYS,
    30,
    'ATTACHMENT_RETENTION_DAYS',
  );
  const orphanGraceHours = positiveSafeInteger(
    environment.ATTACHMENT_ORPHAN_GRACE_HOURS,
    24,
    'ATTACHMENT_ORPHAN_GRACE_HOURS',
  );

  return {
    storagePath,
    maxFileBytes: positiveBigInt(
      environment.ATTACHMENT_MAX_FILE_BYTES,
      10n * MIB,
      'ATTACHMENT_MAX_FILE_BYTES',
    ),
    maxSpaceBytes: positiveBigInt(
      environment.ATTACHMENT_MAX_SPACE_BYTES,
      500n * MIB,
      'ATTACHMENT_MAX_SPACE_BYTES',
    ),
    maxDimension: positiveSafeInteger(
      environment.ATTACHMENT_MAX_DIMENSION,
      10_000,
      'ATTACHMENT_MAX_DIMENSION',
    ),
    maxPixels: positiveBigInt(
      environment.ATTACHMENT_MAX_PIXELS,
      40_000_000n,
      'ATTACHMENT_MAX_PIXELS',
    ),
    minFreeBytes: positiveBigInt(
      environment.ATTACHMENT_MIN_FREE_BYTES,
      1024n * MIB,
      'ATTACHMENT_MIN_FREE_BYTES',
    ),
    retentionMs: retentionDays * 24 * 60 * 60 * 1000,
    orphanGraceMs: orphanGraceHours * 60 * 60 * 1000,
    contentLockTimeoutMs: positiveSafeInteger(
      environment.ATTACHMENT_CONTENT_LOCK_TIMEOUT_MS,
      5_000,
      'ATTACHMENT_CONTENT_LOCK_TIMEOUT_MS',
    ),
  };
}
