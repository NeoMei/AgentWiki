import { Test, TestingModule } from '@nestjs/testing';
import { LlmService } from './llm.service';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const envValues: Record<string, string | undefined> = {};
const mockConfigService = {
  get: jest.fn((key: string) => envValues[key]),
};

describe('LlmService', () => {
  let service: LlmService;

  beforeEach(async () => {
    for (const key of Object.keys(envValues)) delete envValues[key];
    jest.clearAllMocks();
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
      expect(model).toBe('deepseek-v4-flash');
    });
  });

  describe('generateText configuration', () => {
    it('uses DeepSeek V4 Flash as the default text model', async () => {
      envValues.LLM_GATEWAY = 'direct';
      envValues.DEEPSEEK_API_KEY = 'deepseek-test-key-1234567890';
      mockedAxios.post.mockResolvedValueOnce({
        data: { choices: [{ message: { content: '{"relations":[]}' } }] },
      });

      const result = await service.generateText('hello');

      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://api.deepseek.com/v1/chat/completions',
        expect.objectContaining({ model: 'deepseek-v4-flash' }),
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer deepseek-test-key-1234567890' }),
        }),
      );
      expect(result.modelId).toBe('deepseek-v4-flash');
    });

    it('honors LLM_DEFAULT_MODEL when no explicit model is passed', async () => {
      envValues.LLM_GATEWAY = 'direct';
      envValues.LLM_DEFAULT_MODEL = 'qwen-plus';
      envValues.QWEN_API_KEY = 'qwen-test-key-1234567890';
      mockedAxios.post.mockResolvedValueOnce({
        data: { choices: [{ message: { content: 'ok' } }] },
      });

      const result = await service.generateText('hello');

      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
        expect.objectContaining({ model: 'qwen-plus' }),
        expect.anything(),
      );
      expect(result.modelId).toBe('qwen-plus');
    });
  });

  describe('generateEmbedding configuration', () => {
    it('sends dimensions and uses the direct provider API when LLM_GATEWAY=direct', async () => {
      envValues.LLM_GATEWAY = 'direct';
      envValues.QWEN_API_KEY = 'qwen-test-key-1234567890';
      envValues.LLM_EMBEDDING_MODEL = 'qwen-plus';
      mockedAxios.post.mockResolvedValueOnce({
        data: { data: [{ embedding: [0.1, 0.2] }] },
      });

      const result = await service.generateEmbedding('hello');

      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings',
        { model: 'text-embedding-v4', input: 'hello', dimensions: 2048 },
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer qwen-test-key-1234567890' }),
        }),
      );
      expect(result.modelId).toBe('text-embedding-v4');
      expect(result.dimensions).toBe(2048);
    });

    it('keeps the openrouter payload unchanged and without dimensions', async () => {
      envValues.OPENROUTER_API_KEY = 'or-test-key-1234567890';
      mockedAxios.post.mockResolvedValueOnce({
        data: { data: [{ embedding: [0.1] }] },
      });

      await service.generateEmbedding('hello');

      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://openrouter.ai/api/v1/embeddings',
        { model: 'embedding-3', input: 'hello' },
        expect.anything(),
      );
    });

    it('prefers the explicit option model over LLM_EMBEDDING_MODEL', async () => {
      envValues.LLM_GATEWAY = 'direct';
      envValues.QWEN_API_KEY = 'qwen-test-key-1234567890';
      envValues.LLM_EMBEDDING_MODEL = 'qwen-plus';
      mockedAxios.post.mockResolvedValueOnce({
        data: { data: [{ embedding: [0.1] }] },
      });

      await service.generateEmbedding('hello', { modelId: 'qwen-max' });

      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ model: 'text-embedding-v4' }),
        expect.anything(),
      );
    });
  });
});
