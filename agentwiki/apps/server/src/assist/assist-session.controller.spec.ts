import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AgentTurnDto, AssistSessionController } from './assist-session.controller';
import { CombinedAuthGuard } from '../core/auth/combined-auth.guard';
import { HumanOnlyGuard } from '../core/auth/human-only.guard';

describe('AssistSessionController', () => {
  const sessions = { create: jest.fn(), list: jest.fn(), get: jest.fn(), send: jest.fn(), cancel: jest.fn() };
  const queue = { enqueue: jest.fn() };
  const controller = new AssistSessionController(sessions as any, queue as any);
  const req = { user: { userId: 'u1' } } as any;
  beforeEach(() => jest.resetAllMocks());
  it('requires the existing human authentication guards', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, AssistSessionController)).toEqual([CombinedAuthGuard, HumanOnlyGuard]);
  });
  it('uses authenticated identity for every operation', async () => {
    controller.create({ spaceId: 's1', title: 'Topic' }, req);
    controller.list('s1', req);
    controller.get('c1', req);
    controller.cancel('t1', req);
    expect(sessions.create).toHaveBeenCalledWith('s1', 'u1', 'Topic');
    expect(sessions.list).toHaveBeenCalledWith('s1', 'u1');
    expect(sessions.get).toHaveBeenCalledWith('c1', 'u1');
    expect(sessions.cancel).toHaveBeenCalledWith('t1', 'u1');
    expect(() => controller.get('c1', { user: {} } as any)).toThrow('requester');
  });
  it('enqueues only after the durable turn commits and preserves the flat view', async () => {
    const body = { clientRequestId: 'r1', pageId: 'p1', mode: 'question' as const, intent: 'why' };
    const turn = { id: 't1', sessionId: 'c1', mode: 'question', result: null };
    sessions.send.mockResolvedValue(turn);
    await expect(controller.send('c1', body, req)).resolves.toBe(turn);
    expect(sessions.send).toHaveBeenCalledWith('c1', 'u1', body);
    expect(queue.enqueue).toHaveBeenCalledTimes(1);
    sessions.send.mockRejectedValue(new Error('denied'));
    await expect(controller.send('c1', body, req)).rejects.toThrow('denied');
    expect(queue.enqueue).toHaveBeenCalledTimes(1);
  });
  it.each([
    { mode: 'edit' }, { referencePageIds: ['1', '2', '3', '4', '5', '6'] },
    { intent: 'a'.repeat(10_001) }, { noteIds: [7] }, { clientRequestId: '' },
  ])('rejects invalid request DTO fields', async extra => {
    const dto = plainToInstance(AgentTurnDto, { clientRequestId: 'r1', pageId: 'p1', intent: 'why', mode: 'question', ...extra });
    expect((await validate(dto)).length).toBeGreaterThan(0);
  });
});
