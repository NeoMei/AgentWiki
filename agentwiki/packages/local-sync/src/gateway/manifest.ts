/**
 * Static gateway tool manifest.
 *
 * The gateway registers exactly one tool set. Remote server tools are
 * discovered dynamically and exposed as wiki_<name>; local and hybrid tools
 * are declared statically here. Legacy low-level orchestrator names are never
 * registered.
 */
import { createHash } from 'node:crypto';

export const EXECUTION_PLANES = ['control', 'remote', 'local', 'hybrid'] as const;
export type ExecutionPlane = (typeof EXECUTION_PLANES)[number];

export interface ToolDeclaration {
  readonly name: string;
  readonly plane: ExecutionPlane;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
}

/* ------------------------------------------------------------------ */
/* Legacy tool names that must never be exposed in 0.3.0               */
/* ------------------------------------------------------------------ */

export const LEGACY_TOOL_NAMES = new Set([
  'start_knowledge_job',
  'get_next_work_item',
  'read_artifacts',
  'submit_organized_item',
  'validate_knowledge_job',
  'preview_knowledge_job',
  'confirm_and_push',
  'pull_space',
  'resolve_conflict',
  'local_sync_status',
  'inspect_local_source',
  'prepare_knowledge_sync',
  'sync_prepared_knowledge',
]);

/* ------------------------------------------------------------------ */
/* Static local and hybrid tool declarations                           */
/* ------------------------------------------------------------------ */

export const STATIC_TOOLS: readonly ToolDeclaration[] = [
  {
    name: 'onboard_status',
    plane: 'control',
    description: 'Read the non-secret completed onboarding session report.',
    inputSchema: { sessionId: { type: 'string' } },
  },
  {
    name: 'local_scan_sources',
    plane: 'local',
    description:
      'Create a read-only CodeGraph local scan plan. Standard analysis is the default; this returns only the plan and localScanPlanHash, never a preview, init, sync, index write, or remote call. A matching confirmed plan is required before standard work may write .codegraph/. Deep analysis requires an explicit request and Stage 2 support.',
    inputSchema: {
      sourcePaths: { type: 'array', items: { type: 'string' } },
      sourceType: { enum: ['auto', 'code', 'documents'] },
      analysisMode: { enum: ['standard', 'deep'], default: 'standard' },
    },
  },
  {
    name: 'local_read_artifacts',
    plane: 'local',
    description: 'Read bounded local artifact summaries for inspection; never uploads.',
    inputSchema: {
      jobId: { type: 'string' },
      workItemId: { type: 'string' },
    },
  },
  {
    name: 'knowledge_prepare',
    plane: 'hybrid',
    description:
      'Prepare a local knowledge preview without uploading. Standard analysis is the default. Code-bearing sources may write .codegraph/ only after the exact localScanPlanHash is confirmed with confirmedLocalScan: true; document-only sources use MarkItDown without a scan hash. Deep analysis requires an explicit request plus Stage 2 support; deep analysis is not installed yet.',
    inputSchema: {
      spaceId: { type: 'string' },
      sourcePaths: { type: 'array', items: { type: 'string' } },
      sourceType: { enum: ['auto', 'code', 'documents'] },
      analysisMode: { enum: ['standard', 'deep'], default: 'standard' },
      localScanPlanHash: { type: 'string', pattern: '^[a-f0-9]{64}$' },
      confirmedLocalScan: { type: 'boolean' },
    },
  },
  {
    name: 'knowledge_confirm_and_sync',
    plane: 'hybrid',
    description:
      'Confirm a preview by jobId and preview hash, pull before push, check revision/conflicts, then upload only the confirmed bundle.',
    inputSchema: {
      jobId: { type: 'string' },
      previewHash: { type: 'string' },
      confirmed: { type: 'boolean' },
    },
  },
  {
    name: 'knowledge_pull',
    plane: 'hybrid',
    description: 'Update the local Space workspace from the authoritative server revision.',
    inputSchema: {
      spaceId: { type: 'string' },
    },
  },
];

/** Names of statically-declared tools in stable order. */
export function staticToolNames(): string[] {
  return STATIC_TOOLS.map((tool) => tool.name);
}

/** Prefix applied to every discovered remote tool. */
export const REMOTE_TOOL_PREFIX = 'wiki_';

/** Convert a remote tool name to its gateway-exposed name. */
export function toRemoteGatewayName(remoteName: string): string {
  return `${REMOTE_TOOL_PREFIX}${remoteName}`;
}

/** Strip the remote prefix to recover the original server tool name. */
export function fromRemoteGatewayName(gatewayName: string): string | null {
  if (!gatewayName.startsWith(REMOTE_TOOL_PREFIX)) return null;
  return gatewayName.slice(REMOTE_TOOL_PREFIX.length);
}

/** True if a candidate name collides with a legacy tool that must not be exposed. */
export function isLegacyToolName(name: string): boolean {
  return LEGACY_TOOL_NAMES.has(name);
}

/** Stable deterministic hash of the static manifest. Used for toolset mismatch checks. */
export function manifestHash(): string {
  const canonical = JSON.stringify(
    STATIC_TOOLS.map((tool) => ({
      name: tool.name,
      plane: tool.plane,
      description: tool.description,
      inputSchema: sortKeys(tool.inputSchema),
    })),
  );
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((result, key) => {
        result[key] = sortKeys((value as Record<string, unknown>)[key]);
        return result;
      }, {});
  }
  return value;
}
