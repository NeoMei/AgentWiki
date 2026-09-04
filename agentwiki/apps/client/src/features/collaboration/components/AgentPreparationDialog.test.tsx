import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../../context/LanguageContext';
import {
  agentPreparationApi,
  existingAgentContextApi,
  type OwnedAgentDetail,
  type OwnedAgentSummary,
} from '../agentPreparationApi';
import {
  AgentPreparationFailure,
  prepareAgent,
  type PreparedAgent,
} from '../prepareAgent';
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
    existingAgentContextApi: { getAgent: vi.fn() },
  };
});

vi.mock('../prepareAgent', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../prepareAgent')>();
  return { ...actual, prepareAgent: vi.fn() };
});

const space = { id: 'space-1', name: 'Knowledge Base' };
const activeAgent: OwnedAgentSummary = {
  id: 'agent-1',
  name: 'Writer',
  description: 'Writes chapters',
  status: 'active',
  revokedAt: null,
  grants: [{ id: 'grant-1', spaceId: space.id, role: 'editor', space }],
};
const pausedReader: OwnedAgentSummary = {
  id: 'agent-reader',
  name: 'Reader Agent',
  description: '',
  status: 'paused',
  revokedAt: null,
  grants: [{ id: 'grant-reader', spaceId: space.id, role: 'reader', space }],
};
const disconnectedDetail: OwnedAgentDetail = { ...activeAgent, credentials: [] };
const connectedDetail: OwnedAgentDetail = {
  ...activeAgent,
  credentials: [{
    id: 'credential-1',
    revokedAt: null,
    expiresAt: null,
    authorization: { role: 'editor', space },
  }],
};

const ownedAgent = (
  id: string,
  role?: 'reader' | 'editor' | 'publisher',
  status = 'active',
): OwnedAgentSummary => ({
  id,
  name: `${id} name`,
  description: '',
  status,
  revokedAt: null,
  grants: role ? [{ id: `grant-${id}`, spaceId: space.id, role, space }] : [],
});

const ownedAgentDetail = (
  agent: OwnedAgentSummary,
  connected = false,
): OwnedAgentDetail => ({
  ...agent,
  credentials: connected ? connectedDetail.credentials : [],
});

const installation = (overrides: Partial<{
  installationId: string;
  code: string;
  expiresAt: string;
  instructions: string;
}> = {}) => ({
  installationId: 'install-1',
  code: 'AW-CODE',
  expiresAt: new Date(Date.now() + 600_000).toISOString(),
  instructions: 'npx --yes @neomei/agentwiki-local-sync@0.7.0 onboard --code AW-CODE',
  ...overrides,
});

const waitingResult = (overrides: Partial<PreparedAgent> = {}): PreparedAgent => ({
  agentId: 'agent-1',
  agentName: 'Writer',
  role: 'editor',
  connection: { kind: 'waiting', installation: installation() },
  ...overrides,
});

const defaultProps = () => ({
  spaceId: 'space-1',
  target: { id: 'writer', name: 'Writer' },
  onClose: vi.fn(),
  onPrepared: vi.fn().mockResolvedValue(undefined),
  onAuthorizationLost: vi.fn().mockResolvedValue(undefined),
});

const renderDialog = (overrides: Partial<ReturnType<typeof defaultProps>> = {}) => {
  const props = { ...defaultProps(), ...overrides };
  const view = render(
    <LanguageProvider>
      <AgentPreparationDialog {...props} />
    </LanguageProvider>,
  );
  return { ...view, props };
};

const submitExistingAgent = async () => {
  await screen.findByRole('combobox', { name: 'Agent' });
  fireEvent.click(screen.getByRole('button', { name: 'Prepare Agent' }));
};

const openWaitingInstruction = async () => {
  await submitExistingAgent();
  await screen.findByText(/onboard --code AW-CODE/);
};

const flushMicrotasks = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
};

const openWaitingInstructionWithFakeTimers = async () => {
  await flushMicrotasks();
  fireEvent.click(screen.getByRole('button', { name: 'Prepare Agent' }));
  await flushMicrotasks();
  expect(screen.getByText(/onboard --code AW-CODE/)).toBeVisible();
};

const storedValues = () => Array.from(
  { length: localStorage.length },
  (_, index) => localStorage.getItem(localStorage.key(index) ?? '') ?? '',
).join('\n');

const useRealPrepareAgent = async () => {
  const actual = await vi.importActual<typeof import('../prepareAgent')>('../prepareAgent');
  vi.mocked(prepareAgent).mockImplementation(actual.prepareAgent);
};

