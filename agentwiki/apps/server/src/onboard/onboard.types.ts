import { createHash } from 'crypto';
import {
  scopesForAgentAccessRole,
  type AgentAccessRole,
} from '@neomei/agentwiki-sync-protocol';

export type StartDeviceInput = {
  packageVersion: '0.5.0';
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
  packageVersion: '0.5.0';
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

export function hashServerPlan(plan: NormalizedServerPlan): string {
  const canonicalJson = JSON.stringify(canonicalize(plan));
  return createHash('sha256').update(canonicalJson, 'utf8').digest('hex');
}
