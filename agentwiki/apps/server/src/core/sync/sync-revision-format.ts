export const SYNC_V1_SCHEMA_VERSION = 'knowledge-bundle@1';
export const SYNC_V1_RECIPE_VERSION = 'none';
export const SYNC_V2_SCHEMA_VERSION = 'content-tree@2';
export const SYNC_V2_RECIPE_VERSION = 'space-folders-v1';
export const SYNC_V3_SCHEMA_VERSION = 'content-tree@3';
export const SYNC_V3_RECIPE_VERSION = 'referenced-images-v1';

export interface SyncRevisionFormat {
  schemaVersion: string;
  recipeVersion: string;
}

export function isSyncV1RevisionFormat(revision: SyncRevisionFormat): boolean {
  return revision.schemaVersion === SYNC_V1_SCHEMA_VERSION
    && revision.recipeVersion === SYNC_V1_RECIPE_VERSION;
}

export function isSyncV2RevisionFormat(revision: SyncRevisionFormat): boolean {
  return revision.schemaVersion === SYNC_V2_SCHEMA_VERSION
    && revision.recipeVersion === SYNC_V2_RECIPE_VERSION;
}

export function isSyncV3RevisionFormat(revision: SyncRevisionFormat): boolean {
  return revision.schemaVersion === SYNC_V3_SCHEMA_VERSION
    && revision.recipeVersion === SYNC_V3_RECIPE_VERSION;
}

export function isSupportedLegacySyncRevisionFormat(revision: SyncRevisionFormat): boolean {
  return isSyncV1RevisionFormat(revision) || isSyncV2RevisionFormat(revision);
}

export function isSupportedSyncRevisionFormat(revision: SyncRevisionFormat): boolean {
  return isSupportedLegacySyncRevisionFormat(revision) || isSyncV3RevisionFormat(revision);
}
