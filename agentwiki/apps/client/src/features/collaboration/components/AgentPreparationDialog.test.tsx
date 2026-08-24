import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../../context/LanguageContext';
import {
  agentPreparationApi,
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
    expiresAt: new Date('2026-08-25T02:00:00.000Z').toISOString(),
    authorization: { role: 'editor', space },
  }],
};

const installation = (overrides: Partial<{
  installationId: string;
  code: string;
  expiresAt: string;
  instructions: string;
}> = {}) => ({
  installationId: 'install-1',
  code: 'AW-CODE',
  expiresAt: new Date(Date.now() + 600_000).toISOString(),
  instructions: 'npx --yes @neomei/agentwiki-local-sync@0.6.1 onboard --code AW-CODE',
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

describe('AgentPreparationDialog', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('agentwiki.language.v1', 'en');
    vi.mocked(agentPreparationApi.listAgents).mockReset().mockResolvedValue([activeAgent]);
    vi.mocked(agentPreparationApi.getAgent).mockReset().mockResolvedValue(disconnectedDetail);
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
    expect(screen.getByRole('status')).toHaveTextContent('Waiting for Agent connection');
    expect(prepareAgent).toHaveBeenCalledWith({
      candidate: { kind: 'new', name: 'Chapter Writer', description: '' },
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

    await waitFor(() => expect(onPrepared).toHaveBeenCalledWith({
      agentId: 'agent-1',
      agentName: 'Writer',
      connection: 'pending',
    }));
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

  it('loads only non-revoked owned Agents and reports load failure safely', async () => {
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
