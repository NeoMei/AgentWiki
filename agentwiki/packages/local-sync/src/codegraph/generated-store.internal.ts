import { GeneratedKnowledgeStoreCore } from './generated-store-core.js';

/** Package-internal runtime factory. The published facade never accepts a caller root. */
export function createInternalGeneratedKnowledgeStore(home: string): GeneratedKnowledgeStoreCore {
  if (typeof home !== 'string' || home.length === 0) throw new Error('CODE_ANALYSIS_FAILED: runtime home is required');
  return new GeneratedKnowledgeStoreCore({ home });
}

export {
  GeneratedKnowledgeStoreCore,
  type GeneratedKnowledgeStoreCoreOptions,
  type GeneratedStoreFileOps,
  type GeneratedPublishManifest,
  type GeneratedPublishManifestBody,
  type GeneratedPublishSet,
  GeneratedPublishManifestSchema,
} from './generated-store-core.js';
