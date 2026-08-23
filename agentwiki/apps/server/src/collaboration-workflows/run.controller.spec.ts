import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { CombinedAuthGuard } from '../core/auth/combined-auth.guard';
import { HumanOnlyGuard } from '../core/auth/human-only.guard';
import { RunController } from './run.controller';

describe('RunController', () => {
  it('uses the exact collaboration run route and human guards', () => {
    expect(Reflect.getMetadata(PATH_METADATA, RunController)).toBe('spaces/:spaceId/collaboration/runs');
    expect(Reflect.getMetadata(GUARDS_METADATA, RunController)).toEqual([CombinedAuthGuard, HumanOnlyGuard]);
  });

  it('declares every required literal sub-route', () => {
    const paths = Object.getOwnPropertyNames(RunController.prototype)
      .filter((name) => name !== 'constructor')
      .map((name) => Reflect.getMetadata(
        PATH_METADATA,
        (RunController.prototype as unknown as Record<string, object>)[name],
      ))
      .flat()
      .filter(Boolean);
    expect(paths).toEqual(expect.arrayContaining([
      'drafts', ':runId/draft', ':runId/draft-details', ':runId/validate', ':runId/start', ':runId',
      ':runId/history/:kind',
      ':runId/actions/pause', ':runId/actions/resume', ':runId/actions/fail', ':runId/actions/cancel',
      ':runId/tasks/:taskId/retry', ':runId/tasks/:taskId/reassign', ':runId/tasks/:taskId/skip',
      ':runId/reviews/:reviewId/decision',
    ]));
  });
});
