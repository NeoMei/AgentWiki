import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFile(resolve(root, path), 'utf8');

const uncommentedLines = (source) => source
  .split(/\r?\n/u)
  .filter((line) => !/^\s*#/u.test(line));

function yamlBlock(source, heading, indent = 0) {
  const lines = source.split(/\r?\n/u);
  const prefix = ' '.repeat(indent);
  const start = lines.findIndex((line) => line === `${prefix}${heading}:`);
  assert.notEqual(start, -1, `missing YAML block ${heading}`);
  const body = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() && line.match(/^\s*/u)?.[0].length <= indent) break;
    body.push(line);
  }
  return body.join('\n');
}

function yamlChildBlock(source, heading, indent) {
  return yamlBlock(source, heading, indent);
}

function environmentValue(service, key) {
  const environment = yamlChildBlock(service, 'environment', 4);
  const match = environment.match(new RegExp(`^ {6}${key}:\\s*(.+)$`, 'mu'));
  assert.ok(match, `missing Compose environment ${key}`);
  return match[1].trim();
}

function unitValues(source, key) {
  return uncommentedLines(source)
    .map((line) => line.trim())
    .filter((line) => line.startsWith(`${key}=`))
    .map((line) => line.slice(key.length + 1));
}

function envAssignments(source) {
  return new Map(uncommentedLines(source).flatMap((line) => {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/u);
    return match ? [[match[1], match[2]]] : [];
  }));
}

function shellWithoutComments(source) {
  return uncommentedLines(source).join('\n');
}

const deployedShell = (source) => shellWithoutComments(source).replaceAll('\\$', '$');

const requiredAttachmentEnv = [
  'ATTACHMENT_STORAGE_PATH',
  'ATTACHMENT_MAX_FILE_BYTES',
  'ATTACHMENT_MAX_SPACE_BYTES',
  'ATTACHMENT_MAX_DIMENSION',
  'ATTACHMENT_MAX_PIXELS',
  'ATTACHMENT_MIN_FREE_BYTES',
  'ATTACHMENT_RETENTION_DAYS',
  'ATTACHMENT_ORPHAN_GRACE_HOURS',
  'ATTACHMENT_CONTENT_LOCK_TIMEOUT_MS',
  'ATTACHMENT_CLEANUP_POLL_MS',
];

test('Docker gives API and worker one private persistent attachment volume and a semantic health probe', async () => {
  const compose = await read('docker-compose.yml');
  const services = yamlBlock(compose, 'services');
  const backend = yamlChildBlock(services, 'backend', 2);
  const worker = yamlChildBlock(services, 'worker', 2);
  const frontend = yamlChildBlock(services, 'frontend', 2);
  const migrate = yamlChildBlock(services, 'migrate', 2);
  const namedVolumes = yamlBlock(compose, 'volumes');

  assert.equal((namedVolumes.match(/^ {2}attachment-data:\s*$/gmu) ?? []).length, 1);
  for (const [name, service] of [['backend', backend], ['worker', worker]]) {
    assert.equal(
      environmentValue(service, 'ATTACHMENT_STORAGE_PATH'),
      '/var/lib/agentwiki/attachments',
      `${name} must use the shared persistent path`,
    );
    const volumes = yamlChildBlock(service, 'volumes', 4);
    assert.equal(
      (volumes.match(/^ {6}- attachment-data:\/var\/lib\/agentwiki\/attachments\s*$/gmu) ?? []).length,
      1,
      `${name} must mount the attachment volume exactly once`,
    );
  }
  for (const [name, service] of [['frontend', frontend], ['migrate', migrate]]) {
    assert.doesNotMatch(service, /attachment-data|ATTACHMENT_STORAGE_PATH/u, `${name} must not expose attachment content`);
  }

  const healthcheck = yamlChildBlock(backend, 'healthcheck', 4);
  const program = healthcheck.match(/^ {8}- "(.+attachmentStorage.+)"\s*$/mu)?.[1];
  assert.ok(program, 'backend healthcheck must execute a semantic attachment-storage probe');
  assert.match(program, /r\.ok/u);
  assert.match(program, /r\.json\(\)/u);
  assert.match(program, /status\s*===\s*'ok'/u);
  assert.match(program, /attachmentStorage\s*===\s*'ok'/u);
});

test('direct-runtime units share the durable attachment path with restrictive creation masks', async () => {
  const units = await Promise.all([
    read('deploy/systemd/agentwiki-api.service'),
    read('deploy/systemd/agentwiki-worker.service'),
  ]);
  for (const unit of units) {
    assert.deepEqual(
      unitValues(unit, 'Environment').filter((value) => value.startsWith('ATTACHMENT_STORAGE_PATH=')),
      ['ATTACHMENT_STORAGE_PATH=/var/lib/agentwiki/attachments'],
    );
    assert.deepEqual(unitValues(unit, 'UMask'), ['0077']);
    assert.doesNotMatch(unit, /ATTACHMENT_STORAGE_PATH=(?:%h|\/tmp|[^\n]*agentwiki-release)/u);
  }
});

