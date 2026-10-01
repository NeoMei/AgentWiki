import { ReviewService } from './review.service';

const principal = { userId: 'admin-1', platformRole: 'super_admin' } as const;
describe('live human review authority', () => {
  it('denies an item decision when the acting platform admin has no live membership', async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'admin-1' }]),
      user: { findUnique: jest.fn().mockResolvedValue({ id: 'admin-1', type: 'human', platformRole: 'super_admin', deletedAt: null, lockedAt: null }) },
      space: { findUnique: jest.fn().mockResolvedValue({ id: 'space-1', deletedAt: null }) },
      spaceMember: { findUnique: jest.fn().mockResolvedValue(null) },
      changeSet: { findUnique: jest.fn().mockResolvedValue({ id: 'cs-1', spaceId: 'space-1' }) },
      changeItem: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    } as any;
    const prisma = { ...tx, $transaction: jest.fn(async (fn) => fn(tx)) } as any;
    const service = new ReviewService(prisma, {} as any, {} as any, {} as any);
    await expect((service.decideItem as any)('cs-1', 'item-1', 'accepted', principal))
      .rejects.toMatchObject({ businessCode: 'SPACE_ACCESS_DENIED' });
    expect(tx.changeItem.updateMany).not.toHaveBeenCalled();
  });
});
