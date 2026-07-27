import { Test, TestingModule } from '@nestjs/testing';
import { LlmService } from './llm.service';
import { ConfigService } from '@nestjs/config';

const mockConfigService = {
  get: jest.fn().mockReturnValue('test-api-key'),
};

describe('LlmService', () => {
  let service: LlmService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LlmService,
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<LlmService>(LlmService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('selectModelForTask', () => {
    it('should select embedding model for embedding task', () => {
      const model = service.selectModelForTask('embedding');
      expect(model).toBeDefined();
    });

    it('should select coder model for coding task', () => {
      const model = service.selectModelForTask('coding');
      expect(model).toBe('deepseek-coder');
    });
  });
});
