import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../context/LanguageContext';
import { NewContentPage } from './NewContentPage';

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('./TemplateContentPreview', () => ({ TemplateContentPreview: () => null }));
vi.mock('../../api/client', () => ({ default: mocks }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'owner', platformRole: 'user' } }) }));
function Destination() { const location = useLocation(); return <h1>{location.pathname + location.search}</h1>; }
function setup(entry = '/spaces/demo/new?folder=folder-1') {
  render(<LanguageProvider><MemoryRouter initialEntries={[entry]}><Routes>
    <Route path="/spaces/:id/new" element={<NewContentPage />} />
    <Route path="*" element={<Destination />} />
  </Routes></MemoryRouter></LanguageProvider>);
}
function gets(role: string, withFolder = true) {
  mocks.get.mockImplementation(async (url: string) => {
    if (url === '/spaces/demo') return { data: { id: 'demo', name: '知识库', members: [{ userId: 'owner', role }] } };
    if (url === '/spaces/demo/folders') return { data: { spaceId: 'demo', treeRevision: '11', nextCursor: null,
      data: withFolder ? [{ id: 'folder-1', parentId: null, name: '项目', path: '/项目' }] : [] } };
    if (url === '/spaces/demo/templates') return { data: { data: [{ id: 'team', scope: 'space', stableKey: 'team',
      category: 'reporting', kind: 'single_page', name: '团队周报', description: '团队模板', defaultTitle: '团队周报',
      currentVersion: 2, archivedAt: null, updatedAt: '2026-10-19', pageCount: 1, folderCount: 0, roleCount: 0,
      supportsCollaboration: false, effectiveSupportsCollaboration: false }], total: 1, skip: 0, take: 100,
      capabilities: { canManage: role === 'owner', canCreate: role !== 'viewer' } } };
    if (url === '/spaces/demo/content-tree') return { data: { treeRevision: '11' } };
    throw new Error(`Unexpected ${url}`);
  });
}
describe('Creation route context', () => {
  beforeEach(() => { localStorage.setItem('agentwiki.language.v1', 'zh-CN'); });
  it('inherits the folder from the URL, validates its ancestry, and sends creation there', async () => {
    gets('editor'); mocks.post.mockResolvedValue({ data: { id: 'page-new' } }); setup();
    expect(await screen.findByText(/知识库 \/ 项目/)).toBeVisible();
    fireEvent.change(screen.getByLabelText('标题'), { target: { value: '项目笔记' } });
    fireEvent.click(screen.getByRole('button', { name: '创建' }));
    expect(await screen.findByRole('heading', { name: '/pages/page-new/edit' })).toBeVisible();
    expect(mocks.post).toHaveBeenCalledWith('/pages', { title: '项目笔记', spaceId: 'demo', folderId: 'folder-1', expectedTreeRevision: '11' });
  });
  it('imports a Markdown file into a new page in the requested folder', async () => {
    gets('editor'); mocks.post.mockResolvedValue({ data: { id: 'page-imported' } }); setup();
    expect(await screen.findByText(/知识库 \/ 项目/)).toBeVisible();
    const file = new File(['# Imported\n\n```mermaid\ngraph TD; A-->B\n```'], 'Imported.md', { type: 'text/markdown' });
    fireEvent.change(screen.getByLabelText('上传文件'), { target: { files: [file] } });
    expect(await screen.findByRole('heading', { name: '/pages/page-imported/edit' })).toBeVisible();
    expect(mocks.post).toHaveBeenCalledWith('/pages', {
      title: 'Imported',
      content: '# Imported\n\n```mermaid\ngraph TD; A-->B\n```',
      spaceId: 'demo',
      folderId: 'folder-1',
      expectedTreeRevision: '11',
    }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });
  it('selects the template from the management link while retaining its destination', async () => {
    gets('owner'); setup('/spaces/demo/new?template=team&kind=single_page&scope=space&folder=folder-1');
    expect(await screen.findByRole('button', { name: /团队周报.*空间自定义/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '下一步' })).toBeEnabled();
    expect(screen.getByText(/知识库 \/ 项目/)).toBeVisible();
  });
  it('denies a viewer opening the creation URL directly', async () => {
    gets('viewer'); setup();
    expect(await screen.findByRole('alert')).toHaveTextContent('没有在此空间创建内容的权限');
    expect(screen.queryByRole('button', { name: '创建' })).not.toBeInTheDocument();
    expect(mocks.post).not.toHaveBeenCalled();
  });
  it('exposes template management from the blank start and keeps the destination folder', async () => {
    gets('owner'); setup();
    expect(await screen.findByRole('link', { name: '管理自定义模板' })).toHaveAttribute('href',
      '/spaces/demo/settings/page-templates?folder=folder-1');
  });
  it('lets editors browse custom templates without exposing management', async () => {
    gets('editor'); setup();
    expect(await screen.findByRole('button', { name: '自定义模板' })).toBeVisible();
    expect(screen.queryByRole('link', { name: '管理自定义模板' })).not.toBeInTheDocument();
  });
  it('does not silently create at the root when the requested folder is unavailable', async () => {
    gets('owner', false); setup();
    expect(await screen.findByRole('alert')).toHaveTextContent('目标目录已不可用');
    expect(screen.queryByLabelText('标题')).not.toBeInTheDocument();
    expect(mocks.post).not.toHaveBeenCalled();
  });
  it('opens page groups for the collaboration entry and cancels back to collaboration', async () => {
    gets('owner'); setup('/spaces/demo/new?from=collaboration');
    expect(await screen.findByRole('button', { name: '页面组' })).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(screen.getByRole('button', { name: '取消' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(await screen.findByRole('heading', { name: '/spaces/demo/collaboration' })).toBeVisible();
  });
});
