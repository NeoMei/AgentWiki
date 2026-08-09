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
const ADAPTER_VERSION = '0.2.0';
const PROTOCOL_VERSION = '1.0';

type ExecResult = { stdout: string; stderr: string };
type Exec = (file: string, args: string[], options: { cwd: string; maxBuffer: number; timeout: number }) => Promise<ExecResult>;

export class CodebaseMemoryAdapter implements SourceAdapter {
  constructor(
    private readonly runtimePath: string,
    private readonly exec: Exec = execFileAsync as unknown as Exec,
  ) {}

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
        packageVersion: '0.9.0',
        installCommand: ['npm', 'install', 'codebase-memory-mcp@0.9.0'],
      },
    };
  }

  async inspect(input: AdapterInput): Promise<SourceDescriptor> {
    assertSourcePath(input.sourcePath);
    const sourceHash = await this.computeSourceHash(input.sourcePath);
    const graphData = await this.runArchitecture(input.sourcePath);

    return {
      adapterId: ADAPTER_ID,
      sourcePath: input.sourcePath,
      displayName: `Codebase ${input.sourcePath}`,
      kind: 'code',
      estimatedArtifacts: graphData.nodes?.length ?? (graphData.total_nodes ? 1 : 0),
      sourceHash,
      metadata: {
        nodeCount: graphData.nodes?.length ?? graphData.total_nodes ?? 0,
        edgeCount: graphData.edges?.length ?? graphData.total_edges ?? 0,
      },
    };
  }

  async collect(input: AdapterInput): Promise<ArtifactBatch> {
    assertSourcePath(input.sourcePath);
    const sourceHash = await this.computeSourceHash(input.sourcePath);
    const graphData = await this.runArchitecture(input.sourcePath);

    const nodes: Array<{ qualified_name?: string; label?: string; file_path?: string; name?: string }> =
      graphData.nodes ?? [];
    const edges: Array<{ source?: string; target?: string; relationship?: string }> =
      graphData.edges ?? [];

    const nodeByName = new Map<string, typeof nodes[number]>();
    for (const node of nodes) {
      if (node.qualified_name) nodeByName.set(node.qualified_name, node);
    }

    const artifacts: SourceArtifact[] = [];
    if (nodes.length === 0 && graphData.total_nodes) {
      const body = architectureBody(graphData);
      const id = artifactId(ADAPTER_ID, input.spaceId, 'architecture/overview');
      artifacts.push({
        artifactId: id,
        adapterId: ADAPTER_ID,
        adapterVersion: ADAPTER_VERSION,
        sourceId: sourceHash,
        logicalKey: 'architecture/overview',
        contentHash: contentHash(body),
        updatedAt: new Date().toISOString(),
        kind: 'code',
        content: {
          title: 'Codebase architecture',
          summary: `Indexed ${graphData.total_nodes} code graph nodes and ${graphData.total_edges ?? 0} edges.`,
          body,
          tags: ['code', 'architecture'],
        },
        evidence: [{
          evidenceId: `${id}:architecture`,
          sourceUri: `codebase-memory://${encodeURIComponent(graphData.project ?? 'project')}/architecture`,
          sourceHash,
        }],
        sensitivity: classifySensitivity(body),
      });
    }
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
                evidenceId: `${id}:symbol`,
                sourceUri: `codebase-memory://symbol/${encodeURIComponent(logicalKey)}`,
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

  private async runArchitecture(sourcePath: string): Promise<{
    project?: string;
    total_nodes?: number;
    total_edges?: number;
    languages?: Array<{ language?: string; file_count?: number }>;
    packages?: Array<{ name?: string; node_count?: number }>;
    entry_points?: Array<{ name?: string; file?: string }>;
    boundaries?: Array<{ from?: string; to?: string; call_count?: number }>;
    nodes?: Array<{ qualified_name?: string; label?: string; file_path?: string; name?: string }>;
    edges?: Array<{ source?: string; target?: string; relationship?: string }>;
  }> {
    const binary = join(this.runtimePath, 'node_modules', '.bin', 'codebase-memory-mcp');
    try {
      const index = await this.exec(process.execPath, [binary, 'cli', '--json', 'index_repository', JSON.stringify({
        repo_path: sourcePath,
        mode: 'fast',
        persistence: false,
      })], {
        cwd: this.runtimePath,
        maxBuffer: 64 * 1024 * 1024,
        timeout: 120_000,
      });
      const indexResult = unwrapCliResult(index.stdout);
      if (indexResult.isError) throw new Error('index_repository returned an error');
      const project = typeof indexResult.value.project === 'string'
        ? indexResult.value.project
        : `private-${sourcePath.split('/').filter(Boolean).at(-1) ?? 'project'}`;
      const architecture = await this.exec(process.execPath, [binary, 'cli', '--json', 'get_architecture', JSON.stringify({
        project,
        aspects: ['overview'],
      })], {
        cwd: this.runtimePath,
        maxBuffer: 64 * 1024 * 1024,
        timeout: 120_000,
      });
      const architectureResult = unwrapCliResult(architecture.stdout);
      if (architectureResult.isError) throw new Error('get_architecture returned an error');
      return architectureResult.value as Awaited<ReturnType<CodebaseMemoryAdapter['runArchitecture']>>;
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

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function unwrapCliResult(stdout: string): { value: Record<string, unknown>; isError: boolean } {
  const parsed: unknown = JSON.parse(stdout);
  if (!isJsonObject(parsed)) throw new Error('codebase-memory returned a non-object response');
  if (isJsonObject(parsed.structuredContent)) {
    return { value: parsed.structuredContent, isError: parsed.isError === true };
  }
  const text = Array.isArray(parsed.content)
    ? parsed.content.find((entry) => isJsonObject(entry) && entry.type === 'text')
    : undefined;
  if (isJsonObject(text) && typeof text.text === 'string') {
    const decoded: unknown = JSON.parse(text.text);
    if (!isJsonObject(decoded)) throw new Error('codebase-memory text response is not an object');
    return { value: decoded, isError: parsed.isError === true };
  }
  return { value: parsed, isError: parsed.isError === true };
}

function architectureBody(graph: {
  total_nodes?: number;
  total_edges?: number;
  languages?: Array<{ language?: string; file_count?: number }>;
  packages?: Array<{ name?: string; node_count?: number }>;
  entry_points?: Array<{ name?: string; file?: string }>;
  boundaries?: Array<{ from?: string; to?: string; call_count?: number }>;
}): string {
  const lines = [
    '# Architecture overview',
    '',
    `- Graph nodes: ${graph.total_nodes ?? 0}`,
    `- Graph edges: ${graph.total_edges ?? 0}`,
  ];
  if (graph.languages?.length) {
    lines.push('', '## Languages', ...graph.languages.map((item) => `- ${item.language ?? 'Unknown'}: ${item.file_count ?? 0} files`));
  }
  if (graph.packages?.length) {
    lines.push('', '## Packages', ...graph.packages.slice(0, 100).map((item) => `- ${item.name ?? 'unknown'}: ${item.node_count ?? 0} nodes`));
  }
  if (graph.entry_points?.length) {
    lines.push('', '## Entry points', ...graph.entry_points.slice(0, 100).map((item) => `- ${item.name ?? 'unknown'}${item.file ? ` (${item.file})` : ''}`));
  }
  if (graph.boundaries?.length) {
    lines.push('', '## Module boundaries', ...graph.boundaries.slice(0, 100).map((item) => `- ${item.from ?? 'unknown'} -> ${item.to ?? 'unknown'}: ${item.call_count ?? 0} calls`));
  }
  return lines.join('\n');
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
