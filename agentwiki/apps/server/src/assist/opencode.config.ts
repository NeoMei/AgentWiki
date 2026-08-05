import { ConfigService } from '@nestjs/config';

export interface RoutingConfig {
  freeModels: string[]; paidModelExcludes: string[]; allowPaidFallback: boolean;
  maxFreeAttempts: number; maxPaidAttempts: number; totalTimeoutMs: number;
  attemptTimeoutMs: number; modelCacheMs: number; modelStaleMs: number;
  modelEnumTimeoutMs: number; estimatedOutputTokens: number;
  circuitFailures: number; circuitWindowMs: number; circuitOpenMs: number;
}

const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._:/-]*$/u;
const integer = (raw: unknown, fallback: number, name: string, max: number) => {
  const value = raw === undefined || raw === '' ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > max) {
    throw new Error(`${name} must be an integer from 1 to ${max}`);
  }
  return value;
};
const boolean = (raw: unknown, fallback: boolean, name: string) => {
  if (raw === undefined || raw === '') return fallback;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw new Error(`${name} must be true or false`);
};
const models = (raw: unknown, name: string) => [...new Set(String(raw || '').split(',').map((x) => x.trim()).filter(Boolean))]
  .map((id) => {
    const hasPathSegment = id.split('/').some((part) => part === '.' || part === '..' || part === '');
    if (!MODEL_ID.test(id) || hasPathSegment) throw new Error(`${name} contains invalid model ID ${id}`);
    return id;
  });

export const readRoutingConfig = (config: ConfigService): RoutingConfig => ({
  freeModels: models(config.get('ASSIST_OPENCODE_FREE_MODELS'), 'ASSIST_OPENCODE_FREE_MODELS'),
  paidModelExcludes: models(config.get('ASSIST_OPENCODE_PAID_MODEL_EXCLUDES'), 'ASSIST_OPENCODE_PAID_MODEL_EXCLUDES'),
  allowPaidFallback: boolean(config.get('ASSIST_OPENCODE_ALLOW_PAID_FALLBACK'), true, 'ASSIST_OPENCODE_ALLOW_PAID_FALLBACK'),
  maxFreeAttempts: integer(config.get('ASSIST_OPENCODE_MAX_FREE_ATTEMPTS'), 3, 'ASSIST_OPENCODE_MAX_FREE_ATTEMPTS', 3),
  maxPaidAttempts: integer(config.get('ASSIST_OPENCODE_MAX_PAID_ATTEMPTS'), 1, 'ASSIST_OPENCODE_MAX_PAID_ATTEMPTS', 1),
  totalTimeoutMs: integer(config.get('ASSIST_OPENCODE_TIMEOUT_MS'), 180_000, 'ASSIST_OPENCODE_TIMEOUT_MS', 180_000),
  attemptTimeoutMs: integer(config.get('ASSIST_OPENCODE_ATTEMPT_TIMEOUT_MS'), 60_000, 'ASSIST_OPENCODE_ATTEMPT_TIMEOUT_MS', 180_000),
  modelCacheMs: integer(config.get('ASSIST_OPENCODE_MODEL_CACHE_MS'), 600_000, 'ASSIST_OPENCODE_MODEL_CACHE_MS', 86_400_000),
  modelStaleMs: integer(config.get('ASSIST_OPENCODE_MODEL_STALE_MS'), 3_600_000, 'ASSIST_OPENCODE_MODEL_STALE_MS', 86_400_000),
  modelEnumTimeoutMs: integer(config.get('ASSIST_OPENCODE_MODEL_ENUM_TIMEOUT_MS'), 10_000, 'ASSIST_OPENCODE_MODEL_ENUM_TIMEOUT_MS', 60_000),
  estimatedOutputTokens: integer(config.get('ASSIST_OPENCODE_ESTIMATED_OUTPUT_TOKENS'), 2_000, 'ASSIST_OPENCODE_ESTIMATED_OUTPUT_TOKENS', 128_000),
  circuitFailures: integer(config.get('ASSIST_OPENCODE_CIRCUIT_FAILURES'), 3, 'ASSIST_OPENCODE_CIRCUIT_FAILURES', 10),
  circuitWindowMs: integer(config.get('ASSIST_OPENCODE_CIRCUIT_WINDOW_MS'), 300_000, 'ASSIST_OPENCODE_CIRCUIT_WINDOW_MS', 3_600_000),
  circuitOpenMs: integer(config.get('ASSIST_OPENCODE_CIRCUIT_OPEN_MS'), 120_000, 'ASSIST_OPENCODE_CIRCUIT_OPEN_MS', 3_600_000),
});
