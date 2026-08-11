import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { type AgentWikiClient, redactSecrets, type KnowledgeSyncResult } from './agentwiki-client.js';
import {
  claimPreview,
  completePreview,
  releasePreview,
  savePreview,
  type LocalSyncConnection,
} from './config.js';
import {
  buildPreview,
  inspectLocalSource,
  prepareKnowledgeSync,
  type SourceInspection,
} from './local-knowledge.js';


const PREVIEW_TTL_MS = 30 * 60 * 1_000;

export interface SyncPreview {
  previewId: string;
  displayName: string;
  spaceId: string;
  added: number;
  updated: number;
  deleted: number;
  unchanged: number;
  processedFiles: number;
  skippedFiles: Array<{ path: string; reason: string }>;
  uploadBytes: number;
  expiresAt: string;
}

export interface LocalSyncCommands {
  status(): Promise<Record<string, unknown>>;
  inspect(input: { path: string }): Promise<SourceInspection>;
  prepare(input: {
    path: string;
    spaceId: string;
    allowRemoteModel: boolean;
    codebaseMemorySummary?: string;
  }): Promise<SyncPreview>;
  sync(input: { previewId: string; confirmed: true }): Promise<KnowledgeSyncResult>;
}

export interface CommandDependencies {
  home: string;
  connection: LocalSyncConnection;
  readApiKey: () => Promise<string>;
  client: AgentWikiClient;
  inspectLocalSource: typeof inspectLocalSource;
  prepareKnowledgeSync: typeof prepareKnowledgeSync;
  savePreview: typeof savePreview;
  claimPreview: typeof claimPreview;
  releasePreview: typeof releasePreview;
  completePreview: typeof completePreview;
  now: () => Date;
}

interface StoredPreview {
  id: string;
  expiresAt: string;
  envelopePath: string;
  envelopeHash: string;
  spaceId?: string;
}

function previewDirectory(home: string): string {
  return join(home, '.agentwiki', 'prepared');
}

function previewEnvelopePath(home: string, previewId: string): string {
  return join(previewDirectory(home), `${previewId}.okf.json`);
}

function hash(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Creates the confirmation-gated local sync operations shared by the CLI and MCP server.
 */
export function createLocalSyncCommands(deps: CommandDependencies): LocalSyncCommands {
  return {
    async status(): Promise<Record<string, unknown>> {
      return {
        connectionId: deps.connection.id,
        serverUrl: deps.connection.serverUrl,
        agentId: deps.connection.agentId,
        client: deps.connection.client,
        pluginVersion: deps.connection.pluginVersion,
        mcpName: deps.connection.mcpName,
      };
    },

    inspect(input) {
      return deps.inspectLocalSource(input.path);
    },

    async prepare(input): Promise<SyncPreview> {
      const prepared = await deps.prepareKnowledgeSync({
        path: input.path,
        allowRemoteModel: input.allowRemoteModel,
        ...(input.codebaseMemorySummary ? { codebaseMemorySummary: input.codebaseMemorySummary } : {}),
      });
      const apiKey = await deps.readApiKey();
      const state = await deps.client.getSyncState(deps.connection, apiKey, input.spaceId, prepared.sourceKey);
      const diff = buildPreview(prepared.envelope, state);
      const previewId = randomUUID();
      const expiresAt = new Date(deps.now().getTime() + PREVIEW_TTL_MS).toISOString();
      const envelopePath = previewEnvelopePath(deps.home, previewId);
      await mkdir(previewDirectory(deps.home), { recursive: true, mode: 0o700 });
      await writeFile(envelopePath, prepared.envelopeBytes, { mode: 0o600 });

      try {
        await deps.savePreview(deps.home, {
          id: previewId,
          expiresAt,
          envelopePath,
          envelopeHash: hash(prepared.envelopeBytes),
          spaceId: input.spaceId,
        } as Parameters<typeof deps.savePreview>[1]);
      } catch (error) {
        await rm(envelopePath, { force: true });
        throw error;
      }

      return {
        previewId,
        displayName: prepared.envelope.name,
        spaceId: input.spaceId,
        ...diff,
        processedFiles: prepared.processedFiles,
        skippedFiles: prepared.skippedFiles,
        uploadBytes: prepared.envelopeBytes.byteLength,
        expiresAt,
      };
    },

    async sync(input): Promise<KnowledgeSyncResult> {
      if (input.confirmed !== true) throw new Error('Explicit user confirmation is required');

      const preview = await deps.claimPreview(deps.home, input.previewId) as StoredPreview;
      let bytes: Uint8Array;
      try {
        bytes = await readFile(preview.envelopePath);
      } catch (error) {
        await deps.releasePreview(deps.home, input.previewId);
        throw new Error('Prepared knowledge changed; generate a new preview', { cause: error });
      }
      if (hash(bytes) !== preview.envelopeHash || !preview.spaceId) {
        await rm(preview.envelopePath, { force: true });
        await deps.releasePreview(deps.home, input.previewId);
        throw new Error('Prepared knowledge changed; generate a new preview');
      }

      try {
        const result = await deps.client.upload(
          deps.connection,
          await deps.readApiKey(),
          preview.spaceId,
          bytes,
          input.previewId,
        );
        await rm(preview.envelopePath, { force: true });
        await deps.completePreview(deps.home, input.previewId);
        return result;
      } catch (error) {
        await deps.releasePreview(deps.home, input.previewId);
        throw error;
      }
    },
  };
}
