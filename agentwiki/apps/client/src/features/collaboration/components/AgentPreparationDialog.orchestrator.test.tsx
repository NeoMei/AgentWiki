import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../../context/LanguageContext';
import {
  agentPreparationApi,
  type OwnedAgentDetail,
} from '../agentPreparationApi';
import { AgentPreparationDialog } from './AgentPreparationDialog';

vi.mock('../agentPreparationApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../agentPreparationApi')>();
  return {
    ...actual,
    agentPreparationApi: {
      listAgents: vi.fn(),
      getAgent: vi.fn(),
      createAgent: vi.fn(),
      activateAgent: vi.fn(),
      upsertGrant: vi.fn(),
      createInstallation: vi.fn(),
    },
  };
});

const space = { id: 'space-1', name: 'Knowledge Base' };
const disconnectedDetail = (id: string): OwnedAgentDetail => ({
  id,
  name: 'Chapter Writer',
  status: 'active',
  grants: [],
  credentials: [],
});
const connectedDetail = (id: string): OwnedAgentDetail => ({
  ...disconnectedDetail(id),
  credentials: [{
    id: 'credential-1',
    revokedAt: null,
    expiresAt: '2030-01-01T00:10:00.000Z',
    authorization: { role: 'editor', space },
  }],
});

const defaultProps = () => ({
  spaceId: space.id,
  target: { id: 'writer', name: 'Writer' },
  onClose: vi.fn(),
  onPrepared: vi.fn().mockResolvedValue(undefined),
  onAuthorizationLost: vi.fn().mockResolvedValue(undefined),
});

const renderDialog = () => {
  const props = defaultProps();
  render(
    <LanguageProvider>
      <AgentPreparationDialog {...props} />
    </LanguageProvider>,
  );
  return props;
};

const startNewAgent = async () => {
  fireEvent.click(await screen.findByRole('tab', { name: 'Create new Agent' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), {
    target: { value: 'Chapter Writer' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Prepare Agent' }));
};

describe('AgentPreparationDialog real preparation orchestrator retries', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('agentwiki.language.v1', 'en');
    vi.mocked(agentPreparationApi.listAgents).mockReset().mockResolvedValue([]);
    vi.mocked(agentPreparationApi.createAgent).mockReset().mockResolvedValue({
      id: 'agent-created',
      name: 'Chapter Writer',
      status: 'active',
    });
    vi.mocked(agentPreparationApi.activateAgent).mockReset();
    vi.mocked(agentPreparationApi.upsertGrant).mockReset().mockResolvedValue({});
    vi.mocked(agentPreparationApi.getAgent).mockReset().mockImplementation(async (id) => (
      connectedDetail(id)
    ));
    vi.mocked(agentPreparationApi.createInstallation).mockReset().mockResolvedValue({
      installationId: 'install-1',
      code: 'AW-CODE',
      expiresAt: '2030-01-01T00:10:00.000Z',
      instructions: 'onboard --code AW-CODE',
    });
  });

  afterEach(() => cleanup());

  it('reuses the visibly locked created Agent when Grant fails across two submissions', async () => {
    vi.mocked(agentPreparationApi.upsertGrant)
      .mockRejectedValueOnce(new Error('grant failed'))
      .mockResolvedValueOnce({});
    const props = renderDialog();

    await startNewAgent();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not authorize the Agent for this Space.',
    );
    expect(screen.getByText(
      'Agent “Chapter Writer” was created. Retry will continue with this Agent.',
    )).toBeVisible();
    expect(screen.queryByRole('tab', { name: 'Create new Agent' })).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Execution role' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry preparation' }));

    await waitFor(() => expect(props.onPrepared).toHaveBeenCalledWith({
      agentId: 'agent-created',
      agentName: 'Chapter Writer',
      connection: 'connected',
    }));
    expect(agentPreparationApi.createAgent).toHaveBeenCalledTimes(1);
    expect(agentPreparationApi.upsertGrant).toHaveBeenCalledTimes(2);
    expect(agentPreparationApi.upsertGrant).toHaveBeenNthCalledWith(
      2,
      'agent-created',
      space.id,
      'editor',
    );
    expect(agentPreparationApi.getAgent).toHaveBeenCalledTimes(1);
    expect(agentPreparationApi.getAgent).toHaveBeenCalledWith('agent-created');
    expect(agentPreparationApi.createInstallation).not.toHaveBeenCalled();
  });

  it('reuses the same Agent and skips completed Grant when detail fails across two submissions', async () => {
    vi.mocked(agentPreparationApi.getAgent)
      .mockRejectedValueOnce(new Error('detail failed'))
      .mockImplementationOnce(async (id) => disconnectedDetail(id));
    renderDialog();

    await startNewAgent();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not check the Agent connection.',
    );
    expect(screen.getByText(
      'Agent “Chapter Writer” was created. Retry will continue with this Agent.',
    )).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Retry preparation' }));

    expect(await screen.findByText('onboard --code AW-CODE')).toBeVisible();
    expect(agentPreparationApi.createAgent).toHaveBeenCalledTimes(1);
    expect(agentPreparationApi.upsertGrant).toHaveBeenCalledTimes(1);
    expect(agentPreparationApi.upsertGrant).toHaveBeenCalledWith(
      'agent-created',
      space.id,
      'editor',
    );
    expect(agentPreparationApi.getAgent).toHaveBeenCalledTimes(2);
    expect(agentPreparationApi.getAgent).toHaveBeenNthCalledWith(2, 'agent-created');
    expect(agentPreparationApi.createInstallation).toHaveBeenCalledTimes(1);
    expect(agentPreparationApi.createInstallation).toHaveBeenCalledWith(
      'agent-created',
      space.id,
      'editor',
    );
  });
});