describe('AgentPreparationDialog', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('agentwiki.language.v1', 'en');
    vi.mocked(agentPreparationApi.listAgents).mockReset().mockResolvedValue([activeAgent]);
    vi.mocked(agentPreparationApi.getAgent).mockReset().mockResolvedValue(disconnectedDetail);
    vi.mocked(existingAgentContextApi.getAgent).mockReset().mockResolvedValue(disconnectedDetail);
    vi.mocked(agentPreparationApi.createAgent).mockReset();
    vi.mocked(agentPreparationApi.activateAgent).mockReset();
    vi.mocked(agentPreparationApi.upsertGrant).mockReset();
    vi.mocked(agentPreparationApi.createInstallation).mockReset();
    vi.mocked(prepareAgent).mockReset();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  afterEach(() => {
    cleanup();
    if (vi.isFakeTimers()) {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('loads an existing active Publisher context and initializes Publisher', async () => {
    const publisher = ownedAgent('agent-publisher', 'publisher');
    let resolveDetail!: (detail: OwnedAgentDetail) => void;
    vi.mocked(agentPreparationApi.listAgents).mockResolvedValue([publisher]);
    vi.mocked(existingAgentContextApi.getAgent).mockImplementation(() => new Promise((resolve) => {
      resolveDetail = resolve;
    }));
    renderDialog();

    const context = await screen.findByRole('region', { name: 'Current Agent context' });
    expect(within(context).getByText('Connection').parentElement).toHaveTextContent(
      'ConnectionChecking connection…',
    );
    expect(screen.getByRole('button', { name: 'Prepare Agent' })).toBeDisabled();
    await waitFor(() => expect(existingAgentContextApi.getAgent).toHaveBeenCalledWith(publisher.id));

    await act(async () => { resolveDetail(ownedAgentDetail(publisher, true)); });

    expect(within(context).getByText('Status').parentElement).toHaveTextContent('StatusActive');
    expect(within(context).getByText('Current Space role').parentElement).toHaveTextContent(
      'Current Space rolePublisher',
    );
    expect(within(context).getByText('Connection').parentElement).toHaveTextContent(
      'ConnectionConnected',
    );
    expect(screen.getByRole('combobox', { name: 'Execution role' })).toHaveValue('publisher');
    expect(screen.getByRole('button', { name: 'Prepare Agent' })).toBeEnabled();
  });

  it('resets Publisher to Editor for a new Agent and restores the existing Grant on return', async () => {
    const publisher = ownedAgent('agent-publisher', 'publisher');
    vi.mocked(agentPreparationApi.listAgents).mockResolvedValue([publisher]);
    vi.mocked(existingAgentContextApi.getAgent).mockResolvedValue(
      ownedAgentDetail(publisher),
    );
    vi.mocked(prepareAgent).mockResolvedValue(waitingResult({
      agentId: 'agent-new',
      agentName: 'New Agent',
    }));
    renderDialog();

    const role = screen.getByRole('combobox', { name: 'Execution role' });
    await waitFor(() => expect(role).toHaveValue('publisher'));
    fireEvent.click(screen.getByRole('tab', { name: 'Create new Agent' }));
    expect(role).toHaveValue('editor');

    fireEvent.click(screen.getByRole('tab', { name: 'Use existing Agent' }));
    await waitFor(() => expect(role).toHaveValue('publisher'));
    fireEvent.click(screen.getByRole('tab', { name: 'Create new Agent' }));
    expect(role).toHaveValue('editor');
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'New Agent' } });
    fireEvent.click(screen.getByRole('button', { name: 'Prepare Agent' }));

    await screen.findByText(/onboard --code AW-CODE/);
    expect(prepareAgent).toHaveBeenCalledWith({
      candidate: {
        kind: 'new',
        name: 'New Agent',
        description: '',
        idempotencyKey: expect.stringMatching(/^create-agent-/u),
      },
      spaceId: 'space-1',
      role: 'editor',
    }, agentPreparationApi, expect.any(Function));
  });

  it('shows a paused Editor as disconnected and initializes Editor', async () => {
    const editor = ownedAgent('agent-editor', 'editor', 'paused');
    vi.mocked(agentPreparationApi.listAgents).mockResolvedValue([editor]);
    vi.mocked(existingAgentContextApi.getAgent).mockResolvedValue(ownedAgentDetail(editor));
    renderDialog();

    const context = await screen.findByRole('region', { name: 'Current Agent context' });
    await waitFor(() => expect(
      within(context).getByText('Connection').parentElement,
    ).toHaveTextContent('ConnectionNot connected'));
    expect(within(context).getByText('Status').parentElement).toHaveTextContent('StatusPaused');
    expect(within(context).getByText('Current Space role').parentElement).toHaveTextContent(
      'Current Space roleEditor',
    );
    expect(screen.getByRole('combobox', { name: 'Execution role' })).toHaveValue('editor');
  });

  it('uses paused ready detail for guidance and activates the selected Agent', async () => {
    const activeSummary = ownedAgent('agent-status-authority', 'editor', 'active');
    const pausedDetail: OwnedAgentDetail = {
      ...ownedAgentDetail(activeSummary),
      status: 'paused',
    };
    vi.mocked(agentPreparationApi.listAgents).mockResolvedValue([activeSummary]);
    vi.mocked(existingAgentContextApi.getAgent).mockResolvedValue(pausedDetail);
    vi.mocked(agentPreparationApi.activateAgent).mockResolvedValue({
      id: activeSummary.id,
      name: activeSummary.name,
      status: 'active',
    });
    vi.mocked(agentPreparationApi.upsertGrant).mockResolvedValue(undefined);
    vi.mocked(agentPreparationApi.getAgent).mockResolvedValue(connectedDetail);
    vi.mocked(agentPreparationApi.createInstallation).mockResolvedValue(installation());
    await useRealPrepareAgent();
    renderDialog();

    const context = await screen.findByRole('region', { name: 'Current Agent context' });
    await waitFor(() => expect(
      within(context).getByText('Status').parentElement,
    ).toHaveTextContent('StatusPaused'));
    expect(screen.getByText(
      'This Agent is paused and will be resumed before authorization.',
    )).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Prepare Agent' }));

    await waitFor(() => expect(agentPreparationApi.activateAgent).toHaveBeenCalledWith(
      activeSummary.id,
    ));
  });

  it('uses active ready detail without stale paused guidance or activation', async () => {
    const pausedSummary = ownedAgent('agent-status-authority', 'editor', 'paused');
    const activeDetail: OwnedAgentDetail = {
      ...ownedAgentDetail(pausedSummary),
      status: 'active',
    };
    vi.mocked(agentPreparationApi.listAgents).mockResolvedValue([pausedSummary]);
    vi.mocked(existingAgentContextApi.getAgent).mockResolvedValue(activeDetail);
    vi.mocked(agentPreparationApi.upsertGrant).mockResolvedValue(undefined);
    vi.mocked(agentPreparationApi.getAgent).mockResolvedValue(connectedDetail);
    vi.mocked(agentPreparationApi.createInstallation).mockResolvedValue(installation());
    await useRealPrepareAgent();
    renderDialog();

    const context = await screen.findByRole('region', { name: 'Current Agent context' });
    await waitFor(() => expect(
      within(context).getByText('Status').parentElement,
    ).toHaveTextContent('StatusActive'));
    expect(screen.queryByText(
      'This Agent is paused and will be resumed before authorization.',
    )).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Prepare Agent' }));

    await waitFor(() => expect(agentPreparationApi.upsertGrant).toHaveBeenCalledTimes(1));
    expect(agentPreparationApi.activateAgent).not.toHaveBeenCalled();
  });

  it('defaults an Agent without a current Space Grant to Editor and explains authorization', async () => {
    const ungranted = ownedAgent('agent-ungranted');
    vi.mocked(agentPreparationApi.listAgents).mockResolvedValue([ungranted]);
    vi.mocked(existingAgentContextApi.getAgent).mockResolvedValue(ownedAgentDetail(ungranted));
    renderDialog();

    const context = await screen.findByRole('region', { name: 'Current Agent context' });
    await waitFor(() => expect(
      within(context).getByText('Current Space role').parentElement,
    ).toHaveTextContent('Current Space roleNone'));
    expect(screen.getByRole('combobox', { name: 'Execution role' })).toHaveValue('editor');
    expect(screen.getByText(
      'This Agent is not authorized for this Space and will be authorized as Editor.',
    )).toBeVisible();
  });

  it.each(['publisher', 'reader'] as const)(
    'treats ready detail without a Grant as authoritative over a stale %s summary',
    async (staleRole) => {
      const staleSummary = ownedAgent(`agent-stale-${staleRole}`, staleRole);
      vi.mocked(agentPreparationApi.listAgents).mockResolvedValue([staleSummary]);
      vi.mocked(existingAgentContextApi.getAgent).mockResolvedValue({
        ...ownedAgentDetail(staleSummary),
        grants: [],
      });
      renderDialog();

      const context = await screen.findByRole('region', { name: 'Current Agent context' });
      await waitFor(() => expect(
        within(context).getByText('Current Space role').parentElement,
      ).toHaveTextContent('Current Space roleNone'));
      expect(screen.getByRole('combobox', { name: 'Execution role' })).toHaveValue('editor');
      expect(screen.getByText(
        'This Agent is not authorized for this Space and will be authorized as Editor.',
      )).toBeVisible();
      expect(screen.queryByText(/currently Reader/u)).not.toBeInTheDocument();
    },
  );

  it('shows unavailable detail safely without exposing a raw error', async () => {
    const publisher = ownedAgent('agent-publisher', 'publisher');
    vi.mocked(agentPreparationApi.listAgents).mockResolvedValue([publisher]);
    vi.mocked(existingAgentContextApi.getAgent).mockRejectedValue(new Error('raw detail failure'));
    renderDialog();

    const context = await screen.findByRole('region', { name: 'Current Agent context' });
    await waitFor(() => expect(
      within(context).getByText('Connection').parentElement,
    ).toHaveTextContent('ConnectionUnavailable'));
    expect(screen.getByRole('combobox', { name: 'Execution role' })).toHaveValue('publisher');
    expect(screen.queryByText(/raw detail failure/u)).not.toBeInTheDocument();
  });

  it('localizes existing Agent context and authorization copy in Simplified Chinese', async () => {
    localStorage.setItem('agentwiki.language.v1', 'zh-CN');
    const ungranted = ownedAgent('agent-ungranted');
    vi.mocked(agentPreparationApi.listAgents).mockResolvedValue([ungranted]);
    vi.mocked(existingAgentContextApi.getAgent).mockResolvedValue(ownedAgentDetail(ungranted));
    renderDialog();

    const context = await screen.findByRole('region', { name: '当前 Agent 上下文' });
    await waitFor(() => expect(
      within(context).getByText('接入状态').parentElement,
    ).toHaveTextContent('接入状态未接入'));
    expect(within(context).getByText('当前 Space 角色').parentElement).toHaveTextContent(
      '当前 Space 角色无',
    );
    expect(screen.getByText(
      '此 Agent 尚未授权当前 Space，将授权为 Editor。',
    )).toBeVisible();
  });

  it('ignores an old selected-Agent detail response', async () => {
    const publisher = ownedAgent('agent-publisher', 'publisher');
    const editor = ownedAgent('agent-editor', 'editor');
    const resolvers = new Map<string, (detail: OwnedAgentDetail) => void>();
    vi.mocked(agentPreparationApi.listAgents).mockResolvedValue([publisher, editor]);
    vi.mocked(existingAgentContextApi.getAgent).mockImplementation((agentId) => new Promise((resolve) => {
      resolvers.set(agentId, resolve);
    }));
    renderDialog();
    const select = await screen.findByRole('combobox', { name: 'Agent' });
    fireEvent.change(select, { target: { value: editor.id } });

    await act(async () => { resolvers.get(editor.id)?.(ownedAgentDetail(editor)); });
    expect(screen.getByRole('combobox', { name: 'Execution role' })).toHaveValue('editor');
    await act(async () => { resolvers.get(publisher.id)?.(ownedAgentDetail(publisher, true)); });

    const context = screen.getByRole('region', { name: 'Current Agent context' });
    expect(within(context).getByText('Current Space role').parentElement).toHaveTextContent(
      'Current Space roleEditor',
    );
    expect(within(context).getByText('Connection').parentElement).toHaveTextContent(
      'ConnectionNot connected',
    );
    expect(screen.getByRole('combobox', { name: 'Execution role' })).toHaveValue('editor');
  });

  it('ignores an old Space detail response', async () => {
    const agent = ownedAgent('agent-1', 'editor');
    const otherSpace = { id: 'space-2', name: 'Other Space' };
    const publisherDetail: OwnedAgentDetail = {
      ...agent,
      grants: [{ id: 'grant-other', spaceId: otherSpace.id, role: 'publisher', space: otherSpace }],
      credentials: [],
    };
    const requests: Array<(detail: OwnedAgentDetail) => void> = [];
    vi.mocked(agentPreparationApi.listAgents).mockResolvedValue([agent]);
    vi.mocked(existingAgentContextApi.getAgent).mockImplementation(() => new Promise((resolve) => {
      requests.push(resolve);
    }));
    const props = defaultProps();
    const view = render(
      <LanguageProvider><AgentPreparationDialog {...props} /></LanguageProvider>,
    );
    await screen.findByRole('combobox', { name: 'Agent' });

    view.rerender(
      <LanguageProvider><AgentPreparationDialog {...props} spaceId={otherSpace.id} /></LanguageProvider>,
    );
    await waitFor(() => expect(agentPreparationApi.listAgents).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(requests.length).toBeGreaterThanOrEqual(2));
    const currentSpaceRequest = requests[requests.length - 1];
    if (!currentSpaceRequest) throw new Error('Expected current Space detail request');
    await act(async () => { currentSpaceRequest(publisherDetail); });
    await waitFor(() => expect(
      screen.getByRole('combobox', { name: 'Execution role' }),
    ).toHaveValue('publisher'));
    await act(async () => { requests[0](ownedAgentDetail(agent)); });
    expect(screen.getByRole('combobox', { name: 'Execution role' })).toHaveValue('publisher');
  });

  it('does not let the detail effect replace durable retry role or Agent', async () => {
    const publisher = ownedAgent('agent-publisher', 'publisher');
    vi.mocked(agentPreparationApi.listAgents).mockResolvedValue([publisher]);
    vi.mocked(existingAgentContextApi.getAgent).mockResolvedValue(
      ownedAgentDetail(publisher, true),
    );
    vi.mocked(prepareAgent).mockRejectedValue(new AgentPreparationFailure(
      'granting',
      new Error('grant failed'),
      {
        agent: publisher,
        resumeFrom: 'granting',
        role: 'editor',
        source: 'existing',
        spaceId: space.id,
      },
    ));
    renderDialog();
    const role = screen.getByRole('combobox', { name: 'Execution role' });
    await waitFor(() => expect(role).toHaveValue('publisher'));
    fireEvent.change(role, { target: { value: 'editor' } });
    await submitExistingAgent();
    expect(await screen.findByText(
      'Retry is locked to Agent “agent-publisher name” so completed steps are not repeated.',
    )).toBeVisible();

    expect(role).toHaveValue('editor');
    expect(role).toBeDisabled();
    expect(screen.queryByRole('combobox', { name: 'Agent' })).not.toBeInTheDocument();
  });

  it('creates and grants an Agent, then shows the one-time instruction only in component state', async () => {
    vi.mocked(agentPreparationApi.listAgents).mockResolvedValue([]);
    vi.mocked(prepareAgent).mockResolvedValue(waitingResult({
      agentId: 'agent-new',
      agentName: 'Chapter Writer',
    }));
    renderDialog();

    fireEvent.click(await screen.findByRole('tab', { name: 'Create new Agent' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Chapter Writer' } });
    fireEvent.click(screen.getByRole('button', { name: 'Prepare Agent' }));

    expect(await screen.findByText(/onboard --code AW-CODE/)).toBeVisible();
    expect(screen.getByText('Waiting for Agent connection')).toBeVisible();
    expect(prepareAgent).toHaveBeenCalledWith({
      candidate: {
        kind: 'new',
        name: 'Chapter Writer',
        description: '',
        idempotencyKey: expect.stringMatching(/^create-agent-/u),
      },
      spaceId: 'space-1',
      role: 'editor',
    }, agentPreparationApi, expect.any(Function));
    expect(storedValues()).not.toContain('AW-CODE');
    expect(storedValues()).not.toContain('onboard');
    expect(Object.values(sessionStorage).join('\n')).not.toContain('AW-CODE');
  });

  it('retries only instruction issuance after durable preparation succeeded', async () => {
    vi.mocked(prepareAgent).mockResolvedValue({
      agentId: 'agent-new',
      agentName: 'Writer',
      role: 'editor',
      connection: { kind: 'instruction_failed' },
    });
    vi.mocked(agentPreparationApi.createInstallation).mockResolvedValue(installation({
      installationId: 'install-2',
      code: 'AW-RETRY',
      instructions: 'onboard --code AW-RETRY',
    }));
    renderDialog();

    await submitExistingAgent();
    fireEvent.click(await screen.findByRole('button', { name: 'Retry connection instruction' }));

    expect(await screen.findByText(/AW-RETRY/)).toBeVisible();
    expect(prepareAgent).toHaveBeenCalledTimes(1);
    expect(agentPreparationApi.createInstallation).toHaveBeenCalledWith(
      'agent-new',
      'space-1',
      'editor',
    );
  });

  it('detects connection automatically and completes the target Role Slot', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-25T01:00:00.000Z'));
    vi.mocked(prepareAgent).mockResolvedValue(waitingResult());
    vi.mocked(agentPreparationApi.getAgent)
      .mockResolvedValueOnce(disconnectedDetail)
      .mockResolvedValueOnce(connectedDetail);
    const onPrepared = vi.fn().mockResolvedValue(undefined);
    renderDialog({ onPrepared });
    await openWaitingInstructionWithFakeTimers();

    await act(async () => { await vi.advanceTimersByTimeAsync(4_000); });

    expect(onPrepared).toHaveBeenCalledWith({
      agentId: 'agent-1',
      agentName: 'Writer',
      connection: 'connected',
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(4_000); });
    expect(onPrepared).toHaveBeenCalledTimes(1);
  });

  it('does not overlap automatic connection checks', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-25T01:00:00.000Z'));
    vi.mocked(prepareAgent).mockResolvedValue(waitingResult());
    let resolveDetail!: (detail: OwnedAgentDetail) => void;
    vi.mocked(agentPreparationApi.getAgent).mockImplementation(() => (
      new Promise((resolve) => { resolveDetail = resolve; })
    ));
    renderDialog();
    await openWaitingInstructionWithFakeTimers();

    await act(async () => { await vi.advanceTimersByTimeAsync(6_000); });
    expect(agentPreparationApi.getAgent).toHaveBeenCalledTimes(1);

    await act(async () => { resolveDetail(disconnectedDetail); });
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(agentPreparationApi.getAgent).toHaveBeenCalledTimes(2);
  });

  it('does not let a cancelled target check unlock a newer in-flight check', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-25T01:00:00.000Z'));
    vi.mocked(prepareAgent).mockResolvedValue(waitingResult());
    const detailResolvers: Array<(detail: OwnedAgentDetail) => void> = [];
    vi.mocked(agentPreparationApi.getAgent).mockImplementation(() => (
      new Promise((resolve) => { detailResolvers.push(resolve); })
    ));
    const props = defaultProps();
    const view = render(
      <LanguageProvider>
        <AgentPreparationDialog {...props} />
      </LanguageProvider>,
    );
    await openWaitingInstructionWithFakeTimers();
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(agentPreparationApi.getAgent).toHaveBeenCalledTimes(1);

    view.rerender(
      <LanguageProvider>
        <AgentPreparationDialog {...props} target={{ id: 'reviewer', name: 'Reviewer' }} />
      </LanguageProvider>,
    );
    await flushMicrotasks();
    fireEvent.click(screen.getByRole('button', { name: 'Prepare Agent' }));
    await flushMicrotasks();
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(agentPreparationApi.getAgent).toHaveBeenCalledTimes(2);

    await act(async () => { detailResolvers[0](disconnectedDetail); });
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });

    expect(agentPreparationApi.getAgent).toHaveBeenCalledTimes(2);
  });

  it('allows mapping first while preserving a pending connection state', async () => {
    vi.mocked(prepareAgent).mockResolvedValue(waitingResult());
    const onPrepared = vi.fn().mockResolvedValue(undefined);
    renderDialog({ onPrepared });
    await openWaitingInstruction();

    fireEvent.click(screen.getByRole('button', { name: 'Connect later and map now' }));
    fireEvent.click(screen.getByRole('button', { name: 'Connect later and map now' }));

    await waitFor(() => expect(onPrepared).toHaveBeenCalledWith({
      agentId: 'agent-1',
      agentName: 'Writer',
      connection: 'pending',
    }));
    expect(onPrepared).toHaveBeenCalledTimes(1);
  });

  it('does not let an old target completion unlock or duplicate the new completion', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-25T01:00:00.000Z'));
    vi.mocked(prepareAgent).mockResolvedValue(waitingResult());
    const completionResolvers: Array<() => void> = [];
    const onPrepared = vi.fn().mockImplementation(() => new Promise<void>((resolve) => {
      completionResolvers.push(resolve);
    }));
    const props = { ...defaultProps(), onPrepared };
    const view = render(
      <LanguageProvider>
        <AgentPreparationDialog {...props} />
      </LanguageProvider>,
    );
    await openWaitingInstructionWithFakeTimers();
    fireEvent.click(screen.getByRole('button', { name: 'Connect later and map now' }));
    expect(onPrepared).toHaveBeenCalledTimes(1);

    view.rerender(
      <LanguageProvider>
        <AgentPreparationDialog {...props} target={{ id: 'reviewer', name: 'Reviewer' }} />
      </LanguageProvider>,
    );
    await flushMicrotasks();
    fireEvent.click(screen.getByRole('button', { name: 'Prepare Agent' }));
    await flushMicrotasks();
    fireEvent.click(screen.getByRole('button', { name: 'Connect later and map now' }));
    expect(onPrepared).toHaveBeenCalledTimes(2);

    await act(async () => { completionResolvers[0](); });
    vi.mocked(agentPreparationApi.getAgent).mockResolvedValue(connectedDetail);
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(onPrepared).toHaveBeenCalledTimes(2);
    await act(async () => { completionResolvers[1](); });
    if (completionResolvers[2]) await act(async () => { completionResolvers[2](); });
  });

  it('refreshes parent authorization instead of retrying after an instruction 403', async () => {
    vi.mocked(prepareAgent).mockResolvedValue({
      agentId: 'agent-1',
      agentName: 'Writer',
      role: 'editor',
      connection: { kind: 'instruction_failed', status: 403 },
    });
    const onAuthorizationLost = vi.fn().mockResolvedValue(undefined);
    renderDialog({ onAuthorizationLost });
    await submitExistingAgent();

    await waitFor(() => expect(onAuthorizationLost).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('button', { name: 'Retry connection instruction' })).not.toBeInTheDocument();
    expect(screen.getByText('Ask a Space Owner or Admin to prepare an executable Agent.')).toBeVisible();
  });

  it('refreshes parent authorization for an initial preparation failure caused by a 403', async () => {
    vi.mocked(prepareAgent).mockRejectedValue(new AgentPreparationFailure(
      'granting',
      { response: { status: 403, data: { message: 'raw authorization detail' } } },
    ));
    const onAuthorizationLost = vi.fn().mockResolvedValue(undefined);
    renderDialog({ onAuthorizationLost });
    await submitExistingAgent();

    await waitFor(() => expect(onAuthorizationLost).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/raw authorization detail/)).not.toBeInTheDocument();
    expect(screen.queryByText('Could not authorize the Agent for this Space.')).not.toBeInTheDocument();
  });

  it('keeps the safe owner-required state when authorization refresh rejects', async () => {
    vi.mocked(prepareAgent).mockResolvedValue({
      agentId: 'agent-1',
      agentName: 'Writer',
      role: 'editor',
      connection: { kind: 'instruction_failed', status: 403 },
    });
    const onAuthorizationLost = vi.fn().mockRejectedValue(new Error('raw parent refresh detail'));
    renderDialog({ onAuthorizationLost });
    await submitExistingAgent();

    await waitFor(() => expect(onAuthorizationLost).toHaveBeenCalledTimes(1));
    expect(screen.getByText('Ask a Space Owner or Admin to prepare an executable Agent.')).toBeVisible();
    expect(screen.queryByText(/raw parent refresh detail/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry connection instruction' })).not.toBeInTheDocument();
  });

  it('refreshes parent authorization when instruction retry returns 403', async () => {
    vi.mocked(prepareAgent).mockResolvedValue({
      agentId: 'agent-1',
      agentName: 'Writer',
      role: 'editor',
      connection: { kind: 'instruction_failed' },
    });
    vi.mocked(agentPreparationApi.createInstallation).mockRejectedValue({
      response: { status: 403, data: { message: 'raw retry detail' } },
    });
    const onAuthorizationLost = vi.fn().mockResolvedValue(undefined);
    renderDialog({ onAuthorizationLost });
    await submitExistingAgent();
    fireEvent.click(await screen.findByRole('button', { name: 'Retry connection instruction' }));

    await waitFor(() => expect(onAuthorizationLost).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/raw retry detail/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry connection instruction' })).not.toBeInTheDocument();
  });

  it('explains paused resume and exact Reader upgrade while defaulting to Editor', async () => {
    vi.mocked(agentPreparationApi.listAgents).mockResolvedValue([pausedReader]);
    vi.mocked(existingAgentContextApi.getAgent).mockResolvedValue(ownedAgentDetail(pausedReader));
    renderDialog();

    expect(await screen.findByText(
      'This Agent is paused and will be resumed before authorization.',
    )).toBeVisible();
    expect(screen.getByText(
      'This Agent is currently Reader and will be upgraded to Editor.',
    )).toBeVisible();
    const role = screen.getByRole('combobox', { name: 'Execution role' });
    expect(role).toHaveValue('editor');

    fireEvent.change(role, { target: { value: 'publisher' } });
    expect(role).toHaveValue('publisher');
    expect(screen.getByText(
      'This Agent is currently Reader and will be upgraded to Publisher.',
    )).toBeVisible();
  });

  it('implements linked roving tabs with Arrow, Home, and End keyboard navigation', async () => {
    renderDialog();
    const existingTab = await screen.findByRole('tab', { name: 'Use existing Agent' });
    const createTab = screen.getByRole('tab', { name: 'Create new Agent' });
    const existingPanelId = existingTab.getAttribute('aria-controls') ?? '';
    const createPanelId = createTab.getAttribute('aria-controls') ?? '';
    const existingPanel = document.getElementById(existingPanelId);
    const createPanel = document.getElementById(createPanelId);

    expect(existingTab).toHaveAttribute('tabindex', '0');
    expect(createTab).toHaveAttribute('tabindex', '-1');
    expect(existingPanel).toHaveAttribute('role', 'tabpanel');
    expect(existingPanel).toHaveAttribute('aria-labelledby', existingTab.id);
    expect(existingPanel).not.toHaveAttribute('hidden');
    expect(existingPanel).toHaveAttribute('tabindex', '0');
    expect(createPanel).toHaveAttribute('role', 'tabpanel');
    expect(createPanel).toHaveAttribute('aria-labelledby', createTab.id);
    expect(createPanel).toHaveAttribute('hidden');
    expect(createPanel).toHaveAttribute('tabindex', '-1');
    expect(screen.queryByRole('textbox', { name: 'Name' })).not.toBeInTheDocument();

    fireEvent.keyDown(existingTab, { key: 'ArrowRight' });
    expect(createTab).toHaveFocus();
    expect(createTab).toHaveAttribute('aria-selected', 'true');
    expect(document.getElementById(existingPanelId)).toBe(existingPanel);
    expect(document.getElementById(createPanelId)).toBe(createPanel);
    expect(existingPanel).toHaveAttribute('hidden');
    expect(existingPanel).toHaveAttribute('tabindex', '-1');
    expect(createPanel).not.toHaveAttribute('hidden');
    expect(createPanel).toHaveAttribute('tabindex', '0');
    expect(screen.queryByRole('combobox', { name: 'Agent' })).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Name' })).toBeVisible();

    fireEvent.keyDown(createTab, { key: 'Home' });
    expect(existingTab).toHaveFocus();
    expect(existingPanel).not.toHaveAttribute('hidden');
    expect(createPanel).toHaveAttribute('hidden');
    fireEvent.keyDown(existingTab, { key: 'End' });
    expect(createTab).toHaveFocus();
    expect(existingPanel).toHaveAttribute('hidden');
    expect(createPanel).not.toHaveAttribute('hidden');
    fireEvent.keyDown(createTab, { key: 'ArrowRight' });
    expect(existingTab).toHaveFocus();
    fireEvent.keyDown(existingTab, { key: 'ArrowLeft' });
    expect(createTab).toHaveFocus();
    expect(existingTab).toHaveAttribute('aria-controls', existingPanelId);
    expect(createTab).toHaveAttribute('aria-controls', createPanelId);
    expect(document.getElementById(existingPanelId)).toBe(existingPanel);
    expect(document.getElementById(createPanelId)).toBe(createPanel);
  });

  it('does not close with Escape or the close button during a mutation', async () => {
    let resolvePreparation!: (result: PreparedAgent) => void;
    vi.mocked(prepareAgent).mockImplementation(() => new Promise((resolve) => {
      resolvePreparation = resolve;
    }));
    const onClose = vi.fn();
    renderDialog({ onClose });
    await screen.findByRole('combobox', { name: 'Agent' });

    fireEvent.click(screen.getByRole('button', { name: 'Prepare Agent' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled();
    expect(screen.getByRole('tab', { name: 'Use existing Agent' })).toBeDisabled();
    expect(screen.getByRole('tab', { name: 'Use existing Agent' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('tab', { name: 'Create new Agent' })).toBeDisabled();
    await act(async () => { resolvePreparation(waitingResult()); });
  });

  it('marks an expired instruction and regenerates it without preparing again', async () => {
    vi.mocked(prepareAgent).mockResolvedValue(waitingResult({
      connection: { kind: 'waiting', installation: installation({
        expiresAt: new Date(Date.now() - 1_000).toISOString(),
      }) },
    }));
    vi.mocked(agentPreparationApi.createInstallation).mockResolvedValue(installation({
      installationId: 'install-new',
      code: 'AW-NEW',
      instructions: 'onboard --code AW-NEW',
    }));
    renderDialog();
    await submitExistingAgent();

    expect(await screen.findByText('This connection instruction has expired.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Copy connection instruction' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry connection instruction' }));

    expect(await screen.findByText(/AW-NEW/)).toBeVisible();
    expect(prepareAgent).toHaveBeenCalledTimes(1);
  });

  it('stops polling as soon as the instruction expires', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-25T01:00:00.000Z'));
    vi.mocked(prepareAgent).mockResolvedValue(waitingResult({
      connection: { kind: 'waiting', installation: installation({
        expiresAt: new Date('2026-08-25T01:00:01.000Z').toISOString(),
      }) },
    }));
    renderDialog();
    await openWaitingInstructionWithFakeTimers();

    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });

    expect(screen.getByText('This connection instruction has expired.')).toBeVisible();
    expect(agentPreparationApi.getAgent).not.toHaveBeenCalled();
  });

  it('uses event time to block a stale Check now action after expiry', async () => {
    vi.useFakeTimers();
    const startedAt = new Date('2026-08-25T01:00:00.000Z');
    vi.setSystemTime(startedAt);
    vi.mocked(prepareAgent).mockResolvedValue(waitingResult({
      connection: { kind: 'waiting', installation: installation({
        expiresAt: new Date(startedAt.getTime() + 1_000).toISOString(),
      }) },
    }));
    renderDialog();
    await openWaitingInstructionWithFakeTimers();

    vi.setSystemTime(new Date(startedAt.getTime() + 2_000));
    fireEvent.click(screen.getByRole('button', { name: 'Check connection now' }));
    await flushMicrotasks();

    expect(agentPreparationApi.getAgent).not.toHaveBeenCalled();
    expect(screen.getByText('This connection instruction has expired.')).toBeVisible();
    expect(screen.queryByText('Waiting for Agent connection')).not.toBeInTheDocument();
  });

  it('ignores a connected poll response that settles after its instruction expires', async () => {
    vi.useFakeTimers();
    const startedAt = new Date('2026-08-25T01:00:00.000Z');
    vi.setSystemTime(startedAt);
    vi.mocked(prepareAgent).mockResolvedValue(waitingResult({
      connection: { kind: 'waiting', installation: installation({
        expiresAt: new Date(startedAt.getTime() + 3_000).toISOString(),
      }) },
    }));
    let resolveDetail!: (detail: OwnedAgentDetail) => void;
    vi.mocked(agentPreparationApi.getAgent).mockImplementation(() => new Promise((resolve) => {
      resolveDetail = resolve;
    }));
    const onPrepared = vi.fn().mockResolvedValue(undefined);
    renderDialog({ onPrepared });
    await openWaitingInstructionWithFakeTimers();
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(agentPreparationApi.getAgent).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date(startedAt.getTime() + 4_000));
    await act(async () => { resolveDetail(connectedDetail); });

    expect(onPrepared).not.toHaveBeenCalled();
    expect(screen.getByText('This connection instruction has expired.')).toBeVisible();
    expect(screen.queryByText('Waiting for Agent connection')).not.toBeInTheDocument();
  });

  it('does not show a connection-check error when an in-flight check rejects after expiry', async () => {
    vi.useFakeTimers();
    const startedAt = new Date('2026-08-25T01:00:00.000Z');
    vi.setSystemTime(startedAt);
    vi.mocked(prepareAgent).mockResolvedValue(waitingResult({
      connection: { kind: 'waiting', installation: installation({
        expiresAt: new Date(startedAt.getTime() + 3_000).toISOString(),
      }) },
    }));
    let rejectDetail!: (error: Error) => void;
    vi.mocked(agentPreparationApi.getAgent).mockImplementation(() => new Promise((_, reject) => {
      rejectDetail = reject;
    }));
    renderDialog();
    await openWaitingInstructionWithFakeTimers();
    fireEvent.click(screen.getByRole('button', { name: 'Check connection now' }));
    await flushMicrotasks();

    vi.setSystemTime(new Date(startedAt.getTime() + 4_000));
    await act(async () => { rejectDetail(new Error('stale check failure')); });

    expect(screen.getByText('This connection instruction has expired.')).toBeVisible();
    expect(screen.queryByText('Could not check the Agent connection.')).not.toBeInTheDocument();
  });

  it('uses event time to block clipboard writes after expiry', async () => {
    vi.useFakeTimers();
    const startedAt = new Date('2026-08-25T01:00:00.000Z');
    vi.setSystemTime(startedAt);
    vi.mocked(prepareAgent).mockResolvedValue(waitingResult({
      connection: { kind: 'waiting', installation: installation({
        expiresAt: new Date(startedAt.getTime() + 1_000).toISOString(),
      }) },
    }));
    renderDialog();
    await openWaitingInstructionWithFakeTimers();

    vi.setSystemTime(new Date(startedAt.getTime() + 2_000));
    fireEvent.click(screen.getByRole('button', { name: 'Copy connection instruction' }));
    await flushMicrotasks();

    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
    expect(screen.getByText('This connection instruction has expired.')).toBeVisible();
  });

  it('keeps expiry when a clipboard write resolves after the instruction expires', async () => {
    vi.useFakeTimers();
    const startedAt = new Date('2026-08-25T01:00:00.000Z');
    vi.setSystemTime(startedAt);
    vi.mocked(prepareAgent).mockResolvedValue(waitingResult({
      connection: { kind: 'waiting', installation: installation({
        expiresAt: new Date(startedAt.getTime() + 1_000).toISOString(),
      }) },
    }));
    let resolveCopy!: () => void;
    vi.mocked(navigator.clipboard.writeText).mockImplementation(() => new Promise<void>((resolve) => {
      resolveCopy = resolve;
    }));
    renderDialog();
    await openWaitingInstructionWithFakeTimers();

    fireEvent.click(screen.getByRole('button', { name: 'Copy connection instruction' }));
    vi.setSystemTime(new Date(startedAt.getTime() + 2_000));
    await act(async () => { resolveCopy(); });

    expect(screen.getByText('This connection instruction has expired.')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Connection instruction copied' })).not.toBeInTheDocument();
    expect(screen.queryByText('Could not copy the connection instruction.')).not.toBeInTheDocument();
  });

  it('keeps expiry when a clipboard write rejects after the instruction expires', async () => {
    vi.useFakeTimers();
    const startedAt = new Date('2026-08-25T01:00:00.000Z');
    vi.setSystemTime(startedAt);
    vi.mocked(prepareAgent).mockResolvedValue(waitingResult({
      connection: { kind: 'waiting', installation: installation({
        expiresAt: new Date(startedAt.getTime() + 1_000).toISOString(),
      }) },
    }));
    let rejectCopy!: (error: Error) => void;
    vi.mocked(navigator.clipboard.writeText).mockImplementation(() => new Promise<void>((_, reject) => {
      rejectCopy = reject;
    }));
    renderDialog();
    await openWaitingInstructionWithFakeTimers();

    fireEvent.click(screen.getByRole('button', { name: 'Copy connection instruction' }));
    vi.setSystemTime(new Date(startedAt.getTime() + 2_000));
    await act(async () => { rejectCopy(new Error('clipboard denied')); });

    expect(screen.getByText('This connection instruction has expired.')).toBeVisible();
    expect(screen.queryByText('Could not copy the connection instruction.')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Connection instruction copied' })).not.toBeInTheDocument();
  });

  it('lets a regenerated instruction check immediately while the expired generation is in flight', async () => {
    vi.useFakeTimers();
    const startedAt = new Date('2026-08-25T01:00:00.000Z');
    vi.setSystemTime(startedAt);
    vi.mocked(prepareAgent).mockResolvedValue(waitingResult({
      connection: { kind: 'waiting', installation: installation({
        expiresAt: new Date(startedAt.getTime() + 3_000).toISOString(),
      }) },
    }));
    vi.mocked(agentPreparationApi.createInstallation).mockResolvedValue(installation({
      installationId: 'install-2',
      code: 'AW-NEW',
      expiresAt: new Date(startedAt.getTime() + 600_000).toISOString(),
      instructions: 'onboard --code AW-NEW',
    }));
    const detailResolvers: Array<(detail: OwnedAgentDetail) => void> = [];
    vi.mocked(agentPreparationApi.getAgent).mockImplementation(() => new Promise((resolve) => {
      detailResolvers.push(resolve);
    }));
    const onPrepared = vi.fn().mockResolvedValue(undefined);
    renderDialog({ onPrepared });
    await openWaitingInstructionWithFakeTimers();
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(agentPreparationApi.getAgent).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });

    fireEvent.click(screen.getByRole('button', { name: 'Retry connection instruction' }));
    await flushMicrotasks();
    fireEvent.click(screen.getByRole('button', { name: 'Check connection now' }));
    await flushMicrotasks();
    const immediateCallCount = vi.mocked(agentPreparationApi.getAgent).mock.calls.length;

    await act(async () => { detailResolvers[0](connectedDetail); });
    if (detailResolvers[1]) {
      await act(async () => { detailResolvers[1](disconnectedDetail); });
    }
    expect(immediateCallCount).toBe(2);
    expect(onPrepared).not.toHaveBeenCalled();
    expect(screen.getByText(/AW-NEW/)).toBeVisible();
  });

  it('keeps the dialog open and shows the localized refresh error when onPrepared rejects', async () => {
    vi.mocked(prepareAgent).mockResolvedValue(waitingResult());
    const onPrepared = vi.fn().mockRejectedValue(new Error('raw refresh detail'));
    const onClose = vi.fn();
    renderDialog({ onPrepared, onClose });
    await openWaitingInstruction();

    fireEvent.click(screen.getByRole('button', { name: 'Connect later and map now' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The Agent was prepared, but the Space Agent list could not be refreshed.',
    );
    expect(screen.getByRole('dialog')).toBeVisible();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByText(/raw refresh detail/)).not.toBeInTheDocument();
  });

  it('fails closed through authorization loss when onPrepared rejects with Axios 403', async () => {
    vi.mocked(prepareAgent).mockResolvedValue(waitingResult());
    const onPrepared = vi.fn().mockRejectedValue({
      response: { status: 403, data: { message: 'raw parent authorization detail' } },
    });
    const onAuthorizationLost = vi.fn().mockRejectedValue(new Error('raw refresh rejection'));
    renderDialog({ onPrepared, onAuthorizationLost });
    await openWaitingInstruction();

    fireEvent.click(screen.getByRole('button', { name: 'Connect later and map now' }));

    await waitFor(() => expect(onAuthorizationLost).toHaveBeenCalledTimes(1));
    expect(screen.getByText(
      'Ask a Space Owner or Admin to prepare an executable Agent.',
    )).toBeVisible();
    expect(screen.queryByText(
      'The Agent was prepared, but the Space Agent list could not be refreshed.',
    )).not.toBeInTheDocument();
    expect(screen.queryByText(/raw parent authorization detail|raw refresh rejection/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  it('shows a localized clipboard alert without leaking the instruction', async () => {
    vi.mocked(prepareAgent).mockResolvedValue(waitingResult());
    vi.mocked(navigator.clipboard.writeText).mockRejectedValue(new Error('clipboard denied'));
    renderDialog();
    await openWaitingInstruction();

    fireEvent.click(screen.getByRole('button', { name: 'Copy connection instruction' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not copy the connection instruction.');
    expect(alert).not.toHaveTextContent('AW-CODE');
    expect(alert).not.toHaveTextContent('onboard');
  });

  it('ignores a clipboard success from an old target instruction', async () => {
    vi.mocked(prepareAgent)
      .mockResolvedValueOnce(waitingResult())
      .mockResolvedValueOnce(waitingResult({
        connection: { kind: 'waiting', installation: installation({
          installationId: 'install-2',
          code: 'AW-NEW',
          instructions: 'onboard --code AW-NEW',
        }) },
      }));
    let resolveCopy!: () => void;
    vi.mocked(navigator.clipboard.writeText).mockImplementation(() => new Promise<void>((resolve) => {
      resolveCopy = resolve;
    }));
    const props = defaultProps();
    const view = render(
      <LanguageProvider>
        <AgentPreparationDialog {...props} />
      </LanguageProvider>,
    );
    await openWaitingInstruction();
    fireEvent.click(screen.getByRole('button', { name: 'Copy connection instruction' }));

    view.rerender(
      <LanguageProvider>
        <AgentPreparationDialog {...props} target={{ id: 'reviewer', name: 'Reviewer' }} />
      </LanguageProvider>,
    );
    await screen.findByRole('combobox', { name: 'Agent' });
    fireEvent.click(screen.getByRole('button', { name: 'Prepare Agent' }));
    await screen.findByText(/AW-NEW/);
    await act(async () => { resolveCopy(); });

    expect(screen.getByRole('button', { name: 'Copy connection instruction' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Connection instruction copied' })).not.toBeInTheDocument();
  });

  it('ignores a clipboard rejection after the Space changes', async () => {
    vi.mocked(prepareAgent).mockResolvedValue(waitingResult());
    let rejectCopy!: (error: Error) => void;
    vi.mocked(navigator.clipboard.writeText).mockImplementation(() => new Promise<void>((_, reject) => {
      rejectCopy = reject;
    }));
    const props = defaultProps();
    const view = render(
      <LanguageProvider>
        <AgentPreparationDialog {...props} />
      </LanguageProvider>,
    );
    await openWaitingInstruction();
    fireEvent.click(screen.getByRole('button', { name: 'Copy connection instruction' }));

    view.rerender(
      <LanguageProvider>
        <AgentPreparationDialog {...props} spaceId="space-2" />
      </LanguageProvider>,
    );
    await screen.findByRole('combobox', { name: 'Agent' });
    await act(async () => { rejectCopy(new Error('stale clipboard failure')); });

    expect(screen.queryByText('Could not copy the connection instruction.')).not.toBeInTheDocument();
  });

  it('checks the connection immediately on request', async () => {
    vi.mocked(prepareAgent).mockResolvedValue(waitingResult());
    vi.mocked(agentPreparationApi.getAgent).mockResolvedValue(connectedDetail);
    const onPrepared = vi.fn().mockResolvedValue(undefined);
    renderDialog({ onPrepared });
    await openWaitingInstruction();

    fireEvent.click(screen.getByRole('button', { name: 'Check connection now' }));

    await waitFor(() => expect(onPrepared).toHaveBeenCalledWith({
      agentId: 'agent-1',
      agentName: 'Writer',
      connection: 'connected',
    }));
  });

  it('fails closed through authorization loss when a manual connection check returns 403', async () => {
    vi.mocked(prepareAgent).mockResolvedValue(waitingResult());
    vi.mocked(agentPreparationApi.getAgent).mockRejectedValue({
      response: { status: 403, data: { message: 'raw manual authorization detail' } },
    });
    const onAuthorizationLost = vi.fn().mockResolvedValue(undefined);
    renderDialog({ onAuthorizationLost });
    await openWaitingInstruction();

    fireEvent.click(screen.getByRole('button', { name: 'Check connection now' }));

    await waitFor(() => expect(onAuthorizationLost).toHaveBeenCalledTimes(1));
    expect(screen.getByText(
      'Ask a Space Owner or Admin to prepare an executable Agent.',
    )).toBeVisible();
    expect(screen.queryByText('Could not check the Agent connection.')).not.toBeInTheDocument();
    expect(screen.queryByText(/raw manual authorization detail/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Check connection now' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry connection instruction' })).not.toBeInTheDocument();
  });

  it('fails closed through authorization loss when a polling connection check returns 403', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-25T01:00:00.000Z'));
    vi.mocked(prepareAgent).mockResolvedValue(waitingResult());
    vi.mocked(agentPreparationApi.getAgent).mockRejectedValue({
      response: { status: 403, data: { message: 'raw polling authorization detail' } },
    });
    const onAuthorizationLost = vi.fn().mockResolvedValue(undefined);
    renderDialog({ onAuthorizationLost });
    await openWaitingInstructionWithFakeTimers();

    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });

    expect(onAuthorizationLost).toHaveBeenCalledTimes(1);
    expect(screen.getByText(
      'Ask a Space Owner or Admin to prepare an executable Agent.',
    )).toBeVisible();
    expect(screen.queryByText('Could not check the Agent connection.')).not.toBeInTheDocument();
    expect(screen.queryByText(/raw polling authorization detail/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry connection instruction' })).not.toBeInTheDocument();
  });

  it('keeps the polling deadline and uses only the latest parent callbacks', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-25T01:00:00.000Z'));
    vi.mocked(prepareAgent).mockResolvedValue(waitingResult());
    vi.mocked(agentPreparationApi.getAgent).mockResolvedValue(connectedDetail);
    const oldOnClose = vi.fn();
    const oldOnPrepared = vi.fn().mockResolvedValue(undefined);
    const props = { ...defaultProps(), onClose: oldOnClose, onPrepared: oldOnPrepared };
    const view = render(
      <LanguageProvider>
        <AgentPreparationDialog {...props} />
      </LanguageProvider>,
    );
    await openWaitingInstructionWithFakeTimers();
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    const clearInterval = vi.spyOn(window, 'clearInterval');
    const newOnClose = vi.fn();
    const newOnPrepared = vi.fn().mockResolvedValue(undefined);

    view.rerender(
      <LanguageProvider>
        <AgentPreparationDialog
          {...props}
          onClose={newOnClose}
          onPrepared={newOnPrepared}
        />
      </LanguageProvider>,
    );
    await flushMicrotasks();
    expect(clearInterval).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });

    expect(agentPreparationApi.getAgent).toHaveBeenCalledTimes(1);
    expect(newOnPrepared).toHaveBeenCalledTimes(1);
    expect(newOnClose).toHaveBeenCalledTimes(1);
    expect(oldOnPrepared).not.toHaveBeenCalled();
    expect(oldOnClose).not.toHaveBeenCalled();
  });

  it('shows a stable localized error when a manual connection check fails', async () => {
    vi.mocked(prepareAgent).mockResolvedValue(waitingResult());
    vi.mocked(agentPreparationApi.getAgent).mockRejectedValue({
      response: { status: 500, data: { message: 'raw database detail' } },
    });
    renderDialog();
    await openWaitingInstruction();

    fireEvent.click(screen.getByRole('button', { name: 'Check connection now' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not check the Agent connection.',
    );
    expect(screen.queryByText(/raw database detail/)).not.toBeInTheDocument();
  });

  it('shows only the localized stage error from a failed preparation', async () => {
    vi.mocked(prepareAgent).mockRejectedValue(new AgentPreparationFailure(
      'activating',
      new Error('raw server activation detail'),
    ));
    renderDialog();
    await submitExistingAgent();

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not resume the Agent.');
    expect(screen.queryByText(/raw server activation detail/)).not.toBeInTheDocument();
  });

  it('filters revoked owned Agents and selects the first available Agent', async () => {
    const revokedAgent: OwnedAgentSummary = {
      ...activeAgent,
      id: 'agent-revoked',
      name: 'Revoked Writer',
      revokedAt: '2026-08-25T00:00:00.000Z',
    };
    const availableAgent: OwnedAgentSummary = {
      ...activeAgent,
      id: 'agent-available',
      name: 'Available Writer',
    };
    vi.mocked(agentPreparationApi.listAgents).mockResolvedValue([revokedAgent, availableAgent]);
    renderDialog();

    const agentSelect = await screen.findByRole('combobox', { name: 'Agent' });
    expect(agentSelect).toHaveValue('agent-available');
    expect(screen.getByRole('option', { name: 'Available Writer' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Revoked Writer' })).not.toBeInTheDocument();
  });

  it('uses the empty/create state when every owned Agent is revoked', async () => {
    vi.mocked(agentPreparationApi.listAgents).mockResolvedValue([{
      ...activeAgent,
      revokedAt: '2026-08-25T00:00:00.000Z',
    }]);
    renderDialog();

    expect(await screen.findByText(
      'You do not have an available Agent yet. Create one here.',
    )).toBeVisible();
    expect(screen.queryByRole('combobox', { name: 'Agent' })).not.toBeInTheDocument();
    expect(screen.queryByText(
      'This Agent is paused and will be resumed before authorization.',
    )).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Create new Agent' }));
    expect(screen.getByRole('textbox', { name: 'Name' })).toBeVisible();
  });

  it('reports owned Agent load failure safely', async () => {
    vi.mocked(agentPreparationApi.listAgents).mockRejectedValue({
      response: { data: { message: 'raw list detail' } },
    });
    renderDialog();

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load your Agents.');
    expect(screen.queryByText(/raw list detail/)).not.toBeInTheDocument();
  });

  it('cleans polling and countdown timers on unmount', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-25T01:00:00.000Z'));
    vi.mocked(prepareAgent).mockResolvedValue(waitingResult());
    const clearInterval = vi.spyOn(window, 'clearInterval');
    const view = renderDialog();
    await openWaitingInstructionWithFakeTimers();

    view.unmount();

    expect(clearInterval).toHaveBeenCalledTimes(2);
  });

  it('clears transient preparation state and timers when the target changes', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-25T01:00:00.000Z'));
    vi.mocked(prepareAgent).mockResolvedValue(waitingResult());
    const clearInterval = vi.spyOn(window, 'clearInterval');
    const props = defaultProps();
    const view = render(
      <LanguageProvider>
        <AgentPreparationDialog {...props} />
      </LanguageProvider>,
    );
    await openWaitingInstructionWithFakeTimers();

    view.rerender(
      <LanguageProvider>
        <AgentPreparationDialog {...props} target={{ id: 'reviewer', name: 'Reviewer' }} />
      </LanguageProvider>,
    );

    await flushMicrotasks();
    expect(screen.getByRole('dialog', { name: 'Prepare Agent for Reviewer' })).toBeVisible();
    expect(screen.queryByText(/onboard --code AW-CODE/)).not.toBeInTheDocument();
    expect(clearInterval).toHaveBeenCalledTimes(2);
  });
});
