import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../app.module';
import { RedisModelHealthStore } from './model-health.store';
import { AssistModule } from './assist.module';
import { OpencodeCliRunner } from './opencode.runner';
import { OpencodeModelRouter } from './opencode.router';

describe('AssistModule model routing bindings', () => {
  let moduleRef: TestingModule | undefined;

  beforeAll(() => {
    process.env.JWT_SECRET ||= 'test-only-assist-module-secret';
    process.env.PROCESS_ROLE = 'api';
  });

  afterEach(async () => {
    await moduleRef?.close();
    moduleRef = undefined;
  });

  it('resolves the queue runner and health store through their shared production instances', async () => {
    moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    const assistModule = moduleRef.select(AssistModule);
    const runner = assistModule.get('OPENCODE_RUNNER', { strict: true });
    expect(runner).toBe(assistModule.get(OpencodeModelRouter, { strict: true }));
    expect(runner).toBeInstanceOf(OpencodeModelRouter);
    expect(runner).not.toBe(assistModule.get(OpencodeCliRunner, { strict: true }));
    expect(assistModule.get('MODEL_HEALTH_STORE', { strict: true }))
      .toBe(assistModule.get(RedisModelHealthStore, { strict: true }));
  });
});
