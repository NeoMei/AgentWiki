import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../context/LanguageContext';
import { collaborationApi } from './api';
import { RunStartWizard, buildAgentJoinInstructions } from './RunStartWizard';
import { validDefinition } from './collaboration-test-fixtures';
import type { TemplateDetail } from './types';

vi.mock('./api', () => ({ collaborationApi: {
  getTemplate: vi.fn(), listMembers: vi.fn(), createRunDraft: vi.fn(), updateRunDraft: vi.fn(),
  validateRunDraft: vi.fn(), startRun: vi.fn(), getRun: vi.fn(), getRunDraftDetails: vi.fn(),
} }));

const template: TemplateDetail = {
  id: 'template-1', spaceId: 'space-1', slug: 'custom', name: 'Custom workflow', description: '',
  system: false, version: 1, definition: validDefinition,
};
const activeEditor = { type: 'agent' as const, agentId: 'agent-editor', role: 'editor', agent: { id: 'agent-editor', name: 'Editor Bot', status: 'active', revokedAt: null } };
const activeReader = { type: 'agent' as const, agentId: 'agent-reader', role: 'reader', agent: { id: 'agent-reader', name: 'Reader Bot', status: 'active', revokedAt: null } };
const revokedAgent = { type: 'agent' as const, agentId: 'agent-revoked', role: 'publisher', agent: { id: 'agent-revoked', name: 'Revoked Bot', status: 'inactive', revokedAt: '2026-08-24T00:00:00Z' } };

function renderWizard() {
  localStorage.setItem('agentwiki.language.v1', 'en');
  return render(<LanguageProvider><MemoryRouter initialEntries={['/spaces/space-1/collaboration/templates/template-1/start']}>
    <Routes><Route path="/spaces/:id/collaboration/templates/:templateId/start" element={<RunStartWizard />} /></Routes>
  </MemoryRouter></LanguageProvider>);
}

describe('RunStartWizard', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    vi.mocked(collaborationApi.getTemplate).mockResolvedValue(template);
    vi.mocked(collaborationApi.listMembers).mockResolvedValue([activeEditor, activeReader, revokedAgent]);
    vi.mocked(collaborationApi.createRunDraft).mockResolvedValue({
      id: 'run-1', name: 'Release 1', status: 'draft', version: 1, inputs: { brief: 'Ship it' }, roleBindings: [], updatedAt: '2026-08-24T00:00:00Z',
    });
    vi.mocked(collaborationApi.updateRunDraft).mockResolvedValue({
      id: 'run-1', name: 'Release 1', status: 'draft', version: 2, inputs: { brief: 'Ship it' },
      roleBindings: [{ roleSlotId: 'writer', agentId: 'agent-editor' }, { roleSlotId: 'reviewer', agentId: 'agent-editor' }], updatedAt: '2026-08-24T00:00:00Z',
    });
    vi.mocked(collaborationApi.validateRunDraft).mockResolvedValue({
      id: 'run-1', name: 'Release 1', status: 'ready', version: 3, inputs: { brief: 'Ship it' }, roleBindings: [], updatedAt: '2026-08-24T00:00:00Z',
    });
    vi.mocked(collaborationApi.startRun).mockResolvedValue({
      id: 'run-1', name: 'Release 1', status: 'running', version: 4, inputs: { brief: 'Ship it' }, updatedAt: '2026-08-24T00:00:00Z',
      roleBindings: [
        { roleSlotId: 'writer', roleSlotName: 'Writer', agentId: 'agent-editor' },
        { roleSlotId: 'reviewer', roleSlotName: 'Reviewer', agentId: 'agent-editor' },
      ],
    });
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
      .mockRejectedValueOnce({ response: { status: 409 } })
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
      .mockRejectedValueOnce({ response: { status: 409 } })
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
      .mockRejectedValueOnce({ response: { status: 409 } })
      .mockResolvedValueOnce({ ...readyRun, status: 'running', version: 5 });
    renderWizard();
    await screen.findByRole('heading', { name: '3. Review and start' });
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
      .mockRejectedValueOnce({ response: { status: 409 } })
      .mockResolvedValueOnce({ ...readyRun, status: 'running', version: 7 });
    vi.mocked(collaborationApi.updateRunDraft).mockResolvedValueOnce(rebasedDraft);
    vi.mocked(collaborationApi.validateRunDraft).mockResolvedValueOnce(revalidated);

    renderWizard();
    await screen.findByRole('heading', { name: '3. Review and start' });
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
    vi.mocked(collaborationApi.updateRunDraft).mockRejectedValueOnce({ response: { status: 409 } });
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
    vi.mocked(collaborationApi.updateRunDraft).mockRejectedValueOnce({ response: { status: 409 } });
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
