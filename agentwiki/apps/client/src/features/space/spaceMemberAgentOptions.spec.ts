import { describe, expect, it } from 'vitest';
import { AGENT_ROLE_SCOPES, filterAvailableAgents } from './spaceMemberAgentOptions';

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

  it('maps viewer and editor roles to the approved default scopes', () => {
    expect(AGENT_ROLE_SCOPES.viewer).toEqual(['pages:read', 'graph:read']);
    expect(AGENT_ROLE_SCOPES.editor).toEqual([
      'pages:read', 'pages:write', 'sources:read', 'graph:read', 'graph:write',
    ]);
  });
});
