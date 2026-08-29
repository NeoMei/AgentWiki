import { z } from 'zod';
import { pathKey, validatePortableDirectoryPath } from '@neomei/agentwiki-sync-protocol';

/**
 * Local manifest for a Space workspace. Tracks source mappings, base revisions,
 * checkpoints, and last sync state.
 */

export const RevisionPointerSchema = z.object({
  revision: z.string().min(1),
  pulledAt: z.string().datetime(),
  contentHash: z.string().min(1),
});

export type RevisionPointer = z.infer<typeof RevisionPointerSchema>;

export const SourceMappingSchema = z.object({
  adapterId: z.string().min(1),
  sourcePath: z.string().min(1),
  sourceId: z.string().min(1),
  sourceHash: z.string().min(1),
  lastCollectedAt: z.string().datetime(),
  artifactCount: z.number().int().nonnegative(),
});

export type SourceMapping = z.infer<typeof SourceMappingSchema>;

export const LocalManifestSchema = z.object({
  schemaVersion: z.string().min(1),
  spaceId: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  baseRevision: RevisionPointerSchema.nullable(),
  pendingRevision: RevisionPointerSchema.nullable(),
  sources: z.array(SourceMappingSchema),
  checkpoints: z.array(z.string().min(1)),
  metadata: z.record(z.unknown()).optional(),
});

export type LocalManifest = z.infer<typeof LocalManifestSchema>;

export function assertLocalManifest(value: unknown): LocalManifest {
  return LocalManifestSchema.parse(value);
}

export function assertRevisionPointer(value: unknown): RevisionPointer {
  return RevisionPointerSchema.parse(value);
}

export function assertSourceMapping(value: unknown): SourceMapping {
  return SourceMappingSchema.parse(value);
}

const FolderIdentityEntryV2Schema = z.object({
  path: z.string().min(1),
  pathKey: z.string().min(1),
  updatedAt: z.string().datetime(),
}).strict();

export const FolderIdentityStateV2Schema = z.object({
  schemaVersion: z.literal(2),
  spaceId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u),
  revision: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u),
  folders: z.record(
    z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u),
    FolderIdentityEntryV2Schema,
  ),
}).strict();

export interface FolderIdentityStateV2 {
  schemaVersion: 2;
  spaceId: string;
  revision: string;
  folders: Record<string, { path: string; pathKey: string; updatedAt: string }>;
}

const FolderIdentityStateV1Schema = z.object({
  schemaVersion: z.literal(1),
  spaceId: z.string().min(1),
  revision: z.string().min(1),
  folders: z.record(z.object({
    path: z.string().min(1),
    updatedAt: z.string().datetime(),
  }).strict()),
}).strict();

export function assertFolderIdentityStateV2(value: unknown): FolderIdentityStateV2 {
  const state = FolderIdentityStateV2Schema.parse(value) as FolderIdentityStateV2;
  const seenPathKeys = new Set<string>();
  for (const [folderId, folder] of Object.entries(state.folders)) {
    const portable = validatePortableDirectoryPath(folder.path);
    if (!portable.path.startsWith('pages/')) {
      throw new TypeError(`Folder ${folderId} is outside the managed pages root`);
    }
    if (folder.path !== portable.path || folder.pathKey !== pathKey(portable.path)) {
      throw new TypeError(`Folder ${folderId} path identity is not canonical`);
    }
    if (seenPathKeys.has(folder.pathKey)) {
      throw new TypeError(`Folder identity state contains duplicate pathKey ${folder.pathKey}`);
    }
    seenPathKeys.add(folder.pathKey);
  }
  return state;
}

export function migrateFolderIdentityStateV2(value: unknown): FolderIdentityStateV2 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Folder identity state must be an object');
  }
  const schemaVersion = (value as Record<string, unknown>).schemaVersion;
  if (typeof schemaVersion === 'number' && schemaVersion > 2) {
    throw new TypeError('Folder identity state uses a future schema version');
  }
  if (schemaVersion === 2) return assertFolderIdentityStateV2(value);
  const legacy = FolderIdentityStateV1Schema.parse(value);
  const folders = Object.fromEntries(Object.entries(legacy.folders).map(([folderId, folder]) => {
    const portable = validatePortableDirectoryPath(folder.path);
    return [folderId, { path: portable.path, pathKey: pathKey(portable.path), updatedAt: folder.updatedAt }];
  }));
  return assertFolderIdentityStateV2({
    schemaVersion: 2,
    spaceId: legacy.spaceId,
    revision: legacy.revision,
    folders,
  });
}
