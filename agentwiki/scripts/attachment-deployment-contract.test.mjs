import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFile(resolve(root, path), 'utf8');
// SECURITY: changing either digest is approval to execute a new Markdown-derived program and requires full executable-code review.
const REVIEWED_RESTORE_PROGRAM_SHA256 = '35f5daaae0c519b3efd0a8818f78dd833b495901201828e981977ec2899277c8';
const REVIEWED_MANIFEST_PROGRAM_SHA256 = '62fdf67c4a06ecd6b7263789b36c78168956ca47429dc23b12080822ca161404';
const UNREVIEWED_RESTORE_PROGRAM = /unreviewed executable restore program/iu;

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

function markdownBashBlocks(source) {
  return [...source.matchAll(/^```bash[ \t]*\r?\n([\s\S]*?)^```[ \t]*$/gmu)]
    .map((match) => match[1])
    .join('\n');
}

function exactShellCommandPositions(source, command) {
  const positions = [];
  let offset = 0;
  for (const line of source.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (trimmed === command) positions.push(offset + line.indexOf(trimmed));
    offset += line.length + 1;
  }
  return positions;
}

const deployedShell = (source) => shellWithoutComments(source).replaceAll('\\$', '$');

function extractShellFunction(source, name) {
  const match = source.match(new RegExp(`^${name}\\(\\) \\{[\\s\\S]*?^\\}`, 'mu'));
  assert.ok(match, `missing executable shell function ${name}`);
  return match[0];
}

const sha256 = (source) => createHash('sha256').update(source).digest('hex');

function assertReviewedRestoreProgram(program) {
  assert.equal(
    sha256(program),
    REVIEWED_RESTORE_PROGRAM_SHA256,
    'unreviewed executable restore program; updating this fingerprint requires a complete executable-code review',
  );
  assert.doesNotMatch(
    program,
    /\bcommand\s+-p\b|(?:^|[\n;&|])\s*(?:source|eval)(?:\s|$)|(?:^|[\n;&|])\s*\/(?:bin|sbin|usr\/bin|usr\/sbin)\//u,
    'reviewed restore program must not contain shell escape commands',
  );
}

function restoreProgram(runbook) {
  const program = shellWithoutComments(markdownBashBlocks(restoreSection(runbook)));
  assertReviewedRestoreProgram(program);
  return program;
}

function reviewedManifestParts(runbook) {
  const pairMatch = runbook.match(/^manifest_pair_jsonl\(\) \{[\s\S]*?^NODE\n\}/mu);
  assert.ok(pairMatch, 'missing executable manifest_pair_jsonl function');
  const wrapper = extractShellFunction(runbook, 'manifest_jsonl');
  const program = `${pairMatch[0]}\n${wrapper}`;
  assert.equal(
    sha256(program),
    REVIEWED_MANIFEST_PROGRAM_SHA256,
    'unreviewed executable manifest program; updating this fingerprint requires a complete executable-code review',
  );
  const nodeMatch = pairMatch[0].match(/<<'NODE'\n([\s\S]*?)\nNODE\n\}/u);
  assert.ok(nodeMatch, 'missing reviewed manifest Node program');
  return { nodeProgram: nodeMatch[1], wrapper };
}

const shellLiteral = (value) => `'${String(value).replaceAll("'", "'\"'\"'")}'`;

function exactArgvExecutable(directory, name, acceptedCases) {
  const branches = acceptedCases.map(({ args, event, stdout = '', status = 0, pid = false }, index) => {
    const condition = [
      `[[ "$#" -eq ${args.length}`,
      ...args.map((argument, argumentIndex) => `&& "\${${argumentIndex + 1}-}" == ${shellLiteral(argument)}`),
      ']]',
    ].join(' ');
    const trace = pid
      ? `printf '%s:%s\\n' ${shellLiteral(event)} "$$" >> "$TRACE_PATH"`
      : `printf '%s\\n' ${shellLiteral(event)} >> "$TRACE_PATH"`;
    return `${index === 0 ? 'if' : 'elif'} ${condition}; then
  ${trace}
  ${stdout ? `printf '%s' ${shellLiteral(stdout)}` : ':'}
  exit ${status}`;
  }).join('\n');
  return executablePath(directory, name, `#!/bin/bash
set -u
if [[ -n "\${BASH_ENV+x}" || -n "\${ENV+x}" || -n "\${CDPATH+x}" || -n "\${NODE_OPTIONS+x}" || -n "\${CONTRACT_SECRET+x}" || -n "\${CONTRACT_SENTINEL_PATH+x}" ]]; then
  printf 'unexpected:${name}:inherited-environment\\n' >> "$TRACE_PATH"
  exit 98
fi
${branches}
else
  printf 'unexpected:${name}' >> "$TRACE_PATH"
  printf ':%q' "$@" >> "$TRACE_PATH"
  printf '\\n' >> "$TRACE_PATH"
  exit 97
fi
`);
}

function runReviewedBash(program, argv, environment) {
  return spawnSync('/bin/bash', ['--noprofile', '--norc', '-c', program, ...argv], {
    encoding: 'utf8',
    env: environment,
  });
}

function executablePath(directory, name, source) {
  const path = resolve(directory, name);
  writeFileSync(path, source, { mode: 0o700 });
  chmodSync(path, 0o700);
  return path;
}

