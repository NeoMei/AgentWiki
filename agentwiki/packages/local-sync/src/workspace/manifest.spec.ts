import { describe, expect, it } from 'vitest';
import {
  FolderIdentityStateV2Schema,
  LocalManifestSchema,
  assertFolderIdentityStateV2,
  assertLocalManifest,
  assertSourceMapping,
  migrateFolderIdentityStateV2,
} from './manifest.js';

describe('local manifest', () => {
  it('validates a minimal manifest', () => {
    const manifest = assertLocalManifest({
      schemaVersion: '1.0',
      spaceId: 'space-1',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
      baseRevision: null,
      pendingRevision: null,
      sources: [],
      checkpoints: [],
    });
    expect(manifest.spaceId).toBe('space-1');
    expect(LocalManifestSchema.safeParse(manifest).success).toBe(true);
  });

  it('validates source mapping', () => {
    const mapping = assertSourceMapping({
      adapterId: 'markitdown',
      sourcePath: '/tmp/docs',
      sourceId: 's1',
      sourceHash: 'sh1',
      lastCollectedAt: '2024-01-01T00:00:00Z',
      artifactCount: 3,
    });
    expect(mapping.artifactCount).toBe(3);
  });

  it('rejects malformed datetime', () => {
    expect(() =>
      assertLocalManifest({
        schemaVersion: '1.0',
        spaceId: 'space-1',
        createdAt: 'now',
        updatedAt: '2024-01-01T00:00:00Z',
        baseRevision: null,
        pendingRevision: null,
        sources: [],
        checkpoints: [],
      }),
    ).toThrow();
  });

  it('migrates a v1 Folder path map to canonical private identity state', () => {
    const migrated = migrateFolderIdentityStateV2({
      schemaVersion: 1,
      spaceId: 'space-1',
      revision: 'rev-1',
      folders: {
        'folder-1': { path: 'pages/\u9879\u76ee', updatedAt: '2026-08-29T00:00:00.000Z' },
      },
    });

    expect(migrated).toEqual({
      schemaVersion: 2,
      spaceId: 'space-1',
      revision: 'rev-1',
      folders: {
        'folder-1': {
          path: 'pages/\u9879\u76ee',
          pathKey: 'pages/\u9879\u76ee',
          updatedAt: '2026-08-29T00:00:00.000Z',
        },
      },
    });
    expect(FolderIdentityStateV2Schema.parse(migrated)).toEqual(migrated);
  });

  it('rejects future Folder state and duplicate active portable paths', () => {
    expect(() => migrateFolderIdentityStateV2({
      schemaVersion: 3,
      spaceId: 'space-1',
      revision: 'rev-1',
      folders: {},
    })).toThrow(/future|version/i);

    expect(() => assertFolderIdentityStateV2({
      schemaVersion: 2,
      spaceId: 'space-1',
      revision: 'rev-1',
      folders: {
        first: { path: 'pages/Project', pathKey: 'pages/project', updatedAt: '2026-08-29T00:00:00.000Z' },
        second: { path: 'pages/project', pathKey: 'pages/project', updatedAt: '2026-08-29T00:00:00.000Z' },
      },
    })).toThrow(/duplicate/i);
  });

  it('rejects mismatched derived path keys and invalid state identity fields', () => {
    expect(() => assertFolderIdentityStateV2({
      schemaVersion: 2,
      spaceId: '',
      revision: '',
      folders: {
        '../folder': { path: 'pages/valid', pathKey: 'wrong', updatedAt: 'not-a-date' },
      },
    })).toThrow();
  });
});
