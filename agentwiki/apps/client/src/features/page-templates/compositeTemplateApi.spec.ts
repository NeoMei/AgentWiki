import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../../api/client';
import {
  archiveCompositeTemplate,
  createCompositeTemplateVersion,
  getCompositeTemplateManagement,
  getLegacyWorkflowUpgradeSource,
  getPageAgentBinding,
  instantiateCompositeTemplate,
  listCompositeTemplates,
  previewFolderTemplate,
  previewLegacyWorkflowUpgrade,
  previewCompositeTemplate,
  previewFolderAgentBindings,
  previewExistingFolderRun,
  restoreCompositeTemplate,
  saveFolderTemplate,
  setPageAgentBinding,
  startExistingPageRun,
  updateCompositeTemplateMetadata,
  upgradeLegacyWorkflow,
} from './compositeTemplateApi';

vi.mock('../../api/client', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() } }));

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

  it('previews an existing Folder Run through the dedicated server boundary', async () => {
    const controller = new AbortController();
    const input = {
      source: { kind: 'template_instantiation' as const, sourceInstantiationId: 'instantiation-1' },
      pageIds: ['page-1'], collaborationInputs: {}, bindings: [],
      bindingEdits: [{ pageId: 'page-1', agentId: 'agent-1', roleSlotKey: 'owner', expectedUpdatedAt: null }],
      roleSlotsByPage: [{ pageId: 'page-1', roleSlotKey: 'owner' }],
    };
    vi.mocked(api.post).mockResolvedValue({ data: {
      treeRevision: '9', pageIds: ['page-1'], pages: [], inputs: {}, inputDefinitions: [], roles: [],
      tasks: [], assignments: [], participants: ['agent-1'], issues: [],
    } });

    await previewExistingFolderRun('space/1', 'folder/1', input, controller.signal);

    expect(api.post).toHaveBeenCalledWith(
      '/spaces/space%2F1/folders/folder%2F1/collaboration-runs/preview', input, { signal: controller.signal },
    );
  });

  it('uses the composite management routes and keeps CAS tokens in every write', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { templateId: 'template/1', version: 2 } });
    vi.mocked(api.post).mockResolvedValue({ data: { id: 'template/1', currentVersion: 3 } });
    vi.mocked(api.patch).mockResolvedValue({ data: { id: 'template/1' } });
    vi.mocked(api.delete).mockResolvedValue({ data: { id: 'template/1' } });

    await getCompositeTemplateManagement('space/1', 'template/1', 2, 'en');
    await updateCompositeTemplateMetadata('space/1', 'template/1', {
      name: 'Name', description: 'Description', category: 'other', defaultTitle: 'Root', expectedUpdatedAt: 'stamp',
    });
    await createCompositeTemplateVersion('space/1', 'template/1', {
      expectedCurrentVersion: 2,
      definition: { schemaVersion: 1, kind: 'page_group', nodes: [], collaboration: null },
    } as never);
    await archiveCompositeTemplate('space/1', 'template/1', 'stamp');
    await restoreCompositeTemplate('space/1', 'template/1', 'next-stamp');

    expect(api.get).toHaveBeenCalledWith('/spaces/space%2F1/templates/template%2F1/management', {
      params: { version: 2, locale: 'en' },
    });
    expect(api.patch).toHaveBeenCalledWith('/spaces/space%2F1/templates/template%2F1', expect.objectContaining({ expectedUpdatedAt: 'stamp' }));
    expect(api.post).toHaveBeenCalledWith('/spaces/space%2F1/templates/template%2F1/versions', expect.objectContaining({ expectedCurrentVersion: 2 }));
    expect(api.delete).toHaveBeenCalledWith('/spaces/space%2F1/templates/template%2F1', { data: { expectedUpdatedAt: 'stamp' } });
    expect(api.post).toHaveBeenCalledWith('/spaces/space%2F1/templates/template%2F1/restore', { expectedUpdatedAt: 'next-stamp' });
  });

  it('posts Folder snapshot selections and never adds client Markdown outside the server preview token', async () => {
    const selection = {
      excludedFolderIds: ['folder-b'], excludedPageIds: ['page-b'], locale: 'zh-CN' as const,
      roleSlotsByPage: [{ pageId: 'page-a', roleSlotKey: 'writer' }], source: { kind: 'simple_pages' as const },
    };
    const preview = {
      definition: { schemaVersion: 1, kind: 'page_group', nodes: [], collaboration: null }, tree: [], roles: [],
      sourceNodes: [], warnings: [], sourceToken: { digest: 'digest', treeRevision: '7', pages: [], workflowSource: {} },
    };
    vi.mocked(api.post).mockResolvedValue({ data: preview });

    await previewFolderTemplate('space', 'folder-a', selection);
    await saveFolderTemplate('space', {
      rootFolderId: 'folder-a', selection, sourceToken: preview.sourceToken,
      acknowledgedWarnings: [], name: 'Reusable', defaultTitle: 'Project', category: 'planning', locale: 'zh-CN',
    });

    expect(api.post).toHaveBeenNthCalledWith(1, '/spaces/space/templates/from-folder/preview', {
      rootFolderId: 'folder-a', selection,
    }, { signal: undefined });
    expect(api.post).toHaveBeenNthCalledWith(2, '/spaces/space/templates/from-folder', expect.objectContaining({
      sourceToken: preview.sourceToken, selection,
    }));
    expect(JSON.stringify(vi.mocked(api.post).mock.calls[1])).not.toContain('clientMarkdown');
  });

  it('uses the server canonical legacy source and exact upgrade result routes', async () => {
    const input = {
      expectedLegacyVersion: 3, expectedLegacyDefinitionHash: 'a'.repeat(64), name: 'Upgraded',
      defaultTitle: 'Workspace', description: 'Description', category: 'planning' as const, locale: 'en' as const,
      nodes: [], taskTargets: [{ taskNodeId: 'draft', pageNodeId: 'page-1' }],
    };
    vi.mocked(api.get).mockResolvedValue({ data: { legacyId: 'legacy/1', version: 3, definitionHash: 'a'.repeat(64), definition: {} } });
    vi.mocked(api.post).mockResolvedValue({ data: { issues: [], definition: {}, definitionHash: 'b'.repeat(64) } });

    await getLegacyWorkflowUpgradeSource('space/1', 'legacy/1');
    await previewLegacyWorkflowUpgrade('space/1', 'legacy/1', input);
    await upgradeLegacyWorkflow('space/1', 'legacy/1', input);

    expect(api.get).toHaveBeenCalledWith('/spaces/space%2F1/collaboration-templates/legacy%2F1/upgrade/source');
    expect(api.post).toHaveBeenNthCalledWith(1, '/spaces/space%2F1/collaboration-templates/legacy%2F1/upgrade/preview', input);
    expect(api.post).toHaveBeenNthCalledWith(2, '/spaces/space%2F1/collaboration-templates/legacy%2F1/upgrade', input);
  });
});
