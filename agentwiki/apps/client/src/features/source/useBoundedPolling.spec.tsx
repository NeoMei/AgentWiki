import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useBoundedPolling } from './useBoundedPolling';

afterEach(() => vi.useRealTimers());
it('serializes refreshes, caps attempts, and cleans up on terminal or unmount', async () => {
  vi.useFakeTimers();
  let resolve!: () => void;
  let calls = 0;
  const refresh = async () => { calls++; if (calls === 1) await new Promise<void>((done) => { resolve = done; }); };
  const view = renderHook(({ enabled }) => useBoundedPolling('scope', enabled, refresh, 3000, 2), { initialProps: { enabled: true } });
  await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
  expect(calls).toBe(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(9000); });
  expect(calls).toBe(1);
  await act(async () => resolve());
  await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
  expect(calls).toBe(2);
  await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
  expect(calls).toBe(2);
  expect(view.result.current).toBe(false);
  view.rerender({ enabled: false });
  expect(vi.getTimerCount()).toBe(0);
  view.unmount();
});

it('clears the timer when a terminal refresh resolves and when unmounted in flight', async () => {
  vi.useFakeTimers();
  const terminal = renderHook(() => useBoundedPolling('terminal', true, async () => true));
  await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
  expect(terminal.result.current).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
  terminal.unmount();
  let resolve!: () => void;
  const inflight = renderHook(() => useBoundedPolling('inflight', true, () => new Promise<void>((done) => { resolve = done; })));
  await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
  inflight.unmount();
  await act(async () => resolve());
  expect(vi.getTimerCount()).toBe(0);
});
