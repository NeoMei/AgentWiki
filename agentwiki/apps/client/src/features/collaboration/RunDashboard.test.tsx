import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../context/LanguageContext';
import { useAuth } from '../../context/AuthContext';
import { collaborationApi } from './api';
import { RunDashboard } from './RunDashboard';

const socketHandlers = new Map<string, (...args: any[]) => void>();
const managerHandlers = new Map<string, (...args: any[]) => void>();
const socket = {
  on: vi.fn((event: string, handler: (...args: any[]) => void) => { socketHandlers.set(event, handler); return socket; }),
  off: vi.fn(), emit: vi.fn(), connect: vi.fn(), disconnect: vi.fn(),
  io: { on: vi.fn((event: string, handler: (...args: any[]) => void) => { managerHandlers.set(event, handler); }), off: vi.fn() },
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => { resolve = nextResolve; });
  return { promise, resolve };
}
vi.mock('socket.io-client', () => ({ io: vi.fn(() => socket) }));
vi.mock('../../context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('./api', () => ({ collaborationApi: {
  getTemplate: vi.fn(), getRun: vi.fn(), listMembers: vi.fn(), pauseRun: vi.fn(), resumeRun: vi.fn(), failRun: vi.fn(),
  cancelRun: vi.fn(), retryTask: vi.fn(), reassignTask: vi.fn(), skipTask: vi.fn(), decideReview: vi.fn(),
  getRunHistory: vi.fn(), getArtifact: vi.fn(),
  getPageReviewComparison: vi.fn(), resolvePageConflict: vi.fn(),
} }));

const runningRun = {
  id: 'run-1', name: 'Release run', spaceId: 'space-1', templateId: 'template-1', templateVersion: 1,
  snapshotHash: 'a'.repeat(64), status: 'running' as const, version: 4,
  startedById: 'starter-1', eventSequence: 8,
  createdAt: '2026-08-24T00:00:00Z', updatedAt: '2026-08-24T00:10:00Z', startedAt: '2026-08-24T00:01:00Z', finishedAt: null,
  roleBindings: [{ roleSlotId: 'writer', roleSlotName: 'Writer', agentId: 'agent-1' }],
  tasks: [{
    id: 'task-1', nodeId: 'draft', ordinal: 0, name: 'Draft', objectivePreview: 'Draft release preview', roleSlotId: 'writer', assigneeAgentId: 'agent-1',
    status: 'running', generation: 2, skippable: false, completedAt: null,
    todoCounts: { total: 50, pending: 47, doing: 1, done: 2, failed: 0 },
    todos: [
      { id: 'todo-1', ordinal: 0, name: 'Inspect', status: 'done', required: true, generation: 2 },
      { id: 'todo-2', ordinal: 1, name: 'Implement', status: 'doing', required: true, generation: 2 },
      { id: 'todo-3', ordinal: 2, name: 'Test', status: 'pending', required: true, generation: 2 },
    ],
    attempts: [{ id: 'attempt-1', status: 'running', leaseExpiresAt: '2026-08-24T00:20:00Z', attemptNumber: 1, agentId: 'agent-1' }],
    artifacts: [{ id: 'artifact-1', version: 2, kind: 'external_reference', status: 'accepted', preview: 'artifact-v2 preview', createdAt: '2026-08-24T00:09:00Z' }],
  }],
  reviews: [],
  events: [{ id: 'event-1', sequence: 8, type: 'todo_updated', actorKind: 'agent', operation: 'update_todo', target: 'todo-2', createdAt: '2026-08-24T00:08:00Z' }],
  joinInstructions: [],
};

const waitingReviewRun = {
  ...runningRun, status: 'waiting_review' as const,
  reviews: [{ id: 'review-1', nodeId: 'human-review', status: 'pending', minimumRole: 'editor', reviewerUserIds: ['reviewer-1'], canDecide: true, allowTerminate: true, revisionTaskId: 'task-1', sourceTaskId: 'task-1', artifactId: 'artifact-1', approvalCriteria: ['Tests pass', 'Evidence is complete'], createdAt: '2026-08-24T00:10:00Z' }],
};

function renderDashboard(run: any = runningRun, role: 'owner' | 'admin' | 'editor' | 'viewer' = 'editor', userId = 'reviewer-1') {
  vi.mocked(useAuth).mockReturnValue({ user: { id: userId } } as ReturnType<typeof useAuth>);
  vi.mocked(collaborationApi.getRun).mockResolvedValue(run as any);
  vi.mocked(collaborationApi.listMembers).mockResolvedValue([{ type: 'human', userId, role }]);
  localStorage.setItem('agentwiki.language.v1', 'en');
  return render(<LanguageProvider><MemoryRouter initialEntries={['/spaces/space-1/collaboration/runs/run-1']}>
    <Routes><Route path="/spaces/:id/collaboration/runs/:runId" element={<RunDashboard />} /></Routes>
  </MemoryRouter></LanguageProvider>);
}

function renderSuperAdminDashboard(run: any = waitingReviewRun) {
  vi.mocked(useAuth).mockReturnValue({
    user: { id: 'platform-admin', platformRole: 'super_admin' },
  } as ReturnType<typeof useAuth>);
  vi.mocked(collaborationApi.getRun).mockResolvedValue(run as any);
  vi.mocked(collaborationApi.listMembers).mockResolvedValue([]);
  localStorage.setItem('agentwiki.language.v1', 'en');
  return render(<LanguageProvider><MemoryRouter initialEntries={['/spaces/space-1/collaboration/runs/run-1']}>
    <Routes><Route path="/spaces/:id/collaboration/runs/:runId" element={<RunDashboard />} /></Routes>
  </MemoryRouter></LanguageProvider>);
}

function NavigationDashboard() {
  const navigate = useNavigate();
  return <><button type="button" onClick={() => navigate('/spaces/space-new/collaboration/runs/run-new')}>Open new run</button><RunDashboard /></>;
}

