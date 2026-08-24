import { createHash } from 'crypto';
import {
  canonicalBytes,
  scopesForAgentAccessRole,
  type AgentAccessRole,
} from '@neomei/agentwiki-sync-protocol';

export type StartDeviceInput = {
  packageVersion: '0.6.1';
  clientType: 'codex' | 'claude' | 'opencode';
  purpose: 'full-onboarding';
};

export type PollDeviceInput = {
  deviceCode: string;
};

export type DeviceDecisionInput = {
  userCode: string;
  decision: 'approve' | 'deny';
};

export type ServerPlan = {
  space: { mode: 'create'; name: string } | { mode: 'existing'; id: string };
  agentName: string;
  role: AgentAccessRole;
  packageVersion: '0.6.1';
};

export type BootstrapInput = {
  serverPlan: ServerPlan;
  serverPlanHash: string;
};

export type NormalizedServerPlan = ServerPlan & {
  scopes: string[];
};

export function normalizeServerPlan(plan: ServerPlan): NormalizedServerPlan {
  return {
    ...plan,
    scopes: scopesForAgentAccessRole(plan.role),
  };
}

export function hashServerPlan(plan: ServerPlan): string {
  return createHash('sha256').update(canonicalBytes(normalizeServerPlan(plan))).digest('hex');
}
