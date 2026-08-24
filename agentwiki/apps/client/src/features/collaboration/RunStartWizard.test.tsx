import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../../context/AuthContext';
import { LanguageProvider } from '../../context/LanguageContext';
import { collaborationApi } from './api';
import { RunStartWizard, buildAgentJoinInstructions } from './RunStartWizard';
import { validDefinition } from './collaboration-test-fixtures';
import type { SpaceMemberSummary, TemplateDetail } from './types';

interface MockPreparationSelection {
  agentId: string;
  agentName: string;
  connection: 'connected' | 'pending';
}

interface MockPreparationDialogProps {
  spaceId: string;
  target: { id: string; name: string };
  onClose: () => void;
  onPrepared: (selection: MockPreparationSelection) => Promise<void>;
  onAuthorizationLost: () => Promise<void>;
}

const preparationDialogState = vi.hoisted(() => ({
  latest: null as MockPreparationDialogProps | null,
}));

vi.mock('./api', () => ({ collaborationApi: {
  getTemplate: vi.fn(), listMembers: vi.fn(), createRunDraft: vi.fn(), updateRunDraft: vi.fn(),
  validateRunDraft: vi.fn(), startRun: vi.fn(), getRun: vi.fn(), getRunDraftDetails: vi.fn(),
} }));

vi.mock('./components/AgentPreparationDialog', async () => {
  const React = await import('react');
  return {
    AgentPreparationDialog: (props: MockPreparationDialogProps) => {
      preparationDialogState.latest = props;
      return React.createElement('div', {
        'aria-label': `Prepare Agent for ${props.target.name}`,
        role: 'dialog',
      });
    },
  };
});

const template: TemplateDetail = {
  id: 'template-1', spaceId: 'space-1', slug: 'custom', name: 'Custom workflow', description: '',
  system: false, version: 1, definition: validDefinition,
};
const activeEditor = { type: 'agent' as const, agentId: 'agent-editor', role: 'editor', agent: { id: 'agent-editor', name: 'Editor Bot', status: 'active', revokedAt: null } };
const activeReader = { type: 'agent' as const, agentId: 'agent-reader', role: 'reader', agent: { id: 'agent-reader', name: 'Reader Bot', status: 'active', revokedAt: null } };
const revokedAgent = { type: 'agent' as const, agentId: 'agent-revoked', role: 'publisher', agent: { id: 'agent-revoked', name: 'Revoked Bot', status: 'inactive', revokedAt: '2026-08-24T00:00:00Z' } };
const ownerMember = { type: 'human' as const, userId: 'user-owner', role: 'owner' };
const preparedEditor = { type: 'agent' as const, agentId: 'agent-new', role: 'editor', agent: { id: 'agent-new', name: 'New Writer', status: 'active', revokedAt: null } };

function renderWizard({
  user = { id: 'user-owner', platformRole: 'user' },
  language = 'en',
  initialEntry = '/spaces/space-1/collaboration/templates/template-1/start',
}: {
  user?: { id: string; platformRole: string };
  language?: 'en' | 'zh-CN';
  initialEntry?: string;
} = {}) {
  localStorage.setItem('agentwiki.language.v1', language);
  localStorage.setItem('user', JSON.stringify(user));
  return render(<AuthProvider><LanguageProvider><MemoryRouter initialEntries={[initialEntry]}>
    <Routes><Route path="/spaces/:id/collaboration/templates/:templateId/start" element={<RunStartWizard />} /></Routes>
  </MemoryRouter></LanguageProvider></AuthProvider>);
}

async function advanceToMapping() {
  await screen.findByRole('heading', { name: /1\./u });
  fireEvent.change(screen.getByLabelText(/Run name|运行名称/u), { target: { value: 'Release 1' } });
  fireEvent.change(screen.getByLabelText('Work brief'), { target: { value: 'Ship it' } });
  fireEvent.click(screen.getByRole('button', { name: /Next|下一页/u }));
  await screen.findByRole('heading', { name: /2\./u });
}

function getMockedPreparationDialog(): MockPreparationDialogProps {
  if (!preparationDialogState.latest) throw new Error('Expected AgentPreparationDialog to be rendered');
  return preparationDialogState.latest;
}

async function completeMockedPreparation(
  selection: MockPreparationSelection,
  dialog = getMockedPreparationDialog(),
) {
  await act(async () => { await dialog.onPrepared(selection); });
}

async function loseMockedPreparationAuthorization(dialog = getMockedPreparationDialog()) {
  await act(async () => { await dialog.onAuthorizationLost(); });
}

function confirmSelfReviewIfRequired() {
  const checkbox = screen.queryByRole('checkbox', { name: /separation risk/u }) as HTMLInputElement | null;
  if (checkbox && !checkbox.checked) fireEvent.click(checkbox);
}

function NavigationWizard() {
  const navigate = useNavigate();
  return <><button type="button" onClick={() => navigate('/spaces/space-1/collaboration/templates/template-new/start')}>Open new wizard</button><RunStartWizard /></>;
}

