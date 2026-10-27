#!/usr/bin/env python3
"""Restore a verified v0.12.64 backup into a new local disposable database.

Run as root on the production host, after backup completion. Uses only the
local PostgreSQL Unix socket as the postgres OS user. Never reads application
credentials, connects to the business database, or replaces live attachments.
Restore diagnostics stay in a mode-0600 file beside the server-private backup.
"""
import argparse
import datetime
import hashlib
import json
import os
import pathlib
import re
import shutil
import signal
import subprocess
import sys
import uuid


def require(value, code):
    if not value:
        raise RuntimeError(code)


def backup_inputs(value):
    backup = pathlib.Path(value)
    require(backup.is_absolute() and backup.parent == pathlib.Path('/var/backups/agentwiki'), 'invalid-backup-parent')
    require(re.fullmatch(r'notes-release-v01264\.[A-Za-z0-9]+', backup.name), 'invalid-backup-name')
    require(backup.is_dir() and backup.resolve() == backup, 'backup-path-not-canonical')
    require(backup.stat().st_uid == 0 and backup.stat().st_mode & 0o077 == 0, 'backup-must-be-root-private')
    for name in ('database.dump', 'SHA256SUMS', 'STATUS'):
        path = backup / name
        require(path.is_file() and not path.is_symlink(), 'invalid-backup-file')
    require((backup / 'STATUS').read_text().strip() == 'verified', 'backup-not-verified')
    hashes = [line.split()[0] for line in (backup / 'SHA256SUMS').read_text().splitlines()
              if len(line.split()) == 2 and line.split()[1] == 'database.dump']
    require(len(hashes) == 1 and re.fullmatch(r'[0-9a-f]{64}', hashes[0]), 'missing-dump-checksum')
    digest = hashlib.sha256()
    with (backup / 'database.dump').open('rb') as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
    require(digest.hexdigest() == hashes[0], 'dump-checksum-mismatch')
    return backup, hashes[0]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--backup', required=True)
    parser.add_argument('--check', action='store_true', help='Validate inputs and local admin access without creating a database')
    args = parser.parse_args()
    receipt = {'mode': 'isolated-backup-restore', 'status': 'failed', 'verifiedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
               'businessDatabaseTouched': False, 'liveAttachmentsTouched': False, 'databaseCreated': False}
    created = False
    database = None
    log = None
    try:
        require(os.geteuid() == 0, 'root-required')
        backup, dump_hash = backup_inputs(args.backup)
        require(pathlib.Path('/var/run/postgresql').is_dir(), 'local-socket-directory-missing')
        for executable in ('runuser', 'psql', 'createdb', 'dropdb', 'pg_restore'):
            require(shutil.which(executable), 'postgres-admin-tool-missing')
        env = {key: value for key, value in os.environ.items() if not key.startswith('PG') and key != 'DATABASE_URL'}
        env.update(PGHOST='/var/run/postgresql', PGPORT='5432', PGUSER='postgres', PGDATABASE='postgres',
                   PGCONNECT_TIMEOUT='10', PGAPPNAME='agentwiki-v01264-isolated-restore')

        def pg(arguments, **kwargs):
            return subprocess.run(['runuser', '-u', 'postgres', '--', *arguments], env=env, **kwargs)

        def sql(database_name, query):
            result = pg(['psql', '--no-password', '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '--dbname', database_name, '--command', query],
                        capture_output=True, text=True, timeout=30)
            require(result.returncode == 0, 'isolated-database-query-failed')
            return result.stdout.strip()

        require(sql('postgres', 'SELECT current_user') == 'postgres', 'local-admin-check-failed')
        database = 'agentwiki_restore_v01264_' + uuid.uuid4().hex
        require(re.fullmatch(r'agentwiki_restore_v01264_[0-9a-f]{32}', database), 'invalid-isolated-name')
        require(sql('postgres', f"SELECT count(*) FROM pg_database WHERE datname='{database}'") == '0', 'isolated-name-already-exists')
        receipt.update(backup=str(backup), dumpSha256=dump_hash, database=database, preexisting=False)
        if args.check:
            receipt.update(status='preflight-passed', databaseExists=False)
        else:
            log_path = backup / ('restore-v01264-' + uuid.uuid4().hex + '.log')
            log = os.fdopen(os.open(log_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'wb')
            receipt['privateLog'] = str(log_path)
            # Defer interrupts just across create+ownership registration. Cleanup
            # may only remove a database whose creation succeeded in this run.
            previous_mask = signal.pthread_sigmask(signal.SIG_BLOCK, {signal.SIGINT, signal.SIGTERM})
            try:
                result = pg(['createdb', '--no-password', '--template=template0', '--encoding=UTF8', '--owner=postgres', database],
                            stdout=log, stderr=log)
                created = result.returncode == 0
            finally:
                signal.pthread_sigmask(signal.SIG_SETMASK, previous_mask)
            require(result.returncode == 0, 'isolated-database-create-failed')
            receipt['databaseCreated'] = True
            # Root opens the private dump; only its bytes are sent to pg_restore.
            # The postgres OS user never gains directory/file access to backups.
            with (backup / 'database.dump').open('rb') as dump:
                result = pg(['pg_restore', '--no-password', '--exit-on-error', '--single-transaction', '--no-owner', '--no-privileges',
                             '--dbname', database], stdin=dump, stdout=log, stderr=log)
            require(result.returncode == 0, 'isolated-database-restore-failed')
            required_tables = sql(database, "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('User','Space','Page','_prisma_migrations')")
            require(required_tables == '4', 'restored-application-tables-missing')
            table_count = int(sql(database, "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'"))
            migration_count = int(sql(database, 'SELECT count(*) FROM public."_prisma_migrations" WHERE finished_at IS NOT NULL'))
            require(table_count > 4 and migration_count > 0, 'restored-schema-incomplete')
            receipt.update(status='passed', restoredApplicationTables=4, restoredPublicTables=table_count, restoredCompletedMigrations=migration_count)
    except (Exception, KeyboardInterrupt) as error:
        # No raw process diagnostics or exception text: dumps can contain user data.
        code = str(error) if isinstance(error, RuntimeError) and re.fullmatch(r'[a-z-]+', str(error)) else 'restore-verification-failed'
        receipt.update(status='failed', error=code)
    finally:
        if created:
            try:
                # Name was generated here, absent before this run, and created by us.
                # Force only our disposable database, so an interrupted restore
                # connection cannot keep its cleanup pending.
                result = pg(['dropdb', '--no-password', '--if-exists', '--force', database], stdout=log, stderr=log)
                require(result.returncode == 0, 'isolated-database-drop-failed')
                receipt['databaseExists'] = sql('postgres', f"SELECT count(*) FROM pg_database WHERE datname='{database}'") != '0'
                require(not receipt['databaseExists'], 'isolated-database-remains')
            except Exception:
                receipt.update(status='failed', cleanup='failed', error='Isolated database cleanup requires attention.')
        if log:
            log.close()
    print(json.dumps(receipt, ensure_ascii=False))
    return 0 if receipt['status'] in ('passed', 'preflight-passed') else 1


if __name__ == '__main__':
    signal.signal(signal.SIGTERM, lambda *_: (_ for _ in ()).throw(KeyboardInterrupt()))
    sys.exit(main())
