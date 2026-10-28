#!/usr/bin/env python3
"""Prepare v0.12.65 deployment hashes and a standalone read-only verifier.

All source bytes, including the reused verifier implementation, come from the
explicit Git revision. No working-tree file, environment file or credential is
included. This command does not contact production or deploy anything.
"""
import argparse
import hashlib
import io
import json
import pathlib
import subprocess
import tarfile

FIXED = {'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tsconfig.json', '.dockerignore', 'deploy.sh',
         'docs/verification/document-workspace-20261006/visual-editor-probe/fixtures.json'}
PREFIXES = ('apps/', 'packages/', 'scripts/', 'deploy/')
VERSIONS = {'package.json': '0.12.65', 'apps/client/package.json': '0.12.65', 'apps/server/package.json': '0.12.65',
            'packages/local-sync/package.json': '0.13.5', 'packages/sync-protocol/package.json': '0.6.1'}
BASE = 'docs/verification/notification-unread-20261023/verify-release.py'
ENTRY = 'docs/verification/space-review-release-v01265-20261028/verify-release.py'


def wanted(path):
    parts = pathlib.PurePosixPath(path).parts
    return ((path in FIXED or path.startswith(PREFIXES))
            and not any(part in {'.env', 'node_modules', 'dist', 'coverage'} for part in parts)
            and not path.endswith('.tar.gz'))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', required=True, help='Git repository or its agentwiki application directory')
    parser.add_argument('--revision', required=True, help='Commit to freeze; resolved to its full SHA')
    parser.add_argument('--out-dir', required=True, help='New directory for manifest, verifier and preparation receipt')
    args = parser.parse_args()
    out = pathlib.Path(args.out_dir).resolve()
    repo = subprocess.check_output(['git', '-C', str(pathlib.Path(args.repo).resolve()), 'rev-parse', '--show-toplevel']).decode().strip()

    def git(*arguments):
        return subprocess.check_output(['git', '-C', repo, *arguments])

    revision = git('rev-parse', '--verify', args.revision + '^{commit}').decode().strip()
    rows, packages, verification_sources = [], {}, {}
    archive = git('archive', '--format=tar', revision, 'agentwiki')
    with tarfile.open(fileobj=io.BytesIO(archive), mode='r:') as tree:
        for member in tree:
            if member.isdir():
                continue
            if not member.name.startswith('agentwiki/'):
                raise RuntimeError('Unexpected archive prefix')
            relative = member.name[len('agentwiki/'):]
            if not wanted(relative) and relative not in (BASE, ENTRY):
                continue
            if not member.isfile():
                raise RuntimeError('Non-regular deployment input: ' + relative)
            data = tree.extractfile(member).read()
            if relative in (BASE, ENTRY):
                verification_sources[relative] = data.decode('utf-8')
            if wanted(relative):
                rows.append({'path': relative, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
            if relative in VERSIONS:
                packages[relative] = json.loads(data)['version']
    if packages != VERSIONS:
        raise RuntimeError('Commit versions do not match 0.12.65/0.13.5/0.6.1')
    if set(verification_sources) != {BASE, ENTRY}:
        raise RuntimeError('The frozen commit must contain both the reusable verifier and the new entry')
    rows.sort(key=lambda row: row['path'])
    if len({row['path'] for row in rows}) != len(rows):
        raise RuntimeError('Duplicate source paths')
    manifest = {'revision': revision, 'scope': 'deploy.sh exact source inputs, excluding .env/node_modules/dist/coverage/tar.gz', 'files': rows}
    raw = (json.dumps(manifest, indent=2, ensure_ascii=False) + '\n').encode('utf-8')
    manifest_hash = hashlib.sha256(raw).hexdigest()
    standalone = '#!/usr/bin/env python3\nBASE_VERIFIER_SOURCE = ' + repr(verification_sources[BASE]) + '\n' + verification_sources[ENTRY]
    compile(standalone, 'verify-release.py', 'exec')
    receipt = {'revision': revision, 'sourceFiles': len(rows), 'manifestSha256': manifest_hash,
               'manifest': str(out / 'source-manifest.json'), 'verifier': str(out / 'verify-release.py'),
               'verifierSha256': hashlib.sha256(standalone.encode('utf-8')).hexdigest(),
               'verifierArgs': ['--revision', revision, '--manifest-sha256', manifest_hash, '--expected-files', str(len(rows))]}
    out.mkdir(parents=True, exist_ok=False)
    (out / 'source-manifest.json').write_bytes(raw)
    (out / 'verify-release.py').write_text(standalone, encoding='utf-8')
    (out / 'preparation-receipt.json').write_text(json.dumps(receipt, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    print(json.dumps(receipt, ensure_ascii=False))


if __name__ == '__main__':
    main()
