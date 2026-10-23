#!/usr/bin/env python3
"""Read-only frozen-source and independent public-entry verification.

Run host mode on production, save its JSON receipt, then run public mode from
another machine with that receipt. Neither mode reads environment/credentials,
changes services, starts onboarding, or writes application data.
"""
import argparse
import datetime
import hashlib
from html.parser import HTMLParser
import json
import pathlib
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request

REVISION = '19da88ebc90c9213a3835403c69f60e3669c5d86'
MANIFEST_SHA256 = 'cc19128fb6c5dadb629ed7772e836a3596206868eec3b3a237678f7c74ecf6be'
EXPECTED_FILES = 1423
VERSIONS = {'web': '0.12.58', 'client': '0.12.58', 'api': '0.12.58', 'localSync': '0.13.5', 'protocol': '0.6.1'}
PUBLIC_ORIGIN = 'https://agentwiki.quukk.com'
HEALTH_KEYS = ('status', 'database', 'redis', 'auditPersistence', 'attachmentStorage')
SERVICES = ('agentwiki-api.service', 'agentwiki-worker.service', 'agentwiki-frontend.service')
ROOT = pathlib.Path('/root/agentwiki')


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def safe_file(root, relative):
    path = pathlib.PurePosixPath(relative)
    require(not path.is_absolute() and '..' not in path.parts and path.parts and '.env' not in path.parts, 'Unsafe relative path in manifest or HTML')
    target = root.joinpath(*path.parts)
    require(target.is_file() and not target.is_symlink(), 'Missing/non-regular file: ' + relative)
    require(target.resolve().is_relative_to(root.resolve()), 'Path escapes expected root: ' + relative)
    return target


class EntryParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.assets = []

    def handle_starttag(self, tag, attrs):
        for key, value in attrs:
            if tag in ('script', 'link') and key in ('src', 'href') and value and value.startswith('/assets/'):
                parsed = urllib.parse.urlsplit(value)
                require(not parsed.query and not parsed.fragment and not parsed.netloc and not parsed.scheme, 'Unexpected entry-asset URL')
                require(urllib.parse.unquote(parsed.path) == parsed.path and '..' not in pathlib.PurePosixPath(parsed.path).parts, 'Unsafe entry-asset path')
                if value not in self.assets:
                    self.assets.append(value)


def entry_assets(html):
    parser = EntryParser()
    parser.feed(html)
    require(parser.assets, 'No entry assets found')
    return parser.assets


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise RuntimeError('Unexpected redirect for a fixed verification URL')


def get_bytes(url, max_bytes=20 * 1024 * 1024):
    opener = urllib.request.build_opener(NoRedirect())
    request = urllib.request.Request(url, headers={'Cache-Control': 'no-cache', 'Accept-Encoding': 'identity', 'User-Agent': 'AgentWiki-release-verifier/0.12.58'})
    with opener.open(request, timeout=30) as response:
        require(response.status == 200, 'Unexpected HTTP status')
        data = response.read(max_bytes + 1)
        require(len(data) <= max_bytes, 'Verification response exceeds bound')
        return data


def health(url):
    raw = json.loads(get_bytes(url, 64 * 1024))
    require(isinstance(raw, dict), 'Health response is not an object')
    summary = {key: raw.get(key) for key in HEALTH_KEYS}
    require(all(value == 'ok' for value in summary.values()), 'Health contract is not fully ok')
    return summary


