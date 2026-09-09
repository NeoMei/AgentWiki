import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, Routes, Route, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../context/LanguageContext';
import { NavigationGuardProvider } from '../space-workspace/workspaceNavigation';
import { NewPageDialog } from './NewPageDialog';

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), list: vi.fn(), legacy: vi.fn(), revision: vi.fn(), preview: vi.fn(), members: vi.fn() }));
vi.mock('../../api/client', () => ({ default: { get: mocks.get, post: mocks.post } }));
vi.mock('../../api/content-tree', () => ({ getContentTreeRevision: mocks.revision }));
vi.mock('./compositeTemplateApi', () => ({ listCompositeTemplates: mocks.list, previewCompositeTemplate: mocks.preview }));
vi.mock('../collaboration/api', () => ({ collaborationApi: { listMembers: mocks.members } }));
vi.mock('./pageTemplateApi', () => ({ listPageTemplates: mocks.legacy }));

const template = { id: 'team', scope: 'space', stableKey: 'team', category: 'reporting', name: '团队周报',
  description: '团队的进度与风险标准', defaultTitle: '团队周报', sourceLocale: 'zh-CN', currentVersion: 2,
  archivedAt: null, updatedAt: '2026-09-10T00:00:00.000Z' };

function Location() { const location = useLocation(); return <p>{location.pathname + location.search}</p>; }
function renderFlow() {
  const router = createMemoryRouter([{ path: '*', element: <LanguageProvider><NavigationGuardProvider><Routes>
    <Route path="/new" element={<NewPageDialog presentation="page" spaceId="space-1" folderId="folder-1"
      targetLocation="知识库 / 项目" onClose={() => router.navigate('/spaces/space-1?folder=folder-1')}
      onCreated={() => router.navigate('/pages/new-page/edit')} />} />
    <Route path="*" element={<Location />} />
  </Routes></NavigationGuardProvider></LanguageProvider> }], { initialEntries: ['/new'] });
  render(<RouterProvider router={router} />);
  return router;
}

describe('New content page flow', () => {
  beforeEach(() => {
    localStorage.setItem('agentwiki.language.v1', 'zh-CN');
    mocks.list.mockRejectedValue(new Error('fallback'));
    mocks.legacy.mockResolvedValue({ system: [], space: [template], totalSpace: 1, skip: 0, take: 100, capabilities: { canManage: true } });
    mocks.revision.mockResolvedValue('21');
    mocks.post.mockResolvedValue({ data: { id: 'new-page' } });
  });

  it('creates blank content directly in its folder and navigates without a false unsaved warning', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderFlow();
    fireEvent.change(await screen.findByLabelText('标题'), { target: { value: '项目笔记' } });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText(/知识库 \/ 项目/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '创建' }));
    expect(await screen.findByText('/pages/new-page/edit')).toBeVisible();
    expect(mocks.post).toHaveBeenCalledWith('/pages', { title: '项目笔记', spaceId: 'space-1', folderId: 'folder-1', expectedTreeRevision: '21' });
    expect(confirm).not.toHaveBeenCalled();
  });

  it('protects input on cancel and returns to the original folder after confirmation', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderFlow();
    fireEvent.change(await screen.findByLabelText('标题'), { target: { value: '草稿' } });
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    await waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(screen.getByLabelText('标题')).toHaveValue('草稿');
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(await screen.findByText('/spaces/space-1?folder=folder-1')).toBeVisible();
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it('finds and creates from a space custom template using its immutable version', async () => {
    renderFlow();
    fireEvent.click(screen.getByRole('button', { name: '单页模板' }));
    fireEvent.change(await screen.findByLabelText('模板来源'), { target: { value: 'space' } });
    fireEvent.change(screen.getByLabelText('搜索模板'), { target: { value: '团队' } });
    fireEvent.click(await screen.findByRole('button', { name: /团队周报/ }));
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    expect(await screen.findByLabelText('标题')).toHaveValue('团队周报');
    fireEvent.click(screen.getByRole('button', { name: '创建' }));
    expect(await screen.findByText('/pages/new-page/edit')).toBeVisible();
    expect(mocks.post).toHaveBeenCalledWith('/pages', expect.objectContaining({ templateId: 'team', templateVersion: 2, templateLocale: 'zh-CN' }));
  });
  it('keeps a pending preview alive when returning is cancelled', async () => {
    let resolve!: (value: unknown) => void;
    mocks.preview.mockReturnValue(new Promise((done) => { resolve = done; }));
    mocks.members.mockResolvedValue([]);
    mocks.list.mockResolvedValue({ data: [{ ...template, kind: 'page_group', pageCount: 1, folderCount: 1,
      roleCount: 0, supportsCollaboration: false, effectiveSupportsCollaboration: false }],
      total: 1, skip: 0, take: 100, capabilities: { canManage: true, canCreate: true } });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderFlow();
    fireEvent.click(screen.getByRole('button', { name: '页面组' }));
    fireEvent.click(await screen.findByRole('button', { name: /团队周报/ }));
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    await waitFor(() => expect(mocks.preview).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: '返回原位置' }));
    await waitFor(() => expect(confirm).toHaveBeenCalled());
    await act(async () => resolve({ nodes: [], roles: [], inputs: [], tasks: [], issues: [], participants: [], treeRevision: '21' }));
    expect(await screen.findByRole('button', { name: '创建页面组' })).toBeEnabled();
    expect(screen.getByLabelText('页面组名称')).toBeEnabled();
  });

  it('does not discard user input when a method switch is cancelled', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderFlow();
    fireEvent.change(await screen.findByLabelText('标题'), { target: { value: '未完成的笔记' } });
    fireEvent.click(screen.getByRole('button', { name: '单页模板' }));
    expect(confirm).toHaveBeenCalled();
    expect(screen.getByLabelText('标题')).toHaveValue('未完成的笔记');
    expect(screen.getByRole('button', { name: '空白页面' })).toHaveAttribute('aria-pressed', 'true');
  });

});
