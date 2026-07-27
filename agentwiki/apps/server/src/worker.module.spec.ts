import { Test, TestingModule } from '@nestjs/testing';
import { WorkerModule } from './worker.module';

describe('WorkerModule dependency graph', () => {
  let moduleRef: TestingModule | undefined;

  beforeAll(() => {
    process.env.PROCESS_ROLE = 'api';
  });

  afterEach(async () => {
    await moduleRef?.close();
    moduleRef = undefined;
  });

  it('compiles without importing HTTP controllers or guards', async () => {
    moduleRef = await Test.createTestingModule({ imports: [WorkerModule] }).compile();
    expect(moduleRef.get(WorkerModule)).toBeDefined();
  });
});
