import { createHash } from 'crypto';

export const PERMISSION_PRESETS = {
  editor: [
    'graph:read', 'graph:write', 'pages:read', 'pages:write', 'review:read',
    'runs:read', 'runs:write', 'sources:read', 'sources:write', 'spaces:read',
  ],
  full: [
    'graph:read', 'graph:write', 'memory:read', 'memory:write', 'pages:read',
    'pages:write', 'review:auto-publish', 'review:read', 'runs:read', 'runs:write',
    'sources:read', 'sources:write', 'spaces:read',
  ],
} as const;

export type StartDeviceInput = {
  packageVersion: '0.3.5';
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
  permissionPreset: keyof typeof PERMISSION_PRESETS;
  approvalMode: 'always-review' | 'scoped-auto-publish';
  packageVersion: '0.3.5';
};

export type BootstrapInput = {
  serverPlan: ServerPlan;
  serverPlanHash: string;
};

export type NormalizedServerPlan = ServerPlan & {
  scopes: string[];
  spaceRole: 'editor';
};

export function normalizeServerPlan(plan: ServerPlan): NormalizedServerPlan {
  const scopes = [...PERMISSION_PRESETS[plan.permissionPreset]];
  if (plan.permissionPreset === 'editor' && plan.approvalMode === 'scoped-auto-publish') {
    scopes.push('review:auto-publish');
  }

  return {
    ...plan,
    scopes: Array.from(new Set(scopes)).sort(),
    spaceRole: 'editor',
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
