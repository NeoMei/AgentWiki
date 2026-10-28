#!/usr/bin/env python3
"""Exercise restore/cleanup control flow with no PostgreSQL or production access."""
import contextlib
import importlib.util
import io
import json
import pathlib
import subprocess
import tempfile
import unittest
from unittest.mock import patch

path = pathlib.Path(__file__).with_name('verify-backup-restore.py')
spec = importlib.util.spec_from_file_location('restore_verifier', path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class RestoreSafetyTests(unittest.TestCase):
    def run_case(self, *, restore_failure=False, interrupted=False, create_failure=False, check=False):
        commands = []
        def run(argv, **options):
            commands.append(argv)
            tool = argv[4]
            require_database = options['env']['PGDATABASE']
            self.assertEqual(require_database, 'postgres')
            self.assertEqual(options['env']['PGHOST'], '/var/run/postgresql')
            if tool == 'psql':
                query = argv[-1]
                if query == 'SELECT current_user': value = 'postgres'
                elif 'pg_database' in query: value = '0'
                elif 'table_name IN' in query: value = '4'
                elif 'information_schema.tables' in query: value = '85'
                elif '_prisma_migrations' in query: value = '65'
                else: self.fail('Unexpected query')
                return subprocess.CompletedProcess(argv, 0, value + '\n', '')
            if tool == 'pg_restore':
                if interrupted: raise KeyboardInterrupt()
                return subprocess.CompletedProcess(argv, 1 if restore_failure else 0)
            return subprocess.CompletedProcess(argv, 1 if tool == 'createdb' and create_failure else 0)

        with tempfile.TemporaryDirectory() as temporary:
            backup = pathlib.Path(temporary)
            (backup / 'database.dump').write_bytes(b'fake custom dump')
            stdout = io.StringIO()
            with patch.object(module.os, 'geteuid', return_value=0), \
                 patch.object(module, 'backup_inputs', return_value=(backup, '0' * 64)), \
                 patch.object(module.pathlib.Path, 'is_dir', return_value=True), \
                 patch.object(module.shutil, 'which', return_value='/usr/bin/fake'), \
                 patch.object(module.subprocess, 'run', side_effect=run), \
                 patch.object(module.sys, 'argv', ['verify-backup-restore.py', '--backup', str(backup)] + (['--check'] if check else [])), \
                 contextlib.redirect_stdout(stdout):
                code = module.main()
            receipt = json.loads(stdout.getvalue())
        return code, receipt, commands

    def test_success_restores_only_new_name_then_removes_it(self):
        code, receipt, commands = self.run_case()
        self.assertEqual(code, 0)
        self.assertEqual(receipt['status'], 'passed')
        self.assertFalse(receipt['databaseExists'])
        created = next(command[-1] for command in commands if command[4] == 'createdb')
        restore = next(command for command in commands if command[4] == 'pg_restore')
        dropped = next(command[-1] for command in commands if command[4] == 'dropdb')
        self.assertRegex(created, r'^agentwiki_restore_v01265_[0-9a-f]{32}$')
        self.assertEqual(restore[-1], created)
        self.assertEqual(dropped, created)
        for flag in ['--single-transaction', '--no-owner', '--no-privileges', '--exit-on-error']:
            self.assertIn(flag, restore)
        self.assertNotIn('--clean', restore)

    def test_restore_error_still_cleans_database(self):
        code, receipt, commands = self.run_case(restore_failure=True)
        self.assertEqual(code, 1)
        self.assertEqual(receipt['error'], 'isolated-database-restore-failed')
        self.assertFalse(receipt['databaseExists'])
        self.assertEqual(sum(command[4] == 'dropdb' for command in commands), 1)

    def test_interrupted_restore_still_cleans_database(self):
        code, receipt, commands = self.run_case(interrupted=True)
        self.assertEqual(code, 1)
        self.assertFalse(receipt['databaseExists'])
        self.assertEqual(sum(command[4] == 'dropdb' for command in commands), 1)

    def test_failed_create_never_drops_an_unowned_database(self):
        code, receipt, commands = self.run_case(create_failure=True)
        self.assertEqual(code, 1)
        self.assertFalse(receipt['databaseCreated'])
        self.assertFalse(any(command[4] in ('dropdb', 'pg_restore') for command in commands))

    def test_check_has_no_database_mutations(self):
        code, receipt, commands = self.run_case(check=True)
        self.assertEqual(code, 0)
        self.assertEqual(receipt['status'], 'preflight-passed')
        self.assertTrue(all(command[4] == 'psql' for command in commands))

    def test_rejects_arbitrary_backup_paths(self):
        with self.assertRaisesRegex(RuntimeError, 'invalid-backup-parent'):
            module.backup_inputs('/tmp/not-a-release-backup')


if __name__ == '__main__':
    unittest.main()
