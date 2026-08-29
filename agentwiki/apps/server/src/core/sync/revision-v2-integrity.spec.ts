import {
  advanceRevisionChainHash,
  hasCompleteRevisionChain,
  hasTrustedV2GenesisInputMarker,
  hasTrustedV2GenesisMarker,
  isValidRevisionChainCheckpoint,
  revisionTreeDeltaHashV2,
  revisionShouldBeV2,
  sealRevisionChainCheckpoint,
} from './revision-v2-integrity';

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
    revisionContentHash: String(sequence).repeat(64).slice(0, 64),
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

  it('accepts an exact retained chain ending at a valid checkpoint boundary', () => {
    const boundary = revision(7, 'rev-6');
    const rollingChainHash = advanceRevisionChainHash(null, {
      ...boundary,
      revisionContentHash: 'a'.repeat(64),
      schemaVersion: 'content-tree@2',
      recipeVersion: 'space-folders-v1',
    });
    const checkpoint = sealRevisionChainCheckpoint({
      spaceId: boundary.spaceId,
      boundarySequence: boundary.sequence,
      boundaryRevisionId: boundary.id,
      boundaryParentRevisionId: boundary.parentRevisionId,
      boundaryRevisionContentHash: 'a'.repeat(64),
      rollingChainHash,
      anchorSequence: 8,
      anchorRevisionId: 'rev-8',
      anchorParentRevisionId: 'rev-7',
      anchorRevisionContentHash: revision(8, 'rev-7').revisionContentHash,
      anchorTreeDeltaHash: 'b'.repeat(64),
    });

    expect(hasCompleteRevisionChain(
      revision(10, 'rev-9'),
      [revision(9, 'rev-8'), revision(8, 'rev-7')],
      { checkpoint },
    )).toBe(true);
  });

  it('rejects a retained v2 gap when no checkpoint evidence exists', () => {
    expect(hasCompleteRevisionChain(
      revision(10, 'rev-9'),
      [revision(9, 'rev-8'), revision(8, 'rev-7')],
    )).toBe(false);
  });

  it('accepts a strict v2 suffix ending at an explicitly verified trusted genesis', () => {
    const genesis = revision(7, 'legacy-rev-6');
    expect(hasCompleteRevisionChain(
      revision(9, 'rev-8'),
      [revision(8, 'rev-7'), genesis],
      { trustedGenesis: genesis },
    )).toBe(true);
    expect(hasCompleteRevisionChain(
      revision(9, 'rev-8'),
      [revision(8, 'wrong'), genesis],
      { trustedGenesis: genesis },
    )).toBe(false);
  });

  it('rejects trusted-genesis bootstrap while its sequence-1 predecessor is retained', () => {
    const predecessor = revision(6, 'rev-5');
    const genesis = revision(7, predecessor.id);

    expect(hasCompleteRevisionChain(
      revision(9, 'rev-8'),
      [revision(8, genesis.id), genesis, predecessor],
      { trustedGenesis: genesis },
    )).toBe(false);
  });
});

