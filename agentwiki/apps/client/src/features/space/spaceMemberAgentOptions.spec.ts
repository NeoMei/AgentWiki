import { describe, expect, it } from 'vitest';
import { filterAvailableAgents } from './spaceMemberAgentOptions';

describe('space member agent options', () => {
  const agents = [
    { id: 'active-new', name: 'Active new', status: 'active', revokedAt: null },
    { id: 'active-existing', name: 'Active existing', status: 'active', revokedAt: null },
    { id: 'paused', name: 'Paused', status: 'paused', revokedAt: null },
    { id: 'revoked', name: 'Revoked', status: 'revoked', revokedAt: '2030-01-01T00:00:00.000Z' },
  ];

  it('returns only active agents without an existing space grant', () => {
    expect(filterAvailableAgents(agents, ['active-existing']).map((agent) => agent.id))
      .toEqual(['active-new']);
  });
});
