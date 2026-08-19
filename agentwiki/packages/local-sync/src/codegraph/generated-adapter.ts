import type { ArtifactBatch } from '../protocol/adapter.js';
import type { SourceArtifact } from '../protocol/artifact.js';
import { artifactId } from '../utils/id.js';
import { classifySensitivity } from '../utils/redact.js';
import { GeneratedKnowledgeStore } from './generated-store.js';
import type { ValidatedGeneratedPublishSet } from './generated-store.js';

export const GENERATED_CODEGRAPH_ADAPTER_ID = 'agentwiki-codegraph-generated';
const ADAPTER_VERSION = '1.0.0';
const STABLE_UPDATED_AT = '1970-01-01T00:00:00.000Z';

export interface GeneratedAdapterCollectInput {
  spaceId: string;
  sourceKey: string;
}

/**
 * Converts only a store-validated publish manifest into SourceArtifacts. It
 * does not discover directories or consume source paths, raw code, or scanner
 * implementation data.
 */
export class GeneratedCodeGraphAdapter {
  constructor(private readonly store: GeneratedKnowledgeStore) {}

  async collect(input: GeneratedAdapterCollectInput): Promise<ArtifactBatch> {
    const published = await this.store.readPublish(input.sourceKey);
    if (!published) return { artifacts: [], hasMore: false };
    return { artifacts: this.adaptValidatedPublish({ spaceId: input.spaceId, published }), hasMore: false };
  }

  adaptValidatedPublish(input: { spaceId: string; published: ValidatedGeneratedPublishSet }): SourceArtifact[] {
    return input.published.documents.map(({ record, content }) => {
      const sensitivity = classifySensitivity(content);
      if (sensitivity !== 'shareable') throw new Error('Validated generated CodeGraph knowledge was not shareable');
      const identityKey = `${record.logicalKey}@${record.sourceKey}`;
      const id = artifactId(GENERATED_CODEGRAPH_ADAPTER_ID, input.spaceId, identityKey);
      return {
        artifactId: id,
        adapterId: GENERATED_CODEGRAPH_ADAPTER_ID,
        adapterVersion: ADAPTER_VERSION,
        sourceId: record.snapshotHash,
        logicalKey: record.logicalKey,
        contentHash: record.contentHash,
        updatedAt: STABLE_UPDATED_AT,
        kind: 'code',
        content: {
          title: record.title,
          summary: `Deterministic ${record.analysisLayer} CodeGraph analysis.`,
          body: content,
          tags: ['codegraph', 'generated', record.analysisLayer],
          metadata: {
            identityKey,
            ownership: {
              producer: GENERATED_CODEGRAPH_ADAPTER_ID,
              logicalKey: record.logicalKey,
              analysisLayer: record.analysisLayer,
              sourceKey: record.sourceKey,
              snapshotHash: record.snapshotHash,
            },
          },
        },
        evidence: record.evidenceIds.map((evidenceId) => ({
          evidenceId,
          sourceUri: `agentwiki-code-snapshot://${record.sourceKey}/${record.relativePath.split('/').map((segment) => encodeURIComponent(segment)).join('/')}`,
          sourceHash: record.snapshotHash,
        })),
        sensitivity,
      };
    });
  }
}
