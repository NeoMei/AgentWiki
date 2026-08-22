/**
 * Server-plan normalization and canonical hashing.
 *
 * This MUST stay byte-for-byte identical with the server-side implementation
 * in apps/server/src/onboard/onboard.types.ts. Any divergence causes the
 * bootstrap endpoint to reject the confirmed plan hash.
 */
import { createHash } from 'node:crypto';
import {
  scopesForAgentAccessRole,
  type AgentAccessRole,
} from '@neomei/agentwiki-sync-protocol';

export interface ServerPlan {
  space: { mode: 'create'; name: string } | { mode: 'existing'; id: string };
  agentName: string;
  role: AgentAccessRole;
  packageVersion: '0.5.0';
}

export interface NormalizedServerPlan extends ServerPlan {
  scopes: string[];
}

export function normalizeServerPlan(plan: ServerPlan): NormalizedServerPlan {
  return {
    ...plan,
    scopes: scopesForAgentAccessRole(plan.role),
  };
}

function canonicalize(value: unknown, parentKey?: string): unknown {
  if (Array.isArray(value)) {
    const values = value.map((item) => canonicalize(item));
    return parentKey === 'scopes'
      ? values.sort((left, right) => String(left).localeCompare(String(right)))
      : values;
  }
  if (value !== null && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce<Record<string, unknown>>((result, key) => {
        result[key] = canonicalize((value as Record<string, unknown>)[key], key);
        return result;
      }, {});
  }
  return value;
}

export function hashServerPlan(plan: ServerPlan): string {
  const normalized = normalizeServerPlan(plan);
  const canonicalJson = JSON.stringify(canonicalize(normalized));
  return createHash('sha256').update(canonicalJson, 'utf8').digest('hex');
}