test('direct deployment validates durable storage before stopping services or migrating', async () => {
  const deploy = deployedShell(await read('deploy.sh'));
  assert.match(deploy, /attachment_storage_path="\/var\/lib\/agentwiki\/attachments"/u);
  assert.match(deploy, /attachment_min_free_bytes="\$\{ATTACHMENT_MIN_FREE_BYTES:-[0-9]+\}"/u);
  assert.match(deploy, /case "\$attachment_storage_path" in[\s\S]*"\$live_dir"[\s\S]*"\$release_dir"/u);
  assert.match(deploy, /\[ -L "\$attachment_storage_path" \]/u);
  assert.match(deploy, /\[ ! -d "\$attachment_storage_path" \]/u);
  assert.match(deploy, /chmod 0700 -- "\$attachment_storage_path"/u);
  assert.match(deploy, /stat -c '%a' -- "\$attachment_storage_path"/u);
  assert.match(deploy, /\[ ! -w "\$attachment_storage_path" \]/u);
  assert.match(deploy, /df -Pk -- "\$attachment_storage_path"/u);
  assert.match(deploy, /available_bytes/u);
  assert.match(deploy, /set_env_value \.env ATTACHMENT_STORAGE_PATH "\$attachment_storage_path"/u);
  assert.match(deploy, /set_env_value apps\/server\/\.env ATTACHMENT_STORAGE_PATH "\$attachment_storage_path"/u);

  const preflight = deploy.indexOf('attachment_storage_path="/var/lib/agentwiki/attachments"');
  const stop = deploy.indexOf('systemctl --user stop');
  const migrate = deploy.indexOf('prisma migrate deploy');
  assert.ok(preflight >= 0 && preflight < stop && preflight < migrate);

  const dangerousPersistentOperations = [
    /(?:rm|mv|chown)\s+(?:-[^\s]+\s+)*--?\s*"?\$attachment_storage_path/u,
    /chown\s+-R[^\n]*\/var\/lib\/agentwiki\/attachments/u,
  ];
  for (const pattern of dangerousPersistentOperations) assert.doesNotMatch(deploy, pattern);

  const archiveCommand = deploy.match(/COPYFILE_DISABLE=1 tar[\s\S]*?-czf "\$\{ARCHIVE\}"([\s\S]*?)\n\n/u)?.[1];
  assert.ok(archiveCommand, 'release archive command must be inspectable');
  assert.doesNotMatch(archiveCommand, /\/var\/lib\/agentwiki\/attachments|attachment_storage_path/u);
  assert.doesNotMatch(archiveCommand, /(?:^|\s)\.(?:\s|$)/u, 'archive input must stay an explicit allowlist');
});

test('direct post-deploy health requires the JSON storage signal', async () => {
  const deploy = deployedShell(await read('deploy.sh'));
  assert.match(deploy, /curl[^\n]*\/api\/health/u);
  assert.doesNotMatch(deploy, /api="\$\(curl[^\n]*-o \/dev\/null/u);
  const probe = deploy.match(/"\$node_binary" -e '([^']*JSON\.parse[^']*)' "\$api_body"/u)?.[1];
  assert.ok(probe, 'post-deploy health must parse JSON with the deployment Node runtime');
  for (const [payload, expectedStatus] of [
    ['{"status":"ok","attachmentStorage":"ok"}', 0],
    ['{"status":"ok"}', 1],
    ['{"status":"ok","attachmentStorage":"unavailable"}', 1],
    ['not-json', 1],
  ]) {
    assert.equal(spawnSync(process.execPath, ['-e', probe, payload]).status, expectedStatus, payload);
  }
});

test('Nginx applies the smallest whole-MiB safe multipart allowance', async () => {
  const nginx = shellWithoutComments(await read('deploy/nginx/agentwiki.conf'));
  const values = [...nginx.matchAll(/\bclient_max_body_size\s+([^;]+);/gu)].map((match) => match[1].trim());
  assert.deepEqual(values, ['11m']);
  assert.doesNotMatch(nginx, /client_max_body_size\s+0\s*;/u);
});

test('environment examples expose every bounded attachment setting', async () => {
  const examples = await Promise.all([read('.env.example'), read('apps/server/.env.example')]);
  for (const example of examples) {
    const values = envAssignments(example);
    for (const key of requiredAttachmentEnv) assert.ok(values.has(key), `${key} missing from env example`);
    assert.equal(values.get('ATTACHMENT_STORAGE_PATH'), '/var/lib/agentwiki/attachments');
    assert.equal(values.get('ATTACHMENT_MAX_FILE_BYTES'), '10485760');
    assert.match(values.get('ATTACHMENT_MAX_SPACE_BYTES') ?? '', /^[1-9][0-9]+$/u);
    assert.match(values.get('ATTACHMENT_MAX_DIMENSION') ?? '', /^[1-9][0-9]+$/u);
    assert.match(values.get('ATTACHMENT_MAX_PIXELS') ?? '', /^[1-9][0-9]+$/u);
    assert.match(values.get('ATTACHMENT_MIN_FREE_BYTES') ?? '', /^[1-9][0-9]+$/u);
    assert.match(values.get('ATTACHMENT_RETENTION_DAYS') ?? '', /^[1-9][0-9]*$/u);
    assert.match(values.get('ATTACHMENT_ORPHAN_GRACE_HOURS') ?? '', /^[1-9][0-9]*$/u);
    assert.match(values.get('ATTACHMENT_CONTENT_LOCK_TIMEOUT_MS') ?? '', /^[1-9][0-9]+$/u);
    assert.match(values.get('ATTACHMENT_CLEANUP_POLL_MS') ?? '', /^[1-9][0-9]+$/u);
  }
});