describe('RunStartWizard', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    preparationDialogState.latest = null;
    vi.mocked(collaborationApi.getTemplate).mockResolvedValue(template);
    vi.mocked(collaborationApi.listMembers).mockResolvedValue([ownerMember, activeEditor, activeReader, revokedAgent]);
    vi.mocked(collaborationApi.createRunDraft).mockResolvedValue({
      id: 'run-1', name: 'Release 1', status: 'draft', version: 1, inputs: { brief: 'Ship it' }, roleBindings: [], updatedAt: '2026-08-24T00:00:00Z',
    });
    vi.mocked(collaborationApi.updateRunDraft).mockResolvedValue({
      id: 'run-1', name: 'Release 1', status: 'draft', version: 2, inputs: { brief: 'Ship it' },
      roleBindings: [{ roleSlotId: 'writer', agentId: 'agent-editor' }, { roleSlotId: 'reviewer', agentId: 'agent-editor' }], updatedAt: '2026-08-24T00:00:00Z',
    });
    vi.mocked(collaborationApi.validateRunDraft).mockResolvedValue({
      id: 'run-1', name: 'Release 1', status: 'ready', version: 3, inputs: { brief: 'Ship it' },
      roleBindings: [{ roleSlotId: 'writer', agentId: 'agent-editor' }, { roleSlotId: 'reviewer', agentId: 'agent-editor' }],
      updatedAt: '2026-08-24T00:00:00Z',
    });
    vi.mocked(collaborationApi.startRun).mockResolvedValue({
      id: 'run-1', name: 'Release 1', status: 'running', version: 4, inputs: { brief: 'Ship it' }, updatedAt: '2026-08-24T00:00:00Z',
      roleBindings: [
        { roleSlotId: 'writer', roleSlotName: 'Writer', agentId: 'agent-editor' },
        { roleSlotId: 'reviewer', roleSlotName: 'Reviewer', agentId: 'agent-editor' },
      ],
    });
  });

  it('shows a retryable error instead of a permanent spinner when initialization fails', async () => {
    vi.mocked(collaborationApi.getTemplate)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(template);

    renderWizard();

    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load the start wizard.');
    expect(screen.queryByTestId('run-wizard-loading')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('heading', { name: '1. Work input' })).toBeVisible();
  });

  it('ignores a stale initialization response after navigating to another template', async () => {
    let resolveOld!: (value: TemplateDetail) => void;
    const oldRequest = new Promise<TemplateDetail>((resolve) => { resolveOld = resolve; });
    vi.mocked(collaborationApi.getTemplate)
      .mockReturnValueOnce(oldRequest)
      .mockResolvedValueOnce({ ...template, id: 'template-new', name: 'New workflow' });
    localStorage.setItem('agentwiki.language.v1', 'en');
    localStorage.setItem('user', JSON.stringify({ id: 'user-owner', platformRole: 'user' }));
    render(<AuthProvider><LanguageProvider><MemoryRouter initialEntries={['/spaces/space-1/collaboration/templates/template-old/start']}>
      <Routes><Route path="/spaces/:id/collaboration/templates/:templateId/start" element={<NavigationWizard />} /></Routes>
    </MemoryRouter></LanguageProvider></AuthProvider>);

    fireEvent.click(screen.getByRole('button', { name: 'Open new wizard' }));
    expect(await screen.findByText('New workflow')).toBeVisible();
    await act(async () => resolveOld({ ...template, id: 'template-old', name: 'Old workflow' }));
    expect(screen.queryByText('Old workflow')).not.toBeInTheDocument();
  });

  it('lets an Owner prepare the first required Role Slot from the empty state', async () => {
    vi.mocked(collaborationApi.listMembers)
      .mockResolvedValueOnce([ownerMember])
      .mockResolvedValueOnce([ownerMember, preparedEditor]);
    renderWizard();
    await advanceToMapping();

    fireEvent.click(screen.getByRole('button', { name: 'Prepare first Agent' }));
    expect(await screen.findByRole('dialog', { name: 'Prepare Agent for Writer' })).toBeVisible();
    await completeMockedPreparation({ agentId: 'agent-new', agentName: 'New Writer', connection: 'connected' });

    expect(screen.getByLabelText('Writer')).toHaveValue('agent-new');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('targets the first required unmapped Role Slot when an earlier slot is already bound', async () => {
    localStorage.setItem('agentwiki.collaboration.draft.space-1.template-1', 'run-draft');
    vi.mocked(collaborationApi.listMembers).mockResolvedValue([ownerMember]);
    vi.mocked(collaborationApi.getRun).mockResolvedValue({
      id: 'run-draft', name: 'Existing draft', status: 'draft', version: 1,
      inputs: { brief: 'Ship it' },
      roleBindings: [{ roleSlotId: 'writer', agentId: 'agent-existing' }],
      updatedAt: '2026-08-24T00:00:00Z',
    });
    renderWizard();
    await screen.findByRole('heading', { name: '2. Map Agents' });

    fireEvent.click(screen.getByRole('button', { name: 'Prepare first Agent' }));

    expect(await screen.findByRole('dialog', { name: 'Prepare Agent for Reviewer' })).toBeVisible();
    expect(getMockedPreparationDialog().target.id).toBe('reviewer');
  });

  it('targets the exact Role Slot from each contextual preparation action', async () => {
    renderWizard();
    await advanceToMapping();

    fireEvent.click(screen.getByRole('button', { name: 'Prepare Agent for Reviewer' }));

    expect(await screen.findByRole('dialog', { name: 'Prepare Agent for Reviewer' })).toBeVisible();
    expect(getMockedPreparationDialog().target).toEqual({ id: 'reviewer', name: 'Reviewer' });
  });

  it.each([
    { label: 'Owner', userId: 'user-owner', platformRole: 'user', members: [{ type: 'human' as const, userId: 'user-owner', role: 'owner' }], allowed: true },
    { label: 'Admin', userId: 'user-admin', platformRole: 'user', members: [{ type: 'human' as const, userId: 'user-admin', role: 'admin' }], allowed: true },
    { label: 'Super Admin', userId: 'super-1', platformRole: 'super_admin', members: [], allowed: true },
    { label: 'Editor', userId: 'user-editor', platformRole: 'user', members: [{ type: 'human' as const, userId: 'user-editor', role: 'editor' }], allowed: false },
    { label: 'Viewer', userId: 'user-viewer', platformRole: 'user', members: [{ type: 'human' as const, userId: 'user-viewer', role: 'viewer' }], allowed: false },
    { label: 'non-member', userId: 'user-none', platformRole: 'user', members: [], allowed: false },
  ])('applies the exact preparation permission for $label', async ({ userId, platformRole, members, allowed }) => {
    vi.mocked(collaborationApi.listMembers).mockResolvedValue(members);
    renderWizard({ user: { id: userId, platformRole } });
    await advanceToMapping();

    if (allowed) {
      expect(screen.getByRole('button', { name: 'Prepare first Agent' })).toBeVisible();
      expect(screen.getByRole('button', { name: 'Prepare Agent for Writer' })).toBeVisible();
    } else {
      expect(screen.getByText('Ask a Space Owner or Admin to prepare an executable Agent.')).toBeVisible();
      expect(screen.queryByRole('button', { name: /Prepare/u })).not.toBeInTheDocument();
    }
  });

  it('derives permission only from the current human membership in a mixed member list', async () => {
    vi.mocked(collaborationApi.listMembers).mockResolvedValue([
      { type: 'human', userId: 'other-owner', role: 'owner' },
      { type: 'agent', agentId: 'agent-owned-name', role: 'publisher', agent: { id: 'agent-owned-name', name: 'Owner-shaped Agent', status: 'active', revokedAt: null } },
      { type: 'human', userId: 'user-editor', role: 'editor' },
    ]);
    renderWizard({ user: { id: 'user-editor', platformRole: 'user' } });
    await advanceToMapping();

    expect(screen.queryByRole('button', { name: /Prepare/u })).not.toBeInTheDocument();
  });

  it('uses exact Simplified Chinese action labels', async () => {
    renderWizard({ language: 'zh-CN' });
    await advanceToMapping();

    expect(screen.getByRole('button', { name: '为“Writer”准备 Agent' })).toBeVisible();
  });

  it.each([
    { state: 'absent', refreshed: [ownerMember] },
    { state: 'Reader', refreshed: [ownerMember, { ...preparedEditor, role: 'reader' }] },
    { state: 'paused', refreshed: [ownerMember, { ...preparedEditor, agent: { ...preparedEditor.agent, status: 'paused' } }] },
  ])('rejects a prepared Agent that is $state in the authoritative member refresh', async ({ refreshed }) => {
    vi.mocked(collaborationApi.listMembers)
      .mockResolvedValueOnce([ownerMember])
      .mockResolvedValueOnce(refreshed as SpaceMemberSummary[]);
    renderWizard();
    await advanceToMapping();
    fireEvent.click(screen.getByRole('button', { name: 'Prepare first Agent' }));

    await expect(completeMockedPreparation({
      agentId: 'agent-new', agentName: 'New Writer', connection: 'connected',
    })).rejects.toThrow('The Agent was prepared, but the Space Agent list could not be refreshed.');

    expect(screen.getByLabelText('Writer')).toHaveValue('');
    expect(screen.getByRole('dialog', { name: 'Prepare Agent for Writer' })).toBeVisible();
  });

  it('keeps the preparation target open when the authoritative member refresh fails', async () => {
    vi.mocked(collaborationApi.listMembers)
      .mockResolvedValueOnce([ownerMember])
      .mockRejectedValueOnce(new Error('offline'));
    renderWizard();
    await advanceToMapping();
    fireEvent.click(screen.getByRole('button', { name: 'Prepare first Agent' }));

    await expect(completeMockedPreparation({
      agentId: 'agent-new', agentName: 'New Writer', connection: 'connected',
    })).rejects.toThrow('offline');
    expect(screen.getByRole('dialog', { name: 'Prepare Agent for Writer' })).toBeVisible();
    expect(screen.getByLabelText('Writer')).toHaveValue('');
  });

  it('does not let an older concurrent completion map a newer preparation target', async () => {
    let resolveWriterRefresh!: (members: SpaceMemberSummary[]) => void;
    const writerRefresh = new Promise<SpaceMemberSummary[]>((resolve) => { resolveWriterRefresh = resolve; });
    const reviewerAgent = { ...preparedEditor, agentId: 'agent-reviewer', agent: { ...preparedEditor.agent, id: 'agent-reviewer', name: 'New Reviewer' } };
    vi.mocked(collaborationApi.listMembers)
      .mockResolvedValueOnce([ownerMember, activeEditor])
      .mockReturnValueOnce(writerRefresh)
      .mockResolvedValueOnce([ownerMember, activeEditor, reviewerAgent]);
    renderWizard();
    await advanceToMapping();

    fireEvent.click(screen.getByRole('button', { name: 'Prepare Agent for Writer' }));
    const writerDialog = getMockedPreparationDialog();
    const writerCompletion = writerDialog.onPrepared({ agentId: 'agent-new', agentName: 'New Writer', connection: 'connected' });
    act(() => writerDialog.onClose());
    fireEvent.click(screen.getByRole('button', { name: 'Prepare Agent for Reviewer' }));
    const reviewerDialog = getMockedPreparationDialog();

    await act(async () => {
      resolveWriterRefresh([ownerMember, preparedEditor]);
      await writerCompletion;
    });
    expect(screen.getByLabelText('Writer')).toHaveValue('');
    expect(screen.getByLabelText('Reviewer')).toHaveValue('');

    await completeMockedPreparation({
      agentId: 'agent-reviewer', agentName: 'New Reviewer', connection: 'connected',
    }, reviewerDialog);
    expect(screen.getByLabelText('Writer')).toHaveValue('');
    expect(screen.getByLabelText('Reviewer')).toHaveValue('agent-reviewer');
  });

  it('ignores a preparation refresh that settles after changing templates', async () => {
    let resolveOldRefresh!: (members: SpaceMemberSummary[]) => void;
    const oldRefresh = new Promise<SpaceMemberSummary[]>((resolve) => { resolveOldRefresh = resolve; });
    vi.mocked(collaborationApi.getTemplate)
      .mockResolvedValueOnce({ ...template, id: 'template-old', name: 'Old workflow' })
      .mockResolvedValueOnce({ ...template, id: 'template-new', name: 'New workflow' });
    vi.mocked(collaborationApi.listMembers)
      .mockResolvedValueOnce([ownerMember])
      .mockReturnValueOnce(oldRefresh)
      .mockResolvedValueOnce([ownerMember]);
    localStorage.setItem('agentwiki.language.v1', 'en');
    localStorage.setItem('user', JSON.stringify({ id: 'user-owner', platformRole: 'user' }));
    render(<AuthProvider><LanguageProvider><MemoryRouter initialEntries={['/spaces/space-1/collaboration/templates/template-old/start']}>
      <Routes><Route path="/spaces/:id/collaboration/templates/:templateId/start" element={<NavigationWizard />} /></Routes>
    </MemoryRouter></LanguageProvider></AuthProvider>);
    await advanceToMapping();
    fireEvent.click(screen.getByRole('button', { name: 'Prepare Agent for Writer' }));
    const oldDialog = getMockedPreparationDialog();
    const oldCompletion = oldDialog.onPrepared({ agentId: 'agent-new', agentName: 'New Writer', connection: 'pending' });

    fireEvent.click(screen.getByRole('button', { name: 'Open new wizard' }));
    expect(await screen.findByText('New workflow')).toBeVisible();
    await advanceToMapping();
    await act(async () => {
      resolveOldRefresh([ownerMember, preparedEditor]);
      await oldCompletion;
    });

    expect(screen.getByLabelText('Writer')).toHaveValue('');
    expect(screen.queryByText('New Writer is mapped but has not connected to this Space yet.')).not.toBeInTheDocument();
  });

  it('reloads authorization and removes every preparation mutation entry after a 403', async () => {
    vi.mocked(collaborationApi.listMembers)
      .mockResolvedValueOnce([ownerMember])
      .mockResolvedValueOnce([{ type: 'human', userId: 'user-owner', role: 'editor' }]);
    renderWizard();
    await advanceToMapping();
    fireEvent.click(screen.getByRole('button', { name: 'Prepare first Agent' }));

    await loseMockedPreparationAuthorization();

    expect(collaborationApi.listMembers).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('Ask a Space Owner or Admin to prepare an executable Agent.')).toBeVisible();
    expect(screen.queryByRole('button', { name: /Prepare/u })).not.toBeInTheDocument();
  });

  it('fails closed when the authorization-loss refresh rejects', async () => {
    vi.mocked(collaborationApi.listMembers)
      .mockResolvedValueOnce([ownerMember])
      .mockRejectedValueOnce(new Error('offline'));
    renderWizard();
    await advanceToMapping();
    fireEvent.click(screen.getByRole('button', { name: 'Prepare first Agent' }));

    await loseMockedPreparationAuthorization();

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Prepare/u })).not.toBeInTheDocument();
    expect(screen.getByText('Ask a Space Owner or Admin to prepare an executable Agent.')).toBeVisible();
  });

  it('ignores an authorization-loss refresh that settles after changing templates', async () => {
    let resolveOldAuthorization!: (members: SpaceMemberSummary[]) => void;
    const oldAuthorization = new Promise<SpaceMemberSummary[]>((resolve) => { resolveOldAuthorization = resolve; });
    vi.mocked(collaborationApi.getTemplate)
      .mockResolvedValueOnce({ ...template, id: 'template-old', name: 'Old workflow' })
      .mockResolvedValueOnce({ ...template, id: 'template-new', name: 'New workflow' });
    vi.mocked(collaborationApi.listMembers)
      .mockResolvedValueOnce([ownerMember])
      .mockReturnValueOnce(oldAuthorization)
      .mockResolvedValueOnce([ownerMember]);
    localStorage.setItem('agentwiki.language.v1', 'en');
    localStorage.setItem('user', JSON.stringify({ id: 'user-owner', platformRole: 'user' }));
    render(<AuthProvider><LanguageProvider><MemoryRouter initialEntries={['/spaces/space-1/collaboration/templates/template-old/start']}>
      <Routes><Route path="/spaces/:id/collaboration/templates/:templateId/start" element={<NavigationWizard />} /></Routes>
    </MemoryRouter></LanguageProvider></AuthProvider>);
    await advanceToMapping();
    fireEvent.click(screen.getByRole('button', { name: 'Prepare Agent for Writer' }));
    const oldDialog = getMockedPreparationDialog();
    const authorizationLoss = oldDialog.onAuthorizationLost();

    fireEvent.click(screen.getByRole('button', { name: 'Open new wizard' }));
    expect(await screen.findByText('New workflow')).toBeVisible();
    await advanceToMapping();
    await act(async () => {
      resolveOldAuthorization([{ type: 'human', userId: 'user-owner', role: 'editor' }]);
      await authorizationLoss;
    });

    expect(screen.getByRole('button', { name: 'Prepare first Agent' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Prepare Agent for Writer' })).toBeVisible();
  });

  it('keeps a per-Role-Slot pending warning in mapping and review without blocking Start', async () => {
    vi.mocked(collaborationApi.listMembers)
      .mockResolvedValueOnce([ownerMember, activeEditor])
      .mockResolvedValueOnce([ownerMember, activeEditor, preparedEditor]);
    vi.mocked(collaborationApi.updateRunDraft).mockResolvedValue({
      id: 'run-1', name: 'Release 1', status: 'draft', version: 2, inputs: { brief: 'Ship it' },
      roleBindings: [{ roleSlotId: 'writer', agentId: 'agent-new' }, { roleSlotId: 'reviewer', agentId: 'agent-editor' }], updatedAt: '2026-08-24T00:00:00Z',
    });
    vi.mocked(collaborationApi.validateRunDraft).mockResolvedValue({
      id: 'run-1', name: 'Release 1', status: 'ready', version: 3, inputs: { brief: 'Ship it' },
      roleBindings: [{ roleSlotId: 'writer', agentId: 'agent-new' }, { roleSlotId: 'reviewer', agentId: 'agent-editor' }], updatedAt: '2026-08-24T00:00:00Z',
    });
    renderWizard();
    await advanceToMapping();
    fireEvent.click(screen.getByRole('button', { name: 'Prepare Agent for Writer' }));
    await completeMockedPreparation({ agentId: 'agent-new', agentName: 'New Writer', connection: 'pending' });

    expect(screen.getByText('New Writer is mapped but has not connected to this Space yet.')).toBeVisible();
    fireEvent.change(screen.getByLabelText('Reviewer'), { target: { value: 'agent-editor' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByRole('heading', { name: '3. Review and start' });
    expect(screen.getByText('New Writer is mapped but has not connected to this Space yet.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Start run' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Start run' }));
    await waitFor(() => expect(collaborationApi.startRun).toHaveBeenCalledTimes(1));
  });

  it('cleans a pending warning when its binding changes, even if the same Agent is used in another slot', async () => {
    vi.mocked(collaborationApi.listMembers)
      .mockResolvedValueOnce([ownerMember, activeEditor])
      .mockResolvedValueOnce([ownerMember, activeEditor, preparedEditor]);
    renderWizard();
    await advanceToMapping();
    fireEvent.click(screen.getByRole('button', { name: 'Prepare Agent for Writer' }));
    await completeMockedPreparation({ agentId: 'agent-new', agentName: 'New Writer', connection: 'pending' });
    fireEvent.change(screen.getByLabelText('Reviewer'), { target: { value: 'agent-new' } });

    expect(screen.getAllByText('New Writer is mapped but has not connected to this Space yet.')).toHaveLength(1);
    fireEvent.change(screen.getByLabelText('Writer'), { target: { value: 'agent-editor' } });
    expect(screen.queryByText('New Writer is mapped but has not connected to this Space yet.')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Writer'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Writer'), { target: { value: 'agent-new' } });
    expect(screen.queryByText('New Writer is mapped but has not connected to this Space yet.')).not.toBeInTheDocument();
  });

  it('clears a pending warning after the same Role Slot completes as connected', async () => {
    vi.mocked(collaborationApi.listMembers)
      .mockResolvedValueOnce([ownerMember, activeEditor])
      .mockResolvedValue([ownerMember, activeEditor, preparedEditor]);
    renderWizard();
    await advanceToMapping();
    fireEvent.click(screen.getByRole('button', { name: 'Prepare Agent for Writer' }));
    await completeMockedPreparation({ agentId: 'agent-new', agentName: 'New Writer', connection: 'pending' });
    expect(screen.getByText('New Writer is mapped but has not connected to this Space yet.')).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Prepare Agent for Writer' }));
    await completeMockedPreparation({ agentId: 'agent-new', agentName: 'New Writer', connection: 'connected' });
    expect(screen.queryByText('New Writer is mapped but has not connected to this Space yet.')).not.toBeInTheDocument();
  });

  it('keeps an emptied required number empty instead of silently converting it to zero', async () => {
    vi.mocked(collaborationApi.getTemplate).mockResolvedValue({
      ...template,
      definition: {
        ...validDefinition,
        inputs: [{ key: 'duration', label: 'Target duration', required: true, type: 'number' }],
      },
    });

    renderWizard();
    await screen.findByRole('heading', { name: '1. Work input' });
    fireEvent.change(screen.getByLabelText('Run name'), { target: { value: 'Release 1' } });
    const duration = screen.getByLabelText('Target duration');
    fireEvent.change(duration, { target: { value: '60' } });
    fireEvent.change(duration, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    expect(await screen.findByText('Complete every required input.')).toBeVisible();
    expect(collaborationApi.createRunDraft).not.toHaveBeenCalled();
  });

  it('enforces the exact three start steps and fresh executable-Agent preflight', async () => {
    renderWizard();
    expect(await screen.findByRole('heading', { name: '1. Work input' })).toBeVisible();
    fireEvent.change(screen.getByLabelText('Run name'), { target: { value: 'Release 1' } });
    fireEvent.change(screen.getByLabelText('Work brief'), { target: { value: 'Ship it' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(collaborationApi.createRunDraft).toHaveBeenCalledWith('space-1', expect.objectContaining({
      templateId: 'template-1', name: 'Release 1', inputs: { brief: 'Ship it' }, roleBindings: [],
    })));

    expect(await screen.findByRole('heading', { name: '2. Map Agents' })).toBeVisible();
    const writer = screen.getByLabelText('Writer');
    expect(within(writer).getByRole('option', { name: 'Editor Bot' })).toBeVisible();
    expect(within(writer).queryByRole('option', { name: 'Reader Bot' })).not.toBeInTheDocument();
    expect(within(writer).queryByRole('option', { name: 'Revoked Bot' })).not.toBeInTheDocument();
    fireEvent.change(writer, { target: { value: 'agent-editor' } });
    fireEvent.change(screen.getByLabelText('Reviewer'), { target: { value: 'agent-editor' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    await waitFor(() => expect(collaborationApi.updateRunDraft).toHaveBeenCalledWith('space-1', 'run-1', expect.objectContaining({
      expectedVersion: 1,
      roleBindings: [
        { roleSlotId: 'writer', agentId: 'agent-editor' },
        { roleSlotId: 'reviewer', agentId: 'agent-editor' },
      ],
    })));
    expect(await screen.findByRole('heading', { name: '3. Review and start' })).toBeVisible();
    expect(collaborationApi.validateRunDraft).toHaveBeenCalledWith('space-1', 'run-1', 2);
  });

  it('refreshes Agent choices and returns to mapping when authorization changed', async () => {
    vi.mocked(collaborationApi.listMembers)
      .mockResolvedValueOnce([activeEditor, activeReader])
      .mockResolvedValueOnce([activeReader]);
    vi.mocked(collaborationApi.validateRunDraft).mockRejectedValueOnce({
      response: { status: 409, data: { code: 'COLLABORATION_AGENT_INACTIVE' } },
    });
    renderWizard();
    await screen.findByRole('heading', { name: '1. Work input' });
    fireEvent.change(screen.getByLabelText('Run name'), { target: { value: 'Release 1' } });
    fireEvent.change(screen.getByLabelText('Work brief'), { target: { value: 'Ship it' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByRole('heading', { name: '2. Map Agents' });
    fireEvent.change(screen.getByLabelText('Writer'), { target: { value: 'agent-editor' } });
    fireEvent.change(screen.getByLabelText('Reviewer'), { target: { value: 'agent-editor' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    expect(await screen.findByText('An assigned Agent is no longer executable. Choose current Agents and try again.')).toBeVisible();
    expect(screen.getByRole('heading', { name: '2. Map Agents' })).toBeVisible();
    expect(within(screen.getByLabelText('Writer')).queryByRole('option', { name: 'Editor Bot' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry preserved changes' })).not.toBeInTheDocument();
  });

  it('starts idempotently, merges roles into one secret-free instruction, and warns about self-review', async () => {
    renderWizard();
    await screen.findByRole('heading', { name: '1. Work input' });
    fireEvent.change(screen.getByLabelText('Run name'), { target: { value: 'Release 1' } });
    fireEvent.change(screen.getByLabelText('Work brief'), { target: { value: 'Ship it' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByRole('heading', { name: '2. Map Agents' });
    fireEvent.change(screen.getByLabelText('Writer'), { target: { value: 'agent-editor' } });
    fireEvent.change(screen.getByLabelText('Reviewer'), { target: { value: 'agent-editor' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByRole('heading', { name: '3. Review and start' });
    expect(screen.getByRole('checkbox', { name: /separation risk/u })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Start run' }));
    expect(collaborationApi.startRun).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('checkbox', { name: /separation risk/u }));
    fireEvent.click(screen.getByRole('button', { name: 'Start run' }));

    expect(await screen.findByText('This Agent fills roles that review each other.')).toBeVisible();
    expect(screen.getAllByRole('button', { name: 'Copy join instruction' })).toHaveLength(1);
    expect(screen.getByText(/wiki_collaboration_join_run/u)).toBeVisible();
    expect(document.body.textContent).not.toMatch(/credential|api[-_ ]?key|token=/iu);
    expect(collaborationApi.startRun).toHaveBeenCalledWith('space-1', 'run-1', expect.objectContaining({ expectedVersion: 3, idempotencyKey: expect.any(String) }));
  });

  it('builds one instruction per Agent for multiple Role Slots', () => {
    const instructions = buildAgentJoinInstructions({
      id: 'run-1', roleBindings: [
        { roleSlotId: 'writer', roleSlotName: 'Writer', agentId: 'agent-1' },
        { roleSlotId: 'reviewer', roleSlotName: 'Reviewer', agentId: 'agent-1' },
      ],
    });
    expect(instructions).toHaveLength(1);
    expect(instructions[0].roleSlots).toEqual(['Writer', 'Reviewer']);
    expect(instructions[0].text).toContain('wiki_collaboration_join_run');
    expect(instructions[0].text).toContain('wiki_collaboration_next_action');
    expect(instructions[0].text).not.toMatch(/(?<!wiki_)collaboration_(?:join_run|next_action)/u);
    expect(instructions[0].text).not.toMatch(/credential|api[-_ ]?key|token=/iu);
  });

  it('edits the existing ready draft when navigating back instead of creating a duplicate run', async () => {
    localStorage.setItem('agentwiki.collaboration.draft.space-1.template-1', 'run-ready');
    vi.mocked(collaborationApi.getRun).mockResolvedValue({
      id: 'run-ready', name: 'Ready release', status: 'ready', version: 3,
      inputs: { brief: 'Original brief' },
      roleBindings: [
        { roleSlotId: 'writer', agentId: 'agent-editor' },
        { roleSlotId: 'reviewer', agentId: 'agent-editor' },
      ],
      updatedAt: '2026-08-24T00:00:00Z',
    });
    renderWizard();

    expect(await screen.findByRole('heading', { name: '3. Review and start' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Go back' }));
    fireEvent.click(screen.getByRole('button', { name: 'Go back' }));
    fireEvent.change(screen.getByLabelText('Run name'), { target: { value: 'Revised release' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    await waitFor(() => expect(collaborationApi.updateRunDraft).toHaveBeenCalledWith(
      'space-1', 'run-ready', expect.objectContaining({ expectedVersion: 3, name: 'Revised release' }),
    ));
    expect(collaborationApi.createRunDraft).not.toHaveBeenCalled();
  });

  it('loads bounded draft details when the main Run summary omits inputs', async () => {
    localStorage.setItem('agentwiki.collaboration.draft.space-1.template-1', 'run-ready');
    vi.mocked(collaborationApi.getRun).mockResolvedValue({
      id: 'run-ready', name: 'Ready release', status: 'ready', version: 3,
      roleBindings: [], updatedAt: '2026-08-24T00:00:00Z',
    });
    vi.mocked(collaborationApi.getRunDraftDetails).mockResolvedValue({
      id: 'run-ready', name: 'Ready release', status: 'ready', version: 3,
      inputs: { brief: 'Recovered brief' }, roleBindings: [], updatedAt: '2026-08-24T00:00:00Z',
    });

    renderWizard();
    expect(await screen.findByRole('heading', { name: '3. Review and start' })).toBeVisible();
    expect(collaborationApi.getRunDraftDetails).toHaveBeenCalledWith('space-1', 'run-ready');
  });

  it('reloads the authoritative version before retrying preserved mapping changes', async () => {
    vi.mocked(collaborationApi.updateRunDraft)
      .mockRejectedValueOnce({ response: { status: 409, data: { code: 'COLLABORATION_RUN_VERSION_CONFLICT' } } })
      .mockResolvedValueOnce({
        id: 'run-1', name: 'Release 1', status: 'draft', version: 3, inputs: { brief: 'Ship it' },
        roleBindings: [{ roleSlotId: 'writer', agentId: 'agent-editor' }, { roleSlotId: 'reviewer', agentId: 'agent-editor' }],
        updatedAt: '2026-08-24T00:01:00Z',
      });
    vi.mocked(collaborationApi.getRun).mockResolvedValue({
      id: 'run-1', name: 'Release 1', status: 'draft', version: 2, inputs: { brief: 'Ship it' },
      roleBindings: [], updatedAt: '2026-08-24T00:01:00Z',
    });
    renderWizard();
    await screen.findByRole('heading', { name: '1. Work input' });
    fireEvent.change(screen.getByLabelText('Run name'), { target: { value: 'Release 1' } });
    fireEvent.change(screen.getByLabelText('Work brief'), { target: { value: 'Ship it' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByRole('heading', { name: '2. Map Agents' });
    fireEvent.change(screen.getByLabelText('Writer'), { target: { value: 'agent-editor' } });
    fireEvent.change(screen.getByLabelText('Reviewer'), { target: { value: 'agent-editor' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    fireEvent.click(await screen.findByRole('button', { name: 'Retry preserved changes' }));
    await waitFor(() => expect(collaborationApi.updateRunDraft).toHaveBeenLastCalledWith(
      'space-1', 'run-1', {
        expectedVersion: 2,
        roleBindings: [
          { roleSlotId: 'writer', agentId: 'agent-editor' },
          { roleSlotId: 'reviewer', agentId: 'agent-editor' },
        ],
      },
    ));
    expect(collaborationApi.getRun).toHaveBeenCalledWith('space-1', 'run-1');
  });

  it('preserves a pending warning while rebasing the same local mapping after a conflict', async () => {
    vi.mocked(collaborationApi.listMembers)
      .mockResolvedValueOnce([ownerMember, activeEditor])
      .mockResolvedValueOnce([ownerMember, activeEditor, preparedEditor]);
    vi.mocked(collaborationApi.updateRunDraft)
      .mockRejectedValueOnce({ response: { status: 409, data: { code: 'COLLABORATION_RUN_VERSION_CONFLICT' } } })
      .mockResolvedValueOnce({
        id: 'run-1', name: 'Release 1', status: 'draft', version: 3, inputs: { brief: 'Ship it' },
        roleBindings: [{ roleSlotId: 'writer', agentId: 'agent-new' }, { roleSlotId: 'reviewer', agentId: 'agent-editor' }],
        updatedAt: '2026-08-24T00:01:00Z',
      });
    vi.mocked(collaborationApi.getRun).mockResolvedValue({
      id: 'run-1', name: 'Release 1', status: 'draft', version: 2, inputs: { brief: 'Ship it' },
      roleBindings: [], updatedAt: '2026-08-24T00:01:00Z',
    });
    vi.mocked(collaborationApi.validateRunDraft).mockResolvedValue({
      id: 'run-1', name: 'Release 1', status: 'ready', version: 4, inputs: { brief: 'Ship it' },
      roleBindings: [{ roleSlotId: 'writer', agentId: 'agent-new' }, { roleSlotId: 'reviewer', agentId: 'agent-editor' }],
      updatedAt: '2026-08-24T00:02:00Z',
    });
    renderWizard();
    await advanceToMapping();
    fireEvent.click(screen.getByRole('button', { name: 'Prepare Agent for Writer' }));
    await completeMockedPreparation({ agentId: 'agent-new', agentName: 'New Writer', connection: 'pending' });
    fireEvent.change(screen.getByLabelText('Reviewer'), { target: { value: 'agent-editor' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    fireEvent.click(await screen.findByRole('button', { name: 'Retry preserved changes' }));

    await screen.findByRole('heading', { name: '3. Review and start' });
    expect(screen.getByText('New Writer is mapped but has not connected to this Space yet.')).toBeVisible();
  });

  it('reloads the authoritative version before retrying preserved input changes', async () => {
    localStorage.setItem('agentwiki.collaboration.draft.space-1.template-1', 'run-1');
    vi.mocked(collaborationApi.getRun)
      .mockResolvedValueOnce({
        id: 'run-1', name: 'Original', status: 'draft', version: 1,
        inputs: { brief: 'Original brief' }, roleBindings: [], updatedAt: '2026-08-24T00:00:00Z',
      })
      .mockResolvedValueOnce({
        id: 'run-1', name: 'Remote edit', status: 'draft', version: 5,
        inputs: { brief: 'Remote brief' }, roleBindings: [], updatedAt: '2026-08-24T00:01:00Z',
      });
    vi.mocked(collaborationApi.updateRunDraft)
      .mockRejectedValueOnce({ response: { status: 409, data: { code: 'COLLABORATION_RUN_VERSION_CONFLICT' } } })
      .mockResolvedValueOnce({
        id: 'run-1', name: 'Preserved local edit', status: 'draft', version: 6,
        inputs: { brief: 'Preserved local brief' }, roleBindings: [], updatedAt: '2026-08-24T00:02:00Z',
      });
    renderWizard();
    await screen.findByRole('heading', { name: '2. Map Agents' });
    fireEvent.click(screen.getByRole('button', { name: 'Go back' }));
    fireEvent.change(screen.getByLabelText('Run name'), { target: { value: 'Preserved local edit' } });
    fireEvent.change(screen.getByLabelText('Work brief'), { target: { value: 'Preserved local brief' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Retry preserved changes' }));

    await waitFor(() => expect(collaborationApi.updateRunDraft).toHaveBeenLastCalledWith('space-1', 'run-1', {
      expectedVersion: 5,
      name: 'Preserved local edit',
      inputs: { brief: 'Preserved local brief' },
    }));
  });

  it('reloads the authoritative version before retrying the same start intent', async () => {
    localStorage.setItem('agentwiki.collaboration.draft.space-1.template-1', 'run-ready');
    const readyRun = {
      id: 'run-ready', name: 'Ready release', status: 'ready' as const, version: 3,
      inputs: { brief: 'Ship it' },
      roleBindings: [
        { roleSlotId: 'writer', agentId: 'agent-editor' },
        { roleSlotId: 'reviewer', agentId: 'agent-editor' },
      ],
      updatedAt: '2026-08-24T00:00:00Z',
    };
    vi.mocked(collaborationApi.getRun)
      .mockResolvedValueOnce(readyRun)
      .mockResolvedValueOnce({ ...readyRun, version: 4, updatedAt: '2026-08-24T00:01:00Z' });
    vi.mocked(collaborationApi.startRun)
      .mockRejectedValueOnce({ response: { status: 409, data: { code: 'COLLABORATION_RUN_VERSION_CONFLICT' } } })
      .mockResolvedValueOnce({ ...readyRun, status: 'running', version: 5 });
    renderWizard();
    await screen.findByRole('heading', { name: '3. Review and start' });
    confirmSelfReviewIfRequired();
    fireEvent.click(screen.getByRole('button', { name: 'Start run' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Retry preserved changes' }));

    await waitFor(() => expect(collaborationApi.startRun).toHaveBeenCalledTimes(2));
    const firstStart = vi.mocked(collaborationApi.startRun).mock.calls[0];
    const retriedStart = vi.mocked(collaborationApi.startRun).mock.calls[1];
    expect(retriedStart).toEqual([
      'space-1', 'run-ready',
      { expectedVersion: 4, idempotencyKey: firstStart[2].idempotencyKey },
    ]);
  });

  it('requires self-review confirmation when a conflict refresh introduces repeated Agent bindings', async () => {
    localStorage.setItem('agentwiki.collaboration.draft.space-1.template-1', 'run-ready');
    const initialRun = {
      id: 'run-ready', name: 'Ready release', status: 'ready' as const, version: 3,
      inputs: { brief: 'Ship it' },
      roleBindings: [
        { roleSlotId: 'writer', agentId: 'agent-editor' },
        { roleSlotId: 'reviewer', agentId: 'agent-second' },
      ],
      updatedAt: '2026-08-24T00:00:00Z',
    };
    const latestRun = {
      ...initialRun,
      version: 4,
      roleBindings: [
        { roleSlotId: 'writer', agentId: 'agent-editor' },
        { roleSlotId: 'reviewer', agentId: 'agent-editor' },
      ],
      updatedAt: '2026-08-24T00:01:00Z',
    };
    vi.mocked(collaborationApi.getRun)
      .mockResolvedValueOnce(initialRun)
      .mockResolvedValueOnce(latestRun);
    vi.mocked(collaborationApi.startRun)
      .mockRejectedValueOnce({ response: { status: 409, data: { code: 'COLLABORATION_RUN_VERSION_CONFLICT' } } });

    renderWizard();
    await screen.findByRole('heading', { name: '3. Review and start' });
    expect(screen.queryByRole('checkbox', { name: /separation risk/u })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Start run' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Retry preserved changes' }));

    expect(await screen.findByRole('checkbox', { name: /separation risk/u })).toBeVisible();
    expect(collaborationApi.startRun).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('checkbox', { name: /separation risk/u }));
    fireEvent.click(screen.getByRole('button', { name: 'Start run' }));
    await waitFor(() => expect(collaborationApi.startRun).toHaveBeenCalledTimes(2));
  });

  it('reapplies the complete preserved draft before validating and retrying start', async () => {
    localStorage.setItem('agentwiki.collaboration.draft.space-1.template-1', 'run-ready');
    const readyRun = {
      id: 'run-ready', name: 'Preserved release', status: 'ready' as const, version: 3,
      inputs: { brief: 'Preserved brief' },
      roleBindings: [
        { roleSlotId: 'writer', agentId: 'agent-editor' },
        { roleSlotId: 'reviewer', agentId: 'agent-editor' },
      ],
      updatedAt: '2026-08-24T00:00:00Z',
    };
    const rebasedDraft = { ...readyRun, status: 'draft' as const, version: 5 };
    const revalidated = { ...readyRun, version: 6 };
    vi.mocked(collaborationApi.getRun)
      .mockResolvedValueOnce(readyRun)
      .mockResolvedValueOnce({ ...readyRun, name: 'Remote edit', status: 'draft', version: 4 });
    vi.mocked(collaborationApi.startRun)
      .mockRejectedValueOnce({ response: { status: 409, data: { code: 'COLLABORATION_RUN_VERSION_CONFLICT' } } })
      .mockResolvedValueOnce({ ...readyRun, status: 'running', version: 7 });
    vi.mocked(collaborationApi.updateRunDraft).mockResolvedValueOnce(rebasedDraft);
    vi.mocked(collaborationApi.validateRunDraft).mockResolvedValueOnce(revalidated);

    renderWizard();
    await screen.findByRole('heading', { name: '3. Review and start' });
    confirmSelfReviewIfRequired();
    fireEvent.click(screen.getByRole('button', { name: 'Start run' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Retry preserved changes' }));

    await waitFor(() => expect(collaborationApi.startRun).toHaveBeenCalledTimes(2));
    expect(collaborationApi.updateRunDraft).toHaveBeenCalledWith('space-1', 'run-ready', {
      expectedVersion: 4,
      name: 'Preserved release',
      inputs: { brief: 'Preserved brief' },
      roleBindings: [
        { roleSlotId: 'writer', agentId: 'agent-editor' },
        { roleSlotId: 'reviewer', agentId: 'agent-editor' },
      ],
    });
    expect(collaborationApi.validateRunDraft).toHaveBeenCalledWith('space-1', 'run-ready', 5);
    const firstStart = vi.mocked(collaborationApi.startRun).mock.calls[0];
    expect(vi.mocked(collaborationApi.startRun).mock.calls[1]).toEqual([
      'space-1', 'run-ready',
      { expectedVersion: 6, idempotencyKey: firstStart[2].idempotencyKey },
    ]);
    expect(vi.mocked(collaborationApi.updateRunDraft).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(collaborationApi.validateRunDraft).mock.invocationCallOrder[0]);
    expect(vi.mocked(collaborationApi.validateRunDraft).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(collaborationApi.startRun).mock.invocationCallOrder[1]);
  });

  it('clears submitting when preserved input retry fails local required validation', async () => {
    localStorage.setItem('agentwiki.collaboration.draft.space-1.template-1', 'run-1');
    vi.mocked(collaborationApi.getRun)
      .mockResolvedValueOnce({
        id: 'run-1', name: 'Original', status: 'draft', version: 1,
        inputs: { brief: 'Original brief' }, roleBindings: [], updatedAt: '2026-08-24T00:00:00Z',
      })
      .mockResolvedValueOnce({
        id: 'run-1', name: 'Remote', status: 'draft', version: 2,
        inputs: { brief: 'Remote brief' }, roleBindings: [], updatedAt: '2026-08-24T00:01:00Z',
      });
    vi.mocked(collaborationApi.updateRunDraft).mockRejectedValueOnce({ response: { status: 409, data: { code: 'COLLABORATION_RUN_VERSION_CONFLICT' } } });
    renderWizard();
    await screen.findByRole('heading', { name: '2. Map Agents' });
    fireEvent.click(screen.getByRole('button', { name: 'Go back' }));
    fireEvent.change(screen.getByLabelText('Work brief'), { target: { value: 'Initially valid' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    const retry = await screen.findByRole('button', { name: 'Retry preserved changes' });
    fireEvent.change(screen.getByLabelText('Work brief'), { target: { value: '' } });
    fireEvent.click(retry);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled());
  });

  it('clears submitting when preserved mapping retry fails local required validation', async () => {
    vi.mocked(collaborationApi.updateRunDraft).mockRejectedValueOnce({ response: { status: 409, data: { code: 'COLLABORATION_RUN_VERSION_CONFLICT' } } });
    vi.mocked(collaborationApi.getRun).mockResolvedValueOnce({
      id: 'run-1', name: 'Release 1', status: 'draft', version: 2,
      inputs: { brief: 'Ship it' }, roleBindings: [], updatedAt: '2026-08-24T00:01:00Z',
    });
    renderWizard();
    await screen.findByRole('heading', { name: '1. Work input' });
    fireEvent.change(screen.getByLabelText('Run name'), { target: { value: 'Release 1' } });
    fireEvent.change(screen.getByLabelText('Work brief'), { target: { value: 'Ship it' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByRole('heading', { name: '2. Map Agents' });
    fireEvent.change(screen.getByLabelText('Writer'), { target: { value: 'agent-editor' } });
    fireEvent.change(screen.getByLabelText('Reviewer'), { target: { value: 'agent-editor' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    const retry = await screen.findByRole('button', { name: 'Retry preserved changes' });
    fireEvent.change(screen.getByLabelText('Writer'), { target: { value: '' } });
    fireEvent.click(retry);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled());
  });
});
