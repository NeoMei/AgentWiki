import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider, useLanguage } from '../../context/LanguageContext';
import { KnowledgeGraph } from './KnowledgeGraph';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), delete: vi.fn() }));
vi.mock('../../api/client', () => ({ default: api }));
const folders = [{ id: 'f1', name: '项目', path: '项目', parentId: null }, { id: 'f2', name: '人物', path: '项目/人物', parentId: 'f1' }, { id: 'f3', name: '空目录', path: '空目录', parentId: null }];
const page = (id: string, title: string, folderId: string | null, path: string) => ({ id, title, folderId, path, x: 100, y: 100, radius: 20 });
const nodes = [page('p1', '大纲', 'f1', 'pages/项目/大纲.md'), page('p2', '小明', 'f2', 'pages/项目/人物/小明.md'), page('p3', '草稿', null, 'pages/草稿.md')];
const edge = (id: string, source: string, target: string, relation: string) => ({ id, source, target, relation, strength: 1, confidence: 1, origin: 'manual' });
const edges = [edge('e1', 'p1', 'p2', 'references'), edge('e2', 'p1', 'p2', 'depends_on'), edge('e3', 'p1', 'p3', 'related_to')];
let painted: ReturnType<typeof vi.fn>;
let arcs: ReturnType<typeof vi.fn>;
let cleared: ReturnType<typeof vi.fn>;

function Controls() {
  const { toggleLanguage } = useLanguage();
  const navigate = useNavigate();
  return <><button onClick={toggleLanguage}>Language</button><button onClick={() => navigate('/spaces/s2/graph')}>Other Space</button></>;
}
function mount() {
  return render(<LanguageProvider><MemoryRouter initialEntries={['/spaces/s1/graph']}><Controls /><Routes>
    <Route path='/spaces/:spaceId/graph' element={<KnowledgeGraph />} />
    <Route path='/pages/:pageId' element={<div>Opened page</div>} />
  </Routes></MemoryRouter></LanguageProvider>);
}
afterEach(() => vi.unstubAllGlobals());
beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  localStorage.setItem('agentwiki.language.v1', 'zh-CN');
  painted = vi.fn(); arcs = vi.fn(); cleared = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 800, 500));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    setTransform: vi.fn(), clearRect: cleared, beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(), arc: arcs, fill: vi.fn(), fillText: painted,
    measureText: (text: string) => ({ width: [...text].length * 8 }),
  } as unknown as CanvasRenderingContext2D);
  api.get.mockResolvedValue({ data: { nodes, edges, folders } });
});

