import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
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

function extractShellFunction(source, name) {
  const match = source.match(new RegExp(`^${name}\\(\\) \\{[\\s\\S]*?^\\}`, 'mu'));
  assert.ok(match, `missing executable shell function ${name}`);
  return match[0];
}

function runShellFunction(source, name, argument) {
  const hereDocMatch = source.match(new RegExp(`^${name}\\(\\) \\{[\\s\\S]*?^NODE\\n\\}`, 'mu'));
  const functionSource = hereDocMatch?.[0] ?? extractShellFunction(source, name);
  return spawnSync('bash', ['-c', `set -euo pipefail\n${functionSource}\n${name} "$1"`, 'contract', argument], {
    encoding: 'utf8',
  });
}

function assertSafeAttachmentDeployment(deploy) {
  for (const line of deploy.split(/\r?\n/u)) {
    if (!/(?:\$attachment_storage_path|\/var\/lib\/agentwiki\/attachments)/u.test(line)) continue;
    if (/(?:^|[;&|()]|\bthen)\s*(?:sudo\s+)?(?:rm|mv|chown)\b/u.test(line)) {
      assert.fail(`destructive persistent-root command: ${line.trim()}`);
    }
  }

  const completed = deploy.indexOf('attachment_storage_preflight_complete=1');
  assert.ok(completed >= 0, 'missing completed attachment-storage preflight marker');
  for (const required of [
    "stat -c '%a' -- \"$attachment_storage_path\"",
    'attachment_write_probe="$attachment_storage_path/.deploy-write-probe.$$"',
    'df -Pk -- "$attachment_storage_path"',
    '"$available_bytes" -lt "$attachment_min_free_bytes"',
    'set_live_attachment_env_value "$live_dir/.env" ATTACHMENT_STORAGE_PATH',
    'set_live_attachment_env_value "$live_dir/.env" ATTACHMENT_MIN_FREE_BYTES',
    'verified_attachment_storage_path=',
    'verified_attachment_min_free_bytes=',
  ]) {
    const position = deploy.indexOf(required);
    assert.ok(position >= 0 && position < completed, `${required} must complete before the marker`);
  }
  for (const boundary of [
    'tar -xzf',
    'pnpm install --frozen-lockfile',
    'systemctl --user stop',
    'pnpm --filter @agentwiki/server exec prisma migrate deploy',
  ]) {
    const position = deploy.indexOf(boundary);
    assert.ok(position > completed, `${boundary} must remain after the completed preflight`);
  }
}

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

test('Docker image prepares the fresh named-volume mountpoint for the non-root runtime', async () => {
  const dockerfile = await read('apps/server/Dockerfile');
  const production = dockerfile.slice(dockerfile.lastIndexOf('FROM '));
  const runtimeUser = production.lastIndexOf('USER node');
  assert.ok(runtimeUser >= 0, 'production runtime must remain USER node');
  assert.match(
    production.slice(0, runtimeUser),
    /RUN install -d -o node -g node -m 0700 \/var\/lib\/agentwiki\/attachments/u,
  );
  assert.doesNotMatch(production.slice(runtimeUser), /USER\s+(?:0|root)\b/u);
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
  assert.match(deploy, /set_live_attachment_env_value "\$live_dir\/\.env" ATTACHMENT_STORAGE_PATH "\$attachment_storage_path"/u);
  assert.match(deploy, /set_live_attachment_env_value "\$live_dir\/\.env" ATTACHMENT_MIN_FREE_BYTES "\$attachment_min_free_bytes"/u);

  assertSafeAttachmentDeployment(deploy);

  const archiveCommand = deploy.match(/COPYFILE_DISABLE=1 tar[\s\S]*?-czf "\$\{ARCHIVE\}"([\s\S]*?)\n\n/u)?.[1];
  assert.ok(archiveCommand, 'release archive command must be inspectable');
  assert.doesNotMatch(archiveCommand, /\/var\/lib\/agentwiki\/attachments|attachment_storage_path/u);
  assert.doesNotMatch(archiveCommand, /(?:^|\s)\.(?:\s|$)/u, 'archive input must stay an explicit allowlist');
});

test('deployment contract rejects reordered validation and destructive root mutations', async () => {
  const deploy = deployedShell(await read('deploy.sh'));
  const marker = 'attachment_storage_preflight_complete=1';
  const reordered = deploy.replace(marker, '').replace(
    'pnpm --filter @agentwiki/server exec prisma migrate deploy',
    `pnpm --filter @agentwiki/server exec prisma migrate deploy\n${marker}`,
  );
  assert.throws(() => assertSafeAttachmentDeployment(reordered), /must remain after/iu);

  for (const command of [
    'rm -rf "$attachment_storage_path"',
    'mv -- "$attachment_storage_path" "$release_dir/attachments"',
    'chown -R node:node /var/lib/agentwiki/attachments',
  ]) {
    assert.throws(
      () => assertSafeAttachmentDeployment(`${deploy}\n${command}`),
      /destructive persistent-root command/iu,
      command,
    );
  }
});

