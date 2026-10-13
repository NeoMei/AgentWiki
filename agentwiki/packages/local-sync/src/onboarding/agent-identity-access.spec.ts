import { expect, it } from 'vitest';
import { productionDependencies } from './install.js';

const connection = { id: 'local', agentId: 'agent-1', credentialId: 'credential-1', serverUrl: 'https://wiki.test/api', spaceId: 'space-a', pluginVersion: '0.12.0', client: 'codex' as const, mcpName: 'agentwiki' };
const expected = { agentId: 'agent-1', spaceId: 'space-b', role: 'editor' as const, scopes: ['knowledge:read', 'knowledge:write'] };
const access = () => ({ access: [{ id: 'agent-1', name: 'Agent', status: 'active', credentialScope: 'agent',
  grants: [
    { role: 'reader', scopes: ['knowledge:read'], folderScopes: [], space: { id: 'space-a', name: 'A' } },
    { role: 'editor', scopes: expected.scopes, folderScopes: [], space: { id: 'space-b', name: 'B' } },
  ],
  credentials: [{ id: 'credential-1', active: true, credentialScope: 'agent' }],
}] });

it('verifies identity-only credentials and initial Space grant independently', async () => {
  const deps = productionDependencies(async (_url, init) => {
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer agent-key');
    return Response.json(access());
  });
  await expect(deps.verifyAccess(connection, 'agent-key', expected)).resolves.toBeUndefined();
});

it.each(['missing-grant', 'wrong-role', 'wrong-scopes', 'inactive-credential', 'other-credential', 'inactive-agent'])('rejects invalid onboarding access: %s', async (state) => {
  const response = access(); const agent = response.access[0]!;
  if (state === 'missing-grant') agent.grants.pop();
  if (state === 'wrong-role') agent.grants[1]!.role = 'reader';
  if (state === 'wrong-scopes') agent.grants[1]!.scopes = ['knowledge:read'];
  if (state === 'inactive-credential') agent.credentials[0]!.active = false;
  if (state === 'other-credential') agent.credentials[0]!.id = 'credential-other';
  if (state === 'inactive-agent') agent.status = 'revoked';
  const deps = productionDependencies(async () => Response.json(response));
  await expect(deps.verifyAccess(connection, 'agent-key', expected)).rejects.toMatchObject({ code: 'TOOLSET_MISMATCH' });
});
