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
  { type: 'agent', agentId: 'agent-2', role: 'editor', agent: { id: 'agent-2', name: 'Beta', status: 'active', connected: true } },
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

  it('shows the Page title in the exact binding scope instead of repeating its ID', async () => {
    renderDialog({ kind: 'page', pageId: 'page-1', title: 'Page one' });
    const scope = await screen.findByTestId('binding-page-scope');
    expect(within(scope).getByText('Page one')).toBeVisible();
    expect(within(scope).getAllByText('page-1')).toHaveLength(1);
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
    fireEvent.click(screen.getByRole('radio', { name: '批量替换所选页面的默认绑定' }));
    fireEvent.change(screen.getByLabelText('批量替换为 Agent'), { target: { value: 'agent-1' } });
    fireEvent.click(screen.getByRole('button', { name: '保存绑定' }));
    await waitFor(() => expect(mocks.setFolderBindings).toHaveBeenCalledWith('space-1', 'folder-root', {
      pageIds: ['page-1', 'page-deep'], expectedTreeRevision: '18', edits: [
        { pageId: 'page-1', agentId: 'agent-1', roleSlotKey: 'owner', expectedUpdatedAt: null },
        { pageId: 'page-deep', agentId: 'agent-1', roleSlotKey: 'owner', expectedUpdatedAt: 'v1' },
      ],
    }));
  });

  it('requests the authoritative Folder preview without an ID-only source snapshot so Page titles remain visible', async () => {
    mocks.discoverFolderSource.mockResolvedValue({ source: exactFolderSource() });
    renderDialog({ kind: 'folder', folderId: 'folder-root', name: 'Root' });
    const scope = await screen.findByTestId('binding-page-scope');

    expect(mocks.previewFolderBindings).toHaveBeenCalledWith('space-1', 'folder-root', undefined, expect.any(AbortSignal));
    expect(within(scope).getByRole('checkbox', { name: '将 One 纳入绑定范围' })).toBeVisible();
    expect(within(scope).getByRole('checkbox', { name: '将 Deep 纳入绑定范围' })).toBeVisible();
  });

  it('writes only the explicitly selected Folder Pages and leaves unselected bindings outside the mutation scope', async () => {
    renderDialog({ kind: 'folder', folderId: 'folder-root', name: 'Root' });
    await screen.findByTestId('binding-page-scope');
    fireEvent.click(screen.getByRole('checkbox', { name: '将 Deep 纳入绑定范围' }));
    fireEvent.click(screen.getByRole('radio', { name: '批量替换所选页面的默认绑定' }));
    fireEvent.change(screen.getByLabelText('批量替换为 Agent'), { target: { value: 'agent-1' } });
    fireEvent.click(screen.getByRole('button', { name: '保存绑定' }));

    await waitFor(() => expect(mocks.setFolderBindings).toHaveBeenCalledWith('space-1', 'folder-root', {
      pageIds: ['page-1'], expectedTreeRevision: '18', edits: [
        { pageId: 'page-1', agentId: 'agent-1', roleSlotKey: 'owner', expectedUpdatedAt: null },
      ],
    }));
  });

  it('disables Folder save and start for an empty Page scope and invalidates a preview when scope changes', async () => {
    mocks.discoverFolderSource.mockResolvedValue({ source: null });
    renderDialog({ kind: 'folder', folderId: 'folder-root', name: 'Root' });
    await screen.findByTestId('binding-page-scope');
    fireEvent.click(screen.getByRole('radio', { name: '批量替换所选页面的默认绑定' }));
    fireEvent.change(screen.getByLabelText('批量替换为 Agent'), { target: { value: 'agent-1' } });
    fireEvent.click(screen.getByRole('checkbox', { name: '保存后立即启动协作' }));
    fireEvent.click(screen.getByRole('button', { name: '预览本次协作' }));
    expect(await screen.findByRole('checkbox', { name: 'Write release' })).toBeVisible();
    expect(screen.getByRole('button', { name: '保存绑定并启动' })).toBeEnabled();

    fireEvent.click(screen.getByRole('checkbox', { name: '将 Deep 纳入绑定范围' }));
    expect(screen.getByText('已选择 1/2 个页面；仅保存或预览/启动所选页面。')).toBeVisible();
    expect(screen.getByRole('button', { name: '保存绑定并启动' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '预览本次协作' }));
    await waitFor(() => expect(mocks.previewFolderRun).toHaveBeenCalledTimes(2));
    expect(mocks.previewFolderRun.mock.calls[1]?.[2]).toEqual(expect.objectContaining({
      pageIds: ['page-1'],
      bindingEdits: [{ pageId: 'page-1', agentId: 'agent-1', roleSlotKey: 'owner', expectedUpdatedAt: null }],
    }));

    fireEvent.click(screen.getByRole('checkbox', { name: '将 One 纳入绑定范围' }));
    expect(screen.getByText('请至少选择一个页面。')).toBeVisible();
    expect(screen.getByRole('button', { name: '保存绑定并启动' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '预览本次协作' })).toBeDisabled();
  });

  it('keeps a narrowed Page scope when changing source and surfaces exact-template validation issues', async () => {
    mocks.discoverFolderSource.mockResolvedValue({ source: exactFolderSource() });
    mocks.previewFolderRun.mockResolvedValueOnce({
      treeRevision: '19', pageIds: ['page-1'], pages: [{ pageId: 'page-1', title: 'One' }],
      inputs: {}, inputDefinitions: [], roles: [], tasks: [], assignments: [], participants: [],
      issues: [{ code: 'PAGE_ROLE_REQUIRED' }],
    }).mockResolvedValueOnce({
      treeRevision: '19', pageIds: ['page-1'], pages: [{ pageId: 'page-1', title: 'One' }],
      inputs: {}, inputDefinitions: [], roles: [], tasks: [], assignments: [], participants: [], issues: [],
    });

    renderDialog({ kind: 'folder', folderId: 'folder-root', name: 'Root' });
    await screen.findByRole('radio', { name: /沿用原组合工作流/ });
    fireEvent.click(screen.getByRole('checkbox', { name: '将 Deep 纳入绑定范围' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '保存后立即启动协作' }));
    fireEvent.click(screen.getByRole('button', { name: '预览本次协作' }));

    expect(await screen.findByText('仍有页面需要明确职责。')).toBeVisible();
    expect(mocks.previewFolderRun.mock.calls[0]?.[2]).toEqual(expect.objectContaining({
      source: { kind: 'template_instantiation', sourceInstantiationId: 'instantiation-1' },
      pageIds: ['page-1'],
    }));
    expect(screen.getByRole('button', { name: '保存绑定并启动' })).toBeDisabled();

    fireEvent.click(screen.getByRole('radio', { name: /改用显式的简单页面职责/ }));
    fireEvent.click(screen.getByRole('button', { name: '预览本次协作' }));
    await waitFor(() => expect(mocks.previewFolderRun).toHaveBeenCalledTimes(2));
    expect(mocks.previewFolderRun.mock.calls[1]?.[2]).toEqual(expect.objectContaining({
      source: { kind: 'page_selection' },
      pageIds: ['page-1'],
    }));
  });

  it('ignores an in-flight preview after the Folder Page scope changes', async () => {
    let resolveStalePreview: ((value: Awaited<ReturnType<typeof mocks.previewFolderRun>>) => void) | undefined;
    const stalePreview = new Promise<Awaited<ReturnType<typeof mocks.previewFolderRun>>>((resolve) => {
      resolveStalePreview = resolve;
    });
    mocks.previewFolderRun.mockReturnValueOnce(stalePreview).mockResolvedValueOnce({
      treeRevision: '19', pageIds: ['page-1'], pages: [{ pageId: 'page-1', title: 'One' }],
      inputs: {}, inputDefinitions: [], roles: [],
      tasks: [{ nodeId: 'current-task', name: 'Current task', roleSlotId: 'owner' }],
      assignments: [], participants: [], issues: [],
    });

    renderDialog({ kind: 'folder', folderId: 'folder-root', name: 'Root' });
    await screen.findByTestId('binding-page-scope');
    fireEvent.click(screen.getByRole('checkbox', { name: '保存后立即启动协作' }));
    fireEvent.click(screen.getByRole('button', { name: '预览本次协作' }));
    await waitFor(() => expect(mocks.previewFolderRun).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('checkbox', { name: '将 Deep 纳入绑定范围' }));
    fireEvent.click(screen.getByRole('button', { name: '预览本次协作' }));
    expect((await screen.findAllByText('Current task')).length).toBeGreaterThan(0);

    resolveStalePreview?.({
      treeRevision: '18', pageIds: ['page-1', 'page-deep'], pages: [], inputs: {}, inputDefinitions: [], roles: [],
      tasks: [{ nodeId: 'stale-task', name: 'Stale task', roleSlotId: 'owner' }],
      assignments: [], participants: [], issues: [],
    });
    await waitFor(() => expect(screen.queryByText('Stale task')).not.toBeInTheDocument());
    expect(mocks.previewFolderRun.mock.calls[1]?.[2]).toEqual(expect.objectContaining({ pageIds: ['page-1'] }));
  });

  it('allows an explicit Folder bulk unbind without starting a Run', async () => {
    renderDialog({ kind: 'folder', folderId: 'folder-root', name: 'Root' });
    await screen.findByRole('radio', { name: '保留各页面当前默认绑定' });
    fireEvent.click(screen.getByRole('radio', { name: '批量替换所选页面的默认绑定' }));
    expect(screen.getByLabelText('批量替换为 Agent')).toHaveValue('');
    fireEvent.click(screen.getByRole('button', { name: '保存绑定' }));

    await waitFor(() => expect(mocks.setFolderBindings).toHaveBeenCalledWith('space-1', 'folder-root', {
      pageIds: ['page-1', 'page-deep'], expectedTreeRevision: '18', edits: [
        { pageId: 'page-1', agentId: null, roleSlotKey: null, expectedUpdatedAt: null },
        { pageId: 'page-deep', agentId: null, roleSlotKey: null, expectedUpdatedAt: 'v1' },
      ],
    }));
    expect(mocks.startFolderRun).not.toHaveBeenCalled();
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
    await screen.findByRole('radio', { name: '保留各页面当前默认绑定' });
    expect(screen.getByRole('radio', { name: /沿用原组合工作流/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /改用显式的简单页面职责/ })).not.toBeChecked();
    fireEvent.click(screen.getByRole('checkbox', { name: '保存后立即启动协作' }));
    expect(screen.getByRole('button', { name: '保存绑定并启动' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '预览本次协作' }));

    expect(await screen.findByRole('checkbox', { name: 'Write release' })).toBeVisible();
    expect(screen.getAllByText(/Alpha/).some((element) => element.closest('li'))).toBe(true);
    expect(mocks.previewFolderRun).toHaveBeenCalledWith('space-1', 'folder-root', expect.objectContaining({
      source: { kind: 'template_instantiation', sourceInstantiationId: 'instantiation-1' },
      pageIds: ['page-1', 'page-deep'],
    }), expect.any(AbortSignal));
    expect(mocks.previewFolderRun.mock.calls[0]?.[2]).not.toHaveProperty('bindingEdits');
    fireEvent.click(screen.getByRole('button', { name: '保存绑定并启动' }));

    await waitFor(() => expect(mocks.startFolderRun).toHaveBeenCalledWith('space-1', 'folder-root', expect.objectContaining({
      source: { kind: 'template_instantiation', sourceInstantiationId: 'instantiation-1' },
      pageIds: ['page-1', 'page-deep'],
      expectedTreeRevision: '18',
    }), expect.any(AbortSignal)));
    expect(mocks.startFolderRun.mock.calls[0]?.[2].pageIds).toEqual(['page-1', 'page-deep']);
  });

  it('keeps heterogeneous Page bindings by default and preserves both authoritative assignments', async () => {
    mocks.discoverFolderSource.mockResolvedValue({ source: exactFolderSource() });
    mocks.previewFolderBindings.mockResolvedValue({ treeRevision: '18', pages: [
      { pageId: 'page-1', title: 'One', agentId: 'agent-1', roleSlotKey: 'writer', updatedAt: 'v1' },
      { pageId: 'page-deep', title: 'Deep', agentId: 'agent-2', roleSlotKey: 'reviewer', updatedAt: 'v2' },
    ] });
    mocks.previewFolderRun.mockResolvedValue({
      treeRevision: '19', pageIds: ['page-1', 'page-deep'],
      pages: [{ pageId: 'page-1', title: 'One' }, { pageId: 'page-deep', title: 'Deep' }],
      inputs: {}, inputDefinitions: [],
      roles: [
        { id: 'writer', name: 'Writer', description: '', required: true },
        { id: 'reviewer', name: 'Reviewer', description: '', required: true },
      ],
      tasks: [
        { nodeId: 'write', name: 'Write', roleSlotId: 'writer' },
        { nodeId: 'review', name: 'Review', roleSlotId: 'reviewer' },
      ],
      assignments: [
        { nodeId: 'write', roleSlotId: 'writer', agentId: 'agent-1' },
        { nodeId: 'review', roleSlotId: 'reviewer', agentId: 'agent-2' },
      ],
      participants: ['agent-1', 'agent-2'], issues: [],
    });

    renderDialog({ kind: 'folder', folderId: 'folder-root', name: 'Root' });
    expect(await screen.findByRole('radio', { name: '保留各页面当前默认绑定' })).toBeChecked();
    fireEvent.click(screen.getByRole('checkbox', { name: '保存后立即启动协作' }));
    fireEvent.click(screen.getByRole('button', { name: '预览本次协作' }));
    expect(await screen.findByRole('checkbox', { name: 'Review' })).toBeVisible();
    expect(screen.getByText(/Beta · agent-2/)).toBeVisible();
    expect(mocks.previewFolderRun.mock.calls[0]?.[2]).toEqual(expect.objectContaining({
      collaborationInputs: {}, bindings: [],
    }));
    expect(mocks.previewFolderRun.mock.calls[0]?.[2]).not.toHaveProperty('bindingEdits');
    fireEvent.click(screen.getByRole('button', { name: '保存绑定并启动' }));
    await waitFor(() => expect(mocks.startFolderRun).toHaveBeenCalled());
    expect(mocks.startFolderRun.mock.calls[0]?.[2]).toEqual(expect.objectContaining({ expectedTreeRevision: '19' }));
    expect(mocks.startFolderRun.mock.calls[0]?.[2]).not.toHaveProperty('bindingEdits');
  });

  it('makes required workflow input and unresolved roles actionable and invalidates stale preview', async () => {
    mocks.discoverFolderSource.mockResolvedValue({ source: exactFolderSource() });
    const blockedPreview = {
      treeRevision: '19', pageIds: ['page-1', 'page-deep'], pages: [], inputs: {},
      inputDefinitions: [{ key: 'brief', label: '项目简述', type: 'short_text', required: true }],
      roles: [{ id: 'reviewer', name: '审核人', description: '审核交付', required: true }],
      tasks: [{ nodeId: 'review', name: '审核交付', roleSlotId: 'reviewer' }],
      assignments: [], participants: [],
      issues: [{ code: 'COLLABORATION_INPUT_REQUIRED' }, { code: 'ROLE_BINDING_REQUIRED' }],
    };
    mocks.previewFolderRun.mockResolvedValueOnce(blockedPreview).mockResolvedValueOnce({
      ...blockedPreview, inputs: { brief: '发布说明' },
      assignments: [{ nodeId: 'review', roleSlotId: 'reviewer', agentId: 'agent-2' }],
      participants: ['agent-2'], issues: [],
    });

    renderDialog({ kind: 'folder', folderId: 'folder-root', name: 'Root' });
    await screen.findByRole('radio', { name: '保留各页面当前默认绑定' });
    fireEvent.click(screen.getByRole('checkbox', { name: '保存后立即启动协作' }));
    fireEvent.click(screen.getByRole('button', { name: '预览本次协作' }));
    expect(await screen.findByLabelText('项目简述')).toBeRequired();
    fireEvent.change(screen.getByLabelText('项目简述'), { target: { value: '发布说明' } });
    fireEvent.change(screen.getByLabelText('审核人'), { target: { value: 'agent-2' } });
    expect(screen.getByRole('button', { name: '保存绑定并启动' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '预览本次协作' }));
    await waitFor(() => expect(mocks.previewFolderRun).toHaveBeenCalledTimes(2));
    expect(mocks.previewFolderRun.mock.calls[1]?.[2]).toEqual(expect.objectContaining({
      collaborationInputs: { brief: '发布说明' },
      bindings: [{ kind: 'role_override', roleSlotId: 'reviewer', agentId: 'agent-2' }],
    }));
    expect(await screen.findByText(/Beta · agent-2/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '保存绑定并启动' }));
    await waitFor(() => expect(mocks.startFolderRun).toHaveBeenCalledWith('space-1', 'folder-root', expect.objectContaining({
      collaborationInputs: { brief: '发布说明' },
      bindings: [{ kind: 'role_override', roleSlotId: 'reviewer', agentId: 'agent-2' }],
      expectedTreeRevision: '19',
    }), expect.any(AbortSignal)));
    expect(mocks.startFolderRun.mock.calls[0]?.[2]).not.toHaveProperty('bindingEdits');
  });

  it('keeps disabled task choices available after the server returns only enabled tasks', async () => {
    mocks.discoverFolderSource.mockResolvedValue({ source: exactFolderSource() });
    const firstPreview = {
      treeRevision: '19', pageIds: ['page-1', 'page-deep'], pages: [], inputs: {}, inputDefinitions: [],
      roles: [{ id: 'writer', name: 'Writer', description: '', required: true }],
      tasks: [
        { nodeId: 'write', name: 'Write', roleSlotId: 'writer' },
        { nodeId: 'polish', name: 'Polish', roleSlotId: 'writer' },
      ],
      assignments: [{ nodeId: 'write', roleSlotId: 'writer', agentId: 'agent-1' }],
      participants: ['agent-1'], issues: [],
    };
    mocks.previewFolderRun.mockResolvedValueOnce(firstPreview).mockResolvedValueOnce({
      ...firstPreview, tasks: [firstPreview.tasks[0]],
    });
    renderDialog({ kind: 'folder', folderId: 'folder-root', name: 'Root' });
    await screen.findByRole('radio', { name: '保留各页面当前默认绑定' });
    fireEvent.click(screen.getByRole('checkbox', { name: '保存后立即启动协作' }));
    fireEvent.click(screen.getByRole('button', { name: '预览本次协作' }));
    const polish = await screen.findByRole('checkbox', { name: 'Polish' });
    fireEvent.click(polish);
    fireEvent.click(screen.getByRole('button', { name: '预览本次协作' }));

    await waitFor(() => expect(mocks.previewFolderRun).toHaveBeenCalledTimes(2));
    expect(mocks.previewFolderRun.mock.calls[1]?.[2]).toEqual(expect.objectContaining({ enabledTaskNodeIds: ['write'] }));
    expect(screen.getByRole('checkbox', { name: 'Polish' })).not.toBeChecked();
  });

  it('keeps per-Page binding CAS independent when an explicit bulk replacement conflicts', async () => {
    mocks.discoverFolderSource.mockResolvedValue({ source: exactFolderSource() });
    mocks.startFolderRun.mockRejectedValue({ response: { data: { code: 'RESOURCE_CONFLICT' } } });
    renderDialog({ kind: 'folder', folderId: 'folder-root', name: 'Root' });
    await screen.findByRole('radio', { name: '保留各页面当前默认绑定' });
    fireEvent.click(screen.getByRole('radio', { name: '批量替换所选页面的默认绑定' }));
    fireEvent.change(screen.getByLabelText('批量替换为 Agent'), { target: { value: 'agent-2' } });
    fireEvent.click(screen.getByRole('checkbox', { name: '保存后立即启动协作' }));
    fireEvent.click(screen.getByRole('button', { name: '预览本次协作' }));
    await screen.findByRole('checkbox', { name: 'Write release' });
    fireEvent.click(screen.getByRole('button', { name: '保存绑定并启动' }));
    await waitFor(() => expect(mocks.startFolderRun).toHaveBeenCalled());
    expect(mocks.startFolderRun.mock.calls[0]?.[2].bindingEdits).toEqual([
      { pageId: 'page-1', agentId: 'agent-2', roleSlotKey: 'owner', expectedUpdatedAt: null },
      { pageId: 'page-deep', agentId: 'agent-2', roleSlotKey: 'owner', expectedUpdatedAt: 'v1' },
    ]);
    expect(await screen.findByRole('alert')).toBeVisible();
  });
});

function exactFolderSource() {
  return {
    sourceInstantiationId: 'instantiation-1', compositeTemplateVersionId: 'version-2',
    templateId: 'template-1', templateVersion: 2, rootFolderId: 'folder-root',
    nodes: [
      { templateNodeId: 'root', kind: 'folder' as const, folderId: 'folder-root', pageId: null },
      { templateNodeId: 'page-a', kind: 'page' as const, folderId: null, pageId: 'page-1' },
      { templateNodeId: 'page-b', kind: 'page' as const, folderId: null, pageId: 'page-deep' },
    ],
  };
}
