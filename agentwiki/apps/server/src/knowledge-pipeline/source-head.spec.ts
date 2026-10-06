import { assertSourceHeadMatches, lockSourceHead, nextSourceGeneration, validateSourcePublication } from './source-head';

const head = { sourceId: 'source', sourceVersionId: 'A', generation: 3 };
function txFixture() {
  const source = { id: 'source', spaceId: 'space', status: 'active', currentSourceVersionId: 'A', currentSourceGeneration: 3 };
  const run = { sourceId: 'source', spaceId: 'space', inputSourceVersionId: 'A', inputSourceGeneration: 3 };
  const tx: any = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: 'source' }]),
    source: { findUnique: jest.fn().mockResolvedValue(source) },
    sourceVersion: { findFirst: jest.fn().mockResolvedValue({ id: 'A' }) },
    ingestRun: { findUnique: jest.fn().mockResolvedValue(run) },
  };
  return { source, run, tx };
}
const page = { id: 'item', type: 'update_page', payload: { sourceId: 'source', sourceVersionId: 'A', sourceGeneration: 3, changes: { content: 'new' } } };
describe('source head publication contract', () => {
  it('rejects both stale A1 and B2 under A3 and preserves the version identity', () => {
    expect(() => assertSourceHeadMatches(head, { sourceId: 'source', sourceVersionId: 'A', generation: 1 })).toThrow();
    expect(() => assertSourceHeadMatches(head, { sourceId: 'source', sourceVersionId: 'B', generation: 2 })).toThrow();
    expect(() => assertSourceHeadMatches(head, { ...head, generation: 3 })).not.toThrow();
    expect(nextSourceGeneration(3, true)).toBe(3);
    expect(nextSourceGeneration(3, false)).toBe(4);
    expect(() => nextSourceGeneration(2147483647, false)).toThrow();
  });
  it('never upgrades historical unknown or a deleted tracked head to current', () => {
    expect(() => assertSourceHeadMatches(null, { sourceId: 'source', sourceVersionId: 'A', generation: null })).not.toThrow();
    expect(() => assertSourceHeadMatches(null, { ...head, generation: 3 })).toThrow();
  });
  it('locks then rejects archived, cross-Space and corrupt-version associations', async () => {
    const f = txFixture();
    await expect(lockSourceHead(f.tx, 'source', 'space')).resolves.toEqual(head);
    f.source.status = 'archived';
    await expect(lockSourceHead(f.tx, 'source', 'space')).rejects.toMatchObject({ businessCode: 'SOURCE_VERSION_CONFLICT' });
    f.source.status = 'active'; f.source.spaceId = 'other';
    await expect(lockSourceHead(f.tx, 'source', 'space')).rejects.toThrow();
    f.source.spaceId = 'space'; f.tx.sourceVersion.findFirst.mockResolvedValue(null);
    await expect(lockSourceHead(f.tx, 'source', 'space')).rejects.toThrow();
  });
  it('validates current manual review and rejects auto-publish, forged or missing generations', async () => {
    const f = txFixture(); const cs = { runId: 'run', spaceId: 'space' };
    expect((await validateSourcePublication(f.tx, cs, [page], false)).get('item')).toEqual(head);
    await expect(validateSourcePublication(f.tx, cs, [page], true)).rejects.toMatchObject({ businessCode: 'APPROVAL_REQUIRED' });
    await expect(validateSourcePublication(f.tx, cs, [{ ...page, payload: { ...page.payload, sourceGeneration: null } }], false)).rejects.toThrow();
    await expect(validateSourcePublication(f.tx, { spaceId: 'space' }, [page], false)).rejects.toThrow();
    await expect(validateSourcePublication(f.tx, cs, [{ ...page, payload: { ...page.payload, changes: { sourceGeneration: 3 } } }], false)).rejects.toThrow();
  });
  it('rejects caller-supplied before generation so revert cannot self-attest source review', async () => {
    const f = txFixture();
    await expect(validateSourcePublication(f.tx, { spaceId: 'space' }, [{ id: 'new', type: 'create_page', payload: { before: { restoredFromArchive: true, sourceGeneration: 8 } } }], false)).rejects.toMatchObject({ businessCode: 'SOURCE_VERSION_CONFLICT' });
  });
  it('protects relation-only runs and locks multiple Sources in sorted order', async () => {
    const f = txFixture(); f.run.inputSourceGeneration = 1;
    await expect(validateSourcePublication(f.tx, { runId: 'run', spaceId: 'space' }, [], false)).rejects.toThrow();
    f.tx.source.findUnique.mockImplementation(({ where }: any) => ({ ...f.source, id: where.id, currentSourceVersionId: null }));
    await validateSourcePublication(f.tx, { spaceId: 'space' }, ['z', 'a'].map(sourceId => ({ id: sourceId, type: 'create_page', payload: { sourceId } })), false);
    expect(f.tx.source.findUnique.mock.calls.slice(-2).map(([args]: any) => args.where.id)).toEqual(['a', 'z']);
  });
});
