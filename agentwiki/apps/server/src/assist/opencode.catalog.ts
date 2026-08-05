import { Logger } from '@nestjs/common';
import { RoutingConfig } from './opencode.config';
import { OpencodeCliRunner } from './opencode.runner';
import { ModelCandidate, ModelPrice, ModelTier } from './opencode.types';

export interface CatalogModel {
  id: string;
  tier: ModelTier;
  price: ModelPrice;
}

const logger = new Logger('OpencodeModelCatalog');
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._:/-]*$/u;

const balancedObjectEnd = (output: string, start: number): number | undefined => {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < output.length; index += 1) {
    const character = output[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === '{') depth += 1;
    else if (character === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return undefined;
};

const modelPrice = (metadata: Record<string, any>): ModelPrice | undefined => {
  const values = [
    metadata.cost?.input,
    metadata.cost?.output,
    metadata.cost?.cache?.read,
    metadata.cost?.cache?.write,
  ];
  if (!values.every((value) => (
    typeof value === 'number' && Number.isFinite(value) && value >= 0
  ))) return undefined;
  return {
    input: values[0],
    output: values[1],
    cacheRead: values[2],
    cacheWrite: values[3],
  };
};

export const parseVerboseModels = (output: string): CatalogModel[] => {
  const models: CatalogModel[] = [];
  let cursor = 0;

  while (cursor < output.length) {
    const lineEnd = output.indexOf('\n', cursor);
    const nextLine = lineEnd < 0 ? output.length : lineEnd + 1;
    const id = output.slice(cursor, lineEnd < 0 ? output.length : lineEnd).trim();
    cursor = nextLine;
    if (!MODEL_ID.test(id)) continue;

    while (cursor < output.length && /\s/u.test(output[cursor])) cursor += 1;
    if (output[cursor] !== '{') continue;
    const objectEnd = balancedObjectEnd(output, cursor);
    if (objectEnd === undefined) break;

    let metadata: Record<string, any>;
    try {
      metadata = JSON.parse(output.slice(cursor, objectEnd + 1));
    } catch {
      cursor = objectEnd + 1;
      continue;
    }
    cursor = objectEnd + 1;

    if (
      metadata.status !== 'active'
      || metadata.capabilities?.input?.text !== true
      || metadata.capabilities?.output?.text !== true
    ) continue;

    const price = modelPrice(metadata);
    if (!price) {
      logger.warn(id);
      continue;
    }
    const tier: ModelTier = Object.values(price).every((value) => value === 0)
      ? 'free'
      : 'paid';
    models.push({ id, tier, price });
  }

  return models;
};

const byId = (left: CatalogModel, right: CatalogModel) => (
  left.id < right.id ? -1 : left.id > right.id ? 1 : 0
);

const byFreePreference = (left: CatalogModel, right: CatalogModel) => {
  const leftBundled = left.id.startsWith('opencode/');
  const rightBundled = right.id.startsWith('opencode/');
  if (leftBundled !== rightBundled) return leftBundled ? -1 : 1;
  return byId(left, right);
};

export const buildCandidates = (
  models: CatalogModel[],
  config: RoutingConfig,
  prompt: string,
): ModelCandidate[] => {
  const uniqueModels = new Map<string, CatalogModel>();
  for (const model of models) {
    if (!uniqueModels.has(model.id)) uniqueModels.set(model.id, model);
  }

  const configuredFree: CatalogModel[] = [];
  const selectedFree = new Set<string>();
  for (const id of config.freeModels) {
    const model = uniqueModels.get(id);
    if (model?.tier !== 'free' || selectedFree.has(id)) continue;
    configuredFree.push(model);
    selectedFree.add(id);
  }
  const discoveredFree = [...uniqueModels.values()]
    .filter((model) => model.tier === 'free' && !selectedFree.has(model.id))
    .sort(byFreePreference);

  const inputTokens = Math.max(1, [...prompt].length);
  const toCandidate = (model: CatalogModel): ModelCandidate => ({
    ...model,
    estimatedCost: model.price.input * inputTokens
      + model.price.output * config.estimatedOutputTokens,
  });
  const freeCandidates = [...configuredFree, ...discoveredFree].map(toCandidate);
  if (!config.allowPaidFallback) return freeCandidates;

  const excludes = new Set(config.paidModelExcludes);
  const paidCandidates = [...uniqueModels.values()]
    .filter((model) => model.tier === 'paid' && !excludes.has(model.id))
    .map(toCandidate)
    .sort((left, right) => (
      left.estimatedCost - right.estimatedCost
      || left.price.output - right.price.output
      || left.price.input - right.price.input
      || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
    ));
  return [...freeCandidates, ...paidCandidates];
};

export class OpencodeModelCatalog {
  private snapshot?: { loadedAt: number; models: CatalogModel[] };
  private refreshing?: Promise<CatalogModel[]>;

  constructor(
    private readonly runner: OpencodeCliRunner,
    private readonly config: RoutingConfig,
  ) {}

  async getModels(): Promise<CatalogModel[]> {
    if (
      this.snapshot
      && Date.now() - this.snapshot.loadedAt < this.config.modelCacheMs
    ) return [...this.snapshot.models];
    if (this.refreshing) return this.refreshing;

    const refreshing = this.refresh();
    this.refreshing = refreshing;
    try {
      return await refreshing;
    } finally {
      if (this.refreshing === refreshing) this.refreshing = undefined;
    }
  }

  private async refresh(): Promise<CatalogModel[]> {
    try {
      const output = await this.runner.listModels(this.config.modelEnumTimeoutMs);
      const models = parseVerboseModels(output);
      this.snapshot = { loadedAt: Date.now(), models };
      return [...models];
    } catch (error) {
      if (
        this.snapshot
        && Date.now() - this.snapshot.loadedAt <= this.config.modelStaleMs
      ) {
        logger.warn('OpenCode model catalog refresh failed; using stale snapshot');
        return [...this.snapshot.models];
      }
      throw error;
    }
  }
}
