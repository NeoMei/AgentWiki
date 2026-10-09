#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const FULL_TEST_ENVIRONMENT_NAMES = Object.freeze([
  'DATABASE_URL',
  'FOLDER_TEST_DATABASE_URL',
  'MARKDOWN_TEST_DATABASE_URL',
  'COLLABORATION_TEST_DATABASE_URL',
  'PAGE_TEMPLATE_TEST_DATABASE_URL',
  'SYNC_V3_TEST_DATABASE_URL',
  'SYNC_VERSION_TEST_DATABASE_URL',
  'SOURCE_FRESHNESS_TEST_DATABASE_URL',
  'TEST_REDIS_URL',
]);

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
const DATABASE_NAME_PATTERN = /^agentwiki_[a-z0-9_]+$/u;

export function classifyFullTestEnvironment(environment = process.env) {
  const configuredNames = FULL_TEST_ENVIRONMENT_NAMES.filter((name) => (
    typeof environment[name] === 'string' && environment[name].trim().length > 0
  ));
  const missing = FULL_TEST_ENVIRONMENT_NAMES.filter((name) => !configuredNames.includes(name));
  return {
    mode: configuredNames.length === 0
      ? 'auto'
      : missing.length === 0
        ? 'explicit'
        : 'partial',
    configured: configuredNames.length,
    missing,
  };
}

export function buildFullTestEnvironment({
  baseDatabaseUrl,
  syncVersionDatabaseUrl,
  redisUrl,
  psqlBin,
  pgDumpBin,
}, sourceEnvironment = process.env) {
  if (!baseDatabaseUrl || !syncVersionDatabaseUrl || !redisUrl || !psqlBin || !pgDumpBin) {
    throw new Error('Local full-test environment is missing a required provisioned value');
  }
  return {
    ...sourceEnvironment,
    AGENTWIKI_FULL_TEST: '1',
    DATABASE_URL: baseDatabaseUrl,
    FOLDER_TEST_DATABASE_URL: baseDatabaseUrl,
    MARKDOWN_TEST_DATABASE_URL: baseDatabaseUrl,
    COLLABORATION_TEST_DATABASE_URL: baseDatabaseUrl,
    PAGE_TEMPLATE_TEST_DATABASE_URL: baseDatabaseUrl,
    SYNC_V3_TEST_DATABASE_URL: baseDatabaseUrl,
    SYNC_VERSION_TEST_DATABASE_URL: syncVersionDatabaseUrl,
    SOURCE_FRESHNESS_TEST_DATABASE_URL: baseDatabaseUrl,
    TEST_REDIS_URL: redisUrl,
    AGENTWIKI_PSQL_BIN: psqlBin,
    PG_DUMP_BIN: pgDumpBin,
  };
}

function resolveBinary(value, fallback) {
  const requested = value?.trim() || fallback;
  if (requested.includes('/')) {
    if (!existsSync(requested)) throw new Error(`${fallback} executable does not exist`);
    return requested;
  }
  const result = spawnSync('which', [requested], { encoding: 'utf8' });
  const resolved = result.status === 0 ? result.stdout.trim() : '';
  if (!resolved) throw new Error(`${requested} executable is unavailable`);
  return resolved;
}

function assertLoopbackUrl(rawUrl, label) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`${label} must be a valid URL`);
  }
  if (!LOOPBACK_HOSTS.has(parsed.hostname)) {
    throw new Error(`${label} must use a loopback host`);
  }
  return parsed;
}

function adminDatabaseUrl(environment) {
  const configured = environment.AGENTWIKI_TEST_POSTGRES_URL?.trim();
  const username = environment.PGUSER?.trim() || environment.USER?.trim();
  const raw = configured
    || `postgresql://${username ? `${encodeURIComponent(username)}@` : ''}127.0.0.1:${environment.PGPORT?.trim() || '5432'}/postgres`;
  const parsed = assertLoopbackUrl(raw, 'AGENTWIKI_TEST_POSTGRES_URL');
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error('AGENTWIKI_TEST_POSTGRES_URL must use PostgreSQL');
  }
  if (!parsed.username && username) parsed.username = encodeURIComponent(username);
  parsed.pathname = '/postgres';
  parsed.searchParams.delete('schema');
  return parsed;
}

function databaseUrlFor(adminUrl, name) {
  if (!DATABASE_NAME_PATTERN.test(name)) throw new Error('Generated test database name is unsafe');
  const parsed = new URL(adminUrl.href);
  parsed.pathname = `/${name}`;
  parsed.search = '';
  return parsed.href;
}

