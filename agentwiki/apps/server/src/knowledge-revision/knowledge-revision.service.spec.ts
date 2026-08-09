import { KnowledgeRevisionService, RevisionHead } from './knowledge-revision.service';
import { BusinessException } from '../core/filters/business-error';

describe('KnowledgeRevisionService', () => {
  const empty: RevisionHead = { revisionId: '0', sequence: 0, contentHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' };

  const makePrisma = (revisions: any[] = []) => ({
    spaceKnowledgeRevision: {
      findFirst: jest.fn(async (_args: any) => {
        if (!revisions.length) return null;
        return [...revisions].sort((a, b) => b.sequence - a.sequence)[0];
      }),
      findUnique: jest.fn(async (__args: any) => revisions.find((r) => r.id === __args.where.id) || null),
      findMany: jest.fn(async (_args: any) => {
        return revisions
          .filter((r) => r.sequence > (_args.where.sequence?.gt ?? -1))
          .sort((a, b) => a.sequence - b.sequence)
          .slice(0, _args.take ?? 100);
      }),
    },
  } as any);

  it('returns the empty revision for an unseen space', async () => {
    const service = new KnowledgeRevisionService(makePrisma());
    await expect(service.current('space-1')).resolves.toEqual(empty);
  });

  it('returns the latest revision by sequence', async () => {
    const revisions = [
      { id: 'rev-1', spaceId: 'space-1', sequence: 1, contentHash: 'a', schemaVersion: 'knowledge-bundle@1', recipeVersion: 'r', snapshot: {}, delta: {} },
      { id: 'rev-2', spaceId: 'space-1', sequence: 2, contentHash: 'b', schemaVersion: 'knowledge-bundle@1', recipeVersion: 'r', snapshot: {}, delta: {} },
    ];
    const service = new KnowledgeRevisionService(makePrisma(revisions));
    await expect(service.current('space-1')).resolves.toEqual({ revisionId: 'rev-2', sequence: 2, contentHash: 'b' });
  });

  it('returns empty snapshot for an unseen space', async () => {
    const service = new KnowledgeRevisionService(makePrisma());
    const snapshot = await service.snapshot('space-1');
    expect(snapshot.revisionId).toBe('0');
    expect(snapshot.sequence).toBe(0);
    expect(snapshot.bundle).toEqual({
      schemaVersion: 'knowledge-bundle@1', recipeVersion: 'none', spaceId: 'space-1', baseRevision: '0',
      pages: [], memories: [], relations: [], provenance: [], deletions: [],
    });
  });

  it('returns stored snapshot for a revision id', async () => {
    const revisions = [
      { id: 'rev-1', spaceId: 'space-1', sequence: 1, contentHash: 'a', schemaVersion: 'knowledge-bundle@1', recipeVersion: 'r', snapshot: { pages: [] }, delta: {} },
    ];
    const service = new KnowledgeRevisionService(makePrisma(revisions));
    await expect(service.snapshot('space-1', 'rev-1')).resolves.toEqual({
      revisionId: 'rev-1', sequence: 1, contentHash: 'a', schemaVersion: 'knowledge-bundle@1', recipeVersion: 'r', bundle: { pages: [] },
    });
  });

  it('rejects a revision that belongs to another space', async () => {
    const revisions = [{ id: 'rev-1', spaceId: 'space-2', sequence: 1, contentHash: 'a', schemaVersion: 'knowledge-bundle@1', recipeVersion: 'r', snapshot: {}, delta: {} }];
    const service = new KnowledgeRevisionService(makePrisma(revisions));
    await expect(service.snapshot('space-1', 'rev-1')).rejects.toBeInstanceOf(BusinessException);
  });

  it('returns empty delta when there is no revision', async () => {
    const service = new KnowledgeRevisionService(makePrisma());
    await expect(service.delta('space-1', '0')).resolves.toEqual({ fromRevision: '0', toRevision: '0', revisions: [] });
  });

  it('returns a full snapshot delta from 0 to head', async () => {
    const revisions = [{ id: 'rev-1', spaceId: 'space-1', sequence: 1, contentHash: 'a', schemaVersion: 'knowledge-bundle@1', recipeVersion: 'r', snapshot: { pages: [] }, delta: {} }];
    const service = new KnowledgeRevisionService(makePrisma(revisions));
    const result = await service.delta('space-1', '0');
    expect(result.toRevision).toBe('rev-1');
    expect(result.revisions).toHaveLength(1);
  });

  it('rejects a base revision from another space', async () => {
    const revisions = [{ id: 'rev-1', spaceId: 'space-2', sequence: 1, contentHash: 'a', schemaVersion: 'knowledge-bundle@1', recipeVersion: 'r', snapshot: {}, delta: {} }];
    const service = new KnowledgeRevisionService(makePrisma(revisions));
    await expect(service.delta('space-1', 'rev-1')).rejects.toBeInstanceOf(BusinessException);
  });

  it('returns ordered revisions after the base sequence', async () => {
    const revisions = [
      { id: 'rev-1', spaceId: 'space-1', sequence: 1, contentHash: 'a', schemaVersion: 'knowledge-bundle@1', recipeVersion: 'r', snapshot: {}, delta: { a: 1 } },
      { id: 'rev-2', spaceId: 'space-1', sequence: 2, contentHash: 'b', schemaVersion: 'knowledge-bundle@1', recipeVersion: 'r', snapshot: {}, delta: { b: 2 } },
      { id: 'rev-3', spaceId: 'space-1', sequence: 3, contentHash: 'c', schemaVersion: 'knowledge-bundle@1', recipeVersion: 'r', snapshot: {}, delta: { c: 3 } },
    ];
    const service = new KnowledgeRevisionService(makePrisma(revisions));
    const result = await service.delta('space-1', 'rev-1');
    expect(result.revisions.map((r) => r.revisionId)).toEqual(['rev-2', 'rev-3']);
    expect(result.toRevision).toBe('rev-3');
  });
});
