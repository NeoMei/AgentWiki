import { spawnSync } from 'node:child_process';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export function resolveTestRedisTarget(
  value,
  { enabled = true, environment = process.env } = {},
) {
  if (!enabled) return undefined;
  if (!value) {
    throw new Error(
      'TEST_REDIS_URL is required when a database-backed integration gate is enabled',
    );
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('TEST_REDIS_URL must be an absolute redis:// or rediss:// URL');
  }
  if (!['redis:', 'rediss:'].includes(url.protocol)) {
    throw new Error('TEST_REDIS_URL must be an absolute redis:// or rediss:// URL');
  }
  if (!LOOPBACK_HOSTS.has(url.hostname)) {
    throw new Error('TEST_REDIS_URL must target a loopback Redis instance');
  }

  const database = url.pathname.replace(/^\/+|\/+$/gu, '');
  if (database && !/^\d+$/u.test(database)) {
    throw new Error('TEST_REDIS_URL database must be a non-negative integer');
  }

  const probeEnvironment = { ...environment };
  delete probeEnvironment.REDISCLI_AUTH;
  if (url.password) probeEnvironment.REDISCLI_AUTH = decodeURIComponent(url.password);

  const hostname = url.hostname === '[::1]' ? '::1' : url.hostname;
  const probeArgs = ['-h', hostname];
  if (url.port) probeArgs.push('-p', url.port);
  if (url.username) probeArgs.push('--user', decodeURIComponent(url.username));
  if (database) probeArgs.push('-n', database);
  if (url.protocol === 'rediss:') probeArgs.push('--tls');
  probeArgs.push('ping');

  return {
    url: url.toString(),
    probeCommand: 'redis-cli',
    probeArgs,
    probeOptions: { encoding: 'utf8', env: probeEnvironment, timeout: 5_000 },
  };
}

export function probeTestRedis(target, spawn = spawnSync) {
  return spawn(
    target.probeCommand,
    target.probeArgs,
    target.probeOptions,
  );
}

export function assertTestRedisAvailable(target, spawn = spawnSync) {
  const result = probeTestRedis(target, spawn);
  if (result.status !== 0 || String(result.stdout ?? '').trim() !== 'PONG') {
    throw new Error('TEST_REDIS_URL is unavailable');
  }
  return target;
}

export function assertE2ETarget(value, environment = process.env, prefix = 'AGENTWIKI_E2E') {
  if (environment[prefix] !== '1') {
    throw new Error(`This destructive verifier requires ${prefix}=1`);
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('AgentWiki E2E target must be an absolute HTTP(S) URL');
  }

  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('AgentWiki E2E target must be an absolute HTTP(S) URL without credentials');
  }

  if (!LOOPBACK_HOSTS.has(url.hostname)) {
    if (environment[`${prefix}_ALLOW_REMOTE`] !== '1') {
      throw new Error(`A remote target requires ${prefix}_ALLOW_REMOTE=1`);
    }
    if (url.protocol !== 'https:') {
      throw new Error('A remote AgentWiki E2E target must use HTTPS');
    }
    const confirmedHost = environment[`${prefix}_CONFIRM_HOST`]?.trim().toLowerCase();
    if (!confirmedHost || confirmedHost !== url.hostname.toLowerCase()) {
      throw new Error('The AgentWiki E2E target must match the confirmed host');
    }
  }

  return url.toString().replace(/\/+$/u, '');
}
export async function cleanupFixture(fixture, remove) {
  const failures = [];
  for (const [kind, id] of [
    ['agent', fixture.agentId],
    ['space', fixture.spaceId],
    ['user', fixture.userId],
  ]) {
    if (!id) continue;
    try {
      await remove(kind, id);
    } catch {
      failures.push(kind);
    }
  }
  if (failures.length) throw new Error(`Cleanup failed for ${failures.join(', ')}`);
}
