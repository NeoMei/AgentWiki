#!/usr/bin/env bash
# Backup only: never replace source/dist, run a migration, or change configuration.
# Reuses the v0.12.64 paired-backup implementation; only the backup directory
# prefix and PostgreSQL application label are renamed for the space review v0.12.65 release.
# Running this script pauses API/Worker while capturing database + attachments.
set -euo pipefail
umask 077

brand_live='/root/agentwiki'
brand_attachments='/var/lib/agentwiki/attachments'
brand_backup=''
brand_pause_requested=0
brand_writers_touched=0
brand_api_was_active=0
brand_worker_was_active=0
brand_success=0

restore_brand_writers() {
  local restore_ok=1 attempt
  [ "$brand_pause_requested" = 1 ] || return 0
  if [ "$brand_api_was_active" = 1 ]; then
    systemctl --user start agentwiki-api.service || restore_ok=0
  fi
  if [ "$brand_worker_was_active" = 1 ]; then
    systemctl --user start agentwiki-worker.service || restore_ok=0
  fi
  for attempt in $(seq 1 20); do
    if systemctl --user is-active --quiet agentwiki-api.service &&
       systemctl --user is-active --quiet agentwiki-worker.service; then
      brand_pause_requested=0
      printf '%s\n' 'API and Worker restored.'
      return 0
    fi
    sleep 0.5
  done
  [ "$restore_ok" = 1 ] || printf '%s\n' 'A writer start command failed.' >&2
  printf '%s\n' 'ERROR: API/Worker restoration needs operator attention.' >&2
  return 1
}

finish_brand_backup() {
  local result=$?
  trap - EXIT INT TERM
  # A service could fail after an initially successful restart/health check.
  # On any failed backup, ensure both originally active writers are active again.
  if [ "$brand_writers_touched" = 1 ] && { [ "$result" -ne 0 ] || [ "$brand_success" -ne 1 ]; }; then
    brand_pause_requested=1
  fi
  if ! restore_brand_writers; then result=1; fi
  if [ "$result" -ne 0 ] || [ "$brand_success" -ne 1 ]; then
    [ "$result" -ne 0 ] || result=1
    printf 'Backup did not complete; retained directory: %s\n' "${brand_backup:-not created}" >&2
  fi
  exit "$result"
}
trap finish_brand_backup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

test "$(id -u)" = 0
for brand_tool in /usr/bin/node /usr/bin/pg_dump /usr/bin/pg_restore; do test -x "$brand_tool"; done
for brand_tool in flock tar rsync sha256sum python3 curl systemctl; do command -v "$brand_tool" >/dev/null; done
test -d "$brand_live" && test ! -L "$brand_live"
test -f "$brand_live/.env"
test -f "$brand_live/apps/server/.env"
test -d "$brand_attachments" && test ! -L "$brand_attachments"
test "$(readlink -f "$brand_attachments")" = "$brand_attachments"
test -d /var/backups/agentwiki && test ! -L /var/backups/agentwiki
test ! -L /root/.agentwiki-deploy.lock
exec 9>/root/.agentwiki-deploy.lock
flock -n 9 || { printf '%s\n' 'Another AgentWiki deployment/backup holds the lock.' >&2; exit 1; }

systemctl --user is-active --quiet agentwiki-api.service
brand_api_was_active=1
systemctl --user is-active --quiet agentwiki-worker.service
brand_worker_was_active=1
systemctl --user is-active --quiet agentwiki-frontend.service
printf '%s\n' 'Preflight: all three services are active; deployment lock acquired.'

