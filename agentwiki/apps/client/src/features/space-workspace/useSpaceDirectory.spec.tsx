import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listFolderAncestry, listTreeChildren } from '../content-tree/contentTreeApi';
import type { ContentTreeListResponse } from '../content-tree/contentTreeTypes';
import { useSpaceDirectory } from './useSpaceDirectory';

vi.mock('../content-tree/contentTreeApi', () => ({ listFolderAncestry: vi.fn(), listTreeChildren: vi.fn() }));

const level = (parentFolderId: string | null, id: string, revision = '7'): ContentTreeListResponse => ({
  spaceId: 'space-1', treeRevision: revision, parentFolderId,
  data: [{ kind: 'folder', id, name: id, path: `/${id}`, sortOrder: 0, createdAt: 'now', updatedAt: 'now', hasChildren: true }],
  nextCursor: null,
});

describe('useSpaceDirectory', () => {
  beforeEach(() => vi.clearAllMocks());

  it('loads only the root and the real ancestor levels needed for a deep link', async () => {
    vi.mocked(listFolderAncestry).mockResolvedValue({
      folders: new Map([
        ['a', { id: 'a', parentId: null, name: 'A', path: '/A', createdAt: 'now', updatedAt: 'now' }],
        ['b', { id: 'b', parentId: 'a', name: 'B', path: '/A/B', createdAt: 'now', updatedAt: 'now' }],
        ['c', { id: 'c', parentId: 'b', name: 'C', path: '/A/B/C', createdAt: 'now', updatedAt: 'now' }],
      ]),
      ancestorIds: ['a', 'b', 'c'], treeRevision: '7',
    });
    vi.mocked(listTreeChildren).mockImplementation(async (_spaceId, parent) => level(parent, parent ? `${parent}-child` : 'a'));
    const setFolderExpanded = vi.fn();

    const { result } = renderHook(() => useSpaceDirectory({
      spaceId: 'space-1', targetFolderId: 'c', expandedFolderIds: new Set(), setFolderExpanded,
    }));

    await waitFor(() => expect(result.current.locating).toBe(false));
    expect(vi.mocked(listTreeChildren).mock.calls.map((call) => call[1])).toEqual([null, 'a', 'b', 'c']);
    expect(setFolderExpanded.mock.calls).toEqual([['a', true], ['b', true], ['c', true]]);
    expect(result.current.crumbs.map((crumb) => crumb.id)).toEqual([null, 'a', 'b', 'c']);
  });

  it('rehydrates reachable expanded levels when the selected folder target changes', async () => {
    const expandedFolderIds = new Set(['a', 'b', 'c']);
    vi.mocked(listFolderAncestry).mockResolvedValue({
      folders: new Map([
        ['a', { id: 'a', parentId: null, name: 'A', path: '/A', createdAt: 'now', updatedAt: 'now' }],
        ['b', { id: 'b', parentId: 'a', name: 'B', path: '/A/B', createdAt: 'now', updatedAt: 'now' }],
        ['c', { id: 'c', parentId: 'b', name: 'C', path: '/A/B/C', createdAt: 'now', updatedAt: 'now' }],
      ]),
      ancestorIds: ['a', 'b', 'c'], treeRevision: '7',
    });
    vi.mocked(listTreeChildren).mockImplementation(async (_spaceId, parentFolderId) => {
      const childByParent = new Map<string | null, string>([[null, 'a'], ['a', 'b'], ['b', 'c'], ['c', 'deep-page']]);
      return level(parentFolderId, childByParent.get(parentFolderId) ?? 'unexpected');
    });
    const setFolderExpanded = vi.fn();
    const { result, rerender } = renderHook(({ targetFolderId }) => useSpaceDirectory({
      spaceId: 'space-1', targetFolderId, expandedFolderIds, setFolderExpanded,
    }), { initialProps: { targetFolderId: 'c' as string | null } });
    await waitFor(() => expect(result.current.locating).toBe(false));
    expect([...result.current.levels.keys()]).toEqual([null, 'a', 'b', 'c']);

    rerender({ targetFolderId: null });
    await waitFor(() => expect(result.current.locating).toBe(false));

    expect([...result.current.levels.keys()]).toEqual([null, 'a', 'b', 'c']);
    expect(vi.mocked(listTreeChildren).mock.calls.slice(4).map((call) => call[1])).toEqual([null, 'a', 'b', 'c']);
  });

  it('rehydrates only reachable expanded branches after a transient unresolved Space identity', async () => {
    const expandedFolderIds = new Set(['a', 'b', 'stale']);
    vi.mocked(listTreeChildren).mockImplementation(async (_spaceId, parentFolderId) => {
      if (parentFolderId === null) return {
        ...level(null, 'a'),
        data: [
          { kind: 'folder', id: 'a', name: 'A', path: '/A', sortOrder: 0, createdAt: 'now', updatedAt: 'now', hasChildren: true },
          { kind: 'folder', id: 'closed', name: 'Closed', path: '/Closed', sortOrder: 1, createdAt: 'now', updatedAt: 'now', hasChildren: true },
        ],
      };
      if (parentFolderId === 'a') return level('a', 'b');
      return level(parentFolderId, `${parentFolderId}-child`);
    });
    const setFolderExpanded = vi.fn();
    const { result, rerender } = renderHook(({ spaceId }) => useSpaceDirectory({
      spaceId, targetFolderId: null, expandedFolderIds, setFolderExpanded,
    }), { initialProps: { spaceId: null as string | null } });
    expect(result.current.levels.size).toBe(0);

    rerender({ spaceId: 'space-1' });
    await waitFor(() => expect(result.current.levels.has('b')).toBe(true));

    expect([...result.current.levels.keys()]).toEqual([null, 'a', 'b']);
    expect(vi.mocked(listTreeChildren).mock.calls.map((call) => call[1])).toEqual([null, 'a', 'b']);
  });

  it('drops cached levels and refreshes the root when an expanded level has a different revision', async () => {
    vi.mocked(listTreeChildren)
      .mockResolvedValueOnce(level(null, 'folder-a', '7'))
      .mockResolvedValueOnce(level('folder-a', 'changed-child', '8'))
      .mockResolvedValueOnce(level(null, 'fresh-root', '8'));
    const expanded = new Set<string>();
    const setFolderExpanded = vi.fn((id: string, open: boolean) => { if (open) expanded.add(id); });
    const { result } = renderHook(() => useSpaceDirectory({
      spaceId: 'space-1', targetFolderId: null, expandedFolderIds: expanded,
      setFolderExpanded,
    }));
    await waitFor(() => expect(result.current.levels.has(null)).toBe(true));

    await act(() => result.current.toggleFolder('folder-a'));

    await waitFor(() => expect(result.current.treeRevision).toBe('8'));
    expect(result.current.treeRevision).toBe('8');
    expect(result.current.levels.get(null)?.nodes[0]?.id).toBe('fresh-root');
    expect(result.current.levels.has('folder-a')).toBe(false);
  });

  it('retries the whole deep-link snapshot instead of mixing revisions between levels', async () => {
    vi.mocked(listFolderAncestry)
      .mockResolvedValueOnce({ folders: new Map(), ancestorIds: ['a'], treeRevision: '7' })
      .mockResolvedValueOnce({ folders: new Map(), ancestorIds: ['a'], treeRevision: '8' });
    vi.mocked(listTreeChildren)
      .mockResolvedValueOnce(level(null, 'stale-root', '7'))
      .mockResolvedValueOnce(level('a', 'changed-child', '8'))
      .mockResolvedValueOnce(level(null, 'fresh-root', '8'))
      .mockResolvedValueOnce(level('a', 'fresh-child', '8'));
    const setFolderExpanded = vi.fn();

    const { result } = renderHook(() => useSpaceDirectory({
      spaceId: 'space-1', targetFolderId: 'a', expandedFolderIds: new Set(),
      setFolderExpanded,
    }));

    await waitFor(() => expect(result.current.locating).toBe(false));
    expect(result.current.treeRevision).toBe('8');
    expect(result.current.levels.get(null)?.nodes[0]?.id).toBe('fresh-root');
    expect(result.current.levels.get('a')?.nodes[0]?.id).toBe('fresh-child');
    expect([...result.current.levels.values()].every((entry) => entry.treeRevision === '8')).toBe(true);
  });

  it('retries the whole snapshot when a preserved expanded branch changes revision', async () => {
    vi.mocked(listTreeChildren)
      .mockResolvedValueOnce(level(null, 'a', '7'))
      .mockResolvedValueOnce(level('a', 'stale-child', '8'))
      .mockResolvedValueOnce(level(null, 'a', '8'))
      .mockResolvedValueOnce(level('a', 'fresh-child', '8'));
    const setFolderExpanded = vi.fn();
    const { result } = renderHook(() => useSpaceDirectory({
      spaceId: 'space-1', targetFolderId: null, expandedFolderIds: new Set(['a']), setFolderExpanded,
    }));

    await waitFor(() => expect(result.current.locating).toBe(false));

    expect(vi.mocked(listTreeChildren).mock.calls.map((call) => call[1])).toEqual([null, 'a', null, 'a']);
    expect(result.current.levels.get(null)?.nodes[0]?.id).toBe('a');
    expect(result.current.levels.get('a')?.nodes[0]?.id).toBe('fresh-child');
    expect([...result.current.levels.values()].every((entry) => entry.treeRevision === '8')).toBe(true);
  });

  it('clears every cached level after directory authorization is revoked', async () => {
    vi.mocked(listTreeChildren)
      .mockResolvedValueOnce(level(null, 'folder-a', '7'))
      .mockRejectedValueOnce({ response: { status: 403 } });
    const setFolderExpanded = vi.fn();
    const { result } = renderHook(() => useSpaceDirectory({
      spaceId: 'space-1', targetFolderId: null, expandedFolderIds: new Set(),
      setFolderExpanded,
    }));
    await waitFor(() => expect(result.current.levels.has(null)).toBe(true));

    await act(() => result.current.reloadLevel('folder-a'));

    expect(result.current.levels.size).toBe(0);
    expect(result.current.folderIndex.size).toBe(0);
    expect(result.current.treeRevision).toBeNull();
    expect(result.current.error).toBeTruthy();
  });

  it('aborts a lazy level request when the Space generation changes and ignores its late result', async () => {
    let resolveLazy!: (value: ContentTreeListResponse) => void;
    const lazy = new Promise<ContentTreeListResponse>((resolve) => { resolveLazy = resolve; });
    let lazySignal: AbortSignal | undefined;
    vi.mocked(listTreeChildren).mockImplementation(async (spaceId, parentFolderId, signal) => {
      if (spaceId === 'space-1' && parentFolderId === null) return level(null, 'folder-a', '7');
      if (spaceId === 'space-1' && parentFolderId === 'folder-a') {
        lazySignal = signal;
        return lazy;
      }
      return { ...level(null, 'space-2-root', '9'), spaceId: 'space-2' };
    });
    const setFolderExpanded = vi.fn();
    const { result, rerender } = renderHook(({ spaceId }) => useSpaceDirectory({
      spaceId, targetFolderId: null, expandedFolderIds: new Set(), setFolderExpanded,
    }), { initialProps: { spaceId: 'space-1' as string | null } });
    await waitFor(() => expect(result.current.levels.has(null)).toBe(true));

    let lazyRequest!: Promise<void>;
    act(() => { lazyRequest = result.current.reloadLevel('folder-a'); });
    await waitFor(() => expect(lazySignal).toBeDefined());
    rerender({ spaceId: 'space-2' });

    expect(lazySignal?.aborted).toBe(true);
    resolveLazy(level('folder-a', 'stale-child', '7'));
    await act(() => lazyRequest);
    await waitFor(() => expect(result.current.treeRevision).toBe('9'));
    expect(result.current.levels.get('folder-a')).toBeUndefined();
    expect(result.current.levels.get(null)?.nodes[0]?.id).toBe('space-2-root');
  });

  it('aborts sibling reloads and prevents cache refill after authorization is revoked', async () => {
    let resolveSibling!: (value: ContentTreeListResponse) => void;
    const sibling = new Promise<ContentTreeListResponse>((resolve) => { resolveSibling = resolve; });
    let siblingSignal: AbortSignal | undefined;
    vi.mocked(listTreeChildren).mockImplementation(async (_spaceId, parentFolderId, signal) => {
      if (parentFolderId === null) return level(null, 'folder-a', '7');
      if (parentFolderId === 'folder-a') {
        siblingSignal = signal;
        return sibling;
      }
      throw { response: { status: 403 } };
    });
    const setFolderExpanded = vi.fn();
    const { result } = renderHook(() => useSpaceDirectory({
      spaceId: 'space-1', targetFolderId: null, expandedFolderIds: new Set(), setFolderExpanded,
    }));
    await waitFor(() => expect(result.current.levels.has(null)).toBe(true));

    let siblingRequest!: Promise<void>;
    act(() => { siblingRequest = result.current.reloadLevel('folder-a'); });
    await waitFor(() => expect(siblingSignal).toBeDefined());
    await act(() => result.current.reloadLevel('folder-b'));

    expect(siblingSignal?.aborted).toBe(true);
    resolveSibling(level('folder-a', 'must-not-return', '7'));
    await act(() => siblingRequest);
    expect(result.current.levels.size).toBe(0);
    expect(result.current.folderIndex.size).toBe(0);
  });
});
