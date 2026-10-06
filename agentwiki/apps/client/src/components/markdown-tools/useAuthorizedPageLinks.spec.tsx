import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import api from '../../api/client';
import { useAuthorizedPageLinks } from './useAuthorizedPageLinks';

vi.mock('../../api/client', () => ({ default: { get: vi.fn() } }));
const page = (id: string, spaceId = 's') => ({ id, title: `Page ${id}`, spaceId });
const deferred = () => {
  let resolve!: (value: any) => void;
  const promise = new Promise<any>((done) => { resolve = done; });
  return { resolve, promise };
};

describe('on-demand authorized Space links', () => {
  beforeEach(() => { vi.mocked(api.get).mockReset(); });

  it('loads recent pages only on demand and searches pages beyond the recent 100', async () => {
    const { result } = renderHook(() => useAuthorizedPageLinks('u', 's', 'p', true));
    expect(api.get).not.toHaveBeenCalled();
    vi.mocked(api.get).mockResolvedValueOnce({ data: { data: Array.from({ length: 100 }, (_, i) => page(String(i))) } });
    expect(await result.current()).toHaveLength(100);
    expect(api.get).toHaveBeenLastCalledWith('/pages', expect.objectContaining({ params: { spaceId: 's', take: 100 }, signal: expect.any(AbortSignal) }));
    vi.mocked(api.get).mockResolvedValueOnce({ data: { results: [{ page: page('old-101') }] } });
    expect(await result.current('  body match  ')).toEqual([{ id: 'old-101', title: 'Page old-101' }]);
    expect(api.get).toHaveBeenLastCalledWith('/search', expect.objectContaining({ params: { q: 'body match', spaceId: 's', limit: 50 }, signal: expect.any(AbortSignal) }));
  });

  it.each(['', 'search'])('validates scope and shape, deduplicates identity and bounds accepted results: %s', async (query) => {
    const { result } = renderHook(() => useAuthorizedPageLinks('u', 's', 'p', true));
    const rows = [null, {}, page('other', 'other'), { ...page('a'), slug: 'keep' }, page('a'), { ...page(''), title: 'No ID' }, { ...page('bad'), title: 4 }, ...Array.from({ length: 110 }, (_, i) => ({ ...page(String(i)), slug: 99 }))];
    vi.mocked(api.get).mockResolvedValue({ data: query ? { results: rows.map((entry) => ({ page: entry })) } : { data: rows } });
    const pages = await result.current(query);
    expect(pages).toHaveLength(query ? 50 : 100);
    expect(pages[0]).toEqual({ id: 'a', title: 'Page a', slug: 'keep' });
    expect(pages[1]).toEqual({ id: '0', title: 'Page 0' });
    expect(new Set(pages.map(({ id }) => id)).size).toBe(pages.length);
    expect(pages.some(({ id }) => ['other', '', 'bad'].includes(id))).toBe(false);
  });

  it.each(['', 'search'])('rejects malformed response envelopes: %s', async (query) => {
    vi.mocked(api.get).mockResolvedValue({ data: { results: {}, data: {} } });
    const { result } = renderHook(() => useAuthorizedPageLinks('u', 's', 'p', true));
    await expect(result.current(query)).rejects.toThrow('Invalid page links response');
  });

  it('aborts superseded requests and rejects late successful responses', async () => {
    const old = deferred();
    vi.mocked(api.get).mockReturnValueOnce(old.promise).mockResolvedValueOnce({ data: { results: [{ page: page('new') }] } });
    const { result } = renderHook(() => useAuthorizedPageLinks('u', 's', 'p', true));
    const pending = result.current('old');
    const signal = vi.mocked(api.get).mock.calls[0][1]!.signal!;
    expect(await result.current('new')).toEqual([{ id: 'new', title: 'Page new' }]);
    expect(signal.aborted).toBe(true);
    old.resolve({ data: { results: [{ page: page('old') }] } });
    await expect(pending).rejects.toThrow('changed scope');
  });

  it('does not dispatch an already cancelled query and unlinks caller abort listeners', async () => {
    const { result } = renderHook(() => useAuthorizedPageLinks('u', 's', 'p', true));
    const cancelled = new AbortController(); cancelled.abort();
    await expect(result.current('query', cancelled.signal)).rejects.toThrow();
    expect(api.get).not.toHaveBeenCalled();
    const caller = new AbortController();
    const remove = vi.spyOn(caller.signal, 'removeEventListener');
    vi.mocked(api.get).mockResolvedValue({ data: { results: [] } });
    await result.current('query', caller.signal);
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('immediately forwards caller cancellation and refuses its delayed result', async () => {
    const pendingResponse = deferred();
    vi.mocked(api.get).mockReturnValue(pendingResponse.promise);
    const { result } = renderHook(() => useAuthorizedPageLinks('u', 's', 'p', true));
    const caller = new AbortController();
    const pending = result.current('query', caller.signal);
    const signal = vi.mocked(api.get).mock.calls[0][1]!.signal!;
    caller.abort(); expect(signal.aborted).toBe(true);
    pendingResponse.resolve({ data: { results: [{ page: page('late') }] } });
    await expect(pending).rejects.toThrow('changed scope');
  });

  it.each(['user', 'space', 'page', 'permission', 'unmount'])('invalidates requests on %s changes', async (change) => {
    const response = deferred();
    vi.mocked(api.get).mockReturnValue(response.promise);
    const initial = { user: 'u', space: 's', page: 'p', canEdit: true };
    const { result, rerender, unmount } = renderHook(({ user, space, page: pageId, canEdit }) => useAuthorizedPageLinks(user, space, pageId, canEdit), { initialProps: initial });
    const pending = result.current('query');
    const signal = vi.mocked(api.get).mock.calls[0][1]!.signal!;
    if (change === 'unmount') unmount();
    else rerender({ ...initial, ...(change === 'permission' ? { canEdit: false } : { [change]: 'other' }) });
    expect(signal.aborted).toBe(true);
    act(() => response.resolve({ data: { results: [{ page: page('private') }] } }));
    await expect(pending).rejects.toThrow('changed scope');
    if (change === 'permission') await expect(result.current()).rejects.toThrow('unavailable');
  });
});
