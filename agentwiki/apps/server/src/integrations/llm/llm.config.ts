export interface LlmModelConfig {
  id: string;
  name: string;
  provider: 'deepseek' | 'kimi' | 'glm' | 'qwen';
  apiBaseUrl: string;
  contextLength: number;
  inputPricePer1kTokens: number;
  outputPricePer1kTokens: number;
  supportsEmbedding: boolean;
  embeddingModelId?: string;
  embeddingDimensions?: number;
}

export interface LlmProviderConfig {
  provider: string;
  apiKeyEnvVar: string;
  defaultApiBaseUrl: string;
  models: LlmModelConfig[];
}

export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

export const LLM_PROVIDERS: Record<string, LlmProviderConfig> = {
  deepseek: {
    provider: 'deepseek',
    apiKeyEnvVar: 'DEEPSEEK_API_KEY',
    defaultApiBaseUrl: 'https://api.deepseek.com/v1',
    models: [
      {
        id: 'deepseek-v4-flash',
        name: 'DeepSeek V4 Flash',
        provider: 'deepseek',
        apiBaseUrl: 'https://api.deepseek.com/v1',
        contextLength: 1_000_000,
        inputPricePer1kTokens: 0.00014,
        outputPricePer1kTokens: 0.00028,
        supportsEmbedding: false,
      },
      {
        id: 'deepseek-chat',
        name: 'DeepSeek Chat',
        provider: 'deepseek',
        apiBaseUrl: 'https://api.deepseek.com/v1',
        contextLength: 65536,
        inputPricePer1kTokens: 0.00014,
        outputPricePer1kTokens: 0.00028,
        supportsEmbedding: false,
      },
      {
        id: 'deepseek-coder',
        name: 'DeepSeek Coder',
        provider: 'deepseek',
        apiBaseUrl: 'https://api.deepseek.com/v1',
        contextLength: 65536,
        inputPricePer1kTokens: 0.00014,
        outputPricePer1kTokens: 0.00028,
        supportsEmbedding: false,
      },
    ],
  },
  kimi: {
    provider: 'kimi',
    apiKeyEnvVar: 'KIMI_API_KEY',
    defaultApiBaseUrl: 'https://api.moonshot.cn/v1',
    models: [
      {
        id: 'kimi-k2',
        name: 'Kimi K2',
        provider: 'kimi',
        apiBaseUrl: 'https://api.moonshot.cn/v1',
        contextLength: 256000,
        inputPricePer1kTokens: 0.001,
        outputPricePer1kTokens: 0.001,
        supportsEmbedding: false,
      },
      {
        id: 'kimi-k2.5',
        name: 'Kimi K2.5',
        provider: 'kimi',
        apiBaseUrl: 'https://api.moonshot.cn/v1',
        contextLength: 256000,
        inputPricePer1kTokens: 0.001,
        outputPricePer1kTokens: 0.001,
        supportsEmbedding: false,
      },
    ],
  },
  glm: {
    provider: 'glm',
    apiKeyEnvVar: 'GLM_API_KEY',
    defaultApiBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    models: [
      {
        id: 'glm-5',
        name: 'GLM-5',
        provider: 'glm',
        apiBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
        contextLength: 128000,
        inputPricePer1kTokens: 0.0005,
        outputPricePer1kTokens: 0.0005,
        supportsEmbedding: true,
        embeddingModelId: 'embedding-3',
        embeddingDimensions: 2048,
      },
      {
        id: 'glm-4',
        name: 'GLM-4',
        provider: 'glm',
        apiBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
        contextLength: 128000,
        inputPricePer1kTokens: 0.0005,
        outputPricePer1kTokens: 0.0005,
        supportsEmbedding: true,
        embeddingModelId: 'embedding-3',
        embeddingDimensions: 2048,
      },
    ],
  },
  qwen: {
    provider: 'qwen',
    apiKeyEnvVar: 'QWEN_API_KEY',
    defaultApiBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: [
      {
        id: 'qwen-max',
        name: 'Qwen Max',
        provider: 'qwen',
        apiBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        contextLength: 32768,
        inputPricePer1kTokens: 0.0004,
        outputPricePer1kTokens: 0.0012,
        supportsEmbedding: true,
        embeddingModelId: 'text-embedding-v4',
        embeddingDimensions: 2048,
      },
      {
        id: 'qwen-plus',
        name: 'Qwen Plus',
        provider: 'qwen',
        apiBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        contextLength: 131072,
        inputPricePer1kTokens: 0.0002,
        outputPricePer1kTokens: 0.0006,
        supportsEmbedding: true,
        embeddingModelId: 'text-embedding-v4',
        embeddingDimensions: 2048,
      },
    ],
  },
};

export const OPENROUTER_MODEL_MAP: Record<string, string> = {
  'deepseek-chat': 'deepseek/deepseek-chat',
  'deepseek-coder': 'deepseek/deepseek-coder',
  'kimi-k2': 'moonshotai/kimi-k2',
  'kimi-k2.5': 'moonshotai/kimi-k2.5',
  'glm-5': 'thudm/glm-5',
  'glm-4': 'thudm/glm-4',
  'qwen-max': 'qwen/qwen-max',
  'qwen-plus': 'qwen/qwen-plus',
};

export const DEFAULT_MODEL = 'deepseek-v4-flash';
export const DEFAULT_GATEWAY = 'openrouter';

export function getModelConfig(modelId: string): LlmModelConfig | undefined {
  for (const provider of Object.values(LLM_PROVIDERS)) {
    const model = provider.models.find((m) => m.id === modelId);
    if (model) return model;
  }
  return undefined;
}

export function getAllModelConfigs(): LlmModelConfig[] {
  return Object.values(LLM_PROVIDERS).flatMap((p) => p.models);
}

export function resolveApiBaseUrl(
  modelId: string,
  gateway: string = DEFAULT_GATEWAY,
): string {
  if (gateway === 'openrouter') {
    return OPENROUTER_BASE_URL;
  }
  const config = getModelConfig(modelId);
  return config?.apiBaseUrl ?? OPENROUTER_BASE_URL;
}

export function resolveModelIdForGateway(
  modelId: string,
  gateway: string = DEFAULT_GATEWAY,
): string {
  if (gateway === 'openrouter') {
    return OPENROUTER_MODEL_MAP[modelId] ?? modelId;
  }
  return modelId;
}