describe('KnowledgeGraph folder browsing', () => {
  it('defaults to actual folder counts, expands nested and empty groups, and opens the selected page from its sidebar', async () => {
    mount();
    const group = await screen.findByRole('button', { name: '人物 项目/人物 1 个页面' });
    expect(group).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: '未分组 1 个页面' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: '项目 项目 1 个页面' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: /小明 pages/ })).not.toBeInTheDocument();
    expect(painted.mock.calls.map(call => call[0])).toContain('人物');
    fireEvent.click(group);
    fireEvent.click(screen.getByRole('button', { name: '小明 pages/项目/人物/小明.md' }));
    const details = screen.getByRole('complementary', { name: '页面详情' });
    expect(within(details).getByText('pages/项目/人物/小明.md')).toBeInTheDocument();
    expect(within(details).getByText('1 个关联页面 · 2 条关系')).toBeInTheDocument();
    expect(within(details).getAllByRole('link', { name: '← 大纲' })[0]).toHaveAttribute('href', '/pages/p1');
    fireEvent.click(screen.getByRole('button', { name: '空目录 空目录 0 个页面' }));
    expect(screen.getByText('此文件夹没有直接包含的页面。')).toBeInTheDocument();
    fireEvent.click(within(details).getByRole('link', { name: '打开页面' }));
    expect(screen.getByText('Opened page')).toBeInTheDocument();
  });

  it('searches titles and canonical paths, reports counts, and clears a no-match canvas', async () => {
    mount();
    const search = await screen.findByRole('searchbox', { name: '搜索页面' });
    fireEvent.change(search, { target: { value: '人物/小明' } });
    expect(screen.getByText('显示 1 / 3 个页面')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '小明 pages/项目/人物/小明.md' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /大纲 pages/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '小明 pages/项目/人物/小明.md' }));
    arcs.mockClear(); cleared.mockClear();
    fireEvent.change(search, { target: { value: '不存在' } });
    expect(screen.getByText('没有匹配的页面。请调整搜索或关系类型。')).toBeInTheDocument();
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
    expect(cleared).toHaveBeenCalled();
    // The final paint is empty, so old nodes cannot remain visible after filtering.
    expect(arcs.mock.invocationCallOrder[arcs.mock.invocationCallOrder.length - 1] ?? 0).toBeLessThan(cleared.mock.invocationCallOrder[cleared.mock.invocationCallOrder.length - 1]!);
    fireEvent.click(screen.getByRole('button', { name: '清除筛选' }));
    expect(screen.getByText('显示 3 / 3 个页面')).toBeInTheDocument();
  });

  it('filters relationship types in the graph and details, preserving accurate unique related-page counts', async () => {
    mount();
    const browser = await screen.findByRole('combobox', { name: '浏览图谱节点' });
    fireEvent.change(browser, { target: { value: 'p1' } });
    expect(screen.getByText('2 个关联页面 · 3 条关系')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: '筛选关系类型' }), { target: { value: 'references' } });
    const details = screen.getByRole('complementary', { name: '页面详情' });
    expect(within(details).getByText('1 个关联页面 · 1 条关系')).toBeInTheDocument();
    expect(within(details).queryByText('(depends_on)')).not.toBeInTheDocument();
    expect(within(details).getByText('(references)')).toBeInTheDocument();
    expect(screen.getByText('显示 2 / 3 个页面')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '手动' }));
    expect(screen.getByText('显示 0 / 3 个页面')).toBeInTheDocument();
  });

  it('uses every graph page for search and relation targets without a first-page-only list request', async () => {
    const many = Array.from({ length: 125 }, (_, i) => page(`p${i}`, `Page ${i}`, 'f1', `pages/项目/Page ${i}.md`));
    api.get.mockResolvedValue({ data: { nodes: many, edges: [], folders } });
    mount();
    const browser = await screen.findByRole('combobox', { name: '浏览图谱节点' });
    expect(within(browser).getAllByRole('option')).toHaveLength(126);
    fireEvent.change(browser, { target: { value: 'p0' } });
    fireEvent.click(screen.getByRole('button', { name: '建立关系…' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('option', { name: 'Page 124' })).toHaveAttribute('value', 'p124');
    expect(api.get.mock.calls.map(call => call[0])).toEqual(['/knowledge/graph/s1']);
  });

  it('keeps empty-folder-only graphs available and translates local UI on language switch', async () => {
    api.get.mockResolvedValue({ data: { nodes: [], edges: [], folders: [folders[2]] } });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: '空目录 空目录 0 个页面' }));
    expect(screen.getByText('此文件夹没有直接包含的页面。')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Language' }));
    expect(screen.getByRole('searchbox', { name: 'Search pages' })).toBeInTheDocument();
    expect(screen.getByText('This folder contains no direct pages.')).toBeInTheDocument();
    expect(localStorage.getItem('agentwiki.language.v1')).toBe('en');
  });

  it('does not reuse a dragged group layout when switching to another Space', async () => {
    vi.stubGlobal('PointerEvent', undefined);
    api.get.mockImplementation((url: string) => Promise.resolve({ data: {
      nodes: [page(url.endsWith('/s1') ? 'old' : 'new', url.endsWith('/s1') ? 'Old page' : 'New page', null, 'pages/page.md')],
      folders: [], edges: [],
    } }));
    const { container } = mount();
    await screen.findByRole('option', { name: 'Old page' });
    fireEvent.click(screen.getByRole('button', { name: '重置视图' }));
    const canvas = container.querySelector('canvas')!;
    fireEvent.mouseDown(canvas, { button: 0, clientX: 150, clientY: 90 });
    fireEvent.mouseMove(window, { buttons: 1, clientX: 230, clientY: 150 });
    fireEvent.mouseUp(window, { button: 0, clientX: 230, clientY: 150 });
    expect(arcs.mock.calls[arcs.mock.calls.length - 1].slice(0, 2)).toEqual([230, 150]);
    fireEvent.click(screen.getByRole('button', { name: 'Other Space' }));
    await screen.findByRole('option', { name: 'New page' });
    // Both Spaces use the same synthetic ungrouped ID, but layout is Space-local.
    expect(arcs.mock.calls[arcs.mock.calls.length - 1].slice(0, 2)).toEqual([150, 90]);
    expect(screen.queryByRole('option', { name: 'Old page' })).not.toBeInTheDocument();
  });

  it('does not replace a new Space graph with an older in-flight response', async () => {
    let resolveOld: (value: unknown) => void = () => {};
    api.get.mockImplementation((url: string) => url.endsWith('/s1') ? new Promise(resolve => { resolveOld = resolve; })
      : Promise.resolve({ data: { nodes: [page('new', 'New Space page', null, 'pages/new.md')], folders: [], edges: [] } }));
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Other Space' }));
    await screen.findByRole('option', { name: 'New Space page' });
    await act(async () => { resolveOld({ data: { nodes, edges, folders } }); });
    expect(screen.queryByRole('option', { name: '大纲' })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'New Space page' })).toBeInTheDocument();
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
  });
});
