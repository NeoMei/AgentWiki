import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../context/LanguageContext';
import { useAuth } from '../../context/AuthContext';
import { collaborationApi } from './api';
import { RunDashboard } from './RunDashboard';

const socketHandlers = new Map<string, (...args: any[]) => void>();
const managerHandlers = new Map<string, (...args: any[]) => void>();
const socket = {
  on: vi.fn((event: string, handler: (...args: any[]) => void) => { socketHandlers.set(event, handler); return socket; }),
  off: vi.fn(), emit: vi.fn(), disconnect: vi.fn(),
  io: { on: vi.fn((event: string, handler: (...args: any[]) => void) => { managerHandlers.set(event, handler); }), off: vi.fn() },
};
vi.mock('socket.io-client', () => ({ io: vi.fn(() => socket) }));
vi.mock('../../context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('./api', () => ({ collaborationApi: {
  getRun: vi.fn(), listMembers: vi.fn(), pauseRun: vi.fn(), resumeRun: vi.fn(), failRun: vi.fn(),
  cancelRun: vi.fn(), retryTask: vi.fn(), reassignTask: vi.fn(), skipTask: vi.fn(), decideReview: vi.fn(),
} }));

const runningRun = {
  id: 'run-1', name: 'Release run', spaceId: 'space-1', templateId: 'template-1', templateVersion: 1,
  templateSnapshot: {}, snapshotHash: 'a'.repeat(64), status: 'running' as const, version: 4,
  inputs: { brief: 'Ship it' }, startedById: 'starter-1', eventSequence: 8,
  createdAt: '2026-08-24T00:00:00Z', updatedAt: '2026-08-24T00:10:00Z', startedAt: '2026-08-24T00:01:00Z', finishedAt: null,
  roleBindings: [{ roleSlotId: 'writer', roleSlotName: 'Writer', agentId: 'agent-1' }],
  tasks: [{
    id: 'task-1', nodeId: 'draft', ordinal: 0, name: 'Draft', objective: 'Draft release', roleSlotId: 'writer', assigneeAgentId: 'agent-1',
    status: 'running', generation: 2, skippable: false, completedAt: null,
    todos: [
      { id: 'todo-1', ordinal: 0, name: 'Inspect', status: 'done', required: true, generation: 2 },
      { id: 'todo-2', ordinal: 1, name: 'Implement', status: 'doing', required: true, generation: 2 },
      { id: 'todo-3', ordinal: 2, name: 'Test', status: 'pending', required: true, generation: 2 },
    ],
    attempts: [{ id: 'attempt-1', status: 'running', leaseExpiresAt: '2026-08-24T00:20:00Z', attemptNumber: 1, agentId: 'agent-1' }],
    artifacts: [{ id: 'artifact-1', version: 2, kind: 'external_reference', status: 'accepted', payload: { name: 'artifact-v2.md' }, createdAt: '2026-08-24T00:09:00Z' }],
  }],
  dependencies: [], reviews: [],
  events: [{ id: 'event-1', sequence: 8, type: 'todo_updated', actorKind: 'agent', operation: 'update_todo', target: 'todo-2', createdAt: '2026-08-24T00:08:00Z', metadata: {} }],
  joinInstructions: [],
};

const waitingReviewRun = {
  ...runningRun, status: 'waiting_review' as const,
  reviews: [{ id: 'review-1', nodeId: 'human-review', status: 'pending', minimumRole: 'editor', reviewerUserIds: ['reviewer-1'], allowTerminate: true, revisionTaskId: 'task-1', artifactId: 'artifact-1', createdAt: '2026-08-24T00:10:00Z' }],
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

describe('RunDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    socketHandlers.clear();
    managerHandlers.clear();
  });

  it('shows non-color status, ordered Todos, lease time, reviews, artifacts, and activity', async () => {
    renderDashboard();
    expect(await screen.findByLabelText('Running status')).toBeVisible();
    expect(screen.getByLabelText('Running status')).toContainElement(screen.getByTestId('status-icon'));
    expect(screen.getAllByRole('listitem', { name: /Todo/u }).map((item) => item.textContent?.replace(/[✓○◐]/gu, '').trim())).toEqual([
      '1. Inspect', '2. Implement', '3. Test',
    ]);
    expect(screen.getByText(/Lease expires/u)).toBeVisible();
    expect(screen.getByText('artifact-v2.md')).toBeVisible();
    expect(screen.getByText('Todo updated')).toBeVisible();
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

  it('submits a human review with a required reason and authoritative refresh', async () => {
    vi.mocked(collaborationApi.decideReview).mockResolvedValue({} as any);
    renderDashboard(waitingReviewRun, 'editor', 'reviewer-1');
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Release run');
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Evidence is complete' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm approve' }));
    await waitFor(() => expect(collaborationApi.decideReview).toHaveBeenCalledWith('space-1', 'run-1', 'review-1', expect.objectContaining({ kind: 'approve', reason: 'Evidence is complete' })));
    expect(collaborationApi.getRun).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Resume Agent instructions')).toBeVisible();
    expect(screen.getByText(/collaboration_next_action/u)).toBeVisible();
    expect(document.body.textContent).not.toMatch(/credential|api[-_ ]?key|token=/iu);
  });
});
