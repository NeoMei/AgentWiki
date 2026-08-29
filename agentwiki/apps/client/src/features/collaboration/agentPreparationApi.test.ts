import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../../api/client';
import {
  agentPreparationApi,
  apiResponseStatus,
  hasActiveSpaceCredential,
  type OwnedAgentDetail,
} from './agentPreparationApi';

vi.mock('../../api/client', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn() },
}));

describe('agentPreparationApi', () => {
  beforeEach(() => vi.clearAllMocks());

  it('uses the existing endpoints and unwraps each Axios response', async () => {
    const agents = [{ id: 'agent-1', name: 'Writer', status: 'paused', grants: [] }];
    const detail = { ...agents[0], credentials: [] };
    const created = { id: 'agent-2', name: 'Researcher', status: 'active' };
    const activated = { id: 'agent-1', name: 'Writer', status: 'active' };
    const grant = { id: 'grant-1' };
    const installation = {
      installationId: 'installation-1',
      code: 'one-time-code',
      expiresAt: '2026-08-25T00:20:00.000Z',
      instructions: 'Connect the Agent',
    };
    vi.mocked(api.get)
      .mockResolvedValueOnce({ data: agents } as never)
      .mockResolvedValueOnce({ data: detail } as never);
    vi.mocked(api.post)
      .mockResolvedValueOnce({ data: created } as never)
      .mockResolvedValueOnce({ data: installation } as never);
    vi.mocked(api.patch).mockResolvedValue({ data: activated } as never);
    vi.mocked(api.put).mockResolvedValue({ data: grant } as never);

    const listedResult = await agentPreparationApi.listAgents();
    const detailResult = await agentPreparationApi.getAgent('agent-1');
    const createdResult = await agentPreparationApi.createAgent({ name: 'Writer', description: '' });
    const activatedResult = await agentPreparationApi.activateAgent('agent-1');
    const grantResult = await agentPreparationApi.upsertGrant('agent-1', 'space-1', 'editor');
    const installationResult = await agentPreparationApi.createInstallation(
      'agent-1',
      'space-1',
      'editor',
    );

    expect(api.get).toHaveBeenCalledWith('/agents');
    expect(api.get).toHaveBeenCalledWith('/agents/agent-1');
    expect(api.post).toHaveBeenCalledWith('/agents', { name: 'Writer', description: '' });
    expect(api.patch).toHaveBeenCalledWith('/agents/agent-1', { status: 'active' });
    expect(api.put).toHaveBeenCalledWith('/agents/agent-1/grants/space-1', { role: 'editor' });
    expect(api.post).toHaveBeenCalledWith('/agents/agent-1/local-sync-installations', {
      pluginVersion: '0.7.0', spaceId: 'space-1', role: 'editor',
    });
    expect(listedResult).toBe(agents);
    expect(detailResult).toBe(detail);
    expect(createdResult).toBe(created);
    expect(activatedResult).toBe(activated);
    expect(grantResult).toBe(grant);
    expect(installationResult).toBe(installation);
  });

  it('accepts only an unrevoked, unexpired credential for the target Space', () => {
    const detail: OwnedAgentDetail = {
      id: 'agent-1', name: 'Writer', status: 'active', grants: [],
      credentials: [
        { id: 'other', revokedAt: null, expiresAt: null, authorization: { space: { id: 'space-2', name: 'Other' }, role: 'editor' } },
        { id: 'expired', revokedAt: null, expiresAt: '2026-08-25T00:00:00.000Z', authorization: { space: { id: 'space-1', name: 'Target' }, role: 'editor' } },
        { id: 'active', revokedAt: null, expiresAt: '2026-08-25T00:20:00.000Z', authorization: { space: { id: 'space-1', name: 'Target' }, role: 'editor' } },
      ],
    };

    expect(hasActiveSpaceCredential(detail, 'space-1', Date.parse('2026-08-25T00:10:00.000Z'))).toBe(true);
    expect(hasActiveSpaceCredential(detail, 'space-3', Date.parse('2026-08-25T00:10:00.000Z'))).toBe(false);
  });

  it('fails closed for malformed or inactive credential lifecycle fields', () => {
    const now = Date.parse('2026-08-25T00:10:00.000Z');
    const lifecycleIsActive = (revokedAt?: string | null, expiresAt?: string | null) => (
      hasActiveSpaceCredential({
        credentials: [{
          id: 'credential-1',
          revokedAt,
          expiresAt,
          authorization: {
            space: { id: 'space-1', name: 'Target' },
            role: 'editor',
          },
        }],
      }, 'space-1', now)
    );

    expect(lifecycleIsActive(null, null)).toBe(true);
    expect(lifecycleIsActive(undefined, undefined)).toBe(true);
    expect(lifecycleIsActive('2026-08-25T00:05:00.000Z', null)).toBe(false);
    expect(lifecycleIsActive('', null)).toBe(false);
    expect(lifecycleIsActive(null, '2026-08-25T00:10:00.000Z')).toBe(false);
    expect(lifecycleIsActive(null, 'not-a-date')).toBe(false);
    expect(lifecycleIsActive(null, '')).toBe(false);
  });

  it('classifies an Axios-shaped status without exposing raw error text', () => {
    expect(apiResponseStatus({ response: { status: 403, data: { message: 'internal' } } })).toBe(403);
    expect(apiResponseStatus({ response: { status: '403' } })).toBeUndefined();
    expect(apiResponseStatus(new Error('offline'))).toBeUndefined();
  });
});
