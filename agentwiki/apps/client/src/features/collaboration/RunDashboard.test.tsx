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
vi.mock('socket.io-client', () => ({ io: vi.fn(() => socket) }));
vi.mock('../../context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('./api', () => ({ collaborationApi: {
  getRun: vi.fn(), listMembers: vi.fn(), pauseRun: vi.fn(), resumeRun: vi.fn(), failRun: vi.fn(),
  cancelRun: vi.fn(), retryTask: vi.fn(), reassignTask: vi.fn(), skipTask: vi.fn(), decideReview: vi.fn(),
  getRunHistory: vi.fn(), getArtifact: vi.fn(),
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
    vi.clearAllMocks();
    socketHandlers.clear();
    managerHandlers.clear();
    vi.mocked(collaborationApi.getArtifact).mockResolvedValue({
      id: 'artifact-1', taskId: 'task-1', generation: 2, version: 2, kind: 'markdown', status: 'pending',
      payload: { markdown: '# Release evidence\nAll checks passed.' }, evidence: [{ kind: 'test', reference: 'client:293' }],
      createdAt: '2026-08-24T00:09:00Z',
    });
    vi.mocked(collaborationApi.getRunHistory).mockResolvedValue({
      items: [{
        id: 'artifact-1', taskId: 'task-1', generation: 2, version: 2, kind: 'markdown', status: 'pending',
        payload: { markdown: '# Release evidence\nAll checks passed.' }, evidence: [{ kind: 'test', reference: 'client:293' }],
        createdAt: '2026-08-24T00:09:00Z',
      }],
      nextCursor: null,
    });
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

  it('renders every collaboration operation and actor without translation-key fallbacks', async () => {
    const operations = [
      'next_action', 'heartbeat', 'update_todo', 'submit_result', 'advance_run', 'recover_expired_lease',
      'review_approve', 'review_reject_for_revision', 'review_terminate', 'pause_run', 'resume_run',
      'fail_run', 'cancel_run', 'retry_task', 'reassign_task', 'skip_task', 'start_run',
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

  it('gives a non-member platform super admin Owner controls', async () => {
    renderSuperAdminDashboard({
      ...waitingReviewRun,
      reviews: waitingReviewRun.reviews.map((review) => ({ ...review, reviewerUserIds: [] })),
    });
    expect(await screen.findByRole('button', { name: 'Approve' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'End as failed' })).toBeVisible();
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