# Parse env as data, never shell code. This function's child receives libpq
# connection parameters in its environment, never a URL/password in argv/logs.
brand_database_command() {
  /usr/bin/node --input-type=commonjs - "$1" "${2:-}" <<'NODE'
const fs = require('node:fs');
const { parseEnv } = require('node:util');
const { spawnSync } = require('node:child_process');
try {
  const merged = {
    ...parseEnv(fs.readFileSync('/root/agentwiki/.env', 'utf8')),
    ...parseEnv(fs.readFileSync('/root/agentwiki/apps/server/.env', 'utf8')),
  };
  if (!merged.DATABASE_URL) throw new Error('Database configuration unavailable');
  const url = new URL(merged.DATABASE_URL);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.username || !url.pathname.slice(1)) {
    throw new Error('Invalid database configuration');
  }
  const childEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('PG') && key !== 'DATABASE_URL'));
  Object.assign(childEnv, {
    PGHOST: url.hostname.replace(/^\[|\]$/g, ''),
    PGPORT: url.port || '5432',
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
    PGCONNECT_TIMEOUT: '12',
    PGAPPNAME: 'agentwiki-space-review-release-backup',
  });
  const supported = {
    host: 'PGHOST', sslmode: 'PGSSLMODE', sslrootcert: 'PGSSLROOTCERT',
    sslcert: 'PGSSLCERT', sslkey: 'PGSSLKEY', sslcrl: 'PGSSLCRL',
    sslcrldir: 'PGSSLCRLDIR', sslpassword: 'PGSSLPASSWORD',
    channel_binding: 'PGCHANNELBINDING', target_session_attrs: 'PGTARGETSESSIONATTRS',
    connect_timeout: 'PGCONNECT_TIMEOUT',
  };
  const prismaOnly = new Set(['schema', 'connection_limit', 'pool_timeout', 'socket_timeout', 'pgbouncer', 'statement_cache_size']);
  for (const [key, value] of url.searchParams) {
    if (supported[key]) childEnv[supported[key]] = value;
    else if (!prismaOnly.has(key)) throw new Error('Unsupported database connection parameter');
  }
  if (!childEnv.PGHOST || !/^\d+$/.test(childEnv.PGPORT)) throw new Error('Invalid database host/port');
  if (process.argv[2] === 'validate') process.exit(0);
  if (process.argv[2] !== 'dump' || !process.argv[3]) throw new Error('Invalid backup command');
  const dump = spawnSync('/usr/bin/pg_dump', ['--format=custom', '--no-password', '--file', process.argv[3]], {
    env: childEnv, encoding: 'utf8', maxBuffer: 1024 * 1024,
  });
  if (dump.status !== 0 || dump.error) {
    // The raw libpq diagnostic is not printed because it can contain connection details.
    process.stderr.write('Database dump failed; connection details suppressed.\n');
    process.exit(1);
  }
} catch {
  process.stderr.write('Database preflight/dump failed; configuration details suppressed.\n');
  process.exit(1);
}
NODE
}
brand_database_command validate

# Verbatim manifest implementation from docs/operations/markdown-attachments.md.
manifest_pair_jsonl() {
  node --input-type=commonjs - "$1" "$2" <<'NODE'
const fs = require('node:fs');
const crypto = require('node:crypto');
const slash = Buffer.from('/');
const dump = Buffer.from(process.argv[2]);
const attachments = Buffer.from(process.argv[3]);
const join = (left, right) => Buffer.concat([left, slash, right]);
const rows = [];

function visit(absolute, relative) {
  const before = fs.lstatSync(absolute, { bigint: true });
  const encodedPath = relative.toString('base64');
  if (before.isSymbolicLink()) throw new Error(`symlink rejected: ${encodedPath}`);
  if (before.isDirectory()) {
    rows.push({ type: 'directory', pathBase64: encodedPath });
    const names = fs.readdirSync(absolute, { encoding: 'buffer' }).sort(Buffer.compare);
    for (const name of names) visit(join(absolute, name), join(relative, name));
    return;
  }
  if (!before.isFile()) throw new Error(`non-regular entry rejected: ${encodedPath}`);

  const noFollow = fs.constants.O_NOFOLLOW ?? 0;
  const descriptor = fs.openSync(absolute, fs.constants.O_RDONLY | noFollow);
  try {
    const opened = fs.fstatSync(descriptor, { bigint: true });
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino) {
      throw new Error(`file identity changed before hashing: ${encodedPath}`);
    }
    const hash = crypto.createHash('sha256');
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let position = 0;
    for (;;) {
      const count = fs.readSync(descriptor, buffer, 0, buffer.length, position);
      if (count === 0) break;
      hash.update(buffer.subarray(0, count));
      position += count;
    }
    const after = fs.fstatSync(descriptor, { bigint: true });
    if (after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size) {
      throw new Error(`file changed while hashing: ${encodedPath}`);
    }
    rows.push({
      type: 'file',
      pathBase64: encodedPath,
      size: opened.size.toString(),
      sha256: hash.digest('hex'),
    });
  } finally {
    fs.closeSync(descriptor);
  }
}