function redact(value, sensitiveValues) {
  let output = String(value ?? '');
  for (const sensitive of sensitiveValues.filter(Boolean).sort((a, b) => b.length - a.length)) {
    output = output.replaceAll(sensitive, '[REDACTED]');
  }
  return output;
}

function postgresEnvironment(rawUrl) {
  const parsed = new URL(rawUrl.href ?? rawUrl);
  const environment = { ...process.env };
  delete environment.DATABASE_URL;
  environment.PGHOST = parsed.hostname;
  environment.PGPORT = parsed.port || '5432';
  environment.PGDATABASE = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
  if (parsed.username) environment.PGUSER = decodeURIComponent(parsed.username);
  else delete environment.PGUSER;
  if (parsed.password) environment.PGPASSWORD = decodeURIComponent(parsed.password);
  else delete environment.PGPASSWORD;
  const sslMode = parsed.searchParams.get('sslmode');
  if (sslMode) environment.PGSSLMODE = sslMode;
  return environment;
}

function runPsql(psqlBin, adminUrl, sql, { allowFailure = false } = {}) {
  const result = spawnSync(psqlBin, [
    '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-At',
    '-c', sql,
  ], {
    encoding: 'utf8',
    env: postgresEnvironment(adminUrl),
    maxBuffer: 4 * 1024 * 1024,
  });
  if (!allowFailure && (result.error || result.status !== 0)) {
    throw new Error(redact(
      [result.error?.message, result.stdout, result.stderr].filter(Boolean).join('\n'),
      [adminUrl.href, adminUrl.password, decodeURIComponent(adminUrl.password)],
    ));
  }
  return result;
}

function createDatabase(psqlBin, adminUrl, name) {
  const exists = runPsql(
    psqlBin,
    adminUrl,
    `SELECT 1 FROM pg_database WHERE datname = '${name}'`,
  );
  if (exists.stdout.trim() === '1') {
    throw new Error(`Refusing to reuse an existing auto-provisioned database: ${name}`);
  }
  runPsql(psqlBin, adminUrl, `CREATE DATABASE "${name}"`);
  const databaseUrl = databaseUrlFor(adminUrl, name);
  runPsql(psqlBin, new URL(databaseUrl), 'CREATE EXTENSION IF NOT EXISTS vector');
  return databaseUrl;
}

function dropDatabase(psqlBin, adminUrl, name) {
  if (!DATABASE_NAME_PATTERN.test(name)) return;
  runPsql(
    psqlBin,
    adminUrl,
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${name}' AND pid <> pg_backend_pid()`,
    { allowFailure: true },
  );
  runPsql(psqlBin, adminUrl, `DROP DATABASE IF EXISTS "${name}"`, { allowFailure: true });
}

function migrateDatabase(databaseUrl, environment, pgDumpBin) {
  const result = spawnSync('pnpm', [
    '--filter', '@agentwiki/server', 'exec', 'prisma', 'migrate', 'deploy',
    '--schema', join(root, 'apps/server/prisma/schema.prisma'),
  ], {
    cwd: root,
    encoding: 'utf8',
    env: { ...environment, DATABASE_URL: databaseUrl, PG_DUMP_BIN: pgDumpBin },
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error(redact(
      [result.error?.message, result.stdout, result.stderr].filter(Boolean).join('\n'),
      [databaseUrl],
    ));
  }
}

function portIsFree(port) {
  return new Promise((resolvePromise) => {
    const server = createServer();
    server.once('error', () => resolvePromise(false));
    server.listen({ host: '127.0.0.1', port }, () => {
      server.close(() => resolvePromise(true));
    });
  });
}

async function findRedisPort(environment) {
  const requested = environment.AGENTWIKI_TEST_REDIS_PORT?.trim();
  if (requested) {
    const port = Number(requested);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) {
      throw new Error('AGENTWIKI_TEST_REDIS_PORT must be a TCP port');
    }
    if (!(await portIsFree(port))) throw new Error(`Redis test port ${port} is already in use`);
    return port;
  }
  for (let port = 6392; port <= 6499; port += 1) {
    if (await portIsFree(port)) return port;
  }
  throw new Error('No free loopback Redis test port is available in 6392-6499');
}

