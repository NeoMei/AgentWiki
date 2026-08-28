import { hasCompleteRevisionChain, revisionShouldBeV2 } from './revision-v2-integrity';

const markerFree = () => ({
  schemaVersion: 'knowledge-bundle@1',
  recipeVersion: 'none',
  sidecar: {},
  folderRowCount: 0,
  hasPlacedPage: false,
  treeDeltaRowCount: 0,
  migrationBatchId: null,
  parentShouldBeV2: false,
});

describe('revisionShouldBeV2', () => {
  it.each([
    ['schema', { schemaVersion: 'content-tree@2' }],
    ['recipe', { recipeVersion: 'space-folders-v1' }],
    ['sidecar key even with a malformed protocol version', {
      sidecar: { spaceFolderMigration: { v2Revision: { protocolVersion: '1' } } },
    }],
    ['Folder row', { folderRowCount: 1 }],
    ['placed Page', { hasPlacedPage: true }],
    ['tree delta row', { treeDeltaRowCount: 1 }],
    ['migration batch', { migrationBatchId: 'space-folders-v1:space-1' }],
    ['v2 parent', { parentShouldBeV2: true }],
  ])('recognizes the isolated %s marker', (_label, marker) => {
    expect(revisionShouldBeV2({ ...markerFree(), ...marker })).toBe(true);
  });

  it('does not mark a Folder-free root-only legacy revision', () => {
    expect(revisionShouldBeV2(markerFree())).toBe(false);
  });
});

describe('hasCompleteRevisionChain', () => {
  const revision = (sequence: number, parentRevisionId: string | null) => ({
    id: `rev-${sequence}`, spaceId: 'space-1', sequence, parentRevisionId,
  });

  it('accepts a complete strict chain loaded in any order', () => {
    expect(hasCompleteRevisionChain(
      revision(4, 'rev-3'),
      [revision(1, null), revision(3, 'rev-2'), revision(2, 'rev-1')],
    )).toBe(true);
  });

  it.each([
    ['deep missing ancestor', [revision(3, 'rev-2'), revision(2, 'rev-1')]],
    ['deep wrong link', [revision(3, 'rev-2'), revision(2, 'wrong'), revision(1, null)]],
    ['deep cycle', [revision(3, 'rev-2'), revision(2, 'rev-3'), revision(1, null)]],
    ['cross-Space ancestor', [revision(3, 'rev-2'), { ...revision(2, 'rev-1'), spaceId: 'space-2' }, revision(1, null)]],
  ])('rejects a %s', (_label, ancestors) => {
    expect(hasCompleteRevisionChain(revision(4, 'rev-3'), ancestors)).toBe(false);
  });
});
