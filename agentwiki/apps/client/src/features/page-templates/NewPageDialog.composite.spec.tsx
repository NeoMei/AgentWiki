import { StrictMode } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../context/LanguageContext';
import { NewPageDialog } from './NewPageDialog';

const mocks = vi.hoisted(() => ({
  api: { post: vi.fn() }, listComposite: vi.fn(), preview: vi.fn(), instantiate: vi.fn(),
  listLegacy: vi.fn(), listMembers: vi.fn(), getRun: vi.fn(), getRevision: vi.fn(),
}));
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
const preview = (collaborationEnabled = false) => ({
  templateId: 'project', templateVersion: 3, locale: 'zh-CN', definitionHash: 'a'.repeat(64), treeRevision: '21',
  nodes: [
    { nodeId: 'root', parentNodeId: null, kind: 'folder', order: 0, name: '项目管理工作区' },
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
  beforeEach(() => {
    vi.clearAllMocks(); localStorage.setItem('agentwiki.language.v1', 'zh-CN');
    mocks.listComposite.mockResolvedValue({ data: [project, weekly], total: 2, skip: 0, take: 100, capabilities: { canManage: true } });
    mocks.listMembers.mockResolvedValue([{ type: 'agent', agentId: 'agent-1', role: 'editor', agent: { id: 'agent-1', name: 'Alpha', status: 'active', connected: true } }]);
    mocks.listLegacy.mockRejectedValue(new Error('not used')); mocks.getRevision.mockResolvedValue('21');
    mocks.preview.mockImplementation((_space: string, _template: string, input: { collaborationEnabled: boolean; roleBindings?: unknown[] }) => {
      const result = preview(input.collaborationEnabled);
      return Promise.resolve(input.roleBindings?.length ? result : { ...result, assignments: [], participants: [] });
    });
    mocks.instantiate.mockResolvedValue({ instantiationId: 'instance-1', rootFolderId: 'folder-new', pageIds: ['page-new'], runId: null, treeRevision: '22' });
    mocks.getRun.mockResolvedValue({ id: 'run-1', roleBindings: [{ roleSlotId: 'owner', roleSlotName: '项目负责人', agentId: 'agent-1' }],
      joinInstructions: [{ agentId: 'agent-1', roleSlotIds: ['owner'], taskIds: ['task-1'] }] });
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
        ? { data: [lateTemplate], total: 101, skip: 100, take: 100, capabilities: { canManage: true } }
        : { data: [project], total: 101, skip: 0, take: 100, capabilities: { canManage: true } },
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
});
