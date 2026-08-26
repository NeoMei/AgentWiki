import { isAbsolute, join, parse, resolve } from 'node:path';

const MIB = 1024n * 1024n;

export interface AttachmentConfig {
  storagePath: string;
  maxFileBytes: bigint;
  maxSpaceBytes: bigint;
  maxDimension: number;
  maxPixels: bigint;
  minFreeBytes: bigint;
  retentionMs: number;
  orphanGraceMs: number;
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

function validateStoragePath(value: string): string {
  if (value !== value.trim() || !isAbsolute(value)) {
    throw new Error('ATTACHMENT_STORAGE_PATH must be an absolute path');
  }
  const normalized = resolve(value);
  if (normalized === parse(normalized).root) {
    throw new Error('ATTACHMENT_STORAGE_PATH must be a narrow directory, not a filesystem root');
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

  const storagePath = validateStoragePath(
    configuredPath ?? join(process.cwd(), '.data', 'attachments'),
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
  };
}
