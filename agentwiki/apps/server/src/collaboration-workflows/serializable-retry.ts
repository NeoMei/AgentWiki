import { BusinessException } from '../core/filters/business-error';

const MAX_SERIALIZABLE_ATTEMPTS = 3;

export async function withCollaborationSerializableRetry<T>(work: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < MAX_SERIALIZABLE_ATTEMPTS; attempt += 1) {
    try {
      return await work();
    } catch (error) {
      if (!isCollaborationSerializationConflict(error)) throw error;
      if (attempt === MAX_SERIALIZABLE_ATTEMPTS - 1) {
        throw new BusinessException(
          'COLLABORATION_PROGRESS_INVARIANT',
          'Concurrent collaboration updates conflicted repeatedly',
        );
      }
    }
  }
  throw new BusinessException('COLLABORATION_PROGRESS_INVARIANT', 'Unable to serialize collaboration update');
}

export function isCollaborationSerializationConflict(error: unknown): boolean {
  const code = errorCode(error);
  return code === 'P2034'
    || (code === 'P2010' && rawDatabaseCode(errorMeta(error)) === '40001');
}

function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

function errorMeta(error: unknown): unknown {
  return error && typeof error === 'object' ? (error as { meta?: unknown }).meta : undefined;
}

function rawDatabaseCode(meta: unknown): string | undefined {
  if (!meta || typeof meta !== 'object') return undefined;
  const code = (meta as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}
