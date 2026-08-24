import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { collaborationApi } from './api';
import type { CollaborationRun } from './types';

export type CollaborationRunLoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; value: CollaborationRun; updating: boolean }
  | { kind: 'error'; error: unknown; previous?: CollaborationRun };

export function useCollaborationRun(spaceId: string, runId: string) {
  const [state, setState] = useState<CollaborationRunLoadState>({ kind: 'loading' });
  const scope = `${spaceId}:${runId}`;
  const scopeRef = useRef(scope);
  const currentRef = useRef<CollaborationRun | undefined>();
  const requestEpoch = useRef(0);
  if (scopeRef.current !== scope) {
    scopeRef.current = scope;
    currentRef.current = undefined;
    requestEpoch.current += 1;
  }

  const refresh = useCallback(async () => {
    if (!spaceId || !runId) return;
    const requestedScope = `${spaceId}:${runId}`;
    const request = ++requestEpoch.current;
    if (currentRef.current) setState({ kind: 'ready', value: currentRef.current, updating: true });
    try {
      const value = await collaborationApi.getRun(spaceId, runId);
      if (scopeRef.current !== requestedScope || requestEpoch.current !== request) return;
      currentRef.current = value;
      setState({ kind: 'ready', value, updating: false });
    } catch (error) {
      if (scopeRef.current !== requestedScope || requestEpoch.current !== request) return;
      setState({ kind: 'error', error, previous: currentRef.current });
    }
  }, [runId, spaceId]);

  useEffect(() => {
    setState({ kind: 'loading' });
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!spaceId || !runId) return;
    const socket: Socket = io(`${window.location.origin}/collaboration`, {
      transports: ['websocket', 'polling'],
      auth: { token: localStorage.getItem('token') },
    });
    let timer: number | undefined;
    const debouncedRefresh = () => {
      if (timer !== undefined) window.clearTimeout(timer);
      timer = window.setTimeout(() => void refresh(), 150);
    };
    const onConnect = () => socket.emit('joinCollaborationRun', { spaceId, runId });
    const onChanged = (hint: { runId?: unknown }) => { if (hint?.runId === runId) debouncedRefresh(); };
    socket.on('connect', onConnect);
    socket.on('collaborationRunChanged', onChanged);
    socket.io.on('reconnect', refresh);
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
      socket.emit('leaveCollaborationRun', { runId });
      socket.off('connect', onConnect);
      socket.off('collaborationRunChanged', onChanged);
      socket.io.off('reconnect', refresh);
      socket.disconnect();
    };
  }, [refresh, runId, spaceId]);

  useEffect(() => {
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refresh]);

  return { state, refresh };
}