def host_verify(manifest_path):
    require(ROOT.is_dir() and not ROOT.is_symlink() and ROOT.resolve() == ROOT, 'Production root is not the expected canonical directory')
    manifest_bytes = pathlib.Path(manifest_path).read_bytes()
    require(digest(manifest_bytes) == MANIFEST_SHA256, 'Manifest digest differs from frozen candidate')
    manifest = json.loads(manifest_bytes)
    require(manifest.get('revision') == REVISION, 'Wrong frozen source revision')
    rows = manifest.get('files')
    require(isinstance(rows, list) and len(rows) == EXPECTED_FILES, 'Unexpected manifest file count')
    require(len({row['path'] for row in rows}) == EXPECTED_FILES, 'Duplicate source paths')
    mismatches = []
    for row in rows:
        data = safe_file(ROOT, row['path']).read_bytes()
        if len(data) != row['bytes'] or digest(data) != row['sha256']:
            mismatches.append(row['path'])
    require(not mismatches, 'Source mismatches: ' + ', '.join(mismatches))
    package_paths = {'web': 'package.json', 'client': 'apps/client/package.json', 'api': 'apps/server/package.json', 'localSync': 'packages/local-sync/package.json', 'protocol': 'packages/sync-protocol/package.json'}
    versions = {key: json.loads(safe_file(ROOT, path).read_text())['version'] for key, path in package_paths.items()}
    require(versions == VERSIONS, 'Release versions do not match fixed candidate')
    services = {}
    for unit in SERVICES:
        result = subprocess.run(['systemctl', '--user', 'is-active', unit], capture_output=True, text=True, timeout=10)
        services[unit] = result.stdout.strip()
        require(result.returncode == 0 and services[unit] == 'active', 'Service is not active: ' + unit)
    node = subprocess.run(['/usr/bin/node', '--version'], capture_output=True, text=True, timeout=10)
    require(node.returncode == 0 and node.stdout.strip().split('.')[0] in ('v24', 'v26'), 'Unsupported production Node runtime')
    local_health = health('http://127.0.0.1:3000/api/health')
    dist = ROOT / 'apps/client/dist'
    html = safe_file(dist, 'index.html').read_bytes()
    assets = entry_assets(html.decode('utf-8'))
    asset_hashes = {asset: digest(safe_file(dist, asset.lstrip('/')).read_bytes()) for asset in assets}
    return {'mode': 'host', 'revision': REVISION, 'sourceFilesVerified': EXPECTED_FILES, 'manifestSha256': MANIFEST_SHA256, 'mismatches': [], 'versions': versions, 'nodeVersion': node.stdout.strip(), 'services': services, 'health': local_health, 'entryHtmlSha256': digest(html), 'entryAssets': asset_hashes}


def public_verify(receipt_path):
    receipt = json.loads(pathlib.Path(receipt_path).read_text())
    require(receipt.get('status') == 'passed' and receipt.get('mode') == 'host', 'Host receipt did not pass')
    require(receipt.get('revision') == REVISION and receipt.get('versions') == VERSIONS and receipt.get('sourceFilesVerified') == EXPECTED_FILES, 'Host receipt belongs to another release')
    require(receipt.get('manifestSha256') == MANIFEST_SHA256, 'Host receipt belongs to another source manifest')
    expected_assets = receipt.get('entryAssets')
    require(isinstance(expected_assets, dict) and expected_assets, 'Host asset hashes are missing')
    public_health = health(PUBLIC_ORIGIN + '/api/health')
    html = get_bytes(PUBLIC_ORIGIN + '/', 2 * 1024 * 1024)
    assets = entry_assets(html.decode('utf-8'))
    require(set(assets) == set(expected_assets), 'Public index references different assets than the deployed host')
    require(digest(html) == receipt.get('entryHtmlSha256'), 'Public index differs from deployed index')
    matched = []
    for asset in assets:
        require(digest(get_bytes(PUBLIC_ORIGIN + asset)) == expected_assets[asset], 'Public asset differs from deployed asset: ' + asset)
        matched.append(asset)
    return {'mode': 'public', 'revision': REVISION, 'origin': PUBLIC_ORIGIN, 'health': public_health, 'pageHttpStatus': 200, 'entryHtmlMatchProduction': True, 'entryAssetsMatchProduction': matched, 'entryAssetCount': len(matched)}


def main():
    require(REVISION != 'PENDING_FROZEN_REVISION' and MANIFEST_SHA256 != 'PENDING_MANIFEST_SHA256' and EXPECTED_FILES > 0, 'Release revision has not been frozen')
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--mode', choices=('host', 'public'), required=True)
    parser.add_argument('--manifest', default='/tmp/agentwiki-v01258-source-manifest.json')
    parser.add_argument('--host-receipt', help='Required by public mode; JSON output from successful host mode')
    args = parser.parse_args()
    if args.mode == 'public' and not args.host_receipt:
        parser.error('--host-receipt is required in public mode')
    result = host_verify(args.manifest) if args.mode == 'host' else public_verify(args.host_receipt)
    result.update(status='passed', verifiedAt=datetime.datetime.now(datetime.timezone.utc).isoformat())
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # No process environment or credentials are ever read or emitted.
        print(json.dumps({'status': 'failed', 'revision': REVISION, 'error': str(error), 'verifiedAt': datetime.datetime.now(datetime.timezone.utc).isoformat()}))
        sys.exit(1)
