import { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../context/LanguageContext';
import { NewPageDialog } from './NewPageDialog';

const mocks = vi.hoisted(() => ({
  api: { post: vi.fn() }, listComposite: vi.fn(), preview: vi.fn(), instantiate: vi.fn(),
  listLegacy: vi.fn(), listMembers: vi.fn(), getRun: vi.fn(), getRevision: vi.fn(),
}));
// Preview fetching/rendering is covered by TemplateContentPreview.spec.tsx and the browser flow.
vi.mock('./TemplateContentPreview', () => ({ TemplateContentPreview: () => null }));
vi.mock('../../api/client', () => ({ default: mocks.api }));
vi.mock('../../api/content-tree', () => ({ getContentTreeRevision: mocks.getRevision }));
vi.mock('./pageTemplateApi', () => ({ listPageTemplates: mocks.listLegacy }));
vi.mock('./compositeTemplateApi', () => ({
  listCompositeTemplates: mocks.listComposite,
  previewCompositeTemplate: mocks.preview,
  instantiateCompositeTemplate: mocks.instantiate,
}));
vi.mock('../collaboration/api', () => ({ collaborationApi: { listMembers: mocks.listMembers, getRun: mocks.getRun } }));

const project = {
  id: 'project', scope: 'system', stableKey: 'project', category: 'planning', kind: 'page_group',
  supportsCollaboration: true, effectiveSupportsCollaboration: true, pageCount: 4, folderCount: 2, roleCount: 2,
  name: '项目管理工作区', description: '项目目录', defaultTitle: '项目管理工作区', sourceLocale: null,
  currentVersion: 3, archivedAt: null, updatedAt: '2026-09-05T00:00:00.000Z',
};
const weekly = { ...project, id: 'weekly', kind: 'single_page', name: '周报', pageCount: 1, folderCount: 0 };
const preview = (collaborationEnabled = false, rootName = '项目管理工作区') => ({
  templateId: 'project', templateVersion: 3, locale: 'zh-CN', definitionHash: 'a'.repeat(64), treeRevision: '21',
  nodes: [
    { nodeId: 'root', parentNodeId: null, kind: 'folder', order: 0, name: rootName },
    { nodeId: 'governance', parentNodeId: 'root', kind: 'folder', order: 0, name: '治理' },
    { nodeId: 'risks', parentNodeId: 'governance', kind: 'page', order: 0, title: '风险与阻塞', content: '' },
  ], pageCount: 1, folderCount: 2, roleCount: 1,
  roles: collaborationEnabled ? [{ id: 'owner', name: '项目负责人', description: '', required: true }] : [],
  inputs: collaborationEnabled ? [{ key: 'project-brief', label: '项目简述', type: 'short_text', required: true }] : [],
  inputValues: {}, tasks: collaborationEnabled ? [{ nodeId: 'write', name: '撰写风险', roleSlotId: 'owner' }] : [],
  assignments: collaborationEnabled ? [{ nodeId: 'write', roleSlotId: 'owner', agentId: 'agent-1' }] : [],
  participants: collaborationEnabled ? ['agent-1'] : [], issues: [],
});

const renderDialog = () => {
  const onCreated = vi.fn();
  render(<LanguageProvider><MemoryRouter><NewPageDialog spaceId="space-1" folderId={null} onClose={() => undefined} onCreated={onCreated} /></MemoryRouter></LanguageProvider>);
  return onCreated;
};

describe('NewPageDialog composite flow', () => {
  it.each([true, false])('interpolates system single-page default titles with catalog enabled=%s', async (enabled) => {
    const daily = { ...weekly, name: 'Daily', defaultTitle: 'Daily {date} / {year} W{week}' };
    mocks.listComposite.mockResolvedValue({ data: [daily], total: 1, skip: 0, take: 100, capabilities: { canManage: true, canCreate: enabled } });
    mocks.listLegacy.mockResolvedValue({ system: [daily], space: [], totalSpace: 0, skip: 0, take: 100, capabilities: { canManage: true } });
    render(<LanguageProvider><MemoryRouter><NewPageDialog spaceId="space-1" folderId={null}
      now={new Date(2026, 7, 25, 12)} onClose={() => undefined} onCreated={() => undefined} /></MemoryRouter></LanguageProvider>);
    fireEvent.click(await screen.findByRole('button', { name: /Daily/ }));
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    expect(await screen.findByLabelText(enabled ? '根名称' : '标题')).toHaveValue('Daily 2026-08-25 / 2026 W35');
  });
  beforeEach(() => {
    vi.clearAllMocks(); localStorage.setItem('agentwiki.language.v1', 'zh-CN');
    mocks.listComposite.mockResolvedValue({ data: [project, weekly], total: 2, skip: 0, take: 100, capabilities: { canManage: true, canCreate: true } });
    mocks.listMembers.mockResolvedValue([{ type: 'agent', agentId: 'agent-1', role: 'editor', agent: { id: 'agent-1', name: 'Alpha', status: 'active', connected: true } }]);
    mocks.listLegacy.mockRejectedValue(new Error('not used')); mocks.getRevision.mockResolvedValue('21');
    mocks.preview.mockImplementation((_space: string, _template: string, input: {
      collaborationEnabled: boolean; rootName?: string; roleBindings?: unknown[]; enabledTaskNodeIds?: string[];
    }) => {
      if (input.collaborationEnabled && input.enabledTaskNodeIds?.length === 0) {
        return Promise.reject(new Error('real selector rejects an explicit empty task selection'));
      }
      const result = preview(input.collaborationEnabled, input.rootName);
      return Promise.resolve(input.roleBindings?.length ? result : { ...result, assignments: [], participants: [] });
    });
    mocks.instantiate.mockResolvedValue({ instantiationId: 'instance-1', rootFolderId: 'folder-new', pageIds: ['page-new'], runId: null, treeRevision: '22' });
    mocks.getRun.mockResolvedValue({ id: 'run-1', roleBindings: [{ roleSlotId: 'owner', roleSlotName: '项目负责人', agentId: 'agent-1' }],
      joinInstructions: [{ agentId: 'agent-1', roleSlotIds: ['owner'], taskIds: ['task-1'] }] });
  });

  it.each(['single_page', 'page_group'] as const)('focuses the %s name once its initial page preview is ready', async (kind) => {
    let resolve!: (value: ReturnType<typeof preview>) => void;
    let resolveRefresh!: (value: ReturnType<typeof preview>) => void;
    mocks.preview.mockImplementationOnce(() => new Promise((done) => { resolve = done; }))
      .mockImplementationOnce(() => new Promise((done) => { resolveRefresh = done; }));
    render(<LanguageProvider><MemoryRouter><NewPageDialog spaceId="space-1" presentation="page" initialKind={kind}
      onClose={() => undefined} onCreated={() => undefined} /></MemoryRouter></LanguageProvider>);
    fireEvent.click(await screen.findByRole('button', { name: kind === 'single_page' ? /周报/ : /项目管理工作区/ }));
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    const name = screen.getByRole('textbox');
    expect(name).toBeDisabled();
    await act(async () => resolve(preview()));
    expect(name).toHaveFocus();
    fireEvent.change(name, { target: { value: 'Updated name' } });
    const cancel = screen.getByRole('button', { name: '取消' });
    act(() => cancel.focus());
    expect(mocks.preview).toHaveBeenCalledTimes(2);
    expect(mocks.preview).toHaveBeenLastCalledWith('space-1', kind === 'single_page' ? 'weekly' : 'project',
      expect.objectContaining({ rootName: 'Updated name' }), expect.any(AbortSignal));
    expect(name).toBeDisabled();
    expect(cancel).toHaveFocus();
    await act(async () => resolveRefresh(preview(false, 'Updated name')));
    expect(screen.getByText('Updated name')).toBeVisible();
    expect(name).toBeEnabled();
    expect(cancel).toHaveFocus();
  });

  it('does not steal focus chosen while the initial page preview loads', async () => {
    let resolve!: (value: ReturnType<typeof preview>) => void;
    mocks.preview.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    render(<LanguageProvider><MemoryRouter><NewPageDialog spaceId="space-1" presentation="page" initialKind="single_page"
      onClose={() => undefined} onCreated={() => undefined} /></MemoryRouter></LanguageProvider>);
    fireEvent.click(await screen.findByRole('button', { name: /周报/ }));
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    const cancel = screen.getByRole('button', { name: '取消' });
    cancel.focus();
    await act(async () => resolve(preview()));
    expect(cancel).toHaveFocus();
  });

  it('discards a departed preview and focuses only the newly selected template when ready', async () => {
    let resolveOld!: (value: ReturnType<typeof preview>) => void;
    let resolveNew!: (value: ReturnType<typeof preview>) => void;
    mocks.preview.mockImplementationOnce(() => new Promise((done) => { resolveOld = done; }))
      .mockImplementationOnce(() => new Promise((done) => { resolveNew = done; }));
    render(<LanguageProvider><MemoryRouter><NewPageDialog spaceId="space-1" presentation="page" initialKind="single_page"
      onClose={() => undefined} onCreated={() => undefined} /></MemoryRouter></LanguageProvider>);
    fireEvent.click(await screen.findByRole('button', { name: /周报/ }));
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    fireEvent.click(screen.getByRole('button', { name: '上一步' }));
    const search = screen.getByRole('searchbox');
    search.focus();
    expect(search).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: /周报/ }));
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    await act(async () => resolveOld(preview(false, 'Old response')));
    expect(screen.getByRole('textbox')).toBeDisabled();
    expect(screen.getByRole('textbox')).not.toHaveFocus();
    await act(async () => resolveNew(preview(false, 'New response')));
    expect(screen.getByRole('textbox')).toHaveFocus();
    expect(screen.queryByText('Old response')).not.toBeInTheDocument();
  });

  it('filters kind and scope independently and previews the complete hierarchy with collaboration off', async () => {
    renderDialog();
    fireEvent.click(await screen.findByRole('button', { name: '多页面' }));
    expect(screen.queryByRole('button', { name: /^周报/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '下一步' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '系统模板' }));
    fireEvent.click(await screen.findByRole('button', { name: /项目管理工作区/ }));
    expect(screen.getByRole('button', { name: '下一步' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    expect(await screen.findByRole('checkbox', { name: '启用 Agent 协作' })).not.toBeChecked();
    expect(screen.getByText('风险与阻塞')).toBeVisible();
    expect(screen.getByText('风险与阻塞').closest('[role="treeitem"]')).toHaveAttribute('aria-level', '3');
  });

  it('keeps async preview results active across the StrictMode setup-cleanup-setup cycle', async () => {
    render(<StrictMode><LanguageProvider><MemoryRouter><NewPageDialog spaceId="space-1" folderId={null}
      onClose={() => undefined} onCreated={() => undefined} /></MemoryRouter></LanguageProvider></StrictMode>);
    fireEvent.click(await screen.findByRole('button', { name: /项目管理工作区/ }));
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    expect(await screen.findByText('风险与阻塞')).toBeVisible();
  });

  it('omits task selection for the first enabled preview so the server can select all valid tasks', async () => {
    renderDialog();
    fireEvent.click(await screen.findByRole('button', { name: /项目管理工作区/ }));
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    fireEvent.click(await screen.findByRole('checkbox', { name: '启用 Agent 协作' }));

    await waitFor(() => expect(mocks.preview).toHaveBeenLastCalledWith('space-1', 'project', expect.not.objectContaining({
      enabledTaskNodeIds: expect.anything(),
    }), expect.any(AbortSignal)));
    expect(await screen.findByRole('button', { name: '下一步' })).toBeEnabled();
  });

  it.each(['single_page', 'page_group'] as const)('defers %s collaboration issues to configuration while retaining placement issues', async (kind) => {
    mocks.preview.mockImplementation((_space: string, _template: string, input: { collaborationEnabled: boolean }) => Promise.resolve({
      ...preview(input.collaborationEnabled),
      issues: [
        { code: 'TARGET_PARENT_FOLDER_NOT_FOUND' },
        ...(input.collaborationEnabled ? [
          { code: 'ROLE_BINDING_REQUIRED', roleSlotId: 'owner' },
          { code: 'COLLABORATION_INPUT_REQUIRED', inputKey: 'project-brief' },
        ] : []),
      ],
    }));
    render(<LanguageProvider><MemoryRouter><NewPageDialog spaceId="space-1" presentation="page" initialKind={kind}
      onClose={() => undefined} onCreated={() => undefined} /></MemoryRouter></LanguageProvider>);
    fireEvent.click(await screen.findByRole('button', { name: kind === 'single_page' ? /周报/ : /项目管理工作区/ }));
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    const enable = await screen.findByRole('checkbox', { name: '启用 Agent 协作' });
    fireEvent.click(enable);
    await waitFor(() => expect(enable).toBeEnabled());
    expect(screen.queryByText('仍有必需角色没有映射 Agent。')).not.toBeInTheDocument();
    expect(screen.queryByText('仍有必填工作流输入未填写。')).not.toBeInTheDocument();
    expect(screen.getByText('目标目录已不存在。')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    expect(await screen.findByText('仍有必需角色没有映射 Agent。')).toBeVisible();
    expect(screen.getByText('仍有必填工作流输入未填写。')).toBeVisible();
  });

  it.each(['single_page', 'page_group'] as const)('makes a missing %s required input visible and reachable after submission', async (kind) => {
    render(<LanguageProvider><MemoryRouter><NewPageDialog spaceId="space-1" presentation="page" initialKind={kind}
      onClose={() => undefined} onCreated={() => undefined} /></MemoryRouter></LanguageProvider>);
    fireEvent.click(await screen.findByRole('button', { name: kind === 'single_page' ? /周报/ : /项目管理工作区/ }));
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    const enable = await screen.findByRole('checkbox', { name: '启用 Agent 协作' });
    fireEvent.click(enable);
    await waitFor(() => expect(enable).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    const input = await screen.findByLabelText('项目简述');
    const scroll = vi.fn(); input.scrollIntoView = scroll;
    const submit = screen.getByRole('button', { name: '创建并启动协作' });
    submit.focus();
    fireEvent.click(submit);
    const toast = screen.getAllByRole('alert').find((alert) => within(alert).queryByRole('button', { name: '关闭' }));
    expect(toast).toBeDefined();
    expect(toast).toHaveTextContent('项目简述');
    expect(input).toHaveFocus();
    expect(scroll).toHaveBeenCalled();
    expect(mocks.instantiate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '上一步' }));
    expect(screen.queryByText('请填写所有必填工作流输入。 项目简述')).not.toBeInTheDocument();
  });

  it.each(['single_page', 'page_group'] as const)('makes a missing %s role mapping visible and reachable after submission', async (kind) => {
    mocks.preview.mockImplementation((_space: string, _template: string, input: { collaborationEnabled: boolean }) => Promise.resolve({
      ...preview(input.collaborationEnabled), inputs: [],
      issues: input.collaborationEnabled ? [{ code: 'ROLE_BINDING_REQUIRED', roleSlotId: 'owner' }] : [],
    }));
    render(<LanguageProvider><MemoryRouter><NewPageDialog spaceId="space-1" presentation="page" initialKind={kind}
      onClose={() => undefined} onCreated={() => undefined} /></MemoryRouter></LanguageProvider>);
    fireEvent.click(await screen.findByRole('button', { name: kind === 'single_page' ? /周报/ : /项目管理工作区/ }));
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    const enable = await screen.findByRole('checkbox', { name: '启用 Agent 协作' });
    fireEvent.click(enable);
    await waitFor(() => expect(enable).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    const role = await screen.findByRole('combobox', { name: '项目负责人' });
    const scroll = vi.fn(); role.scrollIntoView = scroll;
    const submit = screen.getByRole('button', { name: '创建并启动协作' });
    submit.focus();
    fireEvent.click(submit);
    const toast = screen.getAllByRole('alert').find((alert) => within(alert).queryByRole('button', { name: '关闭' }));
    expect(toast).toBeDefined();
    expect(toast).toHaveTextContent('项目负责人');
    expect(role).toHaveFocus();
    expect(scroll).toHaveBeenCalled();
    expect(mocks.instantiate).not.toHaveBeenCalled();
  });

  it('marks a renamed root stale and reloads the visible hierarchy before creation', async () => {
    renderDialog();
    fireEvent.click(await screen.findByRole('button', { name: /项目管理工作区/ }));
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    await screen.findByText('风险与阻塞');
    const rootName = screen.getByLabelText('根名称');

    fireEvent.change(rootName, { target: { value: '自定义根目录' } });

    expect(screen.getByRole('button', { name: '创建页面组' })).toBeDisabled();
    fireEvent.blur(rootName);
    expect(await screen.findByText('自定义根目录')).toBeVisible();
    expect(mocks.preview).toHaveBeenLastCalledWith('space-1', 'project', expect.objectContaining({ rootName: '自定义根目录' }), expect.any(AbortSignal));
    expect(screen.getByRole('button', { name: '创建页面组' })).toBeEnabled();
  });

  it('queries kind and scope on the server so filtering is not limited to the first catalog page', async () => {
    renderDialog();
    await screen.findByRole('button', { name: /项目管理工作区/ });
    fireEvent.click(screen.getByRole('button', { name: '多页面' }));
    fireEvent.click(screen.getByRole('button', { name: 'Space 模板' }));
    await waitFor(() => expect(mocks.listComposite).toHaveBeenLastCalledWith('space-1', expect.objectContaining({
      locale: 'zh-CN', scope: 'space', kind: 'page_group', signal: expect.any(AbortSignal),
    })));
  });

  it('loads the next bounded server page without discarding the current catalog page', async () => {
    const lateTemplate = { ...project, id: 'late-project', name: '第二批项目空间' };
    mocks.listComposite.mockImplementation((_spaceId: string, options: { skip?: number }) => Promise.resolve(
      options.skip === 100
        ? { data: [lateTemplate], total: 101, skip: 100, take: 100, capabilities: { canManage: true, canCreate: true } }
        : { data: [project], total: 101, skip: 0, take: 100, capabilities: { canManage: true, canCreate: true } },
    ));
    renderDialog();
    expect(await screen.findByRole('button', { name: /项目管理工作区/ })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '加载更多' }));
    expect(await screen.findByRole('button', { name: /第二批项目空间/ })).toBeVisible();
    expect(screen.getByRole('button', { name: /项目管理工作区/ })).toBeVisible();
    expect(mocks.listComposite).toHaveBeenLastCalledWith('space-1', expect.objectContaining({ skip: 100, take: 100 }));
  });

  it('omits collaboration fields when off and keeps the result visible until navigation', async () => {
    const onCreated = renderDialog();
    fireEvent.click(await screen.findByRole('button', { name: /项目管理工作区/ }));
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    await screen.findByText('风险与阻塞');
    fireEvent.click(screen.getByRole('button', { name: '创建页面组' }));
    await waitFor(() => expect(mocks.instantiate).toHaveBeenCalledWith('space-1', 'project', expect.not.objectContaining({
      roleBindings: expect.anything(), collaborationInputs: expect.anything(), enabledTaskNodeIds: expect.anything(),
    }), expect.any(AbortSignal)));
    expect(await screen.findByText('创建完成')).toBeVisible();
    expect(onCreated).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '打开页面组' }));
    expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ rootFolderId: 'folder-new' }));
  });

  it('collects required inputs and task mappings then shows one authoritative instruction per participant', async () => {
    mocks.instantiate.mockResolvedValue({ instantiationId: 'instance-1', rootFolderId: 'folder-new', pageIds: ['page-new'], runId: 'run-1', treeRevision: '22' });
    renderDialog();
    fireEvent.click(await screen.findByRole('button', { name: /项目管理工作区/ }));
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    const collaboration = await screen.findByRole('checkbox', { name: '启用 Agent 协作' });
    fireEvent.click(collaboration);
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    fireEvent.change(await screen.findByLabelText('项目简述'), { target: { value: '交付目标' } });
    fireEvent.change(screen.getByLabelText('项目负责人'), { target: { value: 'agent-1' } });
    fireEvent.click(screen.getByRole('button', { name: '刷新参与范围' }));
    const participants = await screen.findByTestId('participant-preview');
    expect(within(participants).getAllByText('Alpha')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '创建并启动协作' }));
    expect(await screen.findByText('协作 Run 已创建。')).toBeVisible();
    expect(screen.getByText(/wiki_collaboration_join_run/)).toBeVisible();
    expect(screen.getByText(/外部 Agent 尚未被唤醒/)).toBeVisible();
    const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: clipboard });
    fireEvent.click(screen.getByRole('button', { name: '复制' }));
    expect(await screen.findByRole('button', { name: '已复制' })).toBeVisible();

  });

  it('refreshes collaboration validation at submit after the user fixes inputs and bindings', async () => {
    mocks.preview.mockImplementation((_space: string, _template: string, input: {
      collaborationEnabled: boolean; roleBindings?: unknown[];
    }) => Promise.resolve({
      ...preview(input.collaborationEnabled),
      issues: input.collaborationEnabled && !input.roleBindings?.length
        ? [{ code: 'ROLE_BINDING_REQUIRED', roleSlotId: 'owner' }]
        : [],
    }));
    renderDialog();
    fireEvent.click(await screen.findByRole('button', { name: /项目管理工作区/ }));
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    fireEvent.click(await screen.findByRole('checkbox', { name: '启用 Agent 协作' }));
    fireEvent.click(await screen.findByRole('button', { name: '下一步' }));
    fireEvent.change(await screen.findByLabelText('项目简述'), { target: { value: '交付目标' } });
    fireEvent.change(screen.getByLabelText('项目负责人'), { target: { value: 'agent-1' } });
    fireEvent.click(screen.getByRole('button', { name: '创建并启动协作' }));
    await waitFor(() => expect(mocks.instantiate).toHaveBeenCalled());
    expect(screen.queryByText(/仍有必需角色没有映射 Agent/)).not.toBeInTheDocument();
  });

  const configureReadyCollaboration = async () => {
    fireEvent.click(await screen.findByRole('button', { name: /项目管理工作区/ }));
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    const enable = await screen.findByRole('checkbox', { name: '启用 Agent 协作' });
    fireEvent.click(enable);
    await waitFor(() => expect(enable).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    fireEvent.change(await screen.findByLabelText('项目简述'), { target: { value: '交付目标' } });
    fireEvent.change(screen.getByLabelText('项目负责人'), { target: { value: 'agent-1' } });
  };

  it('does not instantiate from an old preview after submit preflight fails and allows a later retry', async () => {
    renderDialog();
    await configureReadyCollaboration();
    mocks.preview.mockRejectedValueOnce(new Error('preflight unavailable'));
    fireEvent.click(screen.getByRole('button', { name: '创建并启动协作' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '创建并启动协作' })).toBeEnabled());
    expect(screen.getByRole('alert')).toBeVisible();
    expect(mocks.instantiate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '创建并启动协作' }));
    await screen.findByText('创建完成');
    expect(mocks.instantiate).toHaveBeenCalledTimes(1);
  });

  it.each(['close', 'back', 'page-return', 'unmount'] as const)('never instantiates after leaving pending preflight via %s', async (exit) => {
    const onClose = vi.fn();
    const view = render(<LanguageProvider><MemoryRouter><NewPageDialog spaceId="space-1"
      presentation={exit === 'page-return' ? 'page' : 'dialog'} initialKind="page_group"
      onClose={onClose} onCreated={() => undefined} /></MemoryRouter></LanguageProvider>);
    await configureReadyCollaboration();
    let finishPreflight!: (value: ReturnType<typeof preview>) => void;
    mocks.preview.mockImplementationOnce(() => new Promise((resolve) => { finishPreflight = resolve; }));
    fireEvent.click(screen.getByRole('button', { name: '创建并启动协作' }));
    const signal = mocks.preview.mock.calls[mocks.preview.mock.calls.length - 1]?.[3] as AbortSignal;
    if (exit === 'unmount') view.unmount();
    else if (exit === 'back') fireEvent.click(screen.getByRole('button', { name: '上一步' }));
    else if (exit === 'page-return') fireEvent.click(screen.getByRole('button', { name: /返回/ }));
    else fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    await act(async () => finishPreflight(preview(true)));
    expect(signal.aborted).toBe(true);
    expect(mocks.instantiate).not.toHaveBeenCalled();
    if (exit === 'close' || exit === 'page-return') expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('locks rapid submission before awaiting collaboration preflight', async () => {
    renderDialog();
    await configureReadyCollaboration();
    const resolvers: Array<(value: ReturnType<typeof preview>) => void> = [];
    mocks.preview.mockImplementation(() => new Promise((resolve) => { resolvers.push(resolve); }));
    const button = screen.getByRole('button', { name: '创建并启动协作' });
    act(() => { fireEvent.click(button); fireEvent.click(button); });
    expect(resolvers).toHaveLength(1);
    await act(async () => { for (const resolve of resolvers) resolve(preview(true)); });
    await screen.findByText('创建完成');
    expect(mocks.instantiate).toHaveBeenCalledTimes(1);
  });

  it('retries an unknown collaboration result with the exact request without changing revision through preflight', async () => {
    mocks.instantiate.mockRejectedValueOnce(new Error('response lost'));
    renderDialog();
    await configureReadyCollaboration();
    fireEvent.click(screen.getByRole('button', { name: '创建并启动协作' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('网络在确认结果前中断');
    const original = mocks.instantiate.mock.calls[0]?.[2];
    const previewCount = mocks.preview.mock.calls.length;
    mocks.preview.mockResolvedValue({ ...preview(true), treeRevision: '999' });
    fireEvent.click(screen.getByRole('button', { name: '创建并启动协作' }));
    await screen.findByText('创建完成');
    expect(mocks.instantiate).toHaveBeenCalledTimes(2);
    expect(mocks.instantiate.mock.calls[1]?.[2]).toEqual(original);
    expect(mocks.preview).toHaveBeenCalledTimes(previewCount);
  });

  it('does not require the role of a task disabled in the current configuration', async () => {
    mocks.preview.mockImplementation((_space: string, _template: string, input: {
      collaborationEnabled: boolean; enabledTaskNodeIds?: string[];
    }) => Promise.resolve({
      ...preview(input.collaborationEnabled),
      roles: input.collaborationEnabled ? [...preview(true).roles, { id: 'reviewer', name: '审查员', description: '', required: true }] : [],
      tasks: input.collaborationEnabled ? [...preview(true).tasks, { nodeId: 'review', name: '审查风险', roleSlotId: 'reviewer' }] : [],
      issues: input.collaborationEnabled && (!input.enabledTaskNodeIds || input.enabledTaskNodeIds.includes('review'))
        ? [{ code: 'ROLE_BINDING_REQUIRED', roleSlotId: 'reviewer' }] : [],
    }));
    renderDialog();
    await configureReadyCollaboration();
    fireEvent.click(screen.getByRole('checkbox', { name: '审查风险' }));
    fireEvent.click(screen.getByRole('button', { name: '创建并启动协作' }));
    await screen.findByText('创建完成');
    expect(mocks.instantiate).toHaveBeenCalledWith('space-1', 'project', expect.objectContaining({
      enabledTaskNodeIds: ['write'],
      roleBindings: [{ kind: 'task_default', nodeId: 'write', roleSlotId: 'owner', agentId: 'agent-1' }],
    }), expect.any(AbortSignal));
  });

  it('restores focus after a user refreshes participant scope so Escape stays inside the dialog', async () => {
    let resolveRefresh!: (value: ReturnType<typeof preview>) => void;
    mocks.preview.mockImplementation((_space: string, _template: string, input: {
      collaborationEnabled: boolean; rootName?: string; roleBindings?: unknown[];
    }) => input.roleBindings?.length
      ? new Promise((resolve) => { resolveRefresh = resolve; })
      : Promise.resolve(preview(input.collaborationEnabled, input.rootName)));
    renderDialog();
    fireEvent.click(await screen.findByRole('button', { name: /项目管理工作区/ }));
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    fireEvent.click(await screen.findByRole('checkbox', { name: '启用 Agent 协作' }));
    fireEvent.click(await screen.findByRole('button', { name: '下一步' }));
    fireEvent.change(await screen.findByLabelText('项目简述'), { target: { value: '交付目标' } });
    fireEvent.change(screen.getByLabelText('项目负责人'), { target: { value: 'agent-1' } });
    const refresh = screen.getByRole('button', { name: '刷新参与范围' });
    refresh.focus();

    fireEvent.click(refresh);
    screen.getByRole('dialog').focus();
    expect(refresh).not.toHaveFocus();
    resolveRefresh({ ...preview(true), participants: ['agent-1'] });

    await waitFor(() => expect(refresh).toHaveFocus());
  });

  it('guards double submission and aborting the wait does not claim rollback', async () => {
    let resolve!: (value: any) => void;
    mocks.instantiate.mockImplementation(() => new Promise((done) => { resolve = done; }));
    renderDialog();
    fireEvent.click(await screen.findByRole('button', { name: /项目管理工作区/ }));
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    await screen.findByText('风险与阻塞');
    const button = screen.getByRole('button', { name: '创建页面组' });
    fireEvent.click(button); fireEvent.click(button);
    await waitFor(() => expect(mocks.instantiate).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    expect(screen.queryByText(/回滚/)).not.toBeInTheDocument();
    resolve({ instantiationId: 'i', rootFolderId: 'f', pageIds: ['p'], runId: null, treeRevision: '22' });
  });

  it('retries an unknown network result with the exact payload and idempotency key', async () => {
    mocks.instantiate
      .mockRejectedValueOnce(new Error('connection ended'))
      .mockResolvedValueOnce({ instantiationId: 'instance-1', rootFolderId: 'folder-new', pageIds: ['page-new'], runId: null, treeRevision: '22' });
    renderDialog();
    fireEvent.click(await screen.findByRole('button', { name: /项目管理工作区/ }));
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    await screen.findByText('风险与阻塞');
    fireEvent.click(screen.getByRole('button', { name: '创建页面组' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('网络在确认结果前中断');
    const firstPayload = mocks.instantiate.mock.calls[0]?.[2];
    fireEvent.click(screen.getByRole('button', { name: '创建页面组' }));
    await screen.findByText('创建完成');
    expect(mocks.instantiate.mock.calls[1]?.[2]).toEqual(firstPayload);
  });

  it('keeps blank and legacy creation available while hiding composite choices when rollout is off', async () => {
    mocks.listComposite.mockResolvedValue({
      data: [project], total: 1, skip: 0, take: 100,
      capabilities: { canManage: true, canCreate: false },
    });
    mocks.listLegacy.mockResolvedValue({
      system: [{ ...weekly, kind: undefined }], space: [], totalSpace: 0, skip: 0, take: 100,
      capabilities: { canManage: true },
    });

    renderDialog();

    expect(await screen.findByText('组合页面组当前未对这个 Space 开放。你仍可创建空白页面或使用旧单页模板。')).toBeVisible();
    expect(screen.queryByRole('button', { name: /项目管理工作区/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^空白页面/ })).toBeVisible();
  });
});
