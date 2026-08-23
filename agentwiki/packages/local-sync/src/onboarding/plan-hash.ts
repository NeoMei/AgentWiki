/**
 * Server-plan normalization and canonical hashing.
 *
 * Both clients use the shared protocol canonical serializer. Any divergence
 * causes the bootstrap endpoint to reject the confirmed plan hash.
 */
import { createHash } from 'node:crypto';
import {
  canonicalBytes,
  scopesForAgentAccessRole,
  type AgentAccessRole,
} from '@neomei/agentwiki-sync-protocol';

export interface ServerPlan {
  space: { mode: 'create'; name: string } | { mode: 'existing'; id: string };
  agentName: string;
  role: AgentAccessRole;
  packageVersion: '0.6.0';
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

export function hashServerPlan(plan: ServerPlan): string {
  return createHash('sha256').update(canonicalBytes(normalizeServerPlan(plan))).digest('hex');
}
