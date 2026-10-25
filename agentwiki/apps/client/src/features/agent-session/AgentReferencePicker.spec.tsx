import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import api from '../../api/client';
import { LanguageProvider } from '../../context/LanguageContext';
import { AgentReferencePicker, referencePopoverPlacement } from './AgentReferencePicker';
import type { ComponentProps } from 'react';

vi.mock('../../api/client', () => ({ default: { get: vi.fn() } }));
type Props = ComponentProps<typeof AgentReferencePicker>;
const defaults: Props = { userId: 'user-a', spaceId: 'space-a', selected: [], onChange: vi.fn() };
const page = (id: string, title = id, spaceId = 'space-a') => ({ page: { id, title, spaceId } });
const tree = (props: Partial<Props> = {}) => <LanguageProvider><AgentReferencePicker {...defaults} {...props} /></LanguageProvider>;
const open = () => fireEvent.click(screen.getByRole('button', { name: 'Reference pages' }));
const search = async (query: string) => {
  fireEvent.change(screen.getByRole('textbox', { name: 'Find reference pages' }), { target: { value: query } });
  await act(async () => vi.advanceTimersByTimeAsync(250));
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(api.get).mockReset().mockResolvedValue({ data: { results: [] } });
  localStorage.setItem('agentwiki.language.v1', 'en');
});
afterEach(() => {
  cleanup(); localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
});

it.each([
  ['zh-CN', '引用文档', '查找引用文档', '请输入需要引用的文档名称'],
  ['en', 'Reference pages', 'Find reference pages', 'Enter the name of the document to reference'],
] as const)('opens a focused localized search only on request in %s', (language, trigger, label, placeholder) => {
  localStorage.setItem('agentwiki.language.v1', language);
  render(tree());
  expect(screen.queryByRole('textbox', { name: label })).not.toBeInTheDocument();
  expect(api.get).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: trigger }));
  expect(screen.getByRole('textbox', { name: label })).toHaveAttribute('placeholder', placeholder);
  expect(screen.getByRole('textbox', { name: label })).toHaveFocus();
});

it('supports arrow navigation and Enter selection, then closes and returns focus', async () => {
  const onChange = vi.fn(), onClose = vi.fn();
  vi.mocked(api.get).mockResolvedValue({ data: { results: [page('a', 'Alpha'), page('b', 'Beta')] } });
  render(tree({ onChange, onClose })); open(); await search('pages');
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'ArrowDown' });
  expect(screen.getByRole('button', { name: 'Add Alpha' })).toHaveFocus();
  fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
  expect(screen.getByRole('button', { name: 'Add Beta' })).toHaveFocus();
  fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
  expect(screen.getByRole('button', { name: 'Add Alpha' })).toHaveFocus();
  fireEvent.keyDown(document.activeElement!, { key: 'Enter' });
  expect(onChange).toHaveBeenCalledWith([{ pageId: 'a', title: 'Alpha' }]);
  expect(onClose).toHaveBeenCalledOnce();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('closes on Escape and clears search when reopened', async () => {
  render(tree()); open(); await search('old query');
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Reference pages' })).toHaveFocus();
  open(); expect(screen.getByRole('textbox')).toHaveValue('');
});

it.each([false, true])('leaves the reference portal beside its trigger at the Tab boundary (shift=%s)', async (shiftKey) => {
  vi.mocked(api.get).mockResolvedValue({ data: { results: [page('a', 'Alpha')] } });
  render(<><button>Before reference picker</button>{tree()}<textarea aria-label="Message" /></>);
  open(); await search('Alpha');
  const boundary = shiftKey ? screen.getByRole('textbox', { name: 'Find reference pages' }) : screen.getByRole('button', { name: 'Add Alpha' });
  boundary.focus();
  fireEvent.keyDown(boundary, { key: 'Tab', shiftKey });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(shiftKey ? screen.getByRole('button', { name: 'Before reference picker' }) : screen.getByRole('textbox', { name: 'Message' })).toHaveFocus();
});

it('keeps Tab navigation inside the reference portal before reaching its boundary', async () => {
  vi.mocked(api.get).mockResolvedValue({ data: { results: [page('a', 'Alpha')] } });
  render(tree()); open(); await search('Alpha');
  const input = screen.getByRole('textbox', { name: 'Find reference pages' });
  const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
  fireEvent(input, event);
  expect(event.defaultPrevented).toBe(false);
  expect(screen.getByRole('dialog')).toBeVisible();
});

