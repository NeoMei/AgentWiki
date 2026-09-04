import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { io } from 'socket.io-client';
import { collaborationApi } from './api';
import type { CollaborationRun } from './types';
import { useCollaborationRun } from './useCollaborationRun';

const socket = {
  on: vi.fn(), off: vi.fn(), emit: vi.fn(), connect: vi.fn(), disconnect: vi.fn(),
  io: { on: vi.fn(), off: vi.fn() },
};

vi.mock('socket.io-client', () => ({ io: vi.fn(() => socket) }));
vi.mock('./api', () => ({ collaborationApi: { getRun: vi.fn() } }));

const run = (id: string, spaceId: string): CollaborationRun => ({
  id, spaceId, name: id, templateId: 'template-1', templateVersion: 1,
  snapshotHash: 'a'.repeat(64), status: 'running', version: 1,
  startedById: 'user-1', eventSequence: 1, roleBindings: [], tasks: [], reviews: [], events: [], joinInstructions: [],
  createdAt: '2026-08-24T00:00:00Z', updatedAt: '2026-08-24T00:00:00Z', startedAt: '2026-08-24T00:00:00Z', finishedAt: null,
});

describe('useCollaborationRun', () => {
  beforeEach(() => vi.clearAllMocks());

  it('defers an explicit Socket connection so StrictMode cleanup cannot abort a handshake', async () => {
    vi.mocked(collaborationApi.getRun).mockResolvedValue(run('run-1', 'space-1'));

    renderHook(() => useCollaborationRun('space-1', 'run-1'));

    expect(io).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ autoConnect: false }));
    await waitFor(() => expect(socket.connect).toHaveBeenCalled());
  });

  it('does not let an old in-flight request overwrite a newly selected run', async () => {
    let resolveOld!: (value: CollaborationRun) => void;
    const oldRequest = new Promise<CollaborationRun>((resolve) => { resolveOld = resolve; });
    vi.mocked(collaborationApi.getRun)
      .mockReturnValueOnce(oldRequest)
      .mockResolvedValueOnce(run('run-new', 'space-new'));

    const { result, rerender } = renderHook(
      ({ spaceId, runId }) => useCollaborationRun(spaceId, runId),
      { initialProps: { spaceId: 'space-old', runId: 'run-old' } },
    );
    rerender({ spaceId: 'space-new', runId: 'run-new' });

    await waitFor(() => expect(result.current.state).toMatchObject({ kind: 'ready', value: { id: 'run-new' } }));
    await act(async () => resolveOld(run('run-old', 'space-old')));

    expect(result.current.state).toMatchObject({ kind: 'ready', value: { id: 'run-new', spaceId: 'space-new' } });
  });

  it('keeps the newest response when refreshes overlap within one run', async () => {
    vi.mocked(collaborationApi.getRun).mockResolvedValueOnce(run('run-1', 'space-1'));
    const { result } = renderHook(() => useCollaborationRun('space-1', 'run-1'));
    await waitFor(() => expect(result.current.state).toMatchObject({ kind: 'ready' }));

    let resolveOlder!: (value: CollaborationRun) => void;
    let resolveNewer!: (value: CollaborationRun) => void;
    vi.mocked(collaborationApi.getRun)
      .mockReturnValueOnce(new Promise((resolve) => { resolveOlder = resolve; }))
      .mockReturnValueOnce(new Promise((resolve) => { resolveNewer = resolve; }));

    let older!: Promise<void>;
    let newer!: Promise<void>;
    act(() => {
      older = result.current.refresh();
      newer = result.current.refresh();
    });
    await act(async () => resolveNewer({ ...run('run-1', 'space-1'), version: 3 }));
    await newer;
    await act(async () => resolveOlder({ ...run('run-1', 'space-1'), version: 2 }));
    await older;

    expect(result.current.state).toMatchObject({ kind: 'ready', value: { version: 3 }, updating: false });
  });
});
