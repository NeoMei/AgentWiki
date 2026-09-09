import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../context/LanguageContext';
import { NewContentPage } from './NewContentPage';

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
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
  it('denies a viewer opening the creation URL directly', async () => {
    gets('viewer'); setup();
    expect(await screen.findByRole('alert')).toHaveTextContent('没有在此空间创建内容的权限');
    expect(screen.queryByRole('button', { name: '创建' })).not.toBeInTheDocument();
    expect(mocks.post).not.toHaveBeenCalled();
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
