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
const edge = (id: string, source: string, target: string, relation: string, origin = 'manual') => ({ id, source, target, relation, strength: 1, confidence: 1, origin });
const edges = [edge('e1', 'p1', 'p2', 'references'), edge('e2', 'p1', 'p2', 'depends_on'), edge('e3', 'p1', 'p3', 'related_to')];
let arcs: ReturnType<typeof vi.fn<(x: number, y: number, radius: number) => void>>;
let cleared: ReturnType<typeof vi.fn>;
let curves: ReturnType<typeof vi.fn>;
let dash: ReturnType<typeof vi.fn>;

function Controls() {
  const { toggleLanguage } = useLanguage(); const navigate = useNavigate();
  return <><button onClick={toggleLanguage}>Language</button><button onClick={() => navigate('/spaces/s2/graph')}>Other Space</button></>;
}
function mount() {
  return render(<LanguageProvider><MemoryRouter initialEntries={['/spaces/s1/graph']}><Controls /><Routes>
    <Route path='/spaces/:spaceId/graph' element={<KnowledgeGraph />} />
    <Route path='/pages/:pageId' element={<div>Opened page</div>} />
  </Routes></MemoryRouter></LanguageProvider>);
}
function filters() { const summary = screen.getByText('关系类型'); if (!summary.closest('details')?.open) fireEvent.click(summary); }
function drawnNode(container: HTMLElement, id: string) {
  const labels = [...container.querySelectorAll<HTMLElement>('[data-node-id]')];
  const index = labels.findIndex(label => label.dataset.nodeId === id);
  expect(index).toBeGreaterThanOrEqual(0);
  const [x, y, radius] = arcs.mock.calls.slice(-labels.length)[index];
  return { x: x as number, y: y as number, radius: radius as number };
}
afterEach(() => vi.unstubAllGlobals());
beforeEach(() => {
  vi.restoreAllMocks(); vi.clearAllMocks(); localStorage.setItem('agentwiki.language.v1', 'zh-CN');
  arcs = vi.fn(); cleared = vi.fn(); curves = vi.fn(); dash = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 800, 620));
  let transform = [1, 0, 0, 1, 0, 0];
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    setTransform(a: number, b: number, c: number, d: number, e: number, f: number) { transform = [a, b, c, d, e, f]; },
    arc(x: number, y: number, radius: number) {
      const dpr = window.devicePixelRatio || 1;
      arcs((x * transform[0] + transform[4]) / dpr, (y * transform[3] + transform[5]) / dpr, radius * transform[0] / dpr);
    },
    clearRect: cleared, beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(), fill: vi.fn(), bezierCurveTo: curves, setLineDash: dash,
  } as unknown as CanvasRenderingContext2D);
  api.get.mockResolvedValue({ data: { nodes, edges, folders } });
});

