import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../../api/client';
import {
  getPageAgentBinding,
  instantiateCompositeTemplate,
  listCompositeTemplates,
  previewCompositeTemplate,
  previewFolderAgentBindings,
  setPageAgentBinding,
  startExistingPageRun,
} from './compositeTemplateApi';

vi.mock('../../api/client', () => ({ default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));

describe('compositeTemplateApi', () => {
  beforeEach(() => vi.clearAllMocks());

  it('keeps scope and kind as independent catalog filters', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { data: [], total: 0, skip: 0, take: 100, capabilities: { canManage: true } } });
    await listCompositeTemplates('space/1', { locale: 'zh-CN', scope: 'space', kind: 'page_group' });
    expect(api.get).toHaveBeenCalledWith('/spaces/space%2F1/templates', { params: expect.objectContaining({
      locale: 'zh-CN', scope: 'space', kind: 'page_group', skip: 0, take: 100,
    }), signal: undefined });
  });

  it('posts preview and instantiate payloads without client-authored definitions', async () => {
    const payload = { templateVersion: 2, locale: 'en' as const, variables: {}, collaborationEnabled: false,
      expectedTreeRevision: '7', targetParentFolderId: null };
    vi.mocked(api.post).mockResolvedValue({ data: { treeRevision: '7', nodes: [], pageCount: 1, folderCount: 0,
      roleCount: 0, roles: [], inputs: [], inputValues: {}, tasks: [], assignments: [], participants: [], issues: [] } });
    await previewCompositeTemplate('space', 'template', payload);
    await instantiateCompositeTemplate('space', 'template', { ...payload, idempotencyKey: 'create-12345678' });
    expect(api.post).toHaveBeenNthCalledWith(1, '/spaces/space/templates/template/preview', payload, { signal: undefined });
    expect(api.post).toHaveBeenNthCalledWith(2, '/spaces/space/templates/template/instantiate', { ...payload, idempotencyKey: 'create-12345678' }, { signal: undefined });
    expect(vi.mocked(api.post).mock.calls.flat()).not.toContainEqual(expect.objectContaining({ definition: expect.anything() }));
  });

  it('uses exact binding snapshots and the atomic page start endpoint', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { pageId: 'page-1', agentId: null, roleSlotKey: null, updatedAt: null } });
    vi.mocked(api.put).mockResolvedValue({ data: [{ pageId: 'page-1', agentId: 'agent-1', roleSlotKey: 'owner', updatedAt: 'v2' }] });
    vi.mocked(api.post).mockResolvedValue({ data: { runId: 'run-1' } });
    expect(await getPageAgentBinding('space', 'page-1')).toMatchObject({ updatedAt: null });
    await setPageAgentBinding('space', 'page-1', { agentId: 'agent-1', roleSlotKey: 'owner', expectedUpdatedAt: null, expectedTreeRevision: '9' });
    await startExistingPageRun('space', 'page-1', { name: 'Page run', roleSlotKey: 'owner', collaborationInputs: {}, bindings: [],
      bindingEdits: [{ pageId: 'page-1', agentId: 'agent-1', roleSlotKey: 'owner', expectedUpdatedAt: null }],
      expectedTreeRevision: '9', idempotencyKey: 'start-12345678' });
    expect(api.put).toHaveBeenCalledWith('/spaces/space/pages/page-1/agent-binding', expect.objectContaining({ expectedUpdatedAt: null }));
    expect(api.post).toHaveBeenCalledWith('/spaces/space/pages/page-1/collaboration-runs', expect.objectContaining({
      bindingEdits: [expect.objectContaining({ pageId: 'page-1', agentId: 'agent-1' })],
    }), { signal: undefined });
  });

  it('discovers a Folder subtree on the server rather than accepting loaded child rows', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { treeRevision: '11', pages: [
      { pageId: 'deep-page', title: 'Deep page', agentId: null, roleSlotKey: null, updatedAt: null },
    ] } });
    const result = await previewFolderAgentBindings('space', 'folder-root');
    expect(api.post).toHaveBeenCalledWith('/spaces/space/folders/folder-root/agent-bindings/preview', {}, { signal: undefined });
    expect(result.pages.map((page) => page.pageId)).toEqual(['deep-page']);
  });
});
