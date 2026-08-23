import { CollaborationEventsService } from './collaboration-events.service';

describe('CollaborationEventsService', () => {
  it('publishes a refresh hint containing IDs and event sequence only', async () => {
    const redis = { publish: jest.fn() } as any;
    const prisma = { collaborationRun: { findUnique: jest.fn() } } as any;
    const service = new CollaborationEventsService(prisma, redis);
    await service.publishRunChanged('space-1', 'run-1', 42);
    expect(redis.publish).toHaveBeenCalledWith(
      'agentwiki:collaboration:runs',
      JSON.stringify({ spaceId: 'space-1', runId: 'run-1', eventSequence: 42 }),
    );
  });

  it('loads the committed sequence before publishing a current-run hint', async () => {
    const redis = { publish: jest.fn() } as any;
    const prisma = { collaborationRun: { findUnique: jest.fn().mockResolvedValue({ spaceId: 'space-1', eventSequence: 9 }) } } as any;
    const service = new CollaborationEventsService(prisma, redis);
    await service.publishCurrentRun('run-1');
    expect(redis.publish).toHaveBeenCalledWith(
      'agentwiki:collaboration:runs',
      JSON.stringify({ spaceId: 'space-1', runId: 'run-1', eventSequence: 9 }),
    );
  });
});
