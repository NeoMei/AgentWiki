import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../context/LanguageContext';
import { useAuth } from '../../context/AuthContext';
import { collaborationApi } from './api';
import { CollaborationWorkspace } from './CollaborationWorkspace';

vi.mock('../../context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('./api', () => ({
  collaborationApi: {
    listTemplates: vi.fn(), copyTemplate: vi.fn(), archiveTemplate: vi.fn(),
    listRuns: vi.fn(), listMembers: vi.fn(),
  },
}));

const systemCodingTemplate = {
  id: 'system-coding', spaceId: null, slug: 'coding', name: '编码协作 / Coding collaboration',
  description: '从需求分析到发布 / From requirements to release', system: true, version: 1,
};
const spaceTemplate = {
  id: 'space-template', spaceId: 'space-1', slug: 'backend-release', name: 'Backend release',
  description: 'Release workflow', system: false, version: 2,
};

function renderWorkspace(language: 'en' | 'zh-CN' = 'en') {
  localStorage.setItem('agentwiki.language.v1', language);
  return render(
    <LanguageProvider>
      <MemoryRouter initialEntries={['/spaces/space-1/collaboration']}>
        <Routes>
          <Route path="/spaces/:id/collaboration" element={<CollaborationWorkspace />} />
        </Routes>
      </MemoryRouter>
    </LanguageProvider>,
  );
}

describe('CollaborationWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuth).mockReturnValue({ user: { id: 'owner-1' } } as ReturnType<typeof useAuth>);
    vi.mocked(collaborationApi.listTemplates).mockResolvedValue([systemCodingTemplate, spaceTemplate]);
    vi.mocked(collaborationApi.listMembers).mockResolvedValue([
      { type: 'human', userId: 'owner-1', role: 'owner' },
    ]);
    vi.mocked(collaborationApi.listRuns).mockResolvedValue([]);
  });

  it('shows system and Space templates and copies a system template', async () => {
    vi.mocked(collaborationApi.copyTemplate).mockResolvedValue({ ...spaceTemplate, id: 'copy-1' });
    renderWorkspace();

    expect(await screen.findByText('Coding collaboration')).toBeVisible();
    expect(screen.getByText('Backend release')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Copy as my template' }));
    fireEvent.change(screen.getByLabelText('Template name'), { target: { value: 'Backend release copy' } });
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));

    await waitFor(() => expect(collaborationApi.copyTemplate).toHaveBeenCalledWith(
      'space-1', 'system-coding', 'Backend release copy',
    ));
    expect(await screen.findByRole('status')).toHaveTextContent('Template copied');
  });

  it('keeps ingest Runs distinct and places Collaboration between Runs and Members', async () => {
    renderWorkspace();
    await screen.findByText('Coding collaboration');
    const links = screen.getAllByRole('link');
    const labels = links.map((link) => link.textContent?.trim());
    expect(labels.indexOf('Runs')).toBeLessThan(labels.indexOf('Collaboration'));
    expect(labels.indexOf('Collaboration')).toBeLessThan(labels.indexOf('Members'));
    expect(screen.getByRole('link', { name: 'Runs' })).toHaveAttribute('href', '/spaces/space-1/runs');
    expect(screen.getByRole('link', { name: 'Collaboration' })).toHaveAttribute('aria-current', 'page');
  });

  it('shows active and history runs on separate tabs', async () => {
    vi.mocked(collaborationApi.listRuns)
      .mockResolvedValueOnce([{ id: 'active-1', name: 'Active release', status: 'running', updatedAt: '2026-08-24T00:00:00Z' }])
      .mockResolvedValueOnce([{ id: 'done-1', name: 'Finished release', status: 'completed', updatedAt: '2026-08-23T00:00:00Z' }]);
    renderWorkspace();
    await screen.findByText('Coding collaboration');

    fireEvent.click(screen.getByRole('tab', { name: 'Active runs' }));
    expect(await screen.findByText('Active release')).toBeVisible();
    expect(collaborationApi.listRuns).toHaveBeenCalledWith('space-1', 'active');
    fireEvent.click(screen.getByRole('tab', { name: 'History' }));
    expect(await screen.findByText('Finished release')).toBeVisible();
    expect(collaborationApi.listRuns).toHaveBeenCalledWith('space-1', 'history');
  });

  it('renders loading, empty, error, permissions, and Chinese copy', async () => {
    let release!: (value: typeof systemCodingTemplate[]) => void;
    vi.mocked(collaborationApi.listTemplates).mockReturnValue(new Promise((resolve) => { release = resolve; }));
    const view = renderWorkspace('zh-CN');
    expect(screen.getByTestId('collaboration-loading')).toBeVisible();
    release([]);
    expect(await screen.findByTestId('collaboration-empty')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Agent 协作' })).toBeVisible();
    view.unmount();

    vi.mocked(useAuth).mockReturnValue({ user: { id: 'viewer-1' } } as ReturnType<typeof useAuth>);
    vi.mocked(collaborationApi.listMembers).mockResolvedValue([
      { type: 'human', userId: 'viewer-1', role: 'viewer' },
    ]);
    vi.mocked(collaborationApi.listTemplates).mockResolvedValue([systemCodingTemplate, spaceTemplate]);
    renderWorkspace();
    await screen.findByText('Coding collaboration');
    expect(screen.queryByRole('button', { name: 'Copy as my template' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Archive' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Start run' })).not.toBeInTheDocument();
  });

  it('renders a recoverable error state', async () => {
    vi.mocked(collaborationApi.listTemplates).mockRejectedValue(new Error('offline'));
    renderWorkspace();
    expect(await screen.findByTestId('collaboration-error')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeVisible();
  });

  it.each(['owner', 'admin', 'editor'] as const)('shows Start run to a human %s', async (role) => {
    vi.mocked(useAuth).mockReturnValue({ user: { id: `${role}-1` } } as ReturnType<typeof useAuth>);
    vi.mocked(collaborationApi.listMembers).mockResolvedValue([
      { type: 'human', userId: `${role}-1`, role },
    ]);
    renderWorkspace();

    const startLinks = await screen.findAllByRole('link', { name: 'Start run' });
    expect(startLinks).toHaveLength(2);
    startLinks.forEach((link) => expect(link).toBeVisible());
  });
});
