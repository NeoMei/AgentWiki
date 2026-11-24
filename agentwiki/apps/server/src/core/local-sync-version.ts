export const CURRENT_LOCAL_SYNC_VERSION = '0.13.7' as const;

export const SUPPORTED_LOCAL_SYNC_VERSIONS = [
  '0.9.0',
  '0.9.1',
  '0.10.0',
  '0.10.1',
  '0.10.2',
  '0.11.0',
  '0.12.0',
  '0.13.0',
  '0.13.1',
  '0.13.2',
  '0.13.3',
  '0.13.4',
  '0.13.5',
  '0.13.6',
  CURRENT_LOCAL_SYNC_VERSION,
] as const;

export type SupportedLocalSyncVersion = typeof SUPPORTED_LOCAL_SYNC_VERSIONS[number];

export function supportsPreinstalledGateway(version: string): boolean {
  return SUPPORTED_LOCAL_SYNC_VERSIONS.findIndex(candidate => candidate === version)
    >= SUPPORTED_LOCAL_SYNC_VERSIONS.indexOf('0.13.6');
}

export function isSupportedLocalSyncVersion(
  value: unknown,
): value is SupportedLocalSyncVersion {
  return typeof value === 'string'
    && (SUPPORTED_LOCAL_SYNC_VERSIONS as readonly string[]).includes(value);
}
