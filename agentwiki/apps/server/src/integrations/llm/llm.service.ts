import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosResponse } from 'axios';
import {
  DEFAULT_MODEL,
  DEFAULT_GATEWAY,
  getModelConfig,
  getAllModelConfigs,
  resolveApiBaseUrl,
  resolveModelIdForGateway,
  LlmModelConfig,
} from './llm.config';

export interface GenerateTextOptions {
  modelId?: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  gateway?: string;
}

export interface GenerateTextResult {
  text: string;
  modelId: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface GenerateEmbeddingOptions {
  modelId?: string;
  gateway?: string;
}

export interface GenerateEmbeddingResult {
  embedding: number[];
  modelId: string;
  dimensions: number;
}

@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);

  constructor(private configService: ConfigService) {}

  private getApiKey(gateway: string, modelConfig?: LlmModelConfig): string {
    if (gateway === 'openrouter') {
      const key = this.configService.get<string>('OPENROUTER_API_KEY') ?? '';
      return this.isValidApiKey(key) ? key : '';
    }
    if (modelConfig) {
      const envVar = `${modelConfig.provider.toUpperCase()}_API_KEY`;
      const key = this.configService.get<string>(envVar) ?? '';
      return this.isValidApiKey(key) ? key : '';
    }
    return '';
  }

  private isValidApiKey(key: string): boolean {
    if (!key || key.trim().length < 10) return false;
    if (key.includes('your_') || key.includes('_here') || key.includes('placeholder')) return false;
    return true;
  }

  private resolveGateway(option?: string): string {
    return option
      ?? this.configService.get<string>('LLM_GATEWAY')
      ?? DEFAULT_GATEWAY;
  }

  private async callChatCompletions(
    apiBaseUrl: string,
    apiKey: string,
    modelId: string,
    messages: Array<{ role: string; content: string }>,
    options: GenerateTextOptions,
  ): Promise<GenerateTextResult> {
    const url = `${apiBaseUrl.replace(/\/$/, '')}/chat/completions`;
    const body = {
      model: modelId,
      messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? 4096,
      top_p: options.topP ?? 1.0,
    };

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    };

    if (options.gateway === 'openrouter') {
      headers['HTTP-Referer'] = 'https://agentwiki.local';
      headers['X-Title'] = 'AgentWiki';
    }

    try {
      const response: AxiosResponse = await axios.post(url, body, { headers, timeout: 60000 });
      const data = response.data;
      const choice = data.choices?.[0];
      const text = choice?.message?.content ?? '';
      const usage = data.usage
        ? {
            promptTokens: data.usage.prompt_tokens ?? 0,
            completionTokens: data.usage.completion_tokens ?? 0,
            totalTokens: data.usage.total_tokens ?? 0,
          }
        : undefined;

      return { text, modelId, usage };
    } catch (error: any) {
      const status = error.response?.status ?? 'unknown';
      const errorText = error.response?.data ? JSON.stringify(error.response.data) : error.message;
      const wrapped = new Error(`LLM API error ${status}: ${errorText}`) as Error & { cause?: unknown };
      wrapped.cause = error;
      throw wrapped;
    }
  }

  async generateText(
    prompt: string,
    options: GenerateTextOptions = {},
  ): Promise<GenerateTextResult> {
    const modelId = options.modelId
      ?? this.configService.get<string>('LLM_DEFAULT_MODEL')
      ?? DEFAULT_MODEL;
    const gateway = this.resolveGateway(options.gateway);
    const modelConfig = getModelConfig(modelId);

    if (!modelConfig) {
      throw new Error(`Unknown model: ${modelId}`);
    }

    const apiBaseUrl = resolveApiBaseUrl(modelId, gateway);
    const resolvedModelId = resolveModelIdForGateway(modelId, gateway);
    const apiKey = this.getApiKey(gateway, modelConfig);

    if (!apiKey) {
      throw new Error(
        `Missing API key for gateway ${gateway} / model ${modelId}`,
      );
    }

    const messages: Array<{ role: string; content: string }> = [
      { role: 'user', content: prompt },
    ];

    if (options.systemPrompt) {
      messages.unshift({ role: 'system', content: options.systemPrompt });
    }

    this.logger.log(
      `Generating text with ${modelId} via ${gateway} (${resolvedModelId})`,
    );

    return this.callChatCompletions(
      apiBaseUrl,
      apiKey,
      resolvedModelId,
      messages,
      options,
    );
  }

  async generateEmbedding(
    text: string,
    options: GenerateEmbeddingOptions = {},
  ): Promise<GenerateEmbeddingResult> {
    // For embeddings, prefer models that support it
    const allModels = getAllModelConfigs();
    const embeddingModels = allModels.filter((m) => m.supportsEmbedding);
    const modelConfig = embeddingModels.find((m) => m.id === options.modelId)
      ?? embeddingModels.find((m) => m.id === this.configService.get<string>('LLM_EMBEDDING_MODEL'))
      ?? embeddingModels[0];

    if (!modelConfig) {
      throw new Error('No embedding model available');
    }

    const gateway = this.resolveGateway(options.gateway);
    const apiBaseUrl = resolveApiBaseUrl(modelConfig.id, gateway);
    const embeddingModelId =
      gateway === 'openrouter'
        ? resolveModelIdForGateway(modelConfig.embeddingModelId!, gateway)
        : modelConfig.embeddingModelId!;
    const apiKey = this.getApiKey(gateway, modelConfig);

    if (!apiKey) {
      throw new Error(
        `Missing API key for gateway ${gateway} / model ${modelConfig.id}`,
      );
    }

    const url = `${apiBaseUrl.replace(/\/$/, '')}/embeddings`;
    const body: Record<string, unknown> = {
      model: embeddingModelId,
      input: text,
    };
    if (gateway !== 'openrouter' && modelConfig.embeddingDimensions) {
      body.dimensions = modelConfig.embeddingDimensions;
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    };

    if (gateway === 'openrouter') {
      headers['HTTP-Referer'] = 'https://agentwiki.local';
      headers['X-Title'] = 'AgentWiki';
    }

    try {
      const response: AxiosResponse = await axios.post(url, body, { headers, timeout: 30000 });
      const data = response.data;
      const embedding: number[] = data.data?.[0]?.embedding ?? [];

      return {
        embedding,
        modelId: embeddingModelId,
        dimensions: modelConfig.embeddingDimensions ?? embedding.length,
      };
    } catch (error: any) {
      const status = error.response?.status ?? 'unknown';
      const errorText = error.response?.data ? JSON.stringify(error.response.data) : error.message;
      const wrapped = new Error(`Embedding API error ${status}: ${errorText}`) as Error & { cause?: unknown };
      wrapped.cause = error;
      throw wrapped;
    }
  }

  getAvailableModels(): LlmModelConfig[] {
    return getAllModelConfigs();
  }

  selectModelForTask(task: 'generation' | 'embedding' | 'coding'): string {
    const models = this.getAvailableModels();
    switch (task) {
      case 'embedding':
        return (
          models.find((m) => m.supportsEmbedding)?.id ?? models[0]?.id ?? DEFAULT_MODEL
        );
      case 'coding':
        return DEFAULT_MODEL;
      case 'generation':
      default:
        return DEFAULT_MODEL;
    }
  }
}