describe('revision chain checkpoint evidence', () => {
  const fields = {
    spaceId: 'space-1',
    boundarySequence: 7,
    boundaryRevisionId: 'rev-7',
    boundaryParentRevisionId: 'rev-6',
    boundaryRevisionContentHash: 'a'.repeat(64),
    anchorSequence: 8,
    anchorRevisionId: 'rev-8',
    anchorParentRevisionId: 'rev-7',
    anchorRevisionContentHash: '8'.repeat(64),
    anchorTreeDeltaHash: 'c'.repeat(64),
  };

  it('hashes exact canonical stored anchor delta rows', () => {
    const rows = [{
      ordinal: 0,
      operation: 'upsert_page',
      folderId: null,
      pageId: 'page-1',
      previousPath: null,
      contentHash: 'd'.repeat(64),
    }];
    expect(revisionTreeDeltaHashV2(rows)).toBe(
      '6dcaad2cfa974dfb7a6586fcf96a414f637edf8d809b39075528be4747e81a6b',
    );
    expect(revisionTreeDeltaHashV2([{ ...rows[0]!, pageId: 'page-2' }])).not.toBe(
      revisionTreeDeltaHashV2(rows),
    );
  });

  it('uses deterministic versioned rolling and evidence hashes', () => {
    const rollingChainHash = advanceRevisionChainHash(null, {
      id: fields.boundaryRevisionId,
      spaceId: fields.spaceId,
      sequence: fields.boundarySequence,
      parentRevisionId: fields.boundaryParentRevisionId,
      revisionContentHash: fields.boundaryRevisionContentHash,
      schemaVersion: 'content-tree@2',
      recipeVersion: 'space-folders-v1',
    });
    expect(rollingChainHash).toBe('79ee19d2d37b30ab15cc10d372b769d766e8be05b12799acdbea417ab75cde5c');

    const checkpoint = sealRevisionChainCheckpoint({ ...fields, rollingChainHash });
    expect(checkpoint).toEqual({
      contractVersion: 'revision-chain-checkpoint@1',
      ...fields,
      rollingChainHash,
      evidenceHash: '961d71241889e3c1e8968a7450597e0c10743950e2f9db44b1ca5a304c97b3d6',
    });
    expect(isValidRevisionChainCheckpoint(checkpoint, 'space-1')).toBe(true);
  });

  it.each([
    ['contract version', { contractVersion: 'revision-chain-checkpoint@2' }],
    ['Space', { spaceId: 'space-2' }],
    ['boundary sequence', { boundarySequence: 8 }],
    ['boundary id', { boundaryRevisionId: 'rev-other' }],
    ['boundary parent', { boundaryParentRevisionId: 'rev-other' }],
    ['boundary content hash', { boundaryRevisionContentHash: 'b'.repeat(64) }],
    ['rolling chain hash', { rollingChainHash: 'b'.repeat(64) }],
    ['anchor sequence', { anchorSequence: 9 }],
    ['anchor id', { anchorRevisionId: 'rev-other' }],
    ['anchor parent', { anchorParentRevisionId: 'rev-other' }],
    ['anchor content hash', { anchorRevisionContentHash: 'b'.repeat(64) }],
    ['anchor delta hash', { anchorTreeDeltaHash: 'b'.repeat(64) }],
    ['evidence hash', { evidenceHash: 'b'.repeat(64) }],
    ['missing boundary parent field', { boundaryParentRevisionId: undefined }],
  ])('rejects checkpoint %s tampering', (_label, mutation) => {
    const rollingChainHash = advanceRevisionChainHash(null, {
      id: fields.boundaryRevisionId,
      spaceId: fields.spaceId,
      sequence: fields.boundarySequence,
      parentRevisionId: fields.boundaryParentRevisionId,
      revisionContentHash: fields.boundaryRevisionContentHash,
      schemaVersion: 'content-tree@2',
      recipeVersion: 'space-folders-v1',
    });
    const checkpoint = sealRevisionChainCheckpoint({ ...fields, rollingChainHash });
    expect(isValidRevisionChainCheckpoint({ ...checkpoint, ...mutation } as never, 'space-1')).toBe(false);
  });
});

describe('trusted v2 genesis marker', () => {
  const marker = {
    id: 'rev-7',
    spaceId: 'space-1',
    sequence: 7,
    parentRevisionId: 'legacy-rev-6',
    schemaVersion: 'content-tree@2',
    recipeVersion: 'space-folders-v1',
    origin: 'migration',
    migrationBatchId: 'space-folders-v1:space-1',
  };
  const sidecar = {
    spaceFolderMigration: {
      version: 1,
      status: 'completed',
      batchKey: 'space-folders-v1:space-1',
      inputHash: 'b'.repeat(64),
      v2Revision: {
        protocolVersion: '2',
        manifestSchema: 'TreeRevisionContentManifestV2',
      },
    },
  };

  it('accepts only the exact Task 6 migration marker combination', () => {
    expect(hasTrustedV2GenesisMarker('space-1', marker, sidecar)).toBe(true);
  });

  it('recognizes the exact Task 6 input marker before v2 finalization', () => {
    const { schemaVersion: _schema, recipeVersion: _recipe, ...pending } = marker;
    const pendingSidecar = {
      spaceFolderMigration: {
        ...sidecar.spaceFolderMigration,
        v2Revision: undefined,
      },
    };
    expect(hasTrustedV2GenesisInputMarker('space-1', pending, pendingSidecar)).toBe(true);
    expect(hasTrustedV2GenesisInputMarker(
      'space-1',
      { ...pending, origin: 'web_editor' },
      pendingSidecar,
    )).toBe(false);
  });

  it.each([
    ['ordinary writer origin', { revision: { origin: 'web_editor' } }],
    ['generic migration batch', { revision: { migrationBatchId: 'other' } }],
    ['wrong Space batch', { sidecar: { spaceFolderMigration: { ...sidecar.spaceFolderMigration, batchKey: 'space-folders-v1:space-2' } } }],
    ['missing input evidence', { sidecar: { spaceFolderMigration: { ...sidecar.spaceFolderMigration, inputHash: null } } }],
    ['legacy schema', { revision: { schemaVersion: 'knowledge-bundle@1' } }],
  ])('rejects %s as a bootstrap marker', (_label, rawMutation) => {
    const mutation = rawMutation as {
      revision?: Partial<typeof marker>;
      sidecar?: unknown;
    };
    expect(hasTrustedV2GenesisMarker(
      'space-1',
      { ...marker, ...(mutation.revision ?? {}) },
      mutation.sidecar ?? sidecar,
    )).toBe(false);
  });
});
