import { ReviewService } from './review.service';

const principal = { userId: 'owner' };
const freshness = { projectChangeSets: jest.fn(async rows => rows) } as any;
const candidate = {
  id: 'cs', title: 'Proposed update: page', spaceId: 'space', status: 'pending_review',
  createdAt: new Date('2026-10-14T10:00:00Z'), runId: null, createdByUserId: 'owner',
  createdByUser: { id: 'owner', name: 'Owner' }, items: [{ id: 'item', type: 'update_page', payload: { pageId: 'page' } }],
};
function setup() {
  const prisma = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: 'cs', total: 51n }]),
    changeSet: { findMany: jest.fn().mockResolvedValue([candidate]), findUnique: jest.fn().mockResolvedValue(candidate) },
    page: { findMany: jest.fn().mockResolvedValue([{ id: 'page', spaceId: 'space', title: 'Human title', syncPath: 'notes/Human title.md' }]) },
    space: { findMany: jest.fn().mockResolvedValue([{ id: 'space', name: 'Space' }]) },
    spaceMember: { findMany: jest.fn().mockResolvedValue([{ spaceId: 'space', role: 'owner' }]) },
    pushSession: { findMany: jest.fn().mockResolvedValue([]) },
  } as any;
  return { prisma, service: new ReviewService(freshness, prisma, {} as any, {} as any, {} as any) };
}
describe('review identity and paginated search', () => {
  it('returns target metadata and explicit live owner capability for a direct proposal', async () => {
    const { service, prisma } = setup();
    const detail = await service.get('cs', principal);
    expect(detail).toMatchObject({ reviewKind: 'proposal', reviewAccess: { canDecide: true }, targets: [{ title: 'Human title', path: 'notes/Human title.md' }], submitter: { name: 'Owner' } });
    expect(prisma.page.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { OR: [{ id: 'page', spaceId: 'space', deletedAt: null }] } }));
  });
  it('explains missing membership and preserves import identity even when source projection removes the run', async () => {
    const { service, prisma } = setup();
    prisma.changeSet.findUnique.mockResolvedValue({ ...candidate, runId: 'hidden-run' });
    prisma.spaceMember.findMany.mockResolvedValue([]);
    freshness.projectChangeSets.mockImplementationOnce(async (rows: any[]) => rows.map(row => ({ ...row, runId: null, run: null })));
    expect(await service.get('cs', principal)).toMatchObject({ reviewKind: 'source_import', reviewAccess: { canDecide: false, reason: 'owner_required' } });
  });
  it('filters before pagination with bound SQL, deterministic tie breaking, and an authorized space scope', async () => {
    const { service, prisma } = setup();
    const result = await (service as any).listPage(['space'], principal, { page: 3, pageSize: 25, q: "Human_%'", status: 'pending_review', from: '2026-10-01T00:00:00.000Z', to: '2026-10-15T00:00:00.000Z' });
    expect(result).toMatchObject({ total: 51, page: 3, pageSize: 25, items: [{ id: 'cs' }], spaces: [{ id: 'space' }] });
    const sql = prisma.$queryRaw.mock.calls[0][0];
    expect(sql.text).toContain('ROW_NUMBER() OVER');
    expect(sql.text).toContain('"createdAt" DESC');
    expect(sql.text).toContain('"id" DESC');
    expect(sql.text).toContain('"Page"');
    expect(sql.values).toContain('space');
    expect(sql.values).toContain("%Human\\_\\%'%");
    expect(sql.values).toContain(50);
    expect(prisma.changeSet.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ['cs'] }, spaceId: { in: ['space'] } } }));
  });
});
