import { homedir } from 'node:os';
import { GeneratedKnowledgeStoreCore, type GeneratedPublishManifest, type GeneratedPublishSet, type ValidatedGeneratedPublishSet } from './generated-store-core.js';
import type { GeneratedKnowledgeDocument } from './base-analyzer.js';

/** Production-only resource caps. Private roots, file operations, and hooks stay internal. */
export interface GeneratedKnowledgeStoreCaps {
  maxGeneratedBytes?: number;
  maxDocumentBytes?: number;
}

function caps(value: GeneratedKnowledgeStoreCaps): GeneratedKnowledgeStoreCaps {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((key) => key !== 'maxGeneratedBytes' && key !== 'maxDocumentBytes')) {
    throw new Error('CODE_ANALYSIS_FAILED: generated store accepts production caps only');
  }
  return value;
}

export class GeneratedKnowledgeStore {
  private readonly core: GeneratedKnowledgeStoreCore;

  constructor(productionCaps: GeneratedKnowledgeStoreCaps = {}) {
    this.core = new GeneratedKnowledgeStoreCore({ home: homedir(), ...caps(productionCaps) });
  }

  writeBase(sourceKey: string, snapshotHash: string, documents: GeneratedKnowledgeDocument[]): Promise<void> { return this.core.writeBase(sourceKey, snapshotHash, documents); }
  publish(sourceKey: string, snapshotHash: string): Promise<GeneratedPublishManifest> { return this.core.publish(sourceKey, snapshotHash); }
  withPublishedBatch<T>(sourceKeys: string[], consume: (sets: ValidatedGeneratedPublishSet[]) => Promise<T>): Promise<T> { return this.core.withPublishedBatch(sourceKeys, consume); }
  readBase(sourceKey: string): Promise<GeneratedPublishSet | null> { return this.core.readBase(sourceKey); }
  readPublish(sourceKey: string): Promise<GeneratedPublishSet | null> { return this.core.readPublish(sourceKey); }
}

export type { GeneratedPublishManifest, GeneratedPublishSet, ValidatedGeneratedPublishSet };
