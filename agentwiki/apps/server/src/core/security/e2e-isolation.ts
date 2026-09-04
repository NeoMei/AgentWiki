import { isIP } from 'node:net';

const E2E_SCHEMA_PATTERN = /^mac_e2e_[A-Za-z0-9_]+$/;

function isLoopbackHost(value: string | undefined, allowLocalhost: boolean): boolean {
  if (!value || value !== value.trim()) return false;
  const normalized = value.toLowerCase().replace(/^\[|\]$/g, '');
  if (allowLocalhost && normalized === 'localhost') return true;
  if (normalized === '::1') return true;
  return isIP(normalized) === 4 && normalized.startsWith('127.');
}

export function isIsolatedE2EEnvironment(environment: NodeJS.ProcessEnv): boolean {
  if (environment.NODE_ENV !== 'test') return false;
  if (!isLoopbackHost(environment.AGENTWIKI_LISTEN_HOST, false)) return false;
  try {
    const databaseUrl = new URL(environment.DATABASE_URL ?? '');
    if (!['postgres:', 'postgresql:'].includes(databaseUrl.protocol)) return false;
    if (!isLoopbackHost(databaseUrl.hostname, true)) return false;
    const databaseName = decodeURIComponent(databaseUrl.pathname.slice(1));
    if (!databaseName.toLowerCase().includes('test')) return false;
    const schemas = databaseUrl.searchParams.getAll('schema');
    return schemas.length === 1 && E2E_SCHEMA_PATTERN.test(schemas[0]);
  } catch {
    return false;
  }
}