describe('RunDashboard', () => {
  beforeEach(() => {
    vi.mocked(collaborationApi.getTemplate).mockRejectedValue(new Error('Template unavailable'));
    vi.clearAllMocks();
    socketHandlers.clear();
    managerHandlers.clear();
    vi.mocked(collaborationApi.getArtifact).mockResolvedValue({
      id: 'artifact-1', taskId: 'task-1', generation: 2, version: 2, kind: 'markdown', status: 'pending',
      payload: { markdown: '# Release evidence\nAll checks passed.' }, evidence: [{ kind: 'test', reference: 'client:293' }],
      createdAt: '2026-08-24T00:09:00Z',
    });
    vi.mocked(collaborationApi.getPageReviewComparison).mockResolvedValue({
      mode: 'candidate', reviewId: 'review-1', artifactId: 'artifact-1', canDecide: true,
      target: { pageId: 'page-1', title: 'Release page' },
      baseline: { pageVersionId: 'version-1', updatedAt: '2026-08-24T00:00:00Z', contentHash: 'a'.repeat(64), available: true, title: 'Release page', markdown: '# Baseline' },
      candidate: { changeSetId: 'change-1', changeSetStatus: 'pending_review', markdown: '# Proposed', evidence: {} },
      current: { pageVersionId: 'version-1', updatedAt: '2026-08-24T00:00:00Z', contentHash: 'a'.repeat(64), markdown: '# Baseline' },
      conflict: false,
    } as any);
    vi.mocked(collaborationApi.getRunHistory).mockResolvedValue({
      items: [{
        id: 'artifact-1', taskId: 'task-1', generation: 2, version: 2, kind: 'markdown', status: 'pending',
        payload: { markdown: '# Release evidence\nAll checks passed.' }, evidence: [{ kind: 'test', reference: 'client:293' }],
        createdAt: '2026-08-24T00:09:00Z',
      }],
      nextCursor: null,
    });
  });

  it.each(['running', 'waiting_review'] as const)('retrieves fresh instructions on reentry to a %s run without a mutation', async (status) => {
    renderDashboard({ ...runningRun, status }, 'owner', 'owner-1');
    const get = await screen.findByRole('button', { name: 'Get continuation instructions' });
    vi.mocked(collaborationApi.getRun).mockResolvedValueOnce({
      ...runningRun, status, version: 5, eventSequence: 9,
      roleBindings: [{ roleSlotId: 'writer', roleSlotName: 'Frozen writer', agentId: 'agent-current' }, { roleSlotId: 'reviewer', roleSlotName: 'Frozen reviewer', agentId: 'agent-current' }],
      joinInstructions: [{ agentId: 'agent-current', roleSlotIds: ['writer', 'reviewer'], taskIds: ['task-current'] }],
    } as any);
    fireEvent.click(get);
    const instruction = await screen.findByText(/Roles: Frozen writer, Frozen reviewer/u);
    expect(instruction).toHaveTextContent('wiki_collaboration_join_run');
    expect(instruction).toHaveTextContent('wiki_collaboration_next_action');
    expect(screen.getAllByRole('button', { name: 'Copy resume instruction' })).toHaveLength(1);
    expect(collaborationApi.getRun).toHaveBeenCalledTimes(2);
    expect(collaborationApi.listMembers).toHaveBeenCalledTimes(2);
    expect(collaborationApi.resumeRun).not.toHaveBeenCalled();
    expect(instruction.textContent).not.toMatch(/credential|api[-_ ]?key|token=/iu);
  });

  it('requires real membership even for the original starter or a platform admin', async () => {
    renderSuperAdminDashboard({ ...runningRun, startedById: 'platform-admin' });
    await screen.findByLabelText('Running status');
    expect(screen.queryByRole('button', { name: 'Get continuation instructions' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pause run' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reassign task' })).not.toBeInTheDocument();
  });

  it('discards instructions if membership is revoked during retrieval', async () => {
    renderDashboard(runningRun, 'owner', 'owner-1');
    const get = await screen.findByRole('button', { name: 'Get continuation instructions' });
    vi.mocked(collaborationApi.listMembers).mockResolvedValueOnce([]);
    vi.mocked(collaborationApi.getRun).mockResolvedValueOnce({ ...runningRun, joinInstructions: [{ agentId: 'agent-1', roleSlotIds: ['writer'], taskIds: ['task-1'] }] } as any);
    fireEvent.click(get);
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not retrieve continuation instructions');
    expect(screen.queryByText(/wiki_collaboration_join_run/u)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pause run' })).not.toBeInTheDocument();
  });

  it('discards a retrieval response when the run becomes terminal', async () => {
    renderDashboard(runningRun, 'owner', 'owner-1');
    const get = await screen.findByRole('button', { name: 'Get continuation instructions' });
    vi.mocked(collaborationApi.getRun).mockResolvedValueOnce({ ...runningRun, status: 'completed', joinInstructions: [{ agentId: 'agent-1', roleSlotIds: ['writer'], taskIds: ['task-1'] }] } as any);
    fireEvent.click(get);
    expect(await screen.findByText('No continuation instructions are available in the current run state.')).toBeVisible();
    expect(screen.queryByText(/wiki_collaboration_join_run/u)).not.toBeInTheDocument();
  });

  it('keeps paused recovery as an actual resume transition', async () => {
    renderDashboard({ ...runningRun, status: 'paused' }, 'owner', 'owner-1');
    fireEvent.click(await screen.findByRole('button', { name: 'Resume run' }));
    expect(screen.queryByRole('button', { name: 'Get continuation instructions' })).not.toBeInTheDocument();
    const resumed = { ...runningRun, joinInstructions: [{ agentId: 'agent-1', roleSlotIds: ['writer'], taskIds: ['task-1'] }] };
    vi.mocked(collaborationApi.resumeRun).mockResolvedValueOnce(resumed as any);
    vi.mocked(collaborationApi.getRun).mockResolvedValueOnce(resumed as any);
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Continue approved work' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm resume run' }));
    expect(await screen.findByText(/wiki_collaboration_join_run/u)).toBeVisible();
    expect(collaborationApi.resumeRun).toHaveBeenCalledWith('space-1', 'run-1', expect.objectContaining({ reason: 'Continue approved work' }));
  });

  it.each(['completed', 'failed', 'cancelled'] as const)('does not offer continuation for a %s run', async (status) => {
    renderDashboard({ ...runningRun, status }, 'owner', 'owner-1');
    await screen.findByTestId('dashboard-section-summary');
    expect(screen.queryByRole('button', { name: 'Get continuation instructions' })).not.toBeInTheDocument();
    expect(screen.queryByText(/wiki_collaboration_join_run/u)).not.toBeInTheDocument();
  });

  it('does not emit instructions after retrieval fails authorization', async () => {
    renderDashboard(runningRun, 'owner', 'owner-1');
    const get = await screen.findByRole('button', { name: 'Get continuation instructions' });
    vi.mocked(collaborationApi.getRun).mockRejectedValueOnce(new Error('Access revoked'));
    fireEvent.click(get);
    expect(await screen.findByText('Could not retrieve continuation instructions. Refresh your membership and try again.')).toBeVisible();
    expect(screen.queryByText(/wiki_collaboration_join_run/u)).not.toBeInTheDocument();
  });

  it('drops old continuation retrieval after navigation to another run', async () => {
    vi.mocked(useAuth).mockReturnValue({ user: { id: 'owner-1' } } as any);
    vi.mocked(collaborationApi.listMembers).mockResolvedValue([{ type: 'human', userId: 'owner-1', role: 'owner' }]);
    vi.mocked(collaborationApi.getRun).mockResolvedValueOnce(runningRun as any);
    localStorage.setItem('agentwiki.language.v1', 'en');
    render(<LanguageProvider><MemoryRouter initialEntries={['/spaces/space-1/collaboration/runs/run-1']}><Routes><Route path="/spaces/:id/collaboration/runs/:runId" element={<NavigationDashboard />} /></Routes></MemoryRouter></LanguageProvider>);
    const get = await screen.findByRole('button', { name: 'Get continuation instructions' });
    const old = deferred<any>();
    vi.mocked(collaborationApi.getRun).mockReturnValueOnce(old.promise).mockResolvedValueOnce({ ...runningRun, id: 'run-new', spaceId: 'space-new', name: 'New run' } as any);
    fireEvent.click(get);
    fireEvent.click(screen.getByRole('button', { name: 'Open new run' }));
    await screen.findByText('New run');
    await act(async () => old.resolve({ ...runningRun, joinInstructions: [{ agentId: 'agent-old', roleSlotIds: ['writer'], taskIds: [] }] }));
    expect(screen.queryByText(/wiki_collaboration_join_run/u)).not.toBeInTheDocument();
  });

  it('clears continuation instructions when a refreshed execution scope changes', async () => {
    const current = { ...runningRun, joinInstructions: [{ agentId: 'agent-1', roleSlotIds: ['writer'], taskIds: ['task-1'] }] };
    renderDashboard(current, 'owner', 'owner-1');
    fireEvent.click(await screen.findByRole('button', { name: 'Get continuation instructions' }));
    await screen.findByText(/wiki_collaboration_join_run/u);
    vi.mocked(collaborationApi.getRun).mockResolvedValueOnce({ ...current, version: 5, eventSequence: 9, joinInstructions: [] } as any);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(screen.queryByText(/wiki_collaboration_join_run/u)).not.toBeInTheDocument());
  });

  it('rejects a read snapshot superseded while the fresh membership request is pending', async () => {
    const current = { ...runningRun, joinInstructions: [{ agentId: 'agent-1', roleSlotIds: ['writer'], taskIds: ['task-1'] }] };
    renderDashboard(current, 'owner', 'owner-1');
    const get = await screen.findByRole('button', { name: 'Get continuation instructions' });
    const members = deferred<any>();
    vi.mocked(collaborationApi.listMembers).mockReturnValueOnce(members.promise);
    fireEvent.click(get);
    await waitFor(() => expect(collaborationApi.getRun).toHaveBeenCalledTimes(2));
    vi.mocked(collaborationApi.getRun).mockResolvedValueOnce({ ...current, version: 5, eventSequence: 9, joinInstructions: [] } as any);
    fireEvent(window, new Event('focus'));
    await waitFor(() => expect(collaborationApi.getRun).toHaveBeenCalledTimes(3));
    await act(async () => members.resolve([{ type: 'human', userId: 'owner-1', role: 'owner' }]));
    expect(screen.queryByText(/wiki_collaboration_join_run/u)).not.toBeInTheDocument();
  });

  it('hides continuation for a real member who is neither manager nor starter', async () => {
    renderDashboard(runningRun, 'editor', 'other-member');
    await screen.findByTestId('dashboard-section-summary');
    expect(screen.queryByRole('button', { name: 'Get continuation instructions' })).not.toBeInTheDocument();
  });

  it('clears copied output when membership is later revoked', async () => {
    const current = { ...runningRun, joinInstructions: [{ agentId: 'agent-1', roleSlotIds: ['writer'], taskIds: ['task-1'] }] };
    renderDashboard(current, 'owner', 'owner-1');
    fireEvent.click(await screen.findByRole('button', { name: 'Get continuation instructions' }));
    await screen.findByText(/wiki_collaboration_join_run/u);
    vi.mocked(collaborationApi.listMembers).mockResolvedValueOnce([]);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(screen.queryByText(/wiki_collaboration_join_run/u)).not.toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Get continuation instructions' })).not.toBeInTheDocument();
  });

  it.each([['owner', 'editor'], ['owner', 'viewer'], ['owner', 'revoked'], ['admin', 'editor'], ['admin', 'viewer'], ['admin', 'revoked']] as const)('removes existing continuation text and copy controls after %s membership becomes %s', async (initialRole, nextRole) => {
    const current = { ...runningRun, joinInstructions: [{ agentId: 'agent-1', roleSlotIds: ['writer'], taskIds: ['task-1'] }] };
    renderDashboard(current, initialRole, 'owner-1');
    fireEvent.click(await screen.findByRole('button', { name: 'Get continuation instructions' }));
    await screen.findByText(/wiki_collaboration_join_run/u);
    expect(screen.getByRole('button', { name: 'Copy resume instruction' })).toBeVisible();
    vi.mocked(collaborationApi.listMembers).mockResolvedValueOnce(nextRole === 'revoked' ? [] : [{ type: 'human', userId: 'owner-1', role: nextRole }]);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(collaborationApi.listMembers).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Get continuation instructions' })).not.toBeInTheDocument());
    expect(screen.queryByText(/wiki_collaboration_join_run/u)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copy resume instruction' })).not.toBeInTheDocument();
    // Eligibility returning must not resurrect an instruction erased by revocation.
    vi.mocked(collaborationApi.listMembers).mockResolvedValueOnce([{ type: 'human', userId: 'owner-1', role: 'owner' }]);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await screen.findByRole('button', { name: 'Get continuation instructions' });
    expect(screen.queryByText(/wiki_collaboration_join_run/u)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copy resume instruction' })).not.toBeInTheDocument();
  });

  it('bounds desktop cards while retaining mobile flow', async () => {
    renderDashboard(runningRun, 'owner', 'owner-1');
    await screen.findByLabelText('Running status');
    expect(screen.getByTestId('collaboration-dashboard')).toHaveClass('lg:h-[calc(100dvh-13rem)]');
    expect(screen.getByTestId('dashboard-section-summary')).toHaveClass('lg:self-start');
    for (const section of ['current-task', 'reviews', 'artifacts', 'activity']) {
      expect(screen.getByTestId(`dashboard-section-${section}`)).toHaveClass('lg:overflow-y-auto', 'min-h-0');
      expect(screen.getByTestId(`dashboard-section-${section}`)).not.toHaveClass('overflow-y-auto');
    }
  });

  it('uses confirmed system template provenance to localize the run task without changing stored content', async () => {
    vi.mocked(collaborationApi.getTemplate).mockResolvedValue({ id: 'template-1', spaceId: null, slug: 'novel-writing', system: true, version: 1, name: 'Novel', description: '', definition: {} } as any);
    const objective = 'Define setting rules, locations, factions, chronology, constraints, and unresolved world questions.';
    renderDashboard({ ...runningRun, tasks: [{ ...runningRun.tasks[0], nodeId: 'world-bible', name: '世界观设定 / World bible', objectivePreview: objective }] });
    expect(await screen.findByRole('heading', { name: 'World bible' })).toBeVisible();
    expect(screen.getByText(objective)).toBeVisible();
    expect(collaborationApi.getTemplate).toHaveBeenCalledWith('space-1', 'template-1');
  });

  it('shows non-color status, ordered Todos, lease time, reviews, artifacts, and activity', async () => {
    renderDashboard();
    expect(await screen.findByLabelText('Running status')).toBeVisible();
    expect(screen.getByLabelText('Running status')).toContainElement(screen.getByTestId('status-icon'));
    expect(screen.getAllByRole('listitem', { name: /Todo/u }).map((item) => item.textContent?.replace(/[✓○◐]/gu, '').trim())).toEqual([
      '1. Inspect', '2. Implement', '3. Test',
    ]);
    expect(screen.getByText(/Lease expires/u)).toBeVisible();
    expect(screen.getByText('Draft release preview')).toBeVisible();
    expect(screen.getByText('artifact-v2 preview')).toBeVisible();
    expect(screen.getByText('Todo updated')).toBeVisible();
  });

  it('labels the Run task assignee as frozen even when the current Space member default changed', async () => {
    vi.mocked(collaborationApi.listMembers).mockResolvedValue([
      { type: 'human', userId: 'reviewer-1', role: 'editor' },
      { type: 'agent', agentId: 'agent-new', role: 'editor', agent: { id: 'agent-new', name: 'New page default', status: 'active' } },
    ]);
    renderDashboard();
    const task = (await screen.findByText('Draft')).closest('article')!;
    expect(task).toHaveTextContent('Frozen assignee');
    expect(task).toHaveTextContent('agent-1');
    expect(task).not.toHaveTextContent('New page default');
  });

  it('loads one authoritative Page comparison on demand and obeys comparison canDecide', async () => {
    renderDashboard({
      ...waitingReviewRun,
      reviews: waitingReviewRun.reviews.map((review) => ({ ...review, pagePublication: { pageId: 'page-1', changeSetId: 'change-1' } })),
    });
    expect(await screen.findByRole('button', { name: 'Load page comparison' })).toBeVisible();
    expect(collaborationApi.getPageReviewComparison).not.toHaveBeenCalled();
    expect(collaborationApi.getArtifact).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Load page comparison' }));
    expect(await screen.findByRole('link', { name: /Release page/ })).toHaveAttribute('href', '/pages/page-1');
    expect(screen.getAllByText('# Baseline')).toHaveLength(2);
    expect(screen.getByText('# Proposed')).toBeVisible();
    expect(screen.getByRole('link', { name: /change-1/ })).toHaveAttribute('href', '/review?spaceId=space-1&changeSet=change-1');
    expect(collaborationApi.getPageReviewComparison).toHaveBeenCalledWith('space-1', 'run-1', 'review-1', expect.any(AbortSignal));

    expect(screen.getByRole('button', { name: 'Approve' })).toBeVisible();
  });

  it('uses only comparison canDecide and keeps an unavailable Page comparison read-only', async () => {
    vi.mocked(collaborationApi.getPageReviewComparison).mockResolvedValueOnce({
      mode: 'adopted_current', reviewId: 'review-1', artifactId: 'artifact-1', canDecide: false,
      target: { pageId: 'page-archived', title: 'Archived page' },
      adoptedCurrent: { pageId: 'page-archived', pageVersionId: null, contentHash: 'b'.repeat(64), markdown: '# Adopted' },
      current: { pageVersionId: null, updatedAt: null, contentHash: null, markdown: null },
      conflict: true,
    } as any);
    renderDashboard({
      ...waitingReviewRun,
      reviews: waitingReviewRun.reviews.map((review) => ({
        ...review, canDecide: true, pagePublication: { pageId: 'page-archived', changeSetId: 'change-old' },
      })),
    });

    fireEvent.click(await screen.findByRole('button', { name: 'Load page comparison' }));
    expect(await screen.findByText('# Adopted')).toBeVisible();
    expect(screen.getByText('Available for review, but the server has not authorized you to decide it.')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reject for revision' })).not.toBeInTheDocument();
  });

  it.each(['regenerate', 'adopt_current'] as const)(
    'resolves a Page conflict with latest comparison CAS for %s',
    async (kind) => {
      const conflictRun = {
        ...waitingReviewRun, status: 'paused' as const, pauseReason: 'page_version_conflict',
        tasks: waitingReviewRun.tasks.map((task) => ({ ...task, targetPageId: 'page-1' })),
        reviews: waitingReviewRun.reviews.map((review) => ({
          ...review, pagePublication: { pageId: 'page-1', changeSetId: 'change-1' },
        })),
      };
      vi.mocked(collaborationApi.getPageReviewComparison).mockResolvedValueOnce({
        mode: 'candidate', reviewId: 'review-1', artifactId: 'artifact-1', canDecide: true,
        target: { pageId: 'page-1', title: 'Release page' },
        baseline: { pageVersionId: 'version-1', updatedAt: null, contentHash: 'a'.repeat(64), available: true, title: 'Release page', markdown: '# Baseline' },
        candidate: { changeSetId: 'change-1', changeSetStatus: 'pending_review', markdown: '# Proposed', evidence: {} },
        current: { pageVersionId: null, updatedAt: null, contentHash: 'b'.repeat(64), markdown: '# Current' },
        conflict: true,
      } as any);
      vi.mocked(collaborationApi.resolvePageConflict).mockResolvedValue({ kind, taskId: 'task-1', generation: 2 } as any);
      vi.mocked(collaborationApi.getRun).mockResolvedValue(conflictRun as any);
      renderDashboard(conflictRun, 'owner', 'owner-1');

      fireEvent.click(await screen.findByRole('button', { name: 'Load page comparison' }));
      const actionName = kind === 'regenerate' ? 'Regenerate from current Page' : 'Adopt current Page';
      fireEvent.click(await screen.findByRole('button', { name: actionName }));

      await waitFor(() => expect(collaborationApi.resolvePageConflict).toHaveBeenCalledWith(
        'space-1', 'run-1', 'task-1', expect.objectContaining({
          kind, expectedPageVersionId: null, expectedContentHash: 'b'.repeat(64),
        }),
      ));
    },
  );

  it('retains a conflict error and reloads the latest comparison after stale CAS', async () => {
    const conflictRun = {
      ...waitingReviewRun, status: 'paused' as const, pauseReason: 'page_version_conflict',
      tasks: waitingReviewRun.tasks.map((task) => ({ ...task, targetPageId: 'page-1' })),
      reviews: waitingReviewRun.reviews.map((review) => ({
        ...review, pagePublication: { pageId: 'page-1', changeSetId: 'change-1' },
      })),
    };
    const comparison = (hash: string, markdown: string) => ({
      mode: 'candidate', reviewId: 'review-1', artifactId: 'artifact-1', canDecide: true,
      target: { pageId: 'page-1', title: 'Release page' },
      baseline: { pageVersionId: 'version-1', updatedAt: null, contentHash: 'a'.repeat(64), available: true, title: 'Release page', markdown: '# Baseline' },
      candidate: { changeSetId: 'change-1', changeSetStatus: 'pending_review', markdown: '# Proposed', evidence: {} },
      current: { pageVersionId: null, updatedAt: null, contentHash: hash, markdown }, conflict: true,
    });
    vi.mocked(collaborationApi.getPageReviewComparison)
      .mockResolvedValueOnce(comparison('b'.repeat(64), '# Current before') as any)
      .mockResolvedValueOnce(comparison('c'.repeat(64), '# Current after') as any);
    vi.mocked(collaborationApi.resolvePageConflict).mockRejectedValue({ response: { data: { code: 'PAGE_VERSION_CONFLICT' } } });
    renderDashboard(conflictRun, 'owner', 'owner-1');

    fireEvent.click(await screen.findByRole('button', { name: 'Load page comparison' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Regenerate from current Page' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('The Page changed again. The latest comparison is shown; review it before retrying.');
    expect(await screen.findByText('# Current after')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Regenerate from current Page' })).toBeEnabled();
    expect(collaborationApi.getPageReviewComparison).toHaveBeenCalledTimes(2);

    vi.mocked(collaborationApi.resolvePageConflict).mockResolvedValueOnce({ kind: 'regenerate', taskId: 'task-1', generation: 2 } as any);
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate from current Page' }));
    await waitFor(() => expect(collaborationApi.resolvePageConflict).toHaveBeenNthCalledWith(
      2, 'space-1', 'run-1', 'task-1', expect.objectContaining({ expectedContentHash: 'c'.repeat(64) }),
    ));
  });

  it('renders every collaboration operation and actor without translation-key fallbacks', async () => {
    const operations = [
      'next_action', 'heartbeat', 'update_todo', 'submit_result', 'advance_run', 'recover_expired_lease',
      'review_approve', 'review_reject_for_revision', 'review_terminate', 'pause_run', 'resume_run',
      'fail_run', 'cancel_run', 'retry_task', 'reassign_task', 'skip_task', 'start_run',
      'resolve_page_conflict_regenerate', 'resolve_page_conflict_adopt_current', 'create_existing_page_group_run',
    ];
    renderDashboard({
      ...runningRun,
      events: operations.map((operation, index) => ({
        id: `event-${index}`, sequence: index + 1, type: 'event',
        actorKind: index % 3 === 0 ? 'agent' : index % 3 === 1 ? 'human' : 'system',
        operation, target: 'run-1', createdAt: '2026-08-24T00:08:00Z',
      })),
    });

    await screen.findByLabelText('Running status');
    expect(document.body.textContent).not.toMatch(/collaboration\.(?:event|actor)\./u);
    expect(screen.getByText('Next action requested')).toBeVisible();
    expect(screen.getAllByText(/Agent|Human|System/u).length).toBeGreaterThan(0);
  });

  it('loads full activity history incrementally from the audit entry point', async () => {
    vi.mocked(collaborationApi.getRunHistory)
      .mockResolvedValueOnce({ items: [{ id: 'full-event-2', operation: 'heartbeat' }], nextCursor: 'cursor-1' })
      .mockResolvedValueOnce({ items: [{ id: 'full-event-1', operation: 'start_run' }], nextCursor: null });
    renderDashboard();

    fireEvent.click(await screen.findByRole('button', { name: 'View all activity' }));

    expect(await screen.findByText(/full-event-2/u)).toBeVisible();
    expect(screen.queryByText(/full-event-1/u)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByText(/full-event-1/u)).toBeVisible();
    expect(collaborationApi.getRunHistory).toHaveBeenNthCalledWith(1, 'space-1', 'run-1', 'events', undefined, 50);
    expect(collaborationApi.getRunHistory).toHaveBeenNthCalledWith(2, 'space-1', 'run-1', 'events', 'cursor-1', 50);
  });

  it('exposes a failed Todo status without relying on color alone', async () => {
    renderDashboard({
      ...runningRun,
      tasks: [{
        ...runningRun.tasks[0],
        todos: [{ ...runningRun.tasks[0].todos[0], status: 'failed' }],
      }],
    });

    expect(await screen.findByRole('listitem', { name: 'Todo 1: Inspect, Failed' })).toBeVisible();
  });

  it('ignores a stale member response after navigating to another Space', async () => {
    let resolveOldMembers!: (value: any[]) => void;
    const oldMembers = new Promise<any[]>((resolve) => { resolveOldMembers = resolve; });
    vi.mocked(useAuth).mockReturnValue({ user: { id: 'user-1' } } as ReturnType<typeof useAuth>);
    vi.mocked(collaborationApi.getRun).mockImplementation(async (spaceId, runId) => ({
      ...runningRun, id: runId, spaceId,
    }) as any);
    vi.mocked(collaborationApi.listMembers)
      .mockReturnValueOnce(oldMembers as any)
      .mockResolvedValueOnce([{ type: 'human', userId: 'user-1', role: 'viewer' }] as any);
    localStorage.setItem('agentwiki.language.v1', 'en');
    render(<LanguageProvider><MemoryRouter initialEntries={['/spaces/space-old/collaboration/runs/run-old']}>
      <Routes><Route path="/spaces/:id/collaboration/runs/:runId" element={<NavigationDashboard />} /></Routes>
    </MemoryRouter></LanguageProvider>);

    fireEvent.click(await screen.findByRole('button', { name: 'Open new run' }));
    await waitFor(() => expect(collaborationApi.listMembers).toHaveBeenCalledWith('space-new'));
    await act(async () => resolveOldMembers([{ type: 'human', userId: 'user-1', role: 'owner' }]));

    expect(screen.queryByRole('button', { name: 'End as failed' })).not.toBeInTheDocument();
  });

  it('aborts and ignores an old Page comparison after navigating to another Run', async () => {
    const oldComparison = deferred<any>();
    let oldSignal: AbortSignal | undefined;
    vi.mocked(useAuth).mockReturnValue({ user: { id: 'reviewer-1' } } as ReturnType<typeof useAuth>);
    vi.mocked(collaborationApi.listMembers).mockResolvedValue([{ type: 'human', userId: 'reviewer-1', role: 'editor' }] as any);
    vi.mocked(collaborationApi.getRun).mockImplementation(async (spaceId, requestedRunId) => ({
      ...waitingReviewRun,
      id: requestedRunId,
      spaceId,
      tasks: waitingReviewRun.tasks.map((task) => ({ ...task, targetPageId: `page-${requestedRunId}` })),
      reviews: waitingReviewRun.reviews.map((review) => ({
        ...review,
        id: `review-${requestedRunId}`,
        pagePublication: { pageId: `page-${requestedRunId}`, changeSetId: `change-${requestedRunId}` },
      })),
    }) as any);
    vi.mocked(collaborationApi.getPageReviewComparison)
      .mockImplementationOnce((_spaceId, _runId, _reviewId, signal) => {
        oldSignal = signal;
        return oldComparison.promise;
      })
      .mockResolvedValueOnce({
        mode: 'candidate', reviewId: 'review-run-new', artifactId: 'artifact-new', canDecide: false,
        target: { pageId: 'page-run-new', title: 'New run page' },
        baseline: { pageVersionId: null, updatedAt: null, contentHash: null, available: false, title: null, markdown: null },
        candidate: { changeSetId: 'change-run-new', changeSetStatus: 'pending_review', markdown: '# New run proposed', evidence: {} },
        current: { pageVersionId: null, updatedAt: null, contentHash: 'c'.repeat(64), markdown: '# New current' },
        conflict: true,
      } as any);
    localStorage.setItem('agentwiki.language.v1', 'en');
    render(<LanguageProvider><MemoryRouter initialEntries={['/spaces/space-old/collaboration/runs/run-old']}>
      <Routes><Route path="/spaces/:id/collaboration/runs/:runId" element={<NavigationDashboard />} /></Routes>
    </MemoryRouter></LanguageProvider>);

    fireEvent.click(await screen.findByRole('button', { name: 'Load page comparison' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open new run' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Load page comparison' }));
    expect(await screen.findByText('# New run proposed')).toBeVisible();
    expect(oldSignal?.aborted).toBe(true);

    await act(async () => oldComparison.resolve({
      mode: 'candidate', reviewId: 'review-run-old', artifactId: 'artifact-old', canDecide: true,
      target: { pageId: 'page-run-old', title: 'Old run page' },
      baseline: { pageVersionId: null, updatedAt: null, contentHash: null, available: false, title: null, markdown: null },
      candidate: { changeSetId: 'change-run-old', changeSetStatus: 'pending_review', markdown: '# Old proposed', evidence: {} },
      current: { pageVersionId: null, updatedAt: null, contentHash: 'b'.repeat(64), markdown: '# Old current' },
      conflict: true,
    }));
    expect(screen.queryByText('# Old proposed')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
  });

  it('treats Socket messages as refresh hints and refetches on focus and reconnect', async () => {
    renderDashboard();
    await waitFor(() => expect(collaborationApi.getRun).toHaveBeenCalledTimes(1));
    socketHandlers.get('collaborationRunChanged')?.({ runId: 'run-1', eventSequence: 9 });
    await waitFor(() => expect(collaborationApi.getRun).toHaveBeenCalledTimes(2));
    window.dispatchEvent(new Event('focus'));
    await waitFor(() => expect(collaborationApi.getRun).toHaveBeenCalledTimes(3));
    managerHandlers.get('reconnect')?.();
    await waitFor(() => expect(collaborationApi.getRun).toHaveBeenCalledTimes(4));
  });

  it('shows only authorized controls and preserves the mobile semantic order', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    renderDashboard(waitingReviewRun, 'editor', 'reviewer-1');
    expect(await screen.findByRole('button', { name: 'Approve' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'End as failed' })).not.toBeInTheDocument();
    const order = screen.getAllByTestId(/^dashboard-section-/u).map((element) => element.dataset.testid?.replace('dashboard-section-', ''));
    expect(order).toEqual(['summary', 'current-task', 'reviews', 'artifacts', 'activity']);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390);
  });

  it('hides Owner controls for a non-member platform super admin', async () => {
    renderSuperAdminDashboard({
      ...waitingReviewRun,
      reviews: waitingReviewRun.reviews.map((review) => ({ ...review, reviewerUserIds: [] })),
    });
    await screen.findByLabelText('Waiting for review status');
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'End as failed' })).not.toBeInTheDocument();
  });

  it('lets an Owner recover a Review after every designated reviewer becomes ineligible', async () => {
    renderDashboard({
      ...waitingReviewRun,
      reviews: waitingReviewRun.reviews.map((review) => ({ ...review, reviewerUserIds: ['removed-reviewer'] })),
    }, 'owner', 'owner-1');

    expect(await screen.findByRole('button', { name: 'Approve' })).toBeVisible();
  });

  it('submits a human review with a required reason and authoritative refresh', async () => {
    const resumedRun = {
      ...waitingReviewRun,
      status: 'running' as const,
      joinInstructions: [{ agentId: 'agent-1', roleSlotIds: ['writer'], taskIds: ['task-1'] }],
    };
    vi.mocked(collaborationApi.decideReview).mockResolvedValue(resumedRun as any);
    renderDashboard(waitingReviewRun, 'editor', 'reviewer-1');
    expect(await screen.findByText('Tests pass')).toBeVisible();
    expect(screen.getByText(/All checks passed/u)).toBeVisible();
    expect(screen.getByText(/client:293/u)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    vi.mocked(collaborationApi.getRun).mockResolvedValue(resumedRun as any);
    expect(screen.getByRole('dialog')).toHaveTextContent('Release run');
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Evidence is complete' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm approve' }));
    await waitFor(() => expect(collaborationApi.decideReview).toHaveBeenCalledWith('space-1', 'run-1', 'review-1', expect.objectContaining({ kind: 'approve', reason: 'Evidence is complete' })));
    expect(collaborationApi.getRun).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Resume Agent instructions')).toBeVisible();
    const instruction = screen.getByText(/wiki_collaboration_join_run/u);
    expect(instruction).toHaveTextContent('wiki_collaboration_join_run');
    expect(instruction).toHaveTextContent('wiki_collaboration_next_action');
    expect(instruction.textContent).not.toMatch(/(?<!wiki_)collaboration_(?:join_run|next_action)/u);
    expect(document.body.textContent).not.toMatch(/credential|api[-_ ]?key|token=/iu);
  });

  it('does not submit an approval when a refresh revokes the pending review capability', async () => {
    renderDashboard(waitingReviewRun);
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Reviewed' } });
    vi.mocked(collaborationApi.getRun).mockResolvedValue({ ...waitingReviewRun, eventSequence: 9, reviews: waitingReviewRun.reviews.map(review => ({ ...review, canDecide: false })) } as any);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(collaborationApi.getRun).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Confirm approve' }));
    expect(collaborationApi.decideReview).not.toHaveBeenCalled();
  });

  it('restores dialog focus after a conflict refresh so Escape remains available', async () => {
    vi.mocked(collaborationApi.decideReview).mockRejectedValueOnce({
      response: { data: { code: 'PAGE_VERSION_CONFLICT' } },
    });
    renderDashboard(waitingReviewRun, 'editor', 'reviewer-1');
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    const reason = screen.getByLabelText('Reason');
    fireEvent.change(reason, { target: { value: 'Concurrent edit' } });
    const confirm = screen.getByRole('button', { name: 'Confirm approve' });
    confirm.focus();
    expect(confirm).toHaveFocus();
    fireEvent.click(confirm);

    await waitFor(() => expect(collaborationApi.getRun).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(reason).toHaveFocus());
    fireEvent.keyDown(reason, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('does not emit resume instructions when the mutation returns a non-running authoritative status', async () => {
    vi.mocked(collaborationApi.decideReview).mockResolvedValue(waitingReviewRun as any);
    renderDashboard(waitingReviewRun, 'editor', 'reviewer-1');
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Another review remains' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm approve' }));

    await waitFor(() => expect(collaborationApi.decideReview).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('Resume Agent instructions')).not.toBeInTheDocument();
  });

  it('uses authoritative join instructions after skip and does not invent a task RoleBinding', async () => {
    const skippableRun = {
      ...runningRun,
      tasks: [{
        ...runningRun.tasks[0],
        roleSlotId: 'alternate-task-only',
        assigneeAgentId: 'agent-alternate',
        status: 'ready',
        skippable: true,
        attempts: [],
      }],
    };
    vi.mocked(collaborationApi.skipTask).mockResolvedValue({
      ...skippableRun,
      status: 'running',
      joinInstructions: [{ agentId: 'agent-1', roleSlotIds: ['writer'], taskIds: [] }],
    } as any);
    renderDashboard(skippableRun, 'owner', 'owner-1');
    vi.mocked(collaborationApi.getRun).mockResolvedValue({ ...skippableRun, joinInstructions: [{ agentId: 'agent-1', roleSlotIds: ['writer'], taskIds: [] }] } as any);
    fireEvent.click(await screen.findByRole('button', { name: 'Skip task' }));
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Other branch remains active' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm skip task' }));

    expect(await screen.findByText('Resume Agent instructions')).toBeVisible();
    expect(screen.getByText(/Roles: Writer/u)).toBeVisible();
    expect(document.body).not.toHaveTextContent('Roles: alternate-task-only');
  });

  it('clears prior recovery instructions when a later mutation is non-running', async () => {
    const resumedRun = {
      ...waitingReviewRun,
      status: 'running' as const,
      joinInstructions: [{ agentId: 'agent-1', roleSlotIds: ['writer'], taskIds: [] }],
    };
    vi.mocked(collaborationApi.decideReview)
      .mockResolvedValueOnce(resumedRun as any)
      .mockResolvedValueOnce({ ...waitingReviewRun, joinInstructions: [] } as any);
    renderDashboard(waitingReviewRun, 'editor', 'reviewer-1');

    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    vi.mocked(collaborationApi.getRun).mockResolvedValueOnce(resumedRun as any);
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'First decision' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm approve' }));
    expect(await screen.findByText('Resume Agent instructions')).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Terminal decision' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm approve' }));
    await waitFor(() => expect(screen.queryByText('Resume Agent instructions')).not.toBeInTheDocument());
  });

  it('clears recovery instructions when a Socket refresh observes a non-running run', async () => {
    const resumedRun = {
      ...waitingReviewRun,
      status: 'running' as const,
      joinInstructions: [{ agentId: 'agent-1', roleSlotIds: ['writer'], taskIds: [] }],
    };
    vi.mocked(collaborationApi.decideReview).mockResolvedValue(resumedRun as any);
    vi.mocked(collaborationApi.getRun)
      .mockResolvedValueOnce(waitingReviewRun as any)
      .mockResolvedValueOnce(resumedRun as any)
      .mockResolvedValueOnce({ ...waitingReviewRun, status: 'completed', joinInstructions: [] } as any);
    renderDashboard(waitingReviewRun, 'editor', 'reviewer-1');

    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Resume work' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm approve' }));
    expect(await screen.findByText('Resume Agent instructions')).toBeVisible();

    socketHandlers.get('collaborationRunChanged')?.({ runId: 'run-1', eventSequence: 10 });
    await waitFor(() => expect(collaborationApi.getRun).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(screen.queryByText('Resume Agent instructions')).not.toBeInTheDocument());
  });

  it('keeps a running mutation instruction during refresh, then clears it for the resolved non-running status', async () => {
    const resumedRun = {
      ...waitingReviewRun,
      status: 'running' as const,
      joinInstructions: [{ agentId: 'agent-1', roleSlotIds: ['writer'], taskIds: ['task-1'] }],
    };
    let resolveRefresh!: (run: any) => void;
    const pendingRefresh = new Promise<any>((resolve) => { resolveRefresh = resolve; });
    vi.mocked(collaborationApi.decideReview).mockResolvedValue(resumedRun as any);
    renderDashboard(waitingReviewRun, 'editor', 'reviewer-1');

    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    vi.mocked(collaborationApi.getRun).mockReturnValueOnce(pendingRefresh as any);
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Resume work' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm approve' }));

    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(screen.getByText('Resume Agent instructions')).toBeVisible();
    expect(screen.getByText(/wiki_collaboration_join_run/u)).toBeVisible();
    resolveRefresh(waitingReviewRun);
    await waitFor(() => expect(collaborationApi.getRun).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText('Resume Agent instructions')).not.toBeInTheDocument());
  });

  it.each(['submitted', 'completed', 'skipped'])(
    'does not offer reassignment or skipping after a task reaches %s',
    async (status) => {
      renderDashboard({
        ...waitingReviewRun,
        tasks: [{ ...waitingReviewRun.tasks[0], status, skippable: true }],
      }, 'owner', 'owner-1');
      await screen.findByLabelText('Waiting for review status');
      expect(screen.queryByRole('button', { name: 'Reassign' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Skip task' })).not.toBeInTheDocument();
    },
  );
});