describe('KnowledgeGraph folder browsing', () => {
  it.each([
    ['zh-CN', '删除关系', '浏览图谱节点', '页面详情'],
    ['en', 'Delete relation', 'Browse graph nodes', 'Page details'],
  ])('keeps every relation deletion visible without expanding evidence in %s', async (language, deleteText, browserLabel, detailsLabel) => {
    localStorage.setItem('agentwiki.language.v1', language);
    api.get.mockResolvedValue({ data: { nodes, folders, edges: [
      edge('outgoing', 'p1', 'p2', 'references'),
      edge('incoming', 'p2', 'p1', 'depends_on'),
      edge('automatic', 'p1', 'p2', 'similar_to', 'auto_similar'),
    ] } });
    mount();
    fireEvent.change(await screen.findByRole('combobox', { name: browserLabel }), { target: { value: 'p1' } });
    const details = screen.getByRole('complementary', { name: detailsLabel });
    const buttons = within(details).getAllByTitle(deleteText);
    expect(buttons).toHaveLength(3);
    buttons.forEach(button => {
      expect(button).toBeVisible();
      expect(button).toHaveTextContent(deleteText);
      expect(button).toHaveAccessibleName(new RegExp(deleteText));
    });
    expect(within(details).getByText('(references)')).toBeVisible();
    expect(within(details).getByText('(depends_on)')).toBeVisible();
    expect(within(details).getByText(language === 'zh-CN' ? '自动·相似' : 'Auto·Similar')).toBeVisible();
  });

  it('confirms and deletes only the chosen reverse-direction relation, keeping both pages and the other relations', async () => {
    let remainingEdges = [edge('e1', 'p1', 'p2', 'references'), edge('e2', 'p2', 'p1', 'depends_on'), edge('e3', 'p1', 'p2', 'similar_to', 'auto_similar')];
    api.get.mockImplementation(() => Promise.resolve({ data: { nodes, folders, edges: remainingEdges } }));
    api.delete.mockImplementation((url: string) => {
      remainingEdges = remainingEdges.filter(item => url !== `/knowledge/relations/${item.id}`);
      return Promise.resolve({ data: { success: true } });
    });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    mount();
    fireEvent.change(await screen.findByRole('combobox', { name: '浏览图谱节点' }), { target: { value: 'p1' } });
    const deleteButton = screen.getByRole('button', { name: /删除关系.*小明.*大纲.*depends_on/ });
    fireEvent.click(deleteButton);
    expect(confirm).toHaveBeenCalledWith('确定删除此关系吗？');
    expect(api.delete).not.toHaveBeenCalled();
    expect(screen.getByText('1 个关联页面 · 3 条关系')).toBeInTheDocument();
    fireEvent.click(deleteButton);
    await screen.findByText('1 个关联页面 · 2 条关系');
    expect(api.delete).toHaveBeenCalledExactlyOnceWith('/knowledge/relations/e2');
    expect(screen.queryByText('(depends_on)')).not.toBeInTheDocument();
    expect(screen.getByText('(references)')).toBeVisible();
    expect(screen.getByText('(similar_to)')).toBeVisible();
    expect(screen.getByRole('option', { name: '大纲 · pages/项目/大纲.md' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '小明 · pages/项目/人物/小明.md' })).toBeInTheDocument();
  });

  it.each([
    [{ response: { status: 403, data: { message: 'Forbidden' } } }, '你没有权限执行此操作。请联系空间所有者或管理员确认成员角色后重试。'],
    [new Error('Network Error'), '网络连接失败，请稍后重试'],
  ])('retains the selected page, relations, and evidence after a rejected deletion', async (failure, message) => {
    api.delete.mockRejectedValueOnce(failure);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    api.get.mockResolvedValue({ data: { nodes, folders, edges: [{ ...edges[0], evidence: { quote: '保留原始证据', confidence: 1 } }] } });
    mount();
    fireEvent.change(await screen.findByRole('combobox', { name: '浏览图谱节点' }), { target: { value: 'p1' } });
    fireEvent.click(screen.getByTitle('删除关系'));
    expect(await screen.findByRole('alert')).toHaveTextContent(message as string);
    const details = screen.getByRole('complementary', { name: '页面详情' });
    expect(within(details).getByText('1 个关联页面 · 1 条关系')).toBeInTheDocument();
    expect(within(details).getByRole('button', { name: /删除关系/ })).toBeVisible();
    const evidence = within(details).getByText('保留原始证据').closest('details')!;
    fireEvent.click(evidence.querySelector('summary')!);
    expect(within(details).getByText('保留原始证据')).toBeVisible();
    expect(api.get).toHaveBeenCalledTimes(1);
  });

  it('shows real folder containers and page labels immediately, retains empty folders, and deduplicates related pages', async () => {
    const { container } = mount();
    const group = await screen.findByRole('button', { name: '人物 项目/人物 1 个页面' });
    expect(group.closest('[data-folder-id]')).toHaveClass('graph-folder-box');
    expect(screen.getByRole('button', { name: '未分组 1 个页面' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '项目 项目 1 个页面' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '小明 pages/项目/人物/小明.md' }));
    const details = screen.getByRole('complementary', { name: '页面详情' });
    expect(within(details).getByText('pages/项目/人物/小明.md')).toBeInTheDocument();
    expect(within(details).getByText('1 个关联页面 · 2 条关系')).toBeInTheDocument();
    const relatedLinks = within(details).getAllByRole('link').filter(link => link.getAttribute('href') === '/pages/p1');
    expect(relatedLinks).toHaveLength(1);
    expect(within(details).getByText('关系与来源 · 2')).toBeVisible();
    within(details).getAllByText('证据详情').forEach(summary => expect(summary.closest('details')).not.toHaveAttribute('open'));
    expect(within(details).getByText('(references)')).toBeVisible();
    expect(within(details).getByText('(depends_on)')).toBeVisible();
    expect(screen.getByText('此文件夹没有直接包含的页面。')).toBeInTheDocument();
    expect(container.querySelectorAll('.graph-folder-box')).toHaveLength(4);
    fireEvent.click(within(details).getByRole('link', { name: '打开页面' }));
    expect(screen.getByText('Opened page')).toBeInTheDocument();
  });

  it('keeps the canvas column unchanged when page details replace the 248px desktop overview and close', async () => {
    const { container } = mount(); const browser = await screen.findByRole('combobox', { name: '浏览图谱节点' });
    const workspace = container.querySelector('canvas')!.closest('.grid')!; const before = workspace.className;
    expect(screen.getByRole('heading', { name: '图谱概览' }).closest('.graph-overview')).toHaveClass('hidden', 'lg:block');
    expect(screen.getByRole('heading', { name: '空间目录' })).toBeInTheDocument();
    fireEvent.change(browser, { target: { value: 'p1' } });
    expect(screen.getByRole('complementary', { name: '页面详情' }).parentElement).toBe(workspace);
    expect(workspace.className).toBe(before); expect(workspace).toHaveClass('lg:grid-cols-[minmax(0,1fr)_248px]');
    expect(screen.queryByRole('heading', { name: '图谱概览' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '关闭页面详情' }));
    expect(workspace.className).toBe(before); expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '图谱概览' }).closest('.graph-overview')).toHaveClass('hidden', 'lg:block');
  });

  it('searches canonical paths, reports counts, and clears the old canvas on no matches', async () => {
    mount(); const search = await screen.findByRole('searchbox', { name: '搜索页面' });
    fireEvent.change(search, { target: { value: '人物/小明' } });
    expect(screen.getByText('显示 1 / 3 个页面')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '小明 pages/项目/人物/小明.md' }));
    expect(screen.queryByRole('button', { name: /大纲 pages/ })).not.toBeInTheDocument();
    arcs.mockClear(); cleared.mockClear();
    fireEvent.change(search, { target: { value: '不存在' } });
    expect(screen.getByText('没有匹配的页面。请调整搜索或关系类型。')).toBeInTheDocument();
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
    await waitFor(() => { expect(cleared).toHaveBeenCalled(); expect(arcs.mock.invocationCallOrder[arcs.mock.invocationCallOrder.length - 1] ?? 0).toBeLessThan(cleared.mock.invocationCallOrder[cleared.mock.invocationCallOrder.length - 1]!); });
    fireEvent.click(screen.getByRole('button', { name: '清除筛选' }));
    expect(screen.getByText('显示 3 / 3 个页面')).toBeInTheDocument();
  });

  it('filters true relationship types and origins without losing unique page counts', async () => {
    mount(); fireEvent.change(await screen.findByRole('combobox', { name: '浏览图谱节点' }), { target: { value: 'p1' } });
    expect(screen.getByText('2 个关联页面 · 3 条关系')).toBeInTheDocument(); filters();
    fireEvent.change(screen.getByRole('combobox', { name: '筛选关系类型' }), { target: { value: 'references' } });
    expect(screen.getByText('1 个关联页面 · 1 条关系')).toBeInTheDocument();
    expect(screen.getByText('显示 2 / 3 个页面')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '手动' })); expect(screen.getByText('显示 0 / 3 个页面')).toBeInTheDocument();
  });

  it('supports connected/unconnected filters, relation focus, and previews more pages without fabricating connections', async () => {
    const many = Array.from({ length: 8 }, (_, i) => page(`p${i}`, `Page ${i}`, 'f1', `pages/项目/Page ${i}.md`));
    api.get.mockResolvedValue({ data: { nodes: many, folders: [folders[0]], edges: [edge('one', 'p0', 'p1', 'related_to')] } });
    mount(); await screen.findByRole('button', { name: '全部 8' });
    expect(screen.getByRole('button', { name: '有关系 2' })).toBeInTheDocument(); expect(screen.getByRole('button', { name: '未连接 6' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Page 7 pages/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Page 5 pages/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '展开 项目 的其余 2 个页面' })); expect(screen.getByRole('button', { name: /Page 7 pages/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '有关系 2' })); expect(screen.getByText('显示 2 / 8 个页面')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '未连接 6' })); expect(screen.getByText('显示 6 / 8 个页面')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '全部 8' })); fireEvent.change(screen.getByRole('combobox', { name: '浏览图谱节点' }), { target: { value: 'p0' } });
    fireEvent.click(screen.getByRole('button', { name: '仅看关联' })); expect(screen.getByText('显示 2 / 8 个页面')).toBeInTheDocument();
    curves.mockClear(); fireEvent.click(screen.getByRole('button', { name: '未连接 6' })); expect(curves).not.toHaveBeenCalled();
  });


  it('keeps the unconnected result set consistent with its count under a relation type filter', async () => {
    api.get.mockResolvedValue({ data: { nodes, folders, edges: [edge('one', 'p1', 'p2', 'references')] } });
    mount(); await screen.findByRole('button', { name: '全部 3' }); filters();
    fireEvent.change(screen.getByRole('combobox', { name: '筛选关系类型' }), { target: { value: 'references' } });
    fireEvent.click(screen.getByRole('button', { name: '未连接 1' }));
    expect(screen.getByRole('option', { name: '草稿 · pages/草稿.md' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: '小明 · pages/项目/人物/小明.md' })).not.toBeInTheDocument();
    expect(screen.getByText('显示 1 / 3 个页面')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '手动' }));
    expect(screen.getByRole('button', { name: '未连接 3' })).toBeInTheDocument();
    expect(screen.getByText('显示 3 / 3 个页面')).toBeInTheDocument();
  });

  it('moves dragged pages with their folder when search compacts columns and restores their relative offset', async () => {
    vi.stubGlobal('PointerEvent', undefined);
    const { container } = mount();
    // Options use API data; wait for the effect-derived graph nodes before resetting/dragging.
    await screen.findByRole('button', { name: '小明 pages/项目/人物/小明.md' });
    fireEvent.click(screen.getByRole('button', { name: '重置视图' }));
    const canvas = container.querySelector('canvas')!;
    const original = drawnNode(container, 'p2');
    const originalBox = container.querySelector<HTMLElement>('[data-folder-id="folder:f2"]')!;
    const originalBoxLeft = parseFloat(originalBox.style.left);
    const originalBoxTop = parseFloat(originalBox.style.top);
    fireEvent.mouseDown(canvas, { button: 0, clientX: original.x, clientY: original.y });
    fireEvent.mouseMove(window, { buttons: 1, clientX: original.x + 10, clientY: original.y }); fireEvent.mouseUp(window);
    expect(drawnNode(container, 'p2')).toEqual({ ...original, x: original.x + 10 });
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索页面' }), { target: { value: '小明' } });
    fireEvent.click(screen.getByRole('button', { name: '重置视图' }));
    const box = container.querySelector<HTMLElement>('[data-folder-id="folder:f2"]')!;
    const label = container.querySelector<HTMLElement>('[data-node-id="p2"]')!;
    expect(parseFloat(label.style.left)).toBeGreaterThan(parseFloat(box.style.left));
    expect(parseFloat(label.style.left)).toBeLessThan(parseFloat(box.style.left) + parseFloat(box.style.width));
    expect(drawnNode(container, 'p2').x - parseFloat(box.style.left)).toBe(original.x - originalBoxLeft + 10);
    expect(drawnNode(container, 'p2').y - parseFloat(box.style.top)).toBe(original.y - originalBoxTop);
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索页面' }), { target: { value: '' } });
    expect(drawnNode(container, 'p2')).toEqual({ ...original, x: original.x + 10 });
    fireEvent.click(screen.getByRole('button', { name: '重置视图' }));
    const restored = drawnNode(container, 'p2');
    fireEvent.mouseDown(canvas, { button: 0, clientX: restored.x, clientY: restored.y });
    fireEvent.mouseMove(window, { buttons: 1, clientX: restored.x + 1000, clientY: restored.y }); fireEvent.mouseUp(window);
    const restoredBox = container.querySelector<HTMLElement>('[data-folder-id="folder:f2"]')!;
    const clipped = drawnNode(container, 'p2');
    expect(clipped.x).toBeGreaterThan(restored.x);
    expect(clipped.x + 72).toBeLessThan(parseFloat(restoredBox.style.left) + parseFloat(restoredBox.style.width));
  });

  it('uses origin for dashed automatic similarity edges and draws each actual edge as a curve', async () => {
    api.get.mockResolvedValue({ data: { nodes, folders, edges: [edge('similar', 'p1', 'p2', 'similar_to', 'auto_similar'), edge('manual', 'p1', 'p3', 'similar_to', 'manual')] } });
    mount(); await screen.findByRole('button', { name: '项目 项目 1 个页面' });
    await waitFor(() => expect(curves).toHaveBeenCalled());
    expect(dash.mock.calls.some(call => JSON.stringify(call[0]) === '[5,5]')).toBe(true);
    filters(); fireEvent.click(screen.getByRole('button', { name: '自动·相似' }));
    dash.mockClear(); fireEvent.click(screen.getByRole('button', { name: '放大图谱' }));
    expect(dash.mock.calls.every(call => call[0].length === 0)).toBe(true);
  });

  it('uses all graph pages for keyboard selection and relation targets without a paginated page request', async () => {
    const many = Array.from({ length: 125 }, (_, i) => page(`p${i}`, `Page ${i}`, 'f1', `pages/项目/Page ${i}.md`));
    api.get.mockResolvedValue({ data: { nodes: many, edges: [], folders } }); mount();
    const browser = await screen.findByRole('combobox', { name: '浏览图谱节点' }); expect(within(browser).getAllByRole('option')).toHaveLength(126);
    fireEvent.change(browser, { target: { value: 'p124' } }); expect(screen.getByRole('button', { name: 'Page 124 pages/项目/Page 124.md' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '建立关系…' })); expect(within(screen.getByRole('dialog')).getByRole('option', { name: 'Page 123 · pages/项目/Page 123.md' })).toHaveAttribute('value', 'p123');
    expect(api.get.mock.calls.map(call => call[0])).toEqual(['/knowledge/graph/s1']);
  });

  it('keeps empty-folder-only graphs available and translates the visible UI', async () => {
    api.get.mockResolvedValue({ data: { nodes: [], edges: [], folders: [folders[2]] } }); mount();
    await screen.findByRole('button', { name: '空目录 空目录 0 个页面' }); expect(screen.getByText('此文件夹没有直接包含的页面。')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Language' })); expect(screen.getByRole('searchbox', { name: 'Search pages' })).toBeInTheDocument();
    expect(screen.getByText('This folder contains no direct pages.')).toBeInTheDocument();
  });

  it('keeps a many-folder opening view readable while explicit Fit graph offers an overview', async () => {
    const manyFolders = Array.from({ length: 18 }, (_, i) => ({ id: `f${i}`, name: `Folder ${i}`, path: `Folder ${i}`, parentId: null }));
    api.get.mockResolvedValue({ data: { nodes: manyFolders.map((folder, i) => page(`p${i}`, `Page ${i}`, folder.id, `pages/Page ${i}.md`)), edges: [], folders: manyFolders } });
    const { container } = mount();
    // The initial fit follows graph-node projection, which happens after options appear.
    await screen.findByRole('button', { name: 'Page 17 pages/Page 17.md' });
    expect(Number(screen.getByLabelText('图谱缩放比例').textContent?.replace('%', ''))).toBeGreaterThanOrEqual(65);
    const initialScale = Number(screen.getByLabelText('图谱缩放比例').textContent?.replace('%', ''));
    fireEvent.click(screen.getByRole('button', { name: '适应图谱' }));
    expect(Number(screen.getByLabelText('图谱缩放比例').textContent?.replace('%', ''))).toBeLessThan(initialScale);
    const lastBox = container.querySelectorAll<HTMLElement>('.graph-folder-box')[17];
    expect(parseFloat(lastBox.style.top) + parseFloat(lastBox.style.height)).toBeLessThanOrEqual(620);
    // Overview mode depends on zoom, not on the number or previous height of folder cards.
    for (let attempt = 0; attempt < 10 && Number(screen.getByLabelText('图谱缩放比例').textContent?.replace('%', '')) >= 65; attempt++) {
      fireEvent.click(screen.getByRole('button', { name: '缩小图谱' }));
    }
    expect(container.querySelector('.graph-stage')).toHaveClass('is-overview');
    const overview = Number(screen.getByLabelText('图谱缩放比例').textContent?.replace('%', ''));
    fireEvent.click(screen.getByRole('button', { name: '缩小图谱' }));
    expect(Number(screen.getByLabelText('图谱缩放比例').textContent?.replace('%', ''))).toBeLessThan(overview);
    fireEvent.change(screen.getByRole('combobox', { name: '浏览图谱节点' }), { target: { value: 'p17' } });
    expect(screen.getByRole('complementary', { name: '页面详情' })).toHaveTextContent('Page 17');
  });

  it('fits the applied three-column layout after resizing from a single column', async () => {
    let width = 390;
    const resizeCallbacks = new Set<ResizeObserverCallback>();
    vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockImplementation(() => new DOMRect(0, 0, width, 620));
    vi.stubGlobal('ResizeObserver', class {
      constructor(private readonly callback: ResizeObserverCallback) { resizeCallbacks.add(callback); }
      observe() {}
      disconnect() { resizeCallbacks.delete(this.callback); }
    });
    const resizeFolders = Array.from({ length: 6 }, (_, i) => ({ id: `f${i}`, name: `Folder ${i}`, path: `Folder ${i}`, parentId: null }));
    api.get.mockResolvedValue({ data: {
      nodes: resizeFolders.map((folder, i) => page(`p${i}`, `Page ${i}`, folder.id, `pages/Page ${i}.md`)),
      edges: [], folders: resizeFolders,
    } });
    const { container } = mount();
    await screen.findByRole('button', { name: 'Page 5 pages/Page 5.md' });
    const boxes = () => [...container.querySelectorAll<HTMLElement>('.graph-folder-box')];
    const scale = () => Number(screen.getByLabelText('图谱缩放比例').textContent?.replace('%', ''));
    expect(new Set(boxes().map(box => box.style.left)).size).toBe(1);
    expect(scale()).toBeGreaterThanOrEqual(85);

    width = 1200;
    act(() => { for (const callback of [...resizeCallbacks]) callback([], {} as ResizeObserver); });
    await waitFor(() => expect(new Set(boxes().slice(0, 3).map(box => box.style.top)).size).toBe(1));
    expect(new Set(boxes().slice(0, 3).map(box => box.style.left)).size).toBe(3);
    const automaticScale = scale();
    // Mixing the new three-column bounds with old single-column nodes fits the
    // tall, obsolete node positions and leaves this wide canvas at the 65% floor.
    expect(automaticScale).toBeGreaterThan(65);
    fireEvent.click(screen.getByRole('button', { name: '适应图谱' }));
    expect(scale()).toBe(automaticScale);
    for (const box of boxes()) {
      expect(parseFloat(box.style.left)).toBeGreaterThanOrEqual(0);
      expect(parseFloat(box.style.left) + parseFloat(box.style.width)).toBeLessThanOrEqual(width);
      expect(parseFloat(box.style.top) + parseFloat(box.style.height)).toBeLessThanOrEqual(620);
    }
  });

  it('does not reuse dragged page coordinates after a Space switch', async () => {
    vi.stubGlobal('PointerEvent', undefined);
    api.get.mockImplementation((url: string) => Promise.resolve({ data: { nodes: [page('same', url.endsWith('/s1') ? 'Old page' : 'New page', null, 'pages/page.md')], folders: [], edges: [] } }));
    const { container } = mount(); await screen.findByRole('button', { name: 'Old page pages/page.md' });
    fireEvent.click(screen.getByRole('button', { name: '重置视图' }));
    const original = drawnNode(container, 'same'); const canvas = container.querySelector('canvas')!;
    fireEvent.mouseDown(canvas, { button: 0, clientX: original.x, clientY: original.y }); fireEvent.mouseMove(window, { buttons: 1, clientX: original.x + 20, clientY: original.y }); fireEvent.mouseUp(window);
    expect(drawnNode(container, 'same')).toEqual({ ...original, x: original.x + 20 });
    fireEvent.click(screen.getByRole('button', { name: 'Other Space' })); await screen.findByRole('button', { name: 'New page pages/page.md' });
    expect(drawnNode(container, 'same')).toEqual(original); expect(screen.queryByRole('option', { name: 'Old page · pages/page.md' })).not.toBeInTheDocument();
  });

  it('does not replace a new Space graph with an older in-flight response', async () => {
    let resolveOld: (value: unknown) => void = () => {};
    api.get.mockImplementation((url: string) => url.endsWith('/s1') ? new Promise(resolve => { resolveOld = resolve; }) : Promise.resolve({ data: { nodes: [page('new', 'New Space page', null, 'pages/new.md')], folders: [], edges: [] } }));
    mount(); fireEvent.click(screen.getByRole('button', { name: 'Other Space' })); await screen.findByRole('option', { name: 'New Space page · pages/new.md' });
    await act(async () => { resolveOld({ data: { nodes, edges, folders } }); });
    expect(screen.queryByRole('option', { name: '大纲 · pages/项目/大纲.md' })).not.toBeInTheDocument(); expect(screen.getByRole('option', { name: 'New Space page · pages/new.md' })).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledTimes(2);
  });
});
