import { GUARDS_METADATA } from '@nestjs/common/constants';
import { CombinedAuthGuard } from '../core/auth/combined-auth.guard';
import { HumanOnlyGuard } from '../core/auth/human-only.guard';
import { AssistController } from './assist.controller';

describe('AssistController authorization boundary', () => {
  it('keeps the privileged editing assistant human-only', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, AssistController)).toEqual([
      CombinedAuthGuard,
      HumanOnlyGuard,
    ]);
  });
});
