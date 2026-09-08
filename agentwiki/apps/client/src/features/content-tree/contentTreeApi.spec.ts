import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../../api/client';
import { listFolderAncestry, listTreeChildren } from './contentTreeApi';

vi.mock('../../api/client', () => ({ default: { get: vi.fn() } }));

const folder = (id: string, parentId: string | null) => ({
  id,
  parentId,
  name: id,
  path: `/${id}`,
  createdAt: '2026-09-08T00:00:00.000Z',
  updatedAt: '2026-09-08T00:00:00.000Z',
});

describe('content-tree coherent pagination', () => {
  beforeEach(() => vi.clearAllMocks());

  it('discards mixed tree revisions and retries the whole child level', async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce({ data: { spaceId: 'space-1', parentFolderId: null, treeRevision: '7', data: [], nextCursor: 'old' } })
      .mockResolvedValueOnce({ data: { spaceId: 'space-1', parentFolderId: null, treeRevision: '8', data: [], nextCursor: null } })
      .mockResolvedValueOnce({ data: { spaceId: 'space-1', parentFolderId: null, treeRevision: '9', data: [{ kind: 'page', id: 'fresh' }], nextCursor: null } });

    const result = await listTreeChildren('space-1', null);

    expect(result.treeRevision).toBe('9');
    expect(result.data).toEqual([{ kind: 'page', id: 'fresh' }]);
    expect(api.get).toHaveBeenCalledTimes(3);
  });

  it('stops folder pagination once the target and its real parent chain are known', async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce({ data: { spaceId: 'space-1', treeRevision: '12', data: [folder('root-a', null), folder('middle', 'root-a')], nextCursor: 'page-2' } })
      .mockResolvedValueOnce({ data: { spaceId: 'space-1', treeRevision: '12', data: [folder('target', 'middle')], nextCursor: 'unused-page' } });

    const result = await listFolderAncestry('space-1', 'target');

    expect([...result.folders.keys()]).toEqual(['root-a', 'middle', 'target']);
    expect(result.ancestorIds).toEqual(['root-a', 'middle', 'target']);
    expect(api.get).toHaveBeenCalledTimes(2);
    expect(vi.mocked(api.get).mock.calls[1]?.[1]).toMatchObject({ params: { cursor: 'page-2' } });
  });
});
