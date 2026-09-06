export const CURRENT_LOCAL_SYNC_VERSION = '0.9.1' as const;

export const SUPPORTED_LOCAL_SYNC_VERSIONS = [
  '0.9.0',
  CURRENT_LOCAL_SYNC_VERSION,
] as const;

export type SupportedLocalSyncVersion = typeof SUPPORTED_LOCAL_SYNC_VERSIONS[number];

export function isSupportedLocalSyncVersion(
  value: unknown,
): value is SupportedLocalSyncVersion {
  return typeof value === 'string'
    && (SUPPORTED_LOCAL_SYNC_VERSIONS as readonly string[]).includes(value);
}
