#!/usr/bin/env python3
"""Verify v0.12.62 against explicitly supplied frozen source identifiers.

Reuses the v0.12.58 read-only host/public checks. prepare-source-manifest.py
embeds that implementation into a standalone copy for transfer to production.
This source entry can also run directly from the repository.
"""
import argparse
import datetime
import json
import pathlib
import re
import sys

BASE_VERIFIER_SOURCE = globals().get('BASE_VERIFIER_SOURCE')
VERSIONS = {'web': '0.12.62', 'client': '0.12.62', 'api': '0.12.62', 'localSync': '0.13.5', 'protocol': '0.6.1'}


def base_source():
    if BASE_VERIFIER_SOURCE is not None:
        return BASE_VERIFIER_SOURCE
    return (pathlib.Path(__file__).resolve().parent.parent / 'notification-unread-20261023' / 'verify-release.py').read_text()


def positive_integer(value):
    parsed = int(value)
    if parsed <= 0:
        raise argparse.ArgumentTypeError('Expected a positive file count')
    return parsed


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--mode', choices=('host', 'public'), required=True)
    parser.add_argument('--revision', required=True, help='Full frozen Git commit SHA')
    parser.add_argument('--manifest-sha256', required=True)
    parser.add_argument('--expected-files', required=True, type=positive_integer)
    parser.add_argument('--manifest', help='Required by host mode; frozen source-manifest.json')
    parser.add_argument('--host-receipt', help='Required by public mode; successful host JSON receipt')
    args = parser.parse_args()
    if not re.fullmatch(r'[0-9a-f]{40}', args.revision):
        parser.error('--revision must be a full lowercase 40-character commit SHA')
    if not re.fullmatch(r'[0-9a-f]{64}', args.manifest_sha256):
        parser.error('--manifest-sha256 must be a lowercase SHA-256 digest')
    if args.mode == 'host' and not args.manifest:
        parser.error('--manifest is required in host mode')
    if args.mode == 'public' and not args.host_receipt:
        parser.error('--host-receipt is required in public mode')
    try:
        source = base_source()
        namespace = {'__name__': '_agentwiki_release_verification_base'}
        exec(compile(source, 'notification-unread-20261023/verify-release.py', 'exec'), namespace)
        namespace.update(REVISION=args.revision, MANIFEST_SHA256=args.manifest_sha256,
                         EXPECTED_FILES=args.expected_files, VERSIONS=VERSIONS)
        result = namespace['host_verify'](args.manifest) if args.mode == 'host' else namespace['public_verify'](args.host_receipt)
        result.update(status='passed', verifiedAt=datetime.datetime.now(datetime.timezone.utc).isoformat())
        print(json.dumps(result, ensure_ascii=False))
    except Exception as error:
        print(json.dumps({'status': 'failed', 'revision': args.revision, 'error': str(error),
                          'verifiedAt': datetime.datetime.now(datetime.timezone.utc).isoformat()}))
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
