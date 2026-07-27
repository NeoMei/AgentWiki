import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from './app.module';

describe('AppModule dependency graph', () => {
  let moduleRef: TestingModule | undefined;

  beforeAll(() => {
    process.env.JWT_SECRET ||= 'test-only-app-module-secret';
    process.env.PROCESS_ROLE = 'api';
  });

  afterEach(async () => {
    await moduleRef?.close();
    moduleRef = undefined;
  });

  it('compiles the complete production module graph', async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    expect(moduleRef.get(AppModule)).toBeDefined();
  });
});
