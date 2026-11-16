/** The one pinned Local Sync release used by installation and host launch. */
export const GATEWAY_PACKAGE_NAME = '@neomei/agentwiki-local-sync';
export const GATEWAY_PACKAGE_VERSION = '0.13.6';

export function assertExactPackageVersion(version: string): void {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error('Gateway runtime version must be an exact version');
  }
}
