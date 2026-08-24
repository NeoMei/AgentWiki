import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LanguageProvider } from '../../../context/LanguageContext';
import type { OwnedAgentDetail, OwnedAgentSummary } from '../agentPreparationApi';
import { ExistingAgentContextPanel } from './ExistingAgentContextPanel';
import type { ExistingAgentContextState } from './useExistingAgentContext';

const space = { id: 'space-1', name: 'Current Space' };
const oldSpace = { id: 'space-old', name: 'Old Space' };

const agent = (
  id: string,
  grantSpace = space,
): OwnedAgentSummary => ({
  id,
  name: `${id} name`,
  description: '',
  status: 'active',
  revokedAt: null,
  grants: [{ id: `grant-${id}`, spaceId: grantSpace.id, role: 'publisher', space: grantSpace }],
});

const readyContext = (
  currentAgent: OwnedAgentSummary,
  contextSpace = space,
): ExistingAgentContextState => ({
  status: 'ready',
  agentId: currentAgent.id,
  connected: true,
  detail: {
    ...currentAgent,
    credentials: [{
      id: 'credential-old',
      revokedAt: null,
      expiresAt: null,
      authorization: { role: 'publisher', space: contextSpace },
    }],
  } satisfies OwnedAgentDetail,
  grantRole: 'publisher',
  spaceId: contextSpace.id,
});

describe('ExistingAgentContextPanel', () => {
  it.each([
    {
      name: 'Agent selection',
      selectedAgent: agent('agent-new'),
      selectedSpaceId: space.id,
      staleContext: readyContext(agent('agent-old')),
    },
    {
      name: 'Space selection',
      selectedAgent: agent('agent-old', oldSpace),
      selectedSpaceId: space.id,
      staleContext: readyContext(agent('agent-old', oldSpace), oldSpace),
    },
  ])('shows loading instead of old connected data after a $name change', ({
    selectedAgent,
    selectedSpaceId,
    staleContext,
  }) => {
    render(
      <LanguageProvider>
        <ExistingAgentContextPanel
          agent={selectedAgent}
          context={staleContext}
          spaceId={selectedSpaceId}
        />
      </LanguageProvider>,
    );

    const context = screen.getByRole('region', { name: 'Current Agent context' });
    expect(within(context).getByText('Current Space role').parentElement).toHaveTextContent(
      'Current Space roleLoading…',
    );
    expect(within(context).getByText('Connection').parentElement).toHaveTextContent(
      'ConnectionChecking connection…',
    );
    expect(within(context).queryByText('Connected')).not.toBeInTheDocument();
  });
});
