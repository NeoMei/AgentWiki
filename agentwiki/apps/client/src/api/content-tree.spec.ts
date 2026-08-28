import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from './client';
import { getContentTreeRevision } from './content-tree';

vi.mock('./client', () => ({ default: { get: vi.fn() } }));

describe('content-tree API', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reads a decimal tree revision from the bounded root listing', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { treeRevision: '53', data: [] } } as any);

    await expect(getContentTreeRevision('space/one')).resolves.toBe('53');
    expect(api.get).toHaveBeenCalledWith('/spaces/space%2Fone/content-tree', { params: { take: 1 } });
  });
});