test('deployment reads optional server env safely and validates its selected free-space floor', async () => {
  const deploy = deployedShell(await read('deploy.sh'));
  const reader = extractShellFunction(deploy, 'read_attachment_min_free_bytes');
  const sandbox = await mkdtemp(resolve(tmpdir(), 'agentwiki-deploy-env-contract-'));
  const serverDirectory = resolve(sandbox, 'apps/server');
  await mkdir(serverDirectory, { recursive: true });
  const environment = { ...process.env };
  delete environment.ATTACHMENT_MIN_FREE_BYTES;
  const run = () => spawnSync('bash', ['-c', `set -euo pipefail\n${reader}\nlive_dir="$1"\nattachment_min_free_bytes="\${ATTACHMENT_MIN_FREE_BYTES:-1073741824}"\nread_attachment_min_free_bytes\nprintf '%s' "$attachment_min_free_bytes"`, 'contract', sandbox], {
    encoding: 'utf8',
    env: environment,
  });

  try {
    await writeFile(resolve(sandbox, '.env'), 'ATTACHMENT_MIN_FREE_BYTES=2468\n');
    let result = run();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, '2468');

    await writeFile(resolve(serverDirectory, '.env'), 'ATTACHMENT_MIN_FREE_BYTES=3579\n');
    result = run();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, '3579');

    await writeFile(resolve(serverDirectory, '.env'), 'ATTACHMENT_MIN_FREE_BYTES=invalid\n');
    result = run();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /positive integer/iu);
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
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

test('backup manifest binds the complete allowed tree losslessly and rejects special entries', async () => {
  const runbook = await read('docs/operations/markdown-attachments.md');
  const sandbox = await mkdtemp(resolve(tmpdir(), 'agentwiki-attachment-manifest-contract-'));
  const bundle = resolve(sandbox, 'bundle');
  const attachments = resolve(bundle, 'attachments');
  const parseManifest = (stdout) => stdout.trim().split('\n').map((line) => JSON.parse(line));
  const manifestByPath = (rows) => new Map(rows.map((row) => [
    Buffer.from(row.pathBase64, 'base64').toString('utf8'),
    row,
  ]));

  try {
    await mkdir(attachments, { recursive: true });
    await writeFile(resolve(bundle, 'database.dump'), 'database-v1');
    await writeFile(resolve(attachments, 'ordinary.png'), 'image-v1');
    await writeFile(resolve(attachments, 'line\nbreak.png'), 'odd-name');

    const baseline = runShellFunction(runbook, 'manifest_jsonl', bundle);
    assert.equal(baseline.status, 0, baseline.stderr);
    const rows = parseManifest(baseline.stdout);
    const byPath = manifestByPath(rows);
    assert.deepEqual([...byPath.keys()], [
      'attachments',
      'attachments/line\nbreak.png',
      'attachments/ordinary.png',
      'database.dump',
    ]);
    assert.deepEqual(byPath.get('attachments'), {
      type: 'directory',
      pathBase64: Buffer.from('attachments').toString('base64'),
    });
    for (const path of ['attachments/line\nbreak.png', 'attachments/ordinary.png', 'database.dump']) {
      assert.equal(byPath.get(path).type, 'file');
      assert.match(byPath.get(path).size, /^[1-9][0-9]*$/u);
      assert.match(byPath.get(path).sha256, /^[a-f0-9]{64}$/u);
    }

    await writeFile(resolve(attachments, 'ordinary.png'), 'IMAGE-v1');
    const changed = runShellFunction(runbook, 'manifest_jsonl', bundle);
    assert.equal(changed.status, 0, changed.stderr);
    assert.notEqual(changed.stdout, baseline.stdout, 'same-size content mutation must change manifest');

    await writeFile(resolve(attachments, 'extra.png'), 'extra');
    const extra = runShellFunction(runbook, 'manifest_jsonl', bundle);
    assert.equal(extra.status, 0, extra.stderr);
    assert.notEqual(extra.stdout, changed.stdout, 'extra entry must change manifest');
    await rm(resolve(attachments, 'extra.png'));
    await rm(resolve(attachments, 'line\nbreak.png'));
    const missing = runShellFunction(runbook, 'manifest_jsonl', bundle);
    assert.equal(missing.status, 0, missing.stderr);
    assert.notEqual(missing.stdout, changed.stdout, 'missing entry must change manifest');

    await symlink('ordinary.png', resolve(attachments, 'link.png'));
    const symlinked = runShellFunction(runbook, 'manifest_jsonl', bundle);
    assert.notEqual(symlinked.status, 0);
    assert.match(symlinked.stderr, /symlink rejected/iu);
    await rm(resolve(attachments, 'link.png'));

    const fifoPath = resolve(attachments, 'pipe');
    const fifo = spawnSync('mkfifo', [fifoPath], { encoding: 'utf8' });
    assert.equal(fifo.status, 0, fifo.stderr);
    const special = runShellFunction(runbook, 'manifest_jsonl', bundle);
    assert.notEqual(special.status, 0);
    assert.match(special.stderr, /non-regular entry rejected/iu);
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});
