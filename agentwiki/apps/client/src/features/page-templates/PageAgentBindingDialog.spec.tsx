import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../context/LanguageContext';
import { MemoryRouter } from 'react-router-dom';
import { PageAgentBindingDialog } from './PageAgentBindingDialog';

const mocks = vi.hoisted(() => ({
  listMembers: vi.fn(), getRun: vi.fn(), getTreeRevision: vi.fn(),
  getPageBinding: vi.fn(), setPageBinding: vi.fn(), deletePageBinding: vi.fn(),
  previewFolderBindings: vi.fn(), setFolderBindings: vi.fn(), startPageRun: vi.fn(), startFolderRun: vi.fn(),
  discoverFolderSource: vi.fn(), previewFolderRun: vi.fn(),
}));

vi.mock('../collaboration/api', () => ({ collaborationApi: { listMembers: mocks.listMembers, getRun: mocks.getRun } }));
vi.mock('../../api/content-tree', () => ({ getContentTreeRevision: mocks.getTreeRevision }));
vi.mock('./compositeTemplateApi', () => ({
  getPageAgentBinding: mocks.getPageBinding,
  setPageAgentBinding: mocks.setPageBinding,
  deletePageAgentBinding: mocks.deletePageBinding,
  previewFolderAgentBindings: mocks.previewFolderBindings,
  setFolderAgentBindings: mocks.setFolderBindings,
  startExistingPageRun: mocks.startPageRun,
  startExistingFolderRun: mocks.startFolderRun,
  previewExistingFolderRun: mocks.previewFolderRun,
  discoverFolderCollaborationSource: mocks.discoverFolderSource,
}));

const agents = [
  { type: 'agent', agentId: 'agent-1', role: 'editor', agent: { id: 'agent-1', name: 'Alpha', status: 'active', connected: true } },
  { type: 'agent', agentId: 'reader-1', role: 'reader', agent: { id: 'reader-1', name: 'Read only', status: 'active' } },
];

const renderDialog = (scope: { kind: 'page'; pageId: string; title: string } | { kind: 'folder'; folderId: string; name: string }) => render(
  <LanguageProvider><MemoryRouter><PageAgentBindingDialog spaceId="space-1" scope={scope} onClose={() => undefined} onSaved={() => undefined} /></MemoryRouter></LanguageProvider>,
);