it('clears results with the search control and dismisses outside without stealing focus', async () => {
  const onClose = vi.fn();
  vi.mocked(api.get).mockResolvedValue({ data: { results: [page('a', 'Alpha')] } });
  render(<>{tree({ onClose })}<button>Outside</button></>); open(); await search('Alpha');
  fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
  expect(screen.getByRole('textbox')).toHaveValue('');
  expect(screen.getByRole('textbox')).toHaveFocus();
  expect(screen.queryByRole('button', { name: 'Add Alpha' })).not.toBeInTheDocument();
  fireEvent.pointerDown(screen.getByRole('button', { name: 'Outside' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(onClose).not.toHaveBeenCalled();
});

it('dismisses the reference search when focus leaves the document without stealing focus back', async () => {
  const onClose = vi.fn();
  render(tree({ onClose })); open(); await search('private query');
  fireEvent.blur(screen.getByRole('textbox', { name: 'Find reference pages' }), { relatedTarget: null });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(onClose).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Reference pages' })).not.toHaveFocus();
  open(); expect(screen.getByRole('textbox', { name: 'Find reference pages' })).toHaveValue('');
});

it('responds to each new open request once and consumes requests while hidden or disabled', () => {
  const rendered = render(tree({ openRequest: 0 }));
  rendered.rerender(tree({ openRequest: 1 })); expect(screen.getByRole('textbox')).toHaveFocus();
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
  rendered.rerender(tree({ openRequest: 1 })); expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  rendered.rerender(tree({ openRequest: 2, disabled: true }));
  rendered.rerender(tree({ openRequest: 2, disabled: false })); expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  rendered.rerender(<div hidden>{tree({ openRequest: 3 })}</div>);
  rendered.rerender(<div hidden>{tree({ openRequest: 4 })}</div>);
  expect(screen.queryByRole('textbox', { hidden: true })).not.toBeInTheDocument();
  rendered.rerender(<div>{tree({ openRequest: 4 })}</div>);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('keeps only unique unselected pages from the same Space', async () => {
  vi.mocked(api.get).mockResolvedValue({ data: { results: [page('a', 'Alpha'), page('a', 'Alpha'), page('b', 'Beta'), page('c', 'Secret', 'space-b'), { page: { id: 42, title: 'Malformed', spaceId: 'space-a' } }] } });
  render(tree({ selected: [{ pageId: 'b', title: 'Beta' }] })); open(); await search('pages');
  expect(screen.getAllByRole('button', { name: 'Add Alpha' })).toHaveLength(1);
  expect(screen.queryByRole('button', { name: 'Add Beta' })).not.toBeInTheDocument();
  expect(screen.queryByText('Secret')).not.toBeInTheDocument(); expect(screen.queryByText('Malformed')).not.toBeInTheDocument();
  expect(api.get).toHaveBeenCalledWith('/search', expect.objectContaining({ params: { q: 'pages', spaceId: 'space-a', limit: 20 }, signal: expect.any(AbortSignal) }));
});

it('caps references at five while leaving compact chips removable', () => {
  const selected = Array.from({ length: 5 }, (_, id) => ({ pageId: `${id}`, title: `Page ${id}` })), onChange = vi.fn();
  const rendered = render(tree({ selected, onChange }));
  expect(screen.getByRole('button', { name: 'Reference pages' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Remove Page 2' }));
  expect(onChange).toHaveBeenCalledWith(selected.filter((reference) => reference.pageId !== '2'));
  rendered.rerender(tree({ selected, onChange, disabled: true }));
  expect(screen.getByRole('button', { name: 'Remove Page 2' })).toBeDisabled();
});

it('aborts stale queries and ignores late results even if the transport resolves after abort', async () => {
  let release!: (value: unknown) => void;
  vi.mocked(api.get).mockReturnValueOnce(new Promise((resolve) => { release = resolve; }));
  render(tree()); open(); await search('old');
  const signal = vi.mocked(api.get).mock.calls[0][1]!.signal!;
  await search('new'); expect(signal.aborted).toBe(true);
  await act(async () => release({ data: { results: [page('a', 'Stale')] } }));
  expect(screen.queryByText('Stale')).not.toBeInTheDocument();
});

it.each(['identity', 'Space', 'disabled'] as const)('clears and aborts the popup when %s changes', async (change) => {
  let release!: (value: unknown) => void;
  vi.mocked(api.get).mockReturnValueOnce(new Promise((resolve) => { release = resolve; }));
  const rendered = render(tree()); open(); await search('secret');
  const signal = vi.mocked(api.get).mock.calls[0][1]!.signal!;
  rendered.rerender(tree(change === 'identity' ? { userId: 'user-b' } : change === 'Space' ? { spaceId: 'space-b' } : { disabled: true }));
  expect(signal.aborted).toBe(true); expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  await act(async () => release({ data: { results: [page('a', 'Secret')] } }));
  expect(screen.queryByText('Secret')).not.toBeInTheDocument();
});

it.each([401, 403, 404])('closes and clears inaccessible results after HTTP %s', async (status) => {
  vi.mocked(api.get).mockRejectedValue({ response: { status } });
  render(tree()); open(); await search('secret');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  open(); expect(screen.getByRole('textbox')).toHaveValue('');
});

it('does not dispatch a queued query or show a result after the session token changes', async () => {
  localStorage.setItem('token', 'token-a');
  const rendered = render(tree()); open();
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'private query' } });
  localStorage.setItem('token', 'token-b');
  await act(async () => vi.advanceTimersByTimeAsync(250));
  expect(api.get).not.toHaveBeenCalled(); expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  rendered.rerender(tree()); open();
  let release!: (value: unknown) => void;
  vi.mocked(api.get).mockReturnValueOnce(new Promise((resolve) => { release = resolve; }));
  await search('other query'); localStorage.setItem('token', 'token-c');
  const transforms = vi.mocked(api.get).mock.calls[0][1]!.transformRequest!;
  const transform = Array.isArray(transforms) ? transforms[0] : transforms;
  expect(() => transform.call({} as never, undefined, {} as never)).toThrow('Reference search session changed');
  await act(async () => release({ data: { results: [page('a', 'Old account result')] } }));
  expect(screen.queryByText('Old account result')).not.toBeInTheDocument(); expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it.each([
  { name: 'right-side desktop panel', anchor: { left: 1190, right: 1218, top: 540, bottom: 568 }, panel: { left: 850, right: 1240, top: 90, bottom: 700 }, viewport: { left: 0, top: 0, right: 1280, bottom: 720 }, height: 720, expected: { left: 866, width: 352, bottom: 188, maxHeight: 352 } },
  { name: 'narrow mobile panel', anchor: { left: 330, right: 358, top: 470, bottom: 498 }, panel: { left: 10, right: 380, top: 260, bottom: 790 }, viewport: { left: 0, top: 0, right: 390, bottom: 844 }, height: 844, expected: { left: 18, width: 352, top: 506, maxHeight: 276 } },
  { name: 'visual viewport above the keyboard', anchor: { left: 310, right: 338, top: 430, bottom: 458 }, panel: { left: 0, right: 360, top: 90, bottom: 800 }, viewport: { left: 0, top: 120, right: 360, bottom: 510 }, height: 844, expected: { left: 8, width: 344, bottom: 422, maxHeight: 294 } },
])('keeps the popup inside the $name and available vertical space', ({ anchor, panel, viewport, height, expected }) => {
  const placement = referencePopoverPlacement(anchor, panel, viewport, height);
  expect(placement).toEqual(expected);
  expect(Number(placement.left)).toBeGreaterThanOrEqual(Math.max(panel.left, viewport.left) + 8);
  expect(Number(placement.left) + Number(placement.width)).toBeLessThanOrEqual(Math.min(panel.right, viewport.right) - 8);
});

it('portals beyond clipped ancestors, repositions on resize and scroll, and closes when hidden', async () => {
  let panelRight = 1240;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const bounds = this.classList.contains('agent-session-panel')
      ? { left: 850, right: panelRight, top: 90, bottom: 700, width: panelRight - 850, height: 610 }
      : { left: 1190, right: 1218, top: 540, bottom: 568, width: 28, height: 28 };
    return { ...bounds, x: bounds.left, y: bounds.top, toJSON: () => bounds };
  });
  vi.stubGlobal('innerWidth', 1280); vi.stubGlobal('innerHeight', 720);
  const rendered = render(<aside className="agent-session-panel" style={{ overflow: 'hidden' }}>{tree()}</aside>);
  open();
  const popup = screen.getByRole('dialog'), input = screen.getByRole('textbox');
  expect(popup.parentElement).toBe(document.body);
  expect(popup).toHaveClass('fixed');
  expect(popup).toHaveStyle({ left: '866px', width: '352px', bottom: '188px', 'max-height': '352px' });
  expect(input).toHaveFocus();
  panelRight = 1180; fireEvent(window, new Event('resize'));
  expect(popup).toHaveStyle({ left: '858px', width: '314px' });
  panelRight = 1140; fireEvent.scroll(window);
  expect(popup).toHaveStyle({ left: '858px', width: '274px' });
  expect(input).toHaveFocus();
  await act(async () => { rendered.container.querySelector('aside')!.hidden = true; });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it.each([{ isComposing: true }, { keyCode: 229 }])('does not consume IME navigation, confirmation, or Escape with %j', async (composition) => {
  const onChange = vi.fn();
  vi.mocked(api.get).mockResolvedValue({ data: { results: [page('a', 'Alpha')] } });
  render(tree({ onChange })); open(); await search('中');
  const input = screen.getByRole('textbox');
  for (const key of ['ArrowDown', 'ArrowUp', 'Enter', 'Escape']) {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...composition });
    fireEvent(input, event);
    expect(event.defaultPrevented).toBe(false);
    expect(input).toHaveFocus();
    expect(screen.getByRole('dialog')).toBeVisible();
  }
  expect(onChange).not.toHaveBeenCalled();
});

it('shows canonical paths to distinguish same-name search results', async () => {
  vi.mocked(api.get).mockResolvedValue({ data: { results: [
    { page: { id: 'a', title: 'Same', spaceId: 'space-a', path: 'pages/One/Same.md' } },
    { page: { id: 'b', title: 'Same', spaceId: 'space-a', path: 'pages/Two/Same.md' } },
  ] } });
  render(tree()); open(); await search('Same');
  expect(screen.getByText('pages/One/Same.md')).toBeVisible();
  expect(screen.getByText('pages/Two/Same.md')).toBeVisible();
});