visit(dump, Buffer.from('database.dump'));
visit(attachments, Buffer.from('attachments'));
rows.sort((left, right) => Buffer.compare(
  Buffer.from(left.pathBase64, 'base64'),
  Buffer.from(right.pathBase64, 'base64'),
));
process.stdout.write(`${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);
NODE
}

manifest_jsonl() {
  manifest_pair_jsonl "$1/database.dump" "$1/attachments"
}

brand_backup="$(mktemp -d /var/backups/agentwiki/space-review-release-v01265.XXXXXXXX)"
printf 'Backup directory: %s\n' "$brand_backup"
date -u '+%Y-%m-%dT%H:%M:%SZ' > "$brand_backup/started-at.txt"
printf '%s\n' 'Archiving application and runtime configuration (dist and env retained).'
tar --exclude=node_modules --exclude=.git --exclude=.codegraph \
  --exclude=.cache --exclude=.tmp --exclude=.turbo --exclude=.vite --exclude=.vite-temp \
  --exclude=coverage --exclude=tmp --exclude=temp --exclude='*.tsbuildinfo' --exclude='*.tar.gz' \
  -czf "$brand_backup/application.tar.gz" -C /root agentwiki
tar -tzf "$brand_backup/application.tar.gz" >/dev/null
python3 - "$brand_backup/application.tar.gz" <<'PY'
import sys, tarfile
required = {
    'agentwiki/package.json', 'agentwiki/.env', 'agentwiki/apps/server/.env',
    'agentwiki/apps/server/dist/main.js', 'agentwiki/apps/server/dist/worker.js',
    'agentwiki/apps/client/dist/index.html',
}
with tarfile.open(sys.argv[1], 'r:gz') as archive:
    members = {entry.name.rstrip('/'): entry for entry in archive}
    if not required.issubset(members) or not all(members[name].isfile() for name in required):
        raise SystemExit('Application archive is missing required source/configuration/build files')
    if any(set(name.split('/')) & {'node_modules', '.git', '.codegraph'} for name in members):
        raise SystemExit('Application archive includes an excluded directory')
PY
tar -czf "$brand_backup/configuration.tar.gz" -C /root \
  agentwiki/.env agentwiki/apps/server/.env \
  .config/systemd/user/agentwiki-api.service \
  .config/systemd/user/agentwiki-worker.service \
  .config/systemd/user/agentwiki-frontend.service
tar -tzf "$brand_backup/configuration.tar.gz" >/dev/null

printf '%s\n' 'Pausing API and Worker for the paired database/attachment snapshot.'
brand_pause_requested=1
brand_writers_touched=1
systemctl --user stop agentwiki-api.service agentwiki-worker.service
for brand_unit in agentwiki-api.service agentwiki-worker.service; do
  test "$(systemctl --user show -p MainPID --value "$brand_unit")" = 0
  test "$(systemctl --user show -p ActiveState --value "$brand_unit")" = inactive
done
systemctl --user is-active --quiet agentwiki-frontend.service
brand_database_command dump "$brand_backup/database.dump"
/usr/bin/pg_restore --list "$brand_backup/database.dump" > "$brand_backup/database-toc.txt"
test -s "$brand_backup/database-toc.txt"
manifest_pair_jsonl "$brand_backup/database.dump" "$brand_attachments" > "$brand_backup/MANIFEST.live-before.jsonl"
mkdir -m 0700 "$brand_backup/attachments"
rsync -a --numeric-ids --delete "$brand_attachments/" "$brand_backup/attachments/"
manifest_jsonl "$brand_backup" > "$brand_backup/MANIFEST.jsonl"
manifest_pair_jsonl "$brand_backup/database.dump" "$brand_attachments" > "$brand_backup/MANIFEST.live-after.jsonl"
cmp "$brand_backup/MANIFEST.live-before.jsonl" "$brand_backup/MANIFEST.jsonl"
cmp "$brand_backup/MANIFEST.live-before.jsonl" "$brand_backup/MANIFEST.live-after.jsonl"
manifest_jsonl "$brand_backup" > "$brand_backup/MANIFEST.recheck.jsonl"
cmp "$brand_backup/MANIFEST.jsonl" "$brand_backup/MANIFEST.recheck.jsonl"
restore_brand_writers

printf '%s\n' 'Validating checksums and restored service health.'
(
  cd "$brand_backup"
  sha256sum application.tar.gz configuration.tar.gz database.dump database-toc.txt \
    MANIFEST.jsonl MANIFEST.live-before.jsonl MANIFEST.live-after.jsonl MANIFEST.recheck.jsonl > SHA256SUMS
  sha256sum -c SHA256SUMS >/dev/null
)
brand_health_ok=0
for brand_attempt in $(seq 1 20); do
  if curl --fail --silent --show-error --max-time 5 http://127.0.0.1:3000/api/health > "$brand_backup/health-after.json" 2>/dev/null &&
     /usr/bin/node -e 'const fs=require("node:fs");try{const h=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.exit(["status","database","redis","auditPersistence","attachmentStorage"].every(k=>h[k]==="ok")?0:1)}catch{process.exit(1)}' "$brand_backup/health-after.json"; then
    brand_health_ok=1
    break
  fi
  sleep 0.5
done
test "$brand_health_ok" = 1
for brand_unit in agentwiki-api.service agentwiki-worker.service agentwiki-frontend.service; do
  systemctl --user is-active --quiet "$brand_unit"
done
date -u '+%Y-%m-%dT%H:%M:%SZ' > "$brand_backup/finished-at.txt"
printf '%s\n' 'verified' > "$brand_backup/STATUS"
brand_success=1
printf 'Backup verified; services restored: %s\n' "$brand_backup"
