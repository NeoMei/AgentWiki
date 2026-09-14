import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../context/LanguageContext';
import { KnowledgeGraph } from './KnowledgeGraph';

const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../../api/client', () => ({ default: api }));

const node = (id: string, title: string) => ({ id, title, x: 100, y: 100, radius: 20 });

describe('KnowledgeGraph origin filters', () => {
  beforeEach(() => {
    localStorage.setItem('agentwiki.language.v1', 'zh-CN');
    vi.clearAllMocks();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      scale: vi.fn(),
      setTransform: vi.fn(),
      clearRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
      fillText: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
  });

  it('renders origin chips and hides an origin when its chip is toggled off', async () => {
    api.get.mockImplementation((url: string) => {
      if (url.includes('/knowledge/graph/')) {
        return Promise.resolve({ data: {
          nodes: [node('p1', 'Alpha'), node('p2', 'Beta')],
          edges: [
            { id: 'e1', source: 'p1', target: 'p2', relation: 'references', strength: 1, confidence: 1, origin: 'auto_wikilink' },
            { id: 'e2', source: 'p2', target: 'p1', relation: 'related_to', strength: 1, confidence: 1, origin: 'manual' },
          ],
        } });
      }
      return Promise.resolve({ data: { data: [{ id: 'p1', title: 'Alpha' }, { id: 'p2', title: 'Beta' }] } });
    });

    const { container } = render(
      <LanguageProvider>
        <MemoryRouter initialEntries={['/spaces/s1/graph']}>
          <Routes>
            <Route path='/spaces/:spaceId/graph' element={<KnowledgeGraph />} />
          </Routes>
        </MemoryRouter>
      </LanguageProvider>,
    );

    expect(await screen.findByText('自动·链接', {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByText('手动')).toBeInTheDocument();

    fireEvent.click(container.querySelector('canvas')!, { clientX: 100, clientY: 100 });
    await waitFor(() => expect(screen.getAllByText('自动·链接')).toHaveLength(2));

    fireEvent.click(screen.getAllByText('自动·链接')[0]);
    await waitFor(() => {
      expect(screen.getByText('自动·链接')).toHaveClass('line-through');
    });
  });

  it('offers a keyboard-accessible node browser alongside the visual canvas', async () => {
    api.get.mockImplementation((url: string) => {
      if (url.includes('/knowledge/graph/')) {
        return Promise.resolve({ data: { nodes: [node('p1', 'Alpha'), node('p2', 'Beta')], edges: [] } });
      }
      return Promise.resolve({ data: { data: [{ id: 'p1', title: 'Alpha' }, { id: 'p2', title: 'Beta' }] } });
    });

    const { container } = render(
      <LanguageProvider>
        <MemoryRouter initialEntries={['/spaces/s1/graph']}>
          <Routes><Route path='/spaces/:spaceId/graph' element={<KnowledgeGraph />} /></Routes>
        </MemoryRouter>
      </LanguageProvider>,
    );

    const nodeBrowser = await screen.findByRole('combobox', { name: '浏览图谱节点' });
    fireEvent.change(nodeBrowser, { target: { value: 'p2' } });
    expect(screen.getByRole('link', { name: '打开所选页面' })).toHaveAttribute('href', '/pages/p2');
    expect(container.querySelector('canvas')).toHaveAttribute('aria-hidden', 'true');
  });

  it('closes the relation dialog with Escape, exits linking mode, and restores focus', async () => {
    api.get.mockImplementation((url: string) => {
      if (url.includes('/knowledge/graph/')) {
        return Promise.resolve({ data: {
          nodes: [node('p1', 'Alpha'), { ...node('p2', 'Beta'), x: 200 }],
          edges: [],
        } });
      }
      return Promise.resolve({ data: { data: [{ id: 'p1', title: 'Alpha' }, { id: 'p2', title: 'Beta' }] } });
    });

    const { container } = render(
      <LanguageProvider>
        <MemoryRouter initialEntries={['/spaces/s1/graph']}>
          <Routes>
            <Route path='/spaces/:spaceId/graph' element={<KnowledgeGraph />} />
          </Routes>
        </MemoryRouter>
      </LanguageProvider>,
    );

    const canvas = await waitFor(() => {
      const value = container.querySelector('canvas');
      expect(value).toBeInTheDocument();
      return value!;
    });
    fireEvent.click(canvas, { clientX: 100, clientY: 100 });
    const opener = screen.getByRole('button', { name: '建立关系…' });
    opener.focus();
    fireEvent.click(opener);
    const dialog = screen.getByRole('dialog', { name: '创建关系' });

    fireEvent.keyDown(dialog, { key: 'Escape' });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText(/正在从以下页面建立关系/)).not.toBeInTheDocument();
    await waitFor(() => expect(opener).toHaveFocus());
  });
});

describe('KnowledgeGraph canvas navigation', () => {
  afterEach(() => vi.unstubAllGlobals());
  let resize: ResizeObserverCallback;
  let disconnect: ReturnType<typeof vi.fn>;
  let drawn: { x: number; y: number; radius: number }[];
  let width: number;
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    vi.stubGlobal('PointerEvent', undefined);
    localStorage.setItem('agentwiki.language.v1', 'en');
    width = 600;
    drawn = [];
    let transform = [1, 0, 0, 1, 0, 0];
    vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockImplementation(() =>
      ({ left: 20, top: 30, width, height: 500, right: width + 20, bottom: 530, x: 20, y: 30, toJSON() {} }));
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      scale() {},
      setTransform(a: number, b: number, c: number, d: number, e: number, f: number) { transform = [a, b, c, d, e, f]; },
      clearRect() { drawn = []; },
      beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fill() {}, fillText() {},
      arc(x: number, y: number, radius: number) {
        const dpr = window.devicePixelRatio || 1;
        drawn.push({ x: (x * transform[0] + transform[4]) / dpr,
          y: (y * transform[3] + transform[5]) / dpr, radius: radius * transform[0] / dpr });
      },
    } as unknown as CanvasRenderingContext2D);
    disconnect = vi.fn();
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: ResizeObserverCallback) { resize = callback; }
      observe() {} disconnect = disconnect;
    });
    api.get.mockImplementation((url: string) => Promise.resolve({ data: url.includes('/knowledge/graph/')
      ? { nodes: [node('p1', 'Alpha'), { ...node('p2', 'Beta'), x: 300, y: 200 }], edges: [] }
      : { data: [{ id: 'p1', title: 'Alpha' }, { id: 'p2', title: 'Beta' }] } }));
  });
  async function mount() {
    const result = render(<LanguageProvider><MemoryRouter initialEntries={['/spaces/s1/graph']}>
      <Routes><Route path='/spaces/:spaceId/graph' element={<KnowledgeGraph />} />
        <Route path='/pages/:pageId' element={<div>Opened page</div>} /></Routes>
    </MemoryRouter></LanguageProvider>);
    await screen.findByRole('combobox', { name: 'Browse graph nodes' });
    return { ...result, canvas: result.container.querySelector('canvas')! };
  }
  function drag(canvas: HTMLCanvasElement, from: number[], to: number[]) {
    fireEvent.mouseDown(canvas, { button: 0, clientX: from[0] + 20, clientY: from[1] + 30 });
    fireEvent.mouseMove(window, { buttons: 1, clientX: to[0] + 20, clientY: to[1] + 30 });
    fireEvent.mouseUp(window, { button: 0, clientX: to[0] + 20, clientY: to[1] + 30 });
  }
  it('anchors bounded zoom on the cursor and selects where the transformed node is drawn', async () => {
    const { canvas } = await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Reset view' }));
    fireEvent.wheel(canvas, { clientX: 120, clientY: 130, deltaY: -Math.log(2) * 1000 });
    expect(drawn[0]).toEqual({ x: 100, y: 100, radius: 40 });
    expect(drawn[1]).toEqual({ x: 500, y: 300, radius: 40 });
    fireEvent.click(canvas, { clientX: 520, clientY: 330 });
    expect(screen.getByRole('link', { name: 'Open selected page' })).toHaveAttribute('href', '/pages/p2');
    fireEvent.wheel(canvas, { clientX: 120, clientY: 130, deltaY: -100000 });
    expect(drawn[0].radius).toBeLessThanOrEqual(80);
    fireEvent.wheel(canvas, { clientX: 120, clientY: 130, deltaY: 100000 });
    expect(drawn[0].radius).toBeGreaterThanOrEqual(5);
  });
  it('pans without clearing selection and opens a transformed node on a fresh double click', async () => {
    const { canvas } = await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Reset view' }));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'p1' } });
    drag(canvas, [450, 400], [500, 440]);
    expect(drawn[0]).toEqual({ x: 150, y: 140, radius: 20 });
    fireEvent.click(canvas, { clientX: 520, clientY: 470 });
    expect(screen.getByRole('combobox')).toHaveValue('p1');
    fireEvent.mouseDown(canvas, { button: 0, clientX: 170, clientY: 170 });
    fireEvent.mouseUp(window);
    fireEvent.click(canvas, { clientX: 170, clientY: 170, detail: 1 });
    fireEvent.doubleClick(canvas, { clientX: 170, clientY: 170 });
    expect(screen.getByText('Opened page')).toBeInTheDocument();
  });
  it('drags a node in world coordinates after zoom and suppresses drag clicks and navigation', async () => {
    const { canvas } = await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Reset view' }));
    fireEvent.wheel(canvas, { clientX: 120, clientY: 130, deltaY: -Math.log(2) * 1000 });
    drag(canvas, [100, 100], [180, 160]);
    expect(drawn[0]).toEqual({ x: 180, y: 160, radius: 40 });
    expect(drawn[1]).toEqual({ x: 500, y: 300, radius: 40 });
    fireEvent.click(canvas, { clientX: 200, clientY: 190 });
    fireEvent.doubleClick(canvas, { clientX: 200, clientY: 190 });
    expect(screen.queryByText('Opened page')).not.toBeInTheDocument();
    expect(screen.getByRole('combobox')).toHaveValue('');
    fireEvent.click(screen.getByRole('button', { name: 'Reset view' }));
    expect(drawn[0]).toEqual({ x: 140, y: 130, radius: 20 });
  });
  it('fits on resize and resets the viewport without changing the layout', async () => {
    const { canvas } = await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Reset view' }));
    expect(drawn[0]).toEqual({ x: 100, y: 100, radius: 20 });
    width = 320;
    act(() => resize([], {} as ResizeObserver));
    expect(drawn[1].x + drawn[1].radius).toBeLessThan(320);
    fireEvent.click(canvas, { clientX: drawn[1].x + 20, clientY: drawn[1].y + 30 });
    expect(screen.getByRole('combobox')).toHaveValue('p2');
    fireEvent.click(screen.getByRole('button', { name: 'Fit graph' }));
    expect(drawn[0].x - drawn[0].radius).toBeGreaterThanOrEqual(0);
  });
  it.each([true, false])('cancels gestures and disconnects on unmount (pointer support: %s)', async (pointerSupport) => {
    vi.stubGlobal('PointerEvent', pointerSupport ? MouseEvent : undefined);
    const down = pointerSupport ? fireEvent.pointerDown : fireEvent.mouseDown;
    const move = pointerSupport ? fireEvent.pointerMove : fireEvent.mouseMove;
    const { canvas, unmount } = await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Reset view' }));
    down(canvas, { button: 0, clientX: 470, clientY: 430 });
    move(window, { clientX: 520, clientY: 470 });
    expect(drawn[0].x).toBe(150);
    if (pointerSupport) fireEvent.pointerCancel(window);
    else fireEvent.mouseUp(window);
    move(window, { clientX: 570, clientY: 470 });
    expect(drawn[0].x).toBe(150);
    down(canvas, { button: 0, clientX: 470, clientY: 430 });
    fireEvent.blur(window);
    move(window, { clientX: 570, clientY: 470 });
    expect(drawn[0].x).toBe(150);
    unmount();
    expect(disconnect).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
  it('preserves click selection with minor pointer jitter and ignores secondary buttons', async () => {
    const { canvas } = await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Reset view' }));
    drag(canvas, [100, 100], [102, 101]);
    fireEvent.click(canvas, { clientX: 122, clientY: 131 });
    expect(screen.getByRole('combobox')).toHaveValue('p1');
    expect(drawn[0]).toEqual({ x: 100, y: 100, radius: 20 });
    fireEvent.mouseDown(canvas, { button: 2, clientX: 120, clientY: 130 });
    fireEvent.mouseMove(window, { clientX: 220, clientY: 230 });
    fireEvent.mouseUp(window);
    expect(drawn[0]).toEqual({ x: 100, y: 100, radius: 20 });
  });

  it('supports keyboard zoom controls and CSS-pixel picking on high-DPI canvases', async () => {
    vi.stubGlobal('devicePixelRatio', 2);
    const { canvas } = await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Reset view' }));
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(drawn[0]).toEqual({ x: 50, y: 62.5, radius: 25 });
    fireEvent.click(canvas, { clientX: 70, clientY: 92.5 });
    expect(screen.getByRole('combobox')).toHaveValue('p1');
    expect(canvas.width).toBe(1200);
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    expect(drawn[0]).toEqual({ x: 100, y: 100, radius: 20 });
  });

  it.each([true, false])('removes input handlers during a drag (pointer support: %s)', async (pointerSupport) => {
    vi.stubGlobal('PointerEvent', pointerSupport ? MouseEvent : undefined);
    const addWindow = vi.spyOn(window, 'addEventListener');
    const removeWindow = vi.spyOn(window, 'removeEventListener');
    const { canvas, unmount } = await mount();
    const wheel = new WheelEvent('wheel', { cancelable: true, clientX: 120, clientY: 130, deltaY: 10 });
    act(() => { canvas.dispatchEvent(wheel); });
    expect(wheel.defaultPrevented).toBe(true);
    (pointerSupport ? fireEvent.pointerDown : fireEvent.mouseDown)(canvas, { button: 0, clientX: 470, clientY: 430 });
    unmount();
    const inputEvents = pointerSupport ? ['pointermove', 'pointerup', 'pointercancel'] : ['mousemove', 'mouseup'];
    for (const type of [...inputEvents, 'blur', 'resize']) {
      const added = addWindow.mock.calls.filter(call => call[0] === type);
      expect(added.length).toBeGreaterThan(0);
      for (const [, listener] of added) expect(removeWindow).toHaveBeenCalledWith(type, listener);
    }
    const detachedWheel = new WheelEvent('wheel', { cancelable: true, deltaY: 10 });
    canvas.dispatchEvent(detachedWheel);
    expect(detachedWheel.defaultPrevented).toBe(false);
  });

  it('exposes Chinese navigation controls through the existing language preference', async () => {
    localStorage.setItem('agentwiki.language.v1', 'zh-CN');
    render(<LanguageProvider><MemoryRouter initialEntries={['/spaces/s1/graph']}>
      <Routes><Route path='/spaces/:spaceId/graph' element={<KnowledgeGraph />} /></Routes>
    </MemoryRouter></LanguageProvider>);
    expect(await screen.findByRole('button', { name: '适应图谱' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重置视图' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '放大图谱' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: '浏览图谱节点' })).toBeInTheDocument();
  });

  it('does not navigate when a pointer drag is followed by the second click of a double click', async () => {
    vi.stubGlobal('PointerEvent', MouseEvent);
    const { canvas } = await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Reset view' }));
    fireEvent.pointerDown(canvas, { button: 0, clientX: 120, clientY: 130 });
    fireEvent.pointerMove(window, { clientX: 160, clientY: 170 });
    fireEvent.pointerUp(window);
    fireEvent.click(canvas, { clientX: 160, clientY: 170, detail: 1 });
    fireEvent.pointerDown(canvas, { button: 0, clientX: 160, clientY: 170, detail: 0 });
    fireEvent.pointerUp(window);
    fireEvent.click(canvas, { clientX: 160, clientY: 170, detail: 2 });
    fireEvent.doubleClick(canvas, { clientX: 160, clientY: 170, detail: 2 });
    expect(screen.queryByText('Opened page')).not.toBeInTheDocument();
  });

  it.each(['node', 'background'])('keeps selection after a short %s pointer drag and delayed compatibility mouse events', async (target) => {
    class TestPointerEvent extends MouseEvent {
      pointerId: number;
      pointerType: string;
      isPrimary: boolean;
      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init);
        this.pointerId = init.pointerId ?? 1;
        this.pointerType = init.pointerType ?? 'touch';
        this.isPrimary = init.isPrimary ?? true;
      }
    }
    vi.stubGlobal('PointerEvent', TestPointerEvent);
    const { canvas } = await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Reset view' }));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'p1' } });
    const clientX = target === 'node' ? 120 : 470;
    const clientY = target === 'node' ? 130 : 430;
    const touch = { button: 0, pointerId: 7, pointerType: 'touch', isPrimary: true, clientX, clientY };
    fireEvent.pointerDown(canvas, touch);
    fireEvent.pointerMove(window, { ...touch, clientX: clientX + 6 });
    fireEvent.pointerUp(window, { ...touch, clientX: clientX + 6 });
    expect(drawn[0].x).toBe(106);
    // Compatibility events can be grouped after pointerup; no live gesture now guards them.
    fireEvent.mouseDown(canvas, { button: 0, detail: 1, clientX: clientX + 6, clientY });
    fireEvent.mouseUp(canvas, { button: 0, detail: 1, clientX: clientX + 6, clientY });
    fireEvent.click(canvas, { detail: 1, clientX: clientX + 6, clientY });
    expect(screen.getByRole('combobox')).toHaveValue('p1');
    fireEvent.doubleClick(canvas, { detail: 2, clientX: 126, clientY: 130 });
    expect(screen.queryByText('Opened page')).not.toBeInTheDocument();

    // A genuinely fresh mouse operation in a Pointer Events browser still pans and opens.
    const mouse = { button: 0, pointerId: 1, pointerType: 'mouse', isPrimary: true, clientX: 470, clientY: 430 };
    fireEvent.pointerDown(canvas, mouse);
    fireEvent.mouseDown(canvas, mouse);
    fireEvent.pointerMove(window, { ...mouse, clientX: 490 });
    fireEvent.mouseMove(window, { ...mouse, clientX: 490 });
    fireEvent.pointerUp(window, { ...mouse, clientX: 490 });
    fireEvent.mouseUp(window, { ...mouse, clientX: 490 });
    fireEvent.click(canvas, { clientX: 490, clientY: 430, detail: 1 });
    expect(drawn[0].x).toBe(126);
    expect(screen.getByRole('combobox')).toHaveValue('p1');
    fireEvent.pointerDown(canvas, { ...mouse, clientX: 146, clientY: 130 });
    fireEvent.mouseDown(canvas, { ...mouse, clientX: 146, clientY: 130 });
    fireEvent.pointerUp(window, { ...mouse, clientX: 146, clientY: 130 });
    fireEvent.mouseUp(window, { ...mouse, clientX: 146, clientY: 130 });
    fireEvent.click(canvas, { clientX: 146, clientY: 130, detail: 1 });
    expect(screen.getByRole('combobox')).toHaveValue('');
    fireEvent.doubleClick(canvas, { clientX: 146, clientY: 130, detail: 2 });
    expect(screen.getByText('Opened page')).toBeInTheDocument();
  });

});