describe('PageAgentBindingDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks(); localStorage.setItem('agentwiki.language.v1', 'zh-CN');
    mocks.listMembers.mockResolvedValue(agents); mocks.getTreeRevision.mockResolvedValue('17');
    mocks.getPageBinding.mockResolvedValue({ pageId: 'page-1', agentId: null, roleSlotKey: null, updatedAt: null });
    mocks.previewFolderBindings.mockResolvedValue({ treeRevision: '18', pages: [
      { pageId: 'page-1', title: 'One', agentId: null, roleSlotKey: null, updatedAt: null },
      { pageId: 'page-deep', title: 'Deep', agentId: 'agent-old', roleSlotKey: 'owner', updatedAt: 'v1' },
    ] });
    mocks.setPageBinding.mockResolvedValue([]); mocks.setFolderBindings.mockResolvedValue([]);
    mocks.discoverFolderSource.mockResolvedValue({ source: null });
    mocks.previewFolderRun.mockResolvedValue({
      treeRevision: '18', pageIds: ['page-1', 'page-deep'],
      pages: [{ pageId: 'page-1', title: 'One' }, { pageId: 'page-deep', title: 'Deep' }],
      inputs: {}, inputDefinitions: [],
      roles: [{ id: 'writer', name: 'Writer', description: '', required: true }],
      tasks: [{ nodeId: 'write-release', name: 'Write release', roleSlotId: 'writer' }],
      assignments: [{ nodeId: 'write-release', roleSlotId: 'writer', agentId: 'agent-1' }],
      participants: ['agent-1'], issues: [],
    });
    mocks.startPageRun.mockResolvedValue({ runId: 'run-1' }); mocks.startFolderRun.mockResolvedValue({ runId: 'run-folder' });
    mocks.getRun.mockResolvedValue({ id: 'run-1', roleBindings: [], joinInstructions: [] });
  });

  it('saves a late Page binding without starting by default', async () => {
    renderDialog({ kind: 'page', pageId: 'page-1', title: 'Page one' });
    expect(await screen.findByRole('checkbox', { name: '保存后立即启动协作' })).not.toBeChecked();
    expect(screen.getByRole('option', { name: /Read only/ })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('主责 Agent'), { target: { value: 'agent-1' } });
    fireEvent.click(screen.getByRole('button', { name: '保存绑定' }));
    await waitFor(() => expect(mocks.setPageBinding).toHaveBeenCalledWith('space-1', 'page-1', {
      agentId: 'agent-1', roleSlotKey: 'owner', expectedUpdatedAt: null, expectedTreeRevision: '17',
    }));
    expect(mocks.startPageRun).not.toHaveBeenCalled();
  });

  it('unbinds an existing Page with its exact binding and tree versions', async () => {
    mocks.getPageBinding.mockResolvedValue({ pageId: 'page-1', agentId: 'agent-1', roleSlotKey: 'owner', updatedAt: 'binding-v1' });
    renderDialog({ kind: 'page', pageId: 'page-1', title: 'Page one' });
    await screen.findByLabelText('主责 Agent');
    fireEvent.change(screen.getByLabelText('主责 Agent'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: '保存绑定' }));
    await waitFor(() => expect(mocks.deletePageBinding).toHaveBeenCalledWith('space-1', 'page-1', {
      expectedUpdatedAt: 'binding-v1', expectedTreeRevision: '17',
    }));
    expect(mocks.startPageRun).not.toHaveBeenCalled();
  });

  it('uses the atomic Page start endpoint instead of saving then starting', async () => {
    renderDialog({ kind: 'page', pageId: 'page-1', title: 'Page one' });
    await screen.findByLabelText('主责 Agent');
    fireEvent.change(screen.getByLabelText('主责 Agent'), { target: { value: 'agent-1' } });
    fireEvent.click(screen.getByRole('checkbox', { name: '保存后立即启动协作' }));
    fireEvent.click(screen.getByRole('button', { name: '保存绑定并启动' }));
    await waitFor(() => expect(mocks.startPageRun).toHaveBeenCalledWith('space-1', 'page-1', expect.objectContaining({
      bindingEdits: [{ pageId: 'page-1', agentId: 'agent-1', roleSlotKey: 'owner', expectedUpdatedAt: null }],
      expectedTreeRevision: '17',
    }), expect.any(AbortSignal)));
    expect(mocks.setPageBinding).not.toHaveBeenCalled();
  });

  it('shows the server-discovered Folder page IDs and sends that exact versioned scope', async () => {
    renderDialog({ kind: 'folder', folderId: 'folder-root', name: 'Root' });
    const list = await screen.findByTestId('binding-page-scope');
    const unboundRow = within(list).getByText('page-1').closest('li');
    const boundRow = within(list).getByText('page-deep').closest('li');
    expect(unboundRow).toHaveTextContent('One');
    expect(unboundRow).toHaveTextContent('未绑定');
    expect(boundRow).toHaveTextContent('Deep');
    expect(boundRow).toHaveTextContent('agent-old');
    expect(boundRow).toHaveTextContent('owner');
    expect(boundRow).toHaveTextContent('v1');
    fireEvent.change(screen.getByLabelText('主责 Agent'), { target: { value: 'agent-1' } });
    fireEvent.click(screen.getByRole('button', { name: '保存绑定' }));
    await waitFor(() => expect(mocks.setFolderBindings).toHaveBeenCalledWith('space-1', 'folder-root', {
      pageIds: ['page-1', 'page-deep'], expectedTreeRevision: '18', edits: [
        { pageId: 'page-1', agentId: 'agent-1', roleSlotKey: 'owner', expectedUpdatedAt: null },
        { pageId: 'page-deep', agentId: 'agent-1', roleSlotKey: 'owner', expectedUpdatedAt: 'v1' },
      ],
    }));
  });

  it('starts the next composite Run from exact provenance without creating or duplicating Pages', async () => {
    mocks.discoverFolderSource.mockResolvedValue({ source: {
      sourceInstantiationId: 'instantiation-1', compositeTemplateVersionId: 'version-2',
      templateId: 'template-1', templateVersion: 2, rootFolderId: 'folder-root',
      nodes: [
        { templateNodeId: 'root', kind: 'folder', folderId: 'folder-root', pageId: null },
        { templateNodeId: 'page-a', kind: 'page', folderId: null, pageId: 'page-1' },
        { templateNodeId: 'page-b', kind: 'page', folderId: null, pageId: 'page-deep' },
      ],
    } });
    renderDialog({ kind: 'folder', folderId: 'folder-root', name: 'Root' });
    await screen.findByLabelText('主责 Agent');
    expect(screen.getByRole('radio', { name: /沿用原组合工作流/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /改用显式的简单页面职责/ })).not.toBeChecked();
    fireEvent.change(screen.getByLabelText('主责 Agent'), { target: { value: 'agent-1' } });
    fireEvent.click(screen.getByRole('checkbox', { name: '保存后立即启动协作' }));
    expect(screen.getByRole('button', { name: '保存绑定并启动' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '预览本次协作' }));

    expect(await screen.findByText('Write release')).toBeVisible();
    expect(screen.getAllByText(/Alpha/).some((element) => element.closest('li'))).toBe(true);
    expect(mocks.previewFolderRun).toHaveBeenCalledWith('space-1', 'folder-root', expect.objectContaining({
      source: { kind: 'template_instantiation', sourceInstantiationId: 'instantiation-1' },
      pageIds: ['page-1', 'page-deep'],
    }), expect.any(AbortSignal));
    fireEvent.click(screen.getByRole('button', { name: '保存绑定并启动' }));

    await waitFor(() => expect(mocks.startFolderRun).toHaveBeenCalledWith('space-1', 'folder-root', expect.objectContaining({
      source: { kind: 'template_instantiation', sourceInstantiationId: 'instantiation-1' },
      pageIds: ['page-1', 'page-deep'],
    }), expect.any(AbortSignal)));
    expect(mocks.startFolderRun.mock.calls[0]?.[2].pageIds).toEqual(['page-1', 'page-deep']);
  });
});
