import { GraphMaintenance } from './graph-maintenance';

describe('GraphMaintenance', () => {
  const build = (role = 'worker') => {
    const refresh = { refresh: jest.fn().mockResolvedValue(undefined) };
    const prisma = {
      spaceGraphState: { findMany: jest.fn().mockResolvedValue([]) },
      page: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const config = { get: jest.fn((key: string) => (key === 'PROCESS_ROLE' ? role : undefined)) };
    const maintenance = new GraphMaintenance(prisma as any, config as any, refresh as any);
    return { maintenance, refresh, prisma };
  };

  afterEach(() => {
    jest.useRealTimers();
  });

  it('does nothing on api-only processes', () => {
    const { maintenance } = build('api');
    expect(() => maintenance.onModuleInit()).not.toThrow();
  });

  it('collapses repeated enqueue calls into one debounced refresh', () => {
    jest.useFakeTimers();
    const { maintenance, refresh } = build('api');
    maintenance.enqueue('space-1');
    maintenance.enqueue('space-1');
    maintenance.enqueue('space-1');
    expect(refresh.refresh).not.toHaveBeenCalled();
    jest.advanceTimersByTime(30_000);
    expect(refresh.refresh).toHaveBeenCalledTimes(1);
    expect(refresh.refresh).toHaveBeenCalledWith('space-1');
  });

  it('skips spaces whose content hash is unchanged during sweep', async () => {
    const { maintenance, refresh, prisma } = build('api');
    const { createHash } = require('crypto');
    const hash = createHash('sha256').update('').digest('hex');
    prisma.spaceGraphState.findMany.mockResolvedValue([{ spaceId: 'space-1', lastContentHash: hash }]);
    await maintenance.sweep();
    expect(refresh.refresh).not.toHaveBeenCalled();
  });
});