async function startRedis(redisBin, redisCliBin, port, directory) {
  const logPath = join(directory, 'redis.log');
  const child = spawn(redisBin, [
    '--bind', '127.0.0.1',
    '--port', String(port),
    '--protected-mode', 'yes',
    '--save', '',
    '--appendonly', 'yes',
    '--appendfsync', 'everysec',
    '--dir', directory,
    '--logfile', logPath,
    '--daemonize', 'no',
  ], { stdio: 'ignore' });
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Redis test process exited before readiness (see ${logPath})`);
    const ping = spawnSync(redisCliBin, ['-h', '127.0.0.1', '-p', String(port), 'PING'], { encoding: 'utf8' });
    if (ping.status === 0 && ping.stdout.trim() === 'PONG') return child;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  child.kill('SIGTERM');
  throw new Error(`Redis test process did not become ready (see ${logPath})`);
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await new Promise((resolvePromise) => {
    const timer = setTimeout(resolvePromise, 2_000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolvePromise();
    });
  });
}

async function provisionLocalEnvironment(sourceEnvironment) {
  const psqlBin = resolveBinary(sourceEnvironment.AGENTWIKI_PSQL_BIN, 'psql');
  const pgDumpBin = resolveBinary(sourceEnvironment.PG_DUMP_BIN, 'pg_dump');
  const redisBin = resolveBinary(sourceEnvironment.AGENTWIKI_REDIS_BIN, 'redis-server');
  const redisCliBin = resolveBinary(sourceEnvironment.AGENTWIKI_REDIS_CLI_BIN, 'redis-cli');
  const adminUrl = adminDatabaseUrl(sourceEnvironment);
  const tempRoot = mkdtempSync(join(tmpdir(), 'agentwiki-full-test-'));
  const baseName = `agentwiki_full_test_${process.pid}_${Date.now().toString(36)}`;
  const syncName = `agentwiki_sync_version_test_${process.pid}_${Date.now().toString(36)}`;
  const createdDatabases = [];
  let redisChild;
  try {
    runPsql(psqlBin, adminUrl, 'SELECT 1');
    const baseDatabaseUrl = createDatabase(psqlBin, adminUrl, baseName);
    createdDatabases.push(baseName);
    const syncVersionDatabaseUrl = createDatabase(psqlBin, adminUrl, syncName);
    createdDatabases.push(syncName);
    migrateDatabase(syncVersionDatabaseUrl, sourceEnvironment, pgDumpBin);
    const redisPort = await findRedisPort(sourceEnvironment);
    redisChild = await startRedis(redisBin, redisCliBin, redisPort, tempRoot);
    const redisUrl = `redis://127.0.0.1:${redisPort}/0`;
    const environment = buildFullTestEnvironment({
      baseDatabaseUrl,
      syncVersionDatabaseUrl,
      redisUrl,
      psqlBin,
      pgDumpBin,
    }, sourceEnvironment);
    environment.TMPDIR = tempRoot;
    return {
      environment,
      cleanup: async () => {
        await stopProcess(redisChild);
        for (const databaseName of createdDatabases.reverse()) dropDatabase(psqlBin, adminUrl, databaseName);
        rmSync(tempRoot, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await stopProcess(redisChild);
    for (const databaseName of createdDatabases.reverse()) dropDatabase(psqlBin, adminUrl, databaseName);
    rmSync(tempRoot, { recursive: true, force: true });
    throw error;
  }
}

async function runHarness(environment) {
  const child = spawn(process.execPath, ['scripts/repository-test-harness.mjs', 'run'], {
    cwd: root,
    env: environment,
    stdio: 'inherit',
  });
  return new Promise((resolvePromise, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolvePromise(code ?? (signal ? 1 : 0)));
    const forwardSignal = (signal) => {
      if (child.exitCode === null) child.kill(signal);
    };
    process.once('SIGINT', () => forwardSignal('SIGINT'));
    process.once('SIGTERM', () => forwardSignal('SIGTERM'));
  });
}

export async function main(sourceEnvironment = process.env) {
  const classification = classifyFullTestEnvironment(sourceEnvironment);
  if (classification.mode === 'partial') {
    throw new Error(
      `Explicit full-test environment is incomplete; missing: ${classification.missing.join(', ')}`,
    );
  }
  if (classification.mode === 'explicit') {
    process.exitCode = await runHarness({ ...sourceEnvironment, AGENTWIKI_FULL_TEST: '1' });
    return;
  }
  const provisioned = await provisionLocalEnvironment(sourceEnvironment);
  try {
    process.exitCode = await runHarness(provisioned.environment);
  } finally {
    await provisioned.cleanup();
  }
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
