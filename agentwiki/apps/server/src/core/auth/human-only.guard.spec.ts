import { ForbiddenException } from '@nestjs/common';
import { HumanOnlyGuard } from './human-only.guard';

describe('HumanOnlyGuard', () => {
  const guard = new HumanOnlyGuard();
  const context = (user: unknown) => ({
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  }) as any;

  it('allows a human JWT principal', () => {
    expect(guard.canActivate(context({ userId: 'u1', type: 'human' }))).toBe(true);
  });

  it('blocks legacy user records and Agent credentials from the control plane', () => {
    expect(() => guard.canActivate(context({ userId: 'u1', type: 'agent' }))).toThrow(ForbiddenException);
    expect(() => guard.canActivate(context({ userId: 'u1', agentId: 'a1', type: 'agent' }))).toThrow(ForbiddenException);
  });
});