function assertPrivateApiExecutionTrace(restore) {
  assertReviewedRestoreProgram(restore);
  const sandbox = mkdtempSync(resolve(tmpdir(), 'agentwiki-private-trace-'));
  const fakeBin = resolve(sandbox, 'bin');
  const tracePath = resolve(sandbox, 'trace');
  const logPath = resolve(sandbox, 'one-shot.log');
  const releasePath = resolve(sandbox, 'release');
  const attachmentPath = resolve(sandbox, 'attachments');
  mkdirSync(fakeBin);
  mkdirSync(releasePath);
  mkdirSync(attachmentPath);

  try {
    exactArgvExecutable(fakeBin, 'sudo', [{
      args: [
        '-u', 'agentwiki', 'env', 'NODE_ENV=production', 'PORT=13000', 'PROCESS_ROLE=api',
        'AGENTWIKI_LISTEN_HOST=127.0.0.1', `ATTACHMENT_STORAGE_PATH=${attachmentPath}`,
        'ATTACHMENT_MIN_FREE_BYTES=4096', 'DATABASE_URL=postgresql://trace',
        'REDIS_URL=redis://trace', 'JWT_SECRET=trace-jwt',
        'AGENTWIKI_SERVER_PEPPER=trace-pepper', 'AGENTWIKI_DEPLOYMENT_SEED=trace-seed',
        'PUBLIC_API_URL=http://127.0.0.1:13000/api', 'node', 'apps/server/dist/main.js',
      ],
      event: 'safe',
      pid: true,
    }]);
    const healthProgram = 'const h=JSON.parse(process.argv[1]);if(h.status!=="ok"||h.attachmentStorage!=="ok")process.exit(1)';
    exactArgvExecutable(fakeBin, 'node', [{
      args: ['-e', healthProgram, '{"status":"ok","attachmentStorage":"ok"}'],
      event: 'health-parse',
    }]);
    exactArgvExecutable(fakeBin, 'curl', [{
      args: ['-fsS', 'http://127.0.0.1:13000/api/health'],
      event: 'health-request',
      stdout: '{"status":"ok","attachmentStorage":"ok"}\n',
    }]);
    exactArgvExecutable(fakeBin, 'mktemp', [{
      args: ['/var/tmp/agentwiki-restore-health.XXXXXXXX.log'],
      event: 'log-allocate',
      stdout: `${logPath}\n`,
    }]);
    exactArgvExecutable(fakeBin, 'seq', [{ args: ['1', '30'], event: 'retry-sequence', stdout: '1\n' }]);
    exactArgvExecutable(fakeBin, 'grep', [{ args: ['-q', '.'], event: 'port-empty', status: 1 }]);
    exactArgvExecutable(fakeBin, 'ss', [{ args: ['-H', '-ltn', 'sport = :13000'], event: 'port-check' }]);
    exactArgvExecutable(fakeBin, 'rm', [{ args: ['--', logPath], event: 'log-remove' }]);

    const start = extractShellFunction(restore, 'start_private_api');
    const verify = extractShellFunction(restore, 'verify_private_api');
    const command = `set -euo pipefail
${start}
${verify}
one_shot_pid=''
cleanup_one_shot() {
  printf 'captured:%s\\n' "$one_shot_pid" >> "$TRACE_PATH"
  if test -n "$one_shot_pid"; then wait "$one_shot_pid" 2>/dev/null || true; fi
  one_shot_pid=''
}
AGENTWIKI_RELEASE_ROOT="$1"
attachment_min_free_bytes=4096
DATABASE_URL=postgresql://trace
REDIS_URL=redis://trace
JWT_SECRET=trace-jwt
AGENTWIKI_SERVER_PEPPER=trace-pepper
AGENTWIKI_DEPLOYMENT_SEED=trace-seed
PUBLIC_API_URL=http://127.0.0.1:13000/api
verify_private_api "$2"`;
    const result = runReviewedBash(command, ['contract', releasePath, attachmentPath], {
      PATH: fakeBin,
      TRACE_PATH: tracePath,
    });
    assert.equal(result.status, 0, `private API trace failed closed: ${result.stderr}`);
    const events = readFileSync(tracePath, 'utf8').trim().split(/\r?\n/u);
    const oneShotLog = existsSync(logPath) ? readFileSync(logPath, 'utf8') : '';
    const serviceStarts = events.filter((event) => /^(?:safe|bare):/u.test(event));
    assert.equal(serviceStarts.length, 1, `private API execution trace must contain exactly one service start: ${JSON.stringify({ events, oneShotLog })}`);
    assert.match(serviceStarts[0], /^safe:/u, 'private API execution trace must use the reviewed launcher');
    const safePid = serviceStarts[0].slice('safe:'.length);
    assert.ok(events.includes(`captured:${safePid}`), 'private API execution trace must capture the reviewed launcher PID');
    assert.equal(events.filter((event) => event === 'health-parse').length, 1, 'health parser must run once with reviewed argv');
    assert.doesNotMatch(events.join('\n'), /^unexpected:/mu, 'private API trace rejected an argv contract');
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
}

function assertRollbackExecutionTrace(restore) {
  assertReviewedRestoreProgram(restore);
  const sandbox = mkdtempSync(resolve(tmpdir(), 'agentwiki-rollback-trace-'));
  const fakeBin = resolve(sandbox, 'bin');
  const tracePath = resolve(sandbox, 'trace');
  const rollbackDirectory = resolve(sandbox, 'rollback');
  mkdirSync(fakeBin);
  mkdirSync(rollbackDirectory);

  try {
    const stagedDump = resolve(rollbackDirectory, 'staged/database.dump');
    const stagedAttachments = resolve(rollbackDirectory, 'staged/attachments');
    const liveRoot = resolve(rollbackDirectory, 'live');
    exactArgvExecutable(fakeBin, 'sudo', [{
      args: ['-u', 'agentwiki', 'systemctl', '--user', 'stop', 'agentwiki-api.service', 'agentwiki-worker.service'],
      event: 'writers-stop',
    }]);
    exactArgvExecutable(fakeBin, 'pg_restore', [{
      args: ['--clean', '--if-exists', '--exit-on-error', '--single-transaction', '--dbname=postgresql://trace', stagedDump],
      event: 'database-restore',
    }]);
    exactArgvExecutable(fakeBin, 'mv', [{ args: ['--', stagedAttachments, liveRoot], event: 'attachment-promotion' }]);
    exactArgvExecutable(fakeBin, 'cmp', [{
      args: [resolve(rollbackDirectory, 'MANIFEST.jsonl'), resolve(rollbackDirectory, 'MANIFEST.promoted-rollback.jsonl')],
      event: 'manifest-compare',
    }]);
    exactArgvExecutable(fakeBin, 'pnpm', [{
      args: ['--filter', '@agentwiki/server', 'exec', 'prisma', 'migrate', 'status'],
      event: 'migration-status',
    }]);

    const rollback = extractShellFunction(restore, 'rollback_pair');
    const command = `set -euo pipefail
cleanup_one_shot() { test "$#" -eq 0; }
validate_attachment_root() {
  test "$#" -eq 2 && test "$1" = "$live_attachment_root" && test "$2" = "$live_attachment_root"
  printf 'root-validation\\n' >> "$TRACE_PATH"
}
manifest_pair_jsonl() {
  test "$#" -eq 2 && test "$1" = "$rollback_restore_bundle/database.dump" && test "$2" = "$live_attachment_root"
  printf 'promoted-manifest\\n' >> "$TRACE_PATH"
}
verify_private_api() {
  test "$#" -eq 1 && test "$1" = "$live_attachment_root"
  printf 'private-health\\n' >> "$TRACE_PATH"
}
DATABASE_URL=postgresql://trace
rollback_dir="$1"
rollback_restore_bundle="$1/staged"
live_attachment_root="$1/live"
failed_live_root="$1/failed"
rollback_live_root="$1/rollback-live"
${rollback}
rollback_pair`;
    const result = runReviewedBash(command, ['contract', rollbackDirectory], {
      PATH: fakeBin,
      TRACE_PATH: tracePath,
    });
    assert.equal(result.status, 0, `rollback execution trace failed closed: ${result.stderr}`);
    const events = readFileSync(tracePath, 'utf8').trim().split(/\r?\n/u);
    assert.deepEqual(
      events,
      [
        'writers-stop',
        'database-restore',
        'attachment-promotion',
        'root-validation',
        'promoted-manifest',
        'manifest-compare',
        'migration-status',
        'private-health',
      ],
      'rollback execution trace must restore the database, promote exactly once, verify the pair, and stay private',
    );
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
}

function assertStagingExecutionTrace(restore) {
  assertReviewedRestoreProgram(restore);
  const sandbox = mkdtempSync(resolve(tmpdir(), 'agentwiki-staging-trace-'));
  const fakeBin = resolve(sandbox, 'bin');
  const tracePath = resolve(sandbox, 'trace');
  const selectedStage = resolve(sandbox, 'selected-stage');
  const rollbackStage = resolve(sandbox, 'rollback-stage');
  const selectedSource = resolve(sandbox, 'selected-source');
  const rollbackSource = resolve(sandbox, 'rollback-source');
  mkdirSync(fakeBin);
  mkdirSync(selectedStage);
  mkdirSync(rollbackStage);

  try {
    exactArgvExecutable(fakeBin, 'mktemp', [
      {
        args: ['-d', '/var/lib/agentwiki/attachments-restore.XXXXXXXX'],
        event: 'stage:selected',
        stdout: `${selectedStage}\n`,
      },
      {
        args: ['-d', '/var/lib/agentwiki/attachments-rollback-restore.XXXXXXXX'],
        event: 'stage:rollback',
        stdout: `${rollbackStage}\n`,
      },
    ]);
    exactArgvExecutable(fakeBin, 'install', [
      { args: ['-m', '0600', `${selectedSource}/database.dump`, `${selectedStage}/database.dump`], event: 'install:selected' },
      { args: ['-m', '0600', `${rollbackSource}/database.dump`, `${rollbackStage}/database.dump`], event: 'install:rollback' },
    ]);
    exactArgvExecutable(fakeBin, 'mkdir', [
      { args: ['-m', '0700', `${selectedStage}/attachments`], event: 'mkdir:selected' },
      { args: ['-m', '0700', `${rollbackStage}/attachments`], event: 'mkdir:rollback' },
    ]);
    exactArgvExecutable(fakeBin, 'rsync', [
      { args: ['-a', '--numeric-ids', '--delete', `${selectedSource}/attachments/`, `${selectedStage}/attachments/`], event: 'rsync:selected' },
      { args: ['-a', '--numeric-ids', '--delete', `${rollbackSource}/attachments/`, `${rollbackStage}/attachments/`], event: 'rsync:rollback' },
    ]);
    exactArgvExecutable(fakeBin, 'cmp', [
      { args: [`${selectedSource}/MANIFEST.jsonl`, `${selectedStage}/MANIFEST.candidate.jsonl`], event: 'cmp:selected' },
      { args: [`${rollbackSource}/MANIFEST.jsonl`, `${rollbackStage}/MANIFEST.candidate.jsonl`], event: 'cmp:rollback' },
    ]);
    exactArgvExecutable(fakeBin, 'pg_restore', [
      { args: ['--list', `${selectedStage}/database.dump`], event: 'list:selected' },
      { args: ['--list', `${rollbackStage}/database.dump`], event: 'list:rollback' },
    ]);

    const stageStart = restore.indexOf('restore_bundle=');
    const stageEnd = restore.indexOf('live_attachment_root=', stageStart);
    assert.ok(stageStart >= 0 && stageEnd > stageStart, 'missing isolated restore staging block');
    const staging = restore.slice(stageStart, stageEnd);
    const command = `set -euo pipefail
manifest_jsonl() {
  if test "$#" -eq 1 && test "$1" = "$trace_selected_stage"; then
    printf 'manifest:selected\\n' >> "$TRACE_PATH"
  elif test "$#" -eq 1 && test "$1" = "$trace_rollback_stage"; then
    printf 'manifest:rollback\\n' >> "$TRACE_PATH"
  else
    printf 'unexpected:manifest:%q\\n' "$*" >> "$TRACE_PATH"
    return 97
  fi
}
trace_selected_stage="$1/selected-stage"
trace_rollback_stage="$1/rollback-stage"
selected_backup_dir="$1/selected-source"
rollback_dir="$1/rollback-source"
${staging}`;
    const result = runReviewedBash(command, ['contract', sandbox], {
      PATH: fakeBin,
      TRACE_PATH: tracePath,
    });
    assert.equal(result.status, 0, `staging execution trace failed closed: ${result.stderr}`);
    const events = readFileSync(tracePath, 'utf8').trim().split(/\r?\n/u);
    assert.deepEqual(
      events,
      [
        'stage:selected',
        'install:selected',
        'mkdir:selected',
        'rsync:selected',
        'manifest:selected',
        'cmp:selected',
        'stage:rollback',
        'install:rollback',
        'mkdir:rollback',
        'rsync:rollback',
        'manifest:rollback',
        'cmp:rollback',
        'list:selected',
        'list:rollback',
      ],
      'staging execution trace must validate each staged dump exactly once before live mutation',
    );
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
}

function runManifestFunction(source, dumpPath, attachmentPath) {
  const { nodeProgram } = reviewedManifestParts(source);
  return spawnSync(process.execPath, ['--input-type=commonjs', '-', dumpPath, attachmentPath], {
    encoding: 'utf8',
    env: {},
    input: nodeProgram,
  });
}

function runManifestBundleFunction(source, bundlePath) {
  reviewedManifestParts(source);
  return runManifestFunction(source, resolve(bundlePath, 'database.dump'), resolve(bundlePath, 'attachments'));
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

function restoreSection(runbook) {
  const start = runbook.indexOf('## Coordinated restore and rollback');
  assert.ok(start >= 0, 'missing coordinated restore section');
  const next = runbook.indexOf('\n## ', start + 4);
  return runbook.slice(start, next >= 0 ? next : undefined);
}

function assertSafeRestoreRunbook(runbook) {
  const restore = restoreProgram(runbook);
  const selectedAssignment = restore.indexOf('selected_backup_dir=');
  const selectedReadonly = restore.indexOf('readonly selected_backup_dir');
  const selectedManifest = restore.indexOf('manifest_jsonl "$selected_backup_dir"');
  const selectedDumpCheck = restore.indexOf('pg_restore --list "$selected_backup_dir/database.dump"');
  const stopWriters = restore.indexOf('systemctl --user stop agentwiki-api.service agentwiki-worker.service');
  const rollbackAssignment = restore.indexOf('rollback_dir=');

  assert.ok(selectedAssignment >= 0, 'selected historical backup must be assigned explicitly');
  assert.ok(selectedReadonly > selectedAssignment, 'selected historical backup must be locked read-only');
  assert.ok(selectedManifest > selectedReadonly, 'selected historical backup manifest must be verified after locking');
  assert.ok(selectedDumpCheck > selectedManifest, 'selected historical database dump must be verified before maintenance');
  assert.ok(stopWriters > selectedDumpCheck, 'writers must stop only after selected backup validation');
  assert.ok(rollbackAssignment > stopWriters, 'rollback capture must use a later independent directory');

  for (const selectedReference of [
    'rsync -a --numeric-ids --delete "$selected_backup_dir/attachments/"',
    'cmp "$selected_backup_dir/MANIFEST.jsonl"',
    'pg_restore --clean --if-exists --exit-on-error --single-transaction --dbname="$DATABASE_URL" "$restore_bundle/database.dump"',
  ]) {
    assert.ok(restore.includes(selectedReference), `restore must use selected historical bundle: ${selectedReference}`);
  }
  for (const rollbackReference of [
    'pg_dump --format=custom --file="$rollback_dir/database.dump"',
    'rsync -a --numeric-ids --delete /var/lib/agentwiki/attachments/ "$rollback_dir/attachments/"',
    'pg_restore --list "$rollback_restore_bundle/database.dump"',
    'pg_restore --clean --if-exists --exit-on-error --single-transaction --dbname="$DATABASE_URL" "$rollback_restore_bundle/database.dump"',
    'rsync -a --numeric-ids --delete "$rollback_dir/attachments/" "$rollback_restore_bundle/attachments/"',
    'mv -- "$rollback_restore_bundle/attachments" "$live_attachment_root"',
  ]) {
    assert.ok(restore.includes(rollbackReference), `rollback must use fresh rollback bundle: ${rollbackReference}`);
  }
  assert.doesNotMatch(restore, /\$backup_dir/u, 'restore must not reuse the generic backup capture variable');

  const selectedStage = restore.indexOf('restore_bundle=');
  const databaseRestore = restore.indexOf(
    'pg_restore --clean --if-exists --exit-on-error --single-transaction --dbname="$DATABASE_URL" "$restore_bundle/database.dump"',
  );
  const livePreflight = restore.indexOf('validate_attachment_root "$live_attachment_root" "$live_attachment_root"');
  const preserveLive = restore.indexOf('mv -- "$live_attachment_root" "$rollback_live_root"');
  const promoteCandidate = restore.indexOf('mv -- "$restore_bundle/attachments" "$live_attachment_root"');
  const promotedManifest = restore.indexOf(
    'manifest_pair_jsonl "$restore_bundle/database.dump" "$live_attachment_root"',
  );
  const oneShotHealth = restore.indexOf('verify_private_api "$live_attachment_root"', promotedManifest);
  const startWriters = restore.indexOf('systemctl --user start agentwiki-api.service agentwiki-worker.service');
  const rollbackStage = restore.indexOf('rollback_restore_bundle=');
  const stagedRollbackDumpValidation = 'pg_restore --list "$rollback_restore_bundle/database.dump" > /dev/null';
  const stagedRollbackDumpValidationPositions = exactShellCommandPositions(restore, stagedRollbackDumpValidation);
  const stagedRollbackDumpValidationIndex = stagedRollbackDumpValidationPositions[0] ?? -1;
  assert.ok(selectedStage > rollbackAssignment, 'selected restore staging must follow rollback capture');
  assert.doesNotMatch(
    restore.slice(selectedStage, rollbackStage),
    /\$rollback_dir/u,
    'selected restore staging must not read the rollback bundle',
  );
  assert.ok(livePreflight > selectedStage && livePreflight < databaseRestore, 'live root must be validated before restore promotion');
  assert.ok(databaseRestore > selectedStage, 'database restore must use the verified staged dump');
  assert.ok(preserveLive > databaseRestore, 'live attachments must be preserved after the staged database restore');
  assert.ok(promoteCandidate > preserveLive, 'verified candidate attachments must be promoted atomically');
  assert.ok(promotedManifest > promoteCandidate, 'the promoted database/filesystem pair must be re-manifested');
  assert.ok(oneShotHealth > promotedManifest, 'private semantic health must follow promoted-pair verification');
  assert.ok(startWriters > oneShotHealth, 'normal writers must not start before one-shot semantic health');
  assert.equal(
    stagedRollbackDumpValidationPositions.length,
    1,
    'staged rollback dump validation must occur exactly once in restore control flow',
  );
  assert.ok(
    stagedRollbackDumpValidationIndex > rollbackStage
      && stagedRollbackDumpValidationIndex < restore.indexOf('pg_restore --clean', rollbackStage)
      && stagedRollbackDumpValidationIndex < startWriters,
    'staged rollback dump validation must complete before destructive restore or writer start',
  );
  assert.doesNotMatch(
    restore.slice(selectedStage),
    /rsync[^\n]+(?:\/var\/lib\/agentwiki\/attachments\/|"\$live_attachment_root\/?")/u,
    'restore must never rsync a half-update into the live attachment root',
  );
  for (const candidate of ['$live_attachment_root', '$restore_bundle/attachments', '$rollback_restore_bundle/attachments']) {
    assert.match(
      restore.slice(selectedStage, databaseRestore),
      new RegExp(`stat -c '%d' -- "\\${candidate.replace('/', '\\/')}"`, 'u'),
      `${candidate} must share the live parent device before restore`,
    );
  }

  const rollbackHandler = extractShellFunction(restore, 'rollback_pair');
  assert.doesNotMatch(
    restore,
    /pg_restore --list "\$rollback_dir\/database\.dump"/u,
    'rollback dump verification must not reread the mutable capture directory',
  );
  assert.doesNotMatch(rollbackHandler, /\$selected_backup_dir/u, 'failure rollback must not read the selected bundle');
  assert.doesNotMatch(
    rollbackHandler,
    /pg_restore[^\n]+"\$rollback_dir\/database\.dump"/u,
    'rollback restore must use the verified staged rollback dump',
  );
  assert.match(rollbackHandler, /pg_restore[^\n]+"\$rollback_restore_bundle\/database\.dump"/u);
  assert.match(rollbackHandler, /mv -- "\$rollback_restore_bundle\/attachments" "\$live_attachment_root"/u);
  assert.doesNotMatch(
    rollbackHandler,
    /manifest_pair_jsonl "\$rollback_dir\/database\.dump"/u,
    'promoted rollback manifest must use the verified staged rollback dump',
  );
  assert.match(rollbackHandler, /manifest_pair_jsonl "\$rollback_restore_bundle\/database\.dump" "\$live_attachment_root"/u);
  const rollbackDatabaseRestore = exactShellCommandPositions(
    rollbackHandler,
    'pg_restore --clean --if-exists --exit-on-error --single-transaction --dbname="$DATABASE_URL" "$rollback_restore_bundle/database.dump"',
  )[0] ?? -1;
  const rollbackAttachmentPromotion = exactShellCommandPositions(
    rollbackHandler,
    'if ! mv -- "$rollback_restore_bundle/attachments" "$live_attachment_root"; then',
  )[0] ?? -1;
  const rollbackPromotedManifest = exactShellCommandPositions(
    rollbackHandler,
    'manifest_pair_jsonl "$rollback_restore_bundle/database.dump" "$live_attachment_root" > "$rollback_dir/MANIFEST.promoted-rollback.jsonl"',
  )[0] ?? -1;
  const rollbackPrivateHealth = exactShellCommandPositions(
    rollbackHandler,
    'verify_private_api "$live_attachment_root"',
  )[0] ?? -1;
  assert.ok(
    rollbackDatabaseRestore >= 0 && rollbackDatabaseRestore < rollbackAttachmentPromotion,
    'rollback database restore must complete before attachment promotion',
  );
  assert.ok(
    rollbackAttachmentPromotion < rollbackPromotedManifest,
    'rollback attachment promotion must precede promoted-pair manifest verification',
  );
  assert.ok(
    rollbackPromotedManifest < rollbackPrivateHealth,
    'rollback promoted-pair manifest verification must precede private health',
  );
  assert.ok(
    rollbackHandler.indexOf('systemctl --user stop') < rollbackHandler.indexOf('pg_restore'),
    'rollback must stop writers before restoring either half',
  );
  const rollbackTrap = restore.indexOf("trap 'rollback_pair' ERR");
  assert.ok(rollbackTrap > rollbackStage && rollbackTrap < databaseRestore, 'paired rollback must guard every live mutation');

  const privateProbe = extractShellFunction(restore, 'verify_private_api');
  const privateStart = extractShellFunction(restore, 'start_private_api');
  assert.match(privateStart, /exec sudo -u agentwiki env NODE_ENV=production/u);
  assert.match(privateStart, /AGENTWIKI_LISTEN_HOST=127\.0\.0\.1/u);
  assert.match(privateStart, /ATTACHMENT_MIN_FREE_BYTES="\$attachment_min_free_bytes"/u);
  assert.match(privateStart, /node apps\/server\/dist\/main\.js/u, 'private health must start the built API');
  for (const key of ['DATABASE_URL', 'REDIS_URL', 'JWT_SECRET', 'AGENTWIKI_SERVER_PEPPER', 'AGENTWIKI_DEPLOYMENT_SEED', 'PUBLIC_API_URL']) {
    assert.match(privateStart, new RegExp(`${key}="\\$${key}"`, 'u'), `private health must pass ${key}`);
  }
  assert.match(privateProbe, /http:\/\/127\.0\.0\.1:13000\/api\/health/u);
  assert.match(privateProbe, /ss -H -ltn 'sport = :13000'/u, 'private health must reject an occupied port');
  const privateLaunch = 'start_private_api "$private_attachment_root" >"$one_shot_log" 2>&1 &';
  const privateLaunchPositions = exactShellCommandPositions(privateProbe, privateLaunch);
  const privateLaunchIndex = privateLaunchPositions[0] ?? -1;
  assert.equal(privateLaunchPositions.length, 1, 'verify_private_api must invoke the reviewed private API launcher exactly once with its attachment root');
  assert.ok(
    privateLaunchIndex > privateProbe.indexOf('one_shot_log="$(mktemp'),
    'private health must allocate its log before launching the private API',
  );
  assert.ok(
    privateLaunchIndex < privateProbe.indexOf('one_shot_pid=$!'),
    'private health must capture the reviewed launcher PID immediately after launch',
  );
  assert.match(privateProbe, /cleanup_one_shot/u, 'private health must clean up the one-shot API');
  const privateCleanup = extractShellFunction(restore, 'cleanup_one_shot');
  assert.match(privateCleanup, /kill -- "\$one_shot_pid"/u, 'private health must stop the one-shot API');
  assert.match(privateCleanup, /wait "\$one_shot_pid"/u, 'private health must reap the one-shot API');
  assertStagingExecutionTrace(restore);
  assertRollbackExecutionTrace(restore);
  assertPrivateApiExecutionTrace(restore);
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

    const baseline = runManifestBundleFunction(runbook, bundle);
    assert.equal(baseline.status, 0, baseline.stderr);
    const paired = runManifestFunction(runbook, resolve(bundle, 'database.dump'), attachments);
    assert.equal(paired.status, 0, paired.stderr);
    assert.equal(paired.stdout, baseline.stdout, 'bundle and promoted-pair manifests must be byte-identical');
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
    const changed = runManifestFunction(runbook, resolve(bundle, 'database.dump'), attachments);
    assert.equal(changed.status, 0, changed.stderr);
    assert.notEqual(changed.stdout, baseline.stdout, 'same-size content mutation must change manifest');

    await writeFile(resolve(attachments, 'extra.png'), 'extra');
    const extra = runManifestFunction(runbook, resolve(bundle, 'database.dump'), attachments);
    assert.equal(extra.status, 0, extra.stderr);
    assert.notEqual(extra.stdout, changed.stdout, 'extra entry must change manifest');
    await rm(resolve(attachments, 'extra.png'));
    await rm(resolve(attachments, 'line\nbreak.png'));
    const missing = runManifestFunction(runbook, resolve(bundle, 'database.dump'), attachments);
    assert.equal(missing.status, 0, missing.stderr);
    assert.notEqual(missing.stdout, changed.stdout, 'missing entry must change manifest');

    await symlink('ordinary.png', resolve(attachments, 'link.png'));
    const symlinked = runManifestFunction(runbook, resolve(bundle, 'database.dump'), attachments);
    assert.notEqual(symlinked.status, 0);
    assert.match(symlinked.stderr, /symlink rejected/iu);
    await rm(resolve(attachments, 'link.png'));

    const fifoPath = resolve(attachments, 'pipe');
    const fifo = spawnSync('mkfifo', [fifoPath], { encoding: 'utf8' });
    assert.equal(fifo.status, 0, fifo.stderr);
    const special = runManifestFunction(runbook, resolve(bundle, 'database.dump'), attachments);
    assert.notEqual(special.status, 0);
    assert.match(special.stderr, /non-regular entry rejected/iu);
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test('restore locks the selected historical bundle before capturing an independent rollback pair', async () => {
  const previousSecret = process.env.CONTRACT_SECRET;
  process.env.CONTRACT_SECRET = 'must-not-enter-reviewed-traces';
  try {
    assertSafeRestoreRunbook(await read('docs/operations/markdown-attachments.md'));
  } finally {
    if (previousSecret === undefined) delete process.env.CONTRACT_SECRET;
    else process.env.CONTRACT_SECRET = previousSecret;
  }
});

test('restore contract rejects bypassing the reviewed private API launcher', async () => {
  const runbook = await read('docs/operations/markdown-attachments.md');
  const expected = 'start_private_api "$private_attachment_root" >"$one_shot_log" 2>&1 &';
  const bypass = 'node apps/server/dist/main.js >"$one_shot_log" 2>&1 &';
  assert.ok(runbook.includes(expected), 'runbook must expose the private launcher mutation target');
  assert.throws(
    () => assertSafeRestoreRunbook(runbook.replace(expected, bypass)),
    UNREVIEWED_RESTORE_PROGRAM,
  );
});

test('restore contract ignores commented command decoys inside executable helpers', async () => {
  const runbook = await read('docs/operations/markdown-attachments.md');
  const expected = 'start_private_api "$private_attachment_root" >"$one_shot_log" 2>&1 &';
  const bypassWithDecoy = `# ${expected}\n  node apps/server/dist/main.js >"$one_shot_log" 2>&1 &`;
  assert.throws(
    () => assertSafeRestoreRunbook(runbook.replace(expected, bypassWithDecoy)),
    UNREVIEWED_RESTORE_PROGRAM,
  );
});

test('restore contract ignores shell no-op command decoys inside executable helpers', async () => {
  const runbook = await read('docs/operations/markdown-attachments.md');
  const expected = 'start_private_api "$private_attachment_root" >"$one_shot_log" 2>&1 &';
  const bypassWithDecoy = `: # ${expected}\n  node apps/server/dist/main.js >"$one_shot_log" 2>&1 &`;
  assert.throws(
    () => assertSafeRestoreRunbook(runbook.replace(expected, bypassWithDecoy)),
    UNREVIEWED_RESTORE_PROGRAM,
  );
});

test('restore contract rejects an additional bare API process after the reviewed launcher', async () => {
  const runbook = await read('docs/operations/markdown-attachments.md');
  const safeLaunch = 'start_private_api "$private_attachment_root" >"$one_shot_log" 2>&1 &';
  const capturedPid = 'one_shot_pid=$!';
  const original = `${safeLaunch}\n  ${capturedPid}`;
  const duplicated = `${safeLaunch}\n  node apps/server/dist/main.js >"$one_shot_log" 2>&1 &\n  ${capturedPid}`;
  assert.ok(runbook.includes(original), 'runbook must expose the private process trace mutation target');
  assert.throws(
    () => assertSafeRestoreRunbook(runbook.replace(original, duplicated)),
    UNREVIEWED_RESTORE_PROGRAM,
  );
});

test('restore contract rejects a reviewed launcher hidden in an unreachable branch', async () => {
  const runbook = await read('docs/operations/markdown-attachments.md');
  const safeLaunch = 'start_private_api "$private_attachment_root" >"$one_shot_log" 2>&1 &';
  const unreachable = `if false; then\n    ${safeLaunch}\n  fi\n  node apps/server/dist/main.js >"$one_shot_log" 2>&1 &`;
  assert.ok(runbook.includes(safeLaunch), 'runbook must expose the private branch mutation target');
  assert.throws(
    () => assertSafeRestoreRunbook(runbook.replace(safeLaunch, unreachable)),
    UNREVIEWED_RESTORE_PROGRAM,
  );
});

test('restore contract rejects staging rollback dump validation after writers start', async () => {
  const runbook = await read('docs/operations/markdown-attachments.md');
  const validation = 'pg_restore --list "$rollback_restore_bundle/database.dump" > /dev/null';
  const writerStart = 'sudo -u agentwiki systemctl --user start agentwiki-api.service agentwiki-worker.service';
  assert.ok(runbook.includes(validation), 'runbook must expose the staged rollback validation mutation target');
  const writerStartIndex = runbook.lastIndexOf(writerStart);
  assert.ok(writerStartIndex >= 0, 'runbook must expose the restore writer-start mutation target');
  const withoutValidation = runbook.replace(validation, ': # staged rollback dump validation accidentally delayed');
  const shiftedWriterStartIndex = withoutValidation.lastIndexOf(writerStart);
  const reordered = `${withoutValidation.slice(0, shiftedWriterStartIndex)}${writerStart}\n${validation}${withoutValidation.slice(shiftedWriterStartIndex + writerStart.length)}`;
  assert.throws(
    () => assertSafeRestoreRunbook(reordered),
    UNREVIEWED_RESTORE_PROGRAM,
  );
});

test('restore contract rejects staged rollback validation hidden in an unreachable branch', async () => {
  const runbook = await read('docs/operations/markdown-attachments.md');
  const validation = 'pg_restore --list "$rollback_restore_bundle/database.dump" > /dev/null';
  const unreachable = `if false; then\n  ${validation}\nfi`;
  assert.ok(runbook.includes(validation), 'runbook must expose the staged validation branch mutation target');
  assert.throws(
    () => assertSafeRestoreRunbook(runbook.replace(validation, unreachable)),
    UNREVIEWED_RESTORE_PROGRAM,
  );
});

test('restore contract rejects rollback attachment promotion before database restore', async () => {
  const runbook = await read('docs/operations/markdown-attachments.md');
  const databaseRestore = 'pg_restore --clean --if-exists --exit-on-error --single-transaction --dbname="$DATABASE_URL" "$rollback_restore_bundle/database.dump"';
  const attachmentPromotion = 'mv -- "$rollback_restore_bundle/attachments" "$live_attachment_root"';
  const databaseRestoreIndex = runbook.indexOf(databaseRestore);
  const attachmentPromotionIndex = runbook.indexOf(attachmentPromotion);
  assert.ok(databaseRestoreIndex >= 0 && attachmentPromotionIndex > databaseRestoreIndex, 'runbook must expose ordered rollback mutation targets');
  const reordered = `${runbook.slice(0, databaseRestoreIndex)}${attachmentPromotion}${runbook.slice(databaseRestoreIndex + databaseRestore.length, attachmentPromotionIndex)}${databaseRestore}${runbook.slice(attachmentPromotionIndex + attachmentPromotion.length)}`;
  assert.throws(
    () => assertSafeRestoreRunbook(reordered),
    UNREVIEWED_RESTORE_PROGRAM,
  );
});

test('restore contract rejects an additional rollback promotion before database restore', async () => {
  const runbook = await read('docs/operations/markdown-attachments.md');
  const databaseRestore = 'pg_restore --clean --if-exists --exit-on-error --single-transaction --dbname="$DATABASE_URL" "$rollback_restore_bundle/database.dump"';
  const earlyPromotion = 'mv -- "$rollback_restore_bundle/attachments" "$live_attachment_root"';
  assert.ok(runbook.includes(databaseRestore), 'runbook must expose the rollback execution trace mutation target');
  assert.throws(
    () => assertSafeRestoreRunbook(runbook.replace(databaseRestore, `${earlyPromotion}\n  ${databaseRestore}`)),
    UNREVIEWED_RESTORE_PROGRAM,
  );
});

test('restore trust boundary rejects an absolute command before it can execute', async () => {
  const runbook = await read('docs/operations/markdown-attachments.md');
  const sandbox = await mkdtemp(resolve(tmpdir(), 'agentwiki-restore-sentinel-'));
  const sentinel = resolve(sandbox, 'absolute-command-ran');
  const insertion = `  /bin/echo "$CONTRACT_SECRET" > ${JSON.stringify(sentinel)}\n`;
  const target = '  private_attachment_root="$1"\n';
  const previousSecret = process.env.CONTRACT_SECRET;
  process.env.CONTRACT_SECRET = 'must-not-reach-markdown';
  try {
    let rejection;
    try {
      assertSafeRestoreRunbook(runbook.replace(target, `${target}${insertion}`));
    } catch (error) {
      rejection = error;
    }
    assert.equal(existsSync(sentinel), false, 'absolute Markdown command executed before trust validation');
    assert.match(rejection?.message ?? '', /unreviewed executable restore program/iu);
  } finally {
    if (previousSecret === undefined) delete process.env.CONTRACT_SECRET;
    else process.env.CONTRACT_SECRET = previousSecret;
    await rm(sandbox, { recursive: true, force: true });
  }
});

test('restore trust boundary rejects command-path and dynamic-code shell escapes', async () => {
  const runbook = await read('docs/operations/markdown-attachments.md');
  const target = '  private_attachment_root="$1"\n';
  for (const escapeCommand of [
    '  command -p echo bypass\n',
    '  source /dev/null\n',
    '  eval :\n',
  ]) {
    assert.throws(
      () => assertSafeRestoreRunbook(runbook.replace(target, `${target}${escapeCommand}`)),
      UNREVIEWED_RESTORE_PROGRAM,
      escapeCommand.trim(),
    );
  }
});

test('restore trust boundary rejects a malicious health Node payload before execution', async () => {
  const runbook = await read('docs/operations/markdown-attachments.md');
  const sandbox = await mkdtemp(resolve(tmpdir(), 'agentwiki-node-sentinel-'));
  const sentinel = resolve(sandbox, 'node-payload-ran');
  const health = 'node -e \'const h=JSON.parse(process.argv[1]);if(h.status!=="ok"||h.attachmentStorage!=="ok")process.exit(1)\' "$response"';
  const malicious = `node -e 'require("node:fs").writeFileSync(process.env.CONTRACT_SENTINEL_PATH,process.env.CONTRACT_SECRET)'`;
  const previousPath = process.env.CONTRACT_SENTINEL_PATH;
  const previousSecret = process.env.CONTRACT_SECRET;
  process.env.CONTRACT_SENTINEL_PATH = sentinel;
  process.env.CONTRACT_SECRET = 'must-not-reach-node';
  try {
    let rejection;
    try {
      assertSafeRestoreRunbook(runbook.replace(health, malicious));
    } catch (error) {
      rejection = error;
    }
    assert.equal(existsSync(sentinel), false, 'real Node executed a Markdown health payload');
    assert.match(rejection?.message ?? '', /unreviewed executable restore program/iu);
  } finally {
    if (previousPath === undefined) delete process.env.CONTRACT_SENTINEL_PATH;
    else process.env.CONTRACT_SENTINEL_PATH = previousPath;
    if (previousSecret === undefined) delete process.env.CONTRACT_SECRET;
    else process.env.CONTRACT_SECRET = previousSecret;
    await rm(sandbox, { recursive: true, force: true });
  }
});

test('restore trust boundary rejects an unreachable selected-list check followed by a wrong dump', async () => {
  const runbook = await read('docs/operations/markdown-attachments.md');
  const selectedList = 'pg_restore --list "$restore_bundle/database.dump" > /dev/null';
  const bypass = `if false; then\n  ${selectedList}\nfi\npg_restore --list /tmp/wrong.dump > /dev/null`;
  assert.ok(runbook.includes(selectedList), 'runbook must expose the staged selected-list mutation target');
  assert.throws(
    () => assertSafeRestoreRunbook(runbook.replace(selectedList, bypass)),
    /unreviewed executable restore program/iu,
  );
});

test('restore trust boundary rejects an unreachable writer stop followed by sudo true', async () => {
  const runbook = await read('docs/operations/markdown-attachments.md');
  const writerStop = 'sudo -u agentwiki systemctl --user stop agentwiki-api.service agentwiki-worker.service';
  const rollbackStopIndex = runbook.lastIndexOf(writerStop);
  assert.ok(rollbackStopIndex >= 0, 'runbook must expose the rollback writer-stop mutation target');
  const bypass = `if false; then\n  ${writerStop}\nfi\nsudo true`;
  const mutated = `${runbook.slice(0, rollbackStopIndex)}${bypass}${runbook.slice(rollbackStopIndex + writerStop.length)}`;
  assert.throws(() => assertSafeRestoreRunbook(mutated), /unreviewed executable restore program/iu);
});

test('restore trust boundary rejects an unreachable rollback restore followed by a wrong dump', async () => {
  const runbook = await read('docs/operations/markdown-attachments.md');
  const rollbackRestore = 'pg_restore --clean --if-exists --exit-on-error --single-transaction --dbname="$DATABASE_URL" "$rollback_restore_bundle/database.dump"';
  const bypass = `if false; then\n  ${rollbackRestore}\nfi\npg_restore --clean --if-exists --exit-on-error --single-transaction --dbname="$DATABASE_URL" /tmp/wrong.dump`;
  assert.ok(runbook.includes(rollbackRestore), 'runbook must expose the rollback dump mutation target');
  assert.throws(
    () => assertSafeRestoreRunbook(runbook.replace(rollbackRestore, bypass)),
    /unreviewed executable restore program/iu,
  );
});

test('manifest trust boundary rejects a changed Markdown program before Node execution', async () => {
  const runbook = await read('docs/operations/markdown-attachments.md');
  const sandbox = await mkdtemp(resolve(tmpdir(), 'agentwiki-manifest-sentinel-'));
  const bundle = resolve(sandbox, 'bundle');
  const sentinel = resolve(sandbox, 'manifest-node-ran');
  await mkdir(resolve(bundle, 'attachments'), { recursive: true });
  await writeFile(resolve(bundle, 'database.dump'), 'database');
  const previousPath = process.env.CONTRACT_SENTINEL_PATH;
  const previousSecret = process.env.CONTRACT_SECRET;
  process.env.CONTRACT_SENTINEL_PATH = sentinel;
  process.env.CONTRACT_SECRET = 'must-not-reach-manifest';
  const target = "const fs = require('node:fs');";
  const malicious = `require('node:fs').writeFileSync(process.env.CONTRACT_SENTINEL_PATH, process.env.CONTRACT_SECRET);\n${target}`;
  try {
    let rejection;
    try {
      runManifestBundleFunction(runbook.replace(target, malicious), bundle);
    } catch (error) {
      rejection = error;
    }
    assert.equal(existsSync(sentinel), false, 'real Node executed an unreviewed Markdown manifest payload');
    assert.match(rejection?.message ?? '', /unreviewed executable manifest program/iu);
  } finally {
    if (previousPath === undefined) delete process.env.CONTRACT_SENTINEL_PATH;
    else process.env.CONTRACT_SENTINEL_PATH = previousPath;
    if (previousSecret === undefined) delete process.env.CONTRACT_SECRET;
    else process.env.CONTRACT_SECRET = previousSecret;
    await rm(sandbox, { recursive: true, force: true });
  }
});

test('private one-shot executes with the reviewed non-default free-space floor', async () => {
  const runbook = await read('docs/operations/markdown-attachments.md');
  const restore = restoreProgram(runbook);
  const start = extractShellFunction(restore, 'start_private_api');
  const sandbox = await mkdtemp(resolve(tmpdir(), 'agentwiki-private-api-contract-'));
  const fakeBin = resolve(sandbox, 'bin');
  const tracePath = resolve(sandbox, 'trace');
  await mkdir(fakeBin);
  const expectedArgs = [
    '-u', 'agentwiki', 'env', 'NODE_ENV=production', 'PORT=13000', 'PROCESS_ROLE=api',
    'AGENTWIKI_LISTEN_HOST=127.0.0.1', 'ATTACHMENT_STORAGE_PATH=/var/lib/agentwiki/attachments',
    'ATTACHMENT_MIN_FREE_BYTES=4096', 'DATABASE_URL=postgresql://test',
    'REDIS_URL=redis://test', 'JWT_SECRET=jwt-test', 'AGENTWIKI_SERVER_PEPPER=pepper-test',
    'AGENTWIKI_DEPLOYMENT_SEED=seed-test', 'PUBLIC_API_URL=http://127.0.0.1:13000/api',
    'node', 'apps/server/dist/main.js',
  ];
  exactArgvExecutable(fakeBin, 'sudo', [{
    args: expectedArgs,
    event: 'safe-start-argv',
    stdout: `${expectedArgs.join('\n')}\n`,
  }]);

  const command = `set -euo pipefail
${start}
AGENTWIKI_RELEASE_ROOT="$1"
attachment_min_free_bytes=4096
DATABASE_URL=postgresql://test
REDIS_URL=redis://test
JWT_SECRET=jwt-test
AGENTWIKI_SERVER_PEPPER=pepper-test
AGENTWIKI_DEPLOYMENT_SEED=seed-test
PUBLIC_API_URL=http://127.0.0.1:13000/api
start_private_api /var/lib/agentwiki/attachments`;
  try {
    const result = runReviewedBash(command, ['contract', sandbox], {
      PATH: fakeBin,
      TRACE_PATH: tracePath,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, `${expectedArgs.join('\n')}\n`);
    assert.match(result.stdout, /^AGENTWIKI_LISTEN_HOST=127\.0\.0\.1$/mu);
    assert.match(result.stdout, /^ATTACHMENT_MIN_FREE_BYTES=4096$/mu);
    assert.doesNotMatch(result.stdout, /ATTACHMENT_MIN_FREE_BYTES=1073741824/u);
    assert.equal(readFileSync(tracePath, 'utf8'), 'safe-start-argv\n');
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test('restore contract rejects missing promotion, wrong dump source, and reordered acceptance', async () => {
  const runbook = await read('docs/operations/markdown-attachments.md');
  for (const [expected, replacement, failure] of [
    [
      'rsync -a --numeric-ids --delete "$selected_backup_dir/attachments/"',
      'rsync -a --numeric-ids --delete "$rollback_dir/attachments/"',
      UNREVIEWED_RESTORE_PROGRAM,
    ],
    [
      'pg_restore --clean --if-exists --exit-on-error --single-transaction --dbname="$DATABASE_URL" "$restore_bundle/database.dump"',
      'pg_restore --clean --if-exists --exit-on-error --single-transaction --dbname="$DATABASE_URL" "$rollback_dir/database.dump"',
      UNREVIEWED_RESTORE_PROGRAM,
    ],
    [
      'pg_restore --clean --if-exists --exit-on-error --single-transaction --dbname="$DATABASE_URL" "$rollback_restore_bundle/database.dump"',
      'pg_restore --clean --if-exists --exit-on-error --single-transaction --dbname="$DATABASE_URL" "$rollback_dir/database.dump"',
      UNREVIEWED_RESTORE_PROGRAM,
    ],
    [
      'pg_restore --list "$rollback_restore_bundle/database.dump"',
      'pg_restore --list "$rollback_dir/database.dump"',
      UNREVIEWED_RESTORE_PROGRAM,
    ],
    [
      'manifest_pair_jsonl "$rollback_restore_bundle/database.dump" "$live_attachment_root"',
      'manifest_pair_jsonl "$rollback_dir/database.dump" "$live_attachment_root"',
      UNREVIEWED_RESTORE_PROGRAM,
    ],
    [
      'mv -- "$restore_bundle/attachments" "$live_attachment_root"',
      ': # candidate promotion accidentally omitted',
      UNREVIEWED_RESTORE_PROGRAM,
    ],
    [
      'manifest_pair_jsonl "$restore_bundle/database.dump" "$live_attachment_root"',
      ': # promoted pair verification accidentally omitted',
      UNREVIEWED_RESTORE_PROGRAM,
    ],
  ]) {
    assert.ok(runbook.includes(expected), `runbook must expose mutation target: ${expected}`);
    assert.throws(
      () => assertSafeRestoreRunbook(runbook.replace(expected, replacement)),
      failure,
    );
  }

  const preserve = 'mv -- "$live_attachment_root" "$rollback_live_root"';
  const promote = 'mv -- "$restore_bundle/attachments" "$live_attachment_root"';
  const manifest = 'manifest_pair_jsonl "$restore_bundle/database.dump" "$live_attachment_root"';
  const oneShot = 'verify_private_api "$live_attachment_root"';
  const selectedOneShotIndex = runbook.lastIndexOf(oneShot);
  assert.ok(selectedOneShotIndex >= 0, 'runbook must expose the selected-pair private health target');
  const missingSelectedHealth = `${runbook.slice(0, selectedOneShotIndex)}: # selected-pair one-shot API accidentally omitted${runbook.slice(selectedOneShotIndex + oneShot.length)}`;
  assert.throws(() => assertSafeRestoreRunbook(missingSelectedHealth), UNREVIEWED_RESTORE_PROGRAM);

  for (const [first, firstIndex, second, secondIndex, failure] of [
    [promote, runbook.indexOf(promote), preserve, runbook.indexOf(preserve), UNREVIEWED_RESTORE_PROGRAM],
    [manifest, runbook.indexOf(manifest), promote, runbook.indexOf(promote), UNREVIEWED_RESTORE_PROGRAM],
    [oneShot, selectedOneShotIndex, manifest, runbook.indexOf(manifest), UNREVIEWED_RESTORE_PROGRAM],
  ]) {
    assert.ok(firstIndex >= 0 && secondIndex >= 0, `runbook must expose reorder targets: ${first} / ${second}`);
    const reordered = `${runbook.slice(0, secondIndex)}${first}${runbook.slice(secondIndex + second.length, firstIndex)}${second}${runbook.slice(firstIndex + first.length)}`;
    assert.throws(() => assertSafeRestoreRunbook(reordered), failure);
  }
});
