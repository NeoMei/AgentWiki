import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
// stat is not currently used in this adapter skeleton.
import { isAbsolute, join } from 'node:path';
import type { AdapterInput, AdapterManifest, SourceAdapter, SourceDescriptor } from '../protocol/adapter.js';
import { ArtifactBatch } from '../protocol/adapter.js';
import type { SourceArtifact } from '../protocol/artifact.js';
import { contentHash } from '../utils/hash.js';
import { artifactId } from '../utils/id.js';
import { classifySensitivity } from '../utils/redact.js';

const execFileAsync = promisify(execFile);

const ADAPTER_ID = 'codebase-memory';
const ADAPTER_VERSION = '0.1.0';
const PROTOCOL_VERSION = '1.0';

export class CodebaseMemoryAdapter implements SourceAdapter {
  constructor(private readonly runtimePath: string) {}

  manifest(): AdapterManifest {
    return {
      adapterId: ADAPTER_ID,
      version: ADAPTER_VERSION,
      protocolVersion: PROTOCOL_VERSION,
      inputKinds: ['directory'],
      artifactKinds: ['code'],
      supportsIncremental: true,
      permissions: ['read-source-path', 'read-git-metadata', 'run-managed-runtime'],
      runtime: {
        kind: 'node-module',
        packageName: 'codebase-memory-mcp',
        packageVersion: '^0.5.0',
        installCommand: ['npm', 'install', 'codebase-memory-mcp@^0.5.0'],
      },
    };
  }

  async inspect(input: AdapterInput): Promise<SourceDescriptor> {
    assertSourcePath(input.sourcePath);
    const sourceHash = await this.computeSourceHash(input.sourcePath);
    const graphData = await this.runGraphCommand(input.sourcePath);

    return {
      adapterId: ADAPTER_ID,
      sourcePath: input.sourcePath,
      displayName: `Codebase ${input.sourcePath}`,
      kind: 'code',
      estimatedArtifacts: graphData.nodes?.length ?? 0,
      sourceHash,
      metadata: {
        nodeCount: graphData.nodes?.length ?? 0,
        edgeCount: graphData.edges?.length ?? 0,
      },
    };
  }

  async collect(input: AdapterInput): Promise<ArtifactBatch> {
    assertSourcePath(input.sourcePath);
    const sourceHash = await this.computeSourceHash(input.sourcePath);
    const graphData = await this.runGraphCommand(input.sourcePath);

    const nodes: Array<{ qualified_name?: string; label?: string; file_path?: string; name?: string }> =
      graphData.nodes ?? [];
    const edges: Array<{ source?: string; target?: string; relationship?: string }> =
      graphData.edges ?? [];

    const nodeByName = new Map<string, typeof nodes[number]>();
    for (const node of nodes) {
      if (node.qualified_name) nodeByName.set(node.qualified_name, node);
    }

    const artifacts: SourceArtifact[] = [];
    for (const node of nodes) {
      const logicalKey = node.qualified_name ?? node.name ?? `node-${artifacts.length}`;
      const filePath = node.file_path ?? '';
      const summary = this.describeNode(node, edges);
      const content = [
        `## ${node.label ?? node.name ?? logicalKey}`,
        summary,
        filePath ? `File: ${filePath}` : '',
      ].filter(Boolean).join('\n\n');

      const sensitivity = classifySensitivity(content);
      if (sensitivity === 'local-only') {
        continue;
      }

      const id = artifactId(ADAPTER_ID, input.spaceId, logicalKey);
      const body = content;
      artifacts.push({
        artifactId: id,
        adapterId: ADAPTER_ID,
        adapterVersion: ADAPTER_VERSION,
        sourceId: sourceHash,
        logicalKey,
        contentHash: contentHash(body),
        updatedAt: new Date().toISOString(),
        kind: 'code',
        content: {
          title: node.label ?? node.name ?? logicalKey,
          summary,
          body,
          fields: {
            qualifiedName: logicalKey,
            ...(filePath ? { filePath } : {}),
          },
          tags: ['code', node.label ?? 'unknown'],
          metadata: { node },
        },
        evidence: filePath
          ? [
              {
                evidenceId: id,
                sourceUri: `file://${filePath}`,
                sourceHash,
                quote: summary,
              },
            ]
          : [],
        sensitivity,
      });
    }

    return { artifacts, hasMore: false };
  }

  private describeNode(
    node: { qualified_name?: string; label?: string; name?: string },
    edges: Array<{ source?: string; target?: string; relationship?: string }>,
  ): string {
    const relations = edges.filter(
      (e) => e.source === node.qualified_name || e.target === node.qualified_name,
    );
    const parts: string[] = [
      `Code symbol ${node.label ?? node.name ?? 'unknown'} (${node.qualified_name ?? 'anonymous'}).`,
    ];
    if (relations.length > 0) {
      parts.push(`Related to ${relations.length} other symbol(s).`);
    }
    return parts.join(' ');
  }

  private async runGraphCommand(sourcePath: string): Promise<{
    nodes?: Array<{ qualified_name?: string; label?: string; file_path?: string; name?: string }>;
    edges?: Array<{ source?: string; target?: string; relationship?: string }>;
  }> {
    const binary = join(this.runtimePath, 'node_modules', '.bin', 'codebase-memory-mcp');
    try {
      const { stdout } = await execFileAsync(process.execPath, [binary, '--graph', sourcePath], {
        cwd: this.runtimePath,
        maxBuffer: 64 * 1024 * 1024,
        timeout: 120_000,
      });
      return JSON.parse(stdout) as ReturnType<CodebaseMemoryAdapter['runGraphCommand']>;
    } catch (error: unknown) {
      throw new Error(
        `codebase-memory-mcp failed for ${sourcePath}: ${formatError(error)}`,
        { cause: error },
      );
    }
  }

  private async computeSourceHash(sourcePath: string): Promise<string> {
    // A lightweight, stable identifier: hash of absolute path.
    return contentHash(sourcePath);
  }
}

function assertSourcePath(sourcePath: string): void {
  if (!isAbsolute(sourcePath)) {
    throw new Error('Source path must be absolute');
  }
}

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
