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

  it('uses the existing Agent, Grant, and installation endpoints', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: [] } as never);
    vi.mocked(api.post).mockResolvedValue({ data: { id: 'agent-1' } } as never);
    vi.mocked(api.patch).mockResolvedValue({ data: { id: 'agent-1', status: 'active' } } as never);
    vi.mocked(api.put).mockResolvedValue({ data: { id: 'grant-1' } } as never);

    await agentPreparationApi.listAgents();
    await agentPreparationApi.createAgent({ name: 'Writer', description: '' });
    await agentPreparationApi.activateAgent('agent-1');
    await agentPreparationApi.upsertGrant('agent-1', 'space-1', 'editor');
    await agentPreparationApi.createInstallation('agent-1', 'space-1', 'editor');

    expect(api.get).toHaveBeenCalledWith('/agents');
    expect(api.post).toHaveBeenCalledWith('/agents', { name: 'Writer', description: '' });
    expect(api.patch).toHaveBeenCalledWith('/agents/agent-1', { status: 'active' });
    expect(api.put).toHaveBeenCalledWith('/agents/agent-1/grants/space-1', { role: 'editor' });
    expect(api.post).toHaveBeenCalledWith('/agents/agent-1/local-sync-installations', {
      pluginVersion: '0.6.1', spaceId: 'space-1', role: 'editor',
    });
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

  it('classifies an Axios-shaped status without exposing raw error text', () => {
    expect(apiResponseStatus({ response: { status: 403, data: { message: 'internal' } } })).toBe(403);
    expect(apiResponseStatus({ response: { status: '403' } })).toBeUndefined();
    expect(apiResponseStatus(new Error('offline'))).toBeUndefined();
  });
});
