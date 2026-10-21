import { createRef } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureAssistTarget } from './assistTargets';
import { SelectionNoteComposer } from './SelectionNoteComposer';
import api from '../../api/client';

vi.mock('../../api/client', () => ({ default: { get: vi.fn() } }));

const auth = vi.hoisted(() => ({ user: { id: 'user', name: 'Alice' } }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => auth }));

const version = '2026-10-14T00:00:00.000Z';
const source = 'A selected passage';
let rect = { left: 100, top: 120, right: 190, bottom: 144, width: 90, height: 24 };
const rootRef = createRef<HTMLDivElement>();
const target = captureAssistTarget(source, 'selection', 2, 10, version)!;
const onAdd = vi.fn<(...args: any[]) => boolean | Promise<boolean>>(() => true);
const props = { rootRef, source, updatedAt: version, identity: 'user:space:page', spaceId: undefined as string | undefined, language: 'en', disabled: false, captureTarget: () => target, onAdd };
const fixture = (overrides: Partial<typeof props> = {}) => <><div ref={rootRef}><p>{source}</p></div><SelectionNoteComposer {...props} {...overrides} /></>;
const select = async () => {
  const text = rootRef.current!.querySelector('p')!.firstChild!;
  const range = document.createRange(); range.setStart(text, 2); range.setEnd(text, 10);
  window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
  fireEvent.mouseUp(rootRef.current!);
  return screen.findByRole('button', { name: 'Add note to selection' });
};
const open = async () => { fireEvent.click(await select()); return screen.getByRole('dialog', { name: 'Add page note' }); };
beforeEach(() => {
  auth.user = { id: 'user', name: 'Alice' };
  vi.mocked(api.get).mockResolvedValue({ data: [] });
  onAdd.mockReset().mockReturnValue(true);
  rect = { left: 100, top: 120, right: 190, bottom: 144, width: 90, height: 24 };
  vi.spyOn(Range.prototype, 'getBoundingClientRect').mockImplementation(() => ({ ...rect, x: rect.left, y: rect.top, toJSON() {} }));
});
afterEach(() => { cleanup(); window.getSelection()?.removeAllRanges(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('selection note composer', () => {
  it('shows the composing account and clears its draft before another account starts a note', async () => {
    const view = render(fixture());
    const dialog = await open();
    expect(within(dialog).getByLabelText('Note author: Alice (you)')).toBeVisible();
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Alice private draft' } });
    auth.user = { id: 'another-user', name: 'Bob' };
    view.rerender(fixture({ identity: 'another-user:space:page' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const nextDialog = await open();
    expect(within(nextDialog).getByLabelText('Note author: Bob (you)')).toBeVisible();
    expect(within(nextDialog).getByRole('textbox')).toHaveValue('');
    expect(screen.queryByText(/Alice/)).not.toBeInTheDocument();
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('captures the original passage before focus moves, waits for saving the page note and closes', async () => {
    render(fixture()); const dialog = await open();
    expect(within(dialog).getByRole('textbox', { name: 'Note' })).toHaveFocus();
    expect(within(dialog).getByRole('blockquote')).toHaveTextContent('selected');
    window.getSelection()!.removeAllRanges();
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Explain this' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add note' }));
    expect(onAdd).toHaveBeenCalledExactlyOnceWith(target, 'Explain this');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(rootRef.current).toHaveTextContent(source);
  });
  it('opens Space member suggestions while typing @ and inserts the selected mention', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: [
      { type: 'human', userId: 'u1', role: 'editor', user: { id: 'u1', type: 'human', name: 'Alice', email: 'alice@example.test' } },
      { type: 'human', userId: 'u2', role: 'viewer', user: { id: 'u2', type: 'human', name: 'Bob', email: 'bob@example.test' } },
      { type: 'human', userId: 'agent', role: 'viewer', user: { id: 'agent', type: 'agent', name: 'Agent', email: 'agent@example.test' } },
    ] });
    render(fixture({ spaceId: 'space-1' }));
    const dialog = await open();
    const textbox = within(dialog).getByRole('textbox', { name: 'Note' });
    fireEvent.change(textbox, { target: { value: '@Al', selectionStart: 3, selectionEnd: 3 } });
    const option = await within(dialog).findByRole('option', { name: /Alice/ });
    expect(within(dialog).queryByRole('option', { name: /Bob/ })).not.toBeInTheDocument();
    fireEvent.click(option);
    expect(textbox).toHaveValue('@Alice ');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add note' }));
    expect(onAdd).toHaveBeenCalledExactlyOnceWith(target, '@Alice', ['u1']);
  });
  it('supports keyboard navigation and selection in the @ list', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: [
      { type: 'human', userId: 'u1', role: 'editor', user: { id: 'u1', type: 'human', name: 'Alice', email: 'alice@example.test' } },
      { type: 'human', userId: 'u2', role: 'viewer', user: { id: 'u2', type: 'human', name: 'Bob', email: 'bob@example.test' } },
    ] });
    render(fixture({ spaceId: 'space-1' }));
    const dialog = await open();
    const textbox = within(dialog).getByRole('textbox', { name: 'Note' });
    fireEvent.change(textbox, { target: { value: '@', selectionStart: 1, selectionEnd: 1 } });
    await within(dialog).findByRole('option', { name: /Alice/ });
    fireEvent.keyDown(textbox, { key: 'ArrowDown' });
    fireEvent.keyDown(textbox, { key: 'Enter' });
    expect(textbox).toHaveValue('@Bob ');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add note' }));
    expect(onAdd).toHaveBeenCalledExactlyOnceWith(target, '@Bob', ['u2']);
  });
  it('keeps the draft and blocks saving when the source or version changes', async () => {
    const view = render(fixture()); const dialog = await open();
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Keep this draft' } });
    view.rerender(fixture({ source: source + ' changed' }));
    expect(screen.getByRole('textbox')).toHaveValue('Keep this draft');
    expect(screen.getByRole('alert')).toHaveTextContent(/changed/);
    expect(screen.getByRole('button', { name: 'Add note' })).toBeDisabled();
    view.rerender(fixture({ updatedAt: '2026-10-14T01:00:00.000Z' }));
    expect(screen.getByRole('button', { name: 'Add note' })).toBeDisabled();
    expect(onAdd).not.toHaveBeenCalled();
  });
  it('reselects a changed passage with the draft intact and submits the new exact target', async () => {
    const view = render(fixture()); const dialog = await open();
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Keep this thought' } });
    const changed = source + ' changed';
    const nextTarget = captureAssistTarget(changed, 'selection', 2, 10, version)!;
    view.rerender(fixture({ source: changed, captureTarget: () => nextTarget }));
    fireEvent.click(screen.getByRole('button', { name: 'Reselect passage' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(await select());
    expect(screen.getByRole('textbox')).toHaveValue('Keep this thought');
    fireEvent.click(screen.getByRole('button', { name: 'Add note' }));
    expect(onAdd).toHaveBeenCalledExactlyOnceWith(nextTarget, 'Keep this thought');
  });

  it('retains a failed submission and clears it synchronously for a different account or page', async () => {
    onAdd.mockReturnValue(false);
    const view = render(fixture()); const dialog = await open();
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Do not lose this' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add note' }));
    expect(screen.getByRole('textbox')).toHaveValue('Do not lose this');
    await waitFor(() => expect(screen.getByRole('alert')).toBeVisible());
    view.rerender(fixture({ identity: 'another-user:space:page' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue('Do not lose this')).not.toBeInTheDocument();
  });
  it('retains the draft while temporarily disabled and saves after the gate clears', async () => {
    const view = render(fixture()); const dialog = await open();
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Do not send yet' } });
    view.rerender(fixture({ disabled: true }));
    expect(screen.getByRole('button', { name: 'Add note' })).toBeDisabled();
    expect(screen.getByRole('textbox')).toHaveValue('Do not send yet');
    expect(onAdd).not.toHaveBeenCalled();
    view.rerender(fixture());
    fireEvent.click(screen.getByRole('button', { name: 'Add note' }));
    expect(onAdd).toHaveBeenCalledExactlyOnceWith(target, 'Do not send yet');
  });
  it('repositions within the visual viewport when a mobile keyboard appears', async () => {
    const viewport = Object.assign(new EventTarget(), { width: 390, height: 700, offsetLeft: 0, offsetTop: 0 });
    vi.stubGlobal('visualViewport', viewport);
    render(fixture()); const dialog = await open();
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Keyboard draft' } });
    viewport.height = 320;
    act(() => { viewport.dispatchEvent(new Event('resize')); });
    expect(Number.parseFloat(dialog.style.top) + 272).toBeLessThanOrEqual(308);
    expect(screen.getByRole('textbox')).toHaveValue('Keyboard draft');
  });

  it('does not offer a note for an unmapped or stale selection', async () => {
    const view = render(fixture({ captureTarget: () => null as any }));
    const text = rootRef.current!.querySelector('p')!.firstChild!;
    const range = document.createRange(); range.setStart(text, 2); range.setEnd(text, 10);
    window.getSelection()!.addRange(range); fireEvent.mouseUp(rootRef.current!);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(screen.queryByRole('button', { name: 'Add note to selection' })).not.toBeInTheDocument();
    view.rerender(fixture({ captureTarget: () => ({ ...target, baseUpdatedAt: '2026-10-13T00:00:00.000Z' }) }));
    fireEvent.keyUp(rootRef.current!, { key: 'Shift' });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(screen.queryByRole('button', { name: 'Add note to selection' })).not.toBeInTheDocument();
  });
  it('dismisses the unopened entry on scrolling and clamps an open composer inside a narrow viewport', async () => {
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(320);
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(480);
    rect = { left: 300, top: 450, right: 340, bottom: 475, width: 40, height: 25 };
    render(fixture()); await select();
    fireEvent.scroll(document);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Add note to selection' })).not.toBeInTheDocument());
    const dialog = await open();
    expect(Number.parseFloat(dialog.style.left)).toBeGreaterThanOrEqual(12);
    expect(Number.parseFloat(dialog.style.left) + Number.parseFloat(dialog.style.width)).toBeLessThanOrEqual(308);
    expect(Number.parseFloat(dialog.style.top)).toBeGreaterThanOrEqual(12);
    expect(Number.parseFloat(dialog.style.top) + 272).toBeLessThanOrEqual(468);
    fireEvent.keyDown(within(dialog).getByRole('textbox'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(onAdd).not.toHaveBeenCalled();
  });
});


it('does not close or permit duplicate submission before a server receipt, and preserves a rejected draft', async () => {
  let finish!: (value: boolean) => void;
  onAdd.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  render(fixture()); const dialog = await open();
  fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Persist this' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Add note' }));
  expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
  expect(screen.getByRole('textbox')).toBeDisabled();
  expect(screen.getByRole('textbox')).toHaveValue('Persist this');
  await act(async () => { finish(false); });
  expect(screen.getByRole('alert')).toBeVisible(); expect(screen.getByRole('textbox')).toHaveValue('Persist this');
  expect(screen.getByRole('button', { name: 'Add note' })).toBeEnabled();
  expect(screen.getByRole('textbox')).toBeEnabled();
});


it('never clears a new identity draft when the previous account save returns', async () => {
  let finish!: (saved: boolean) => void;
  onAdd.mockImplementationOnce(() => new Promise<boolean>((resolve) => { finish = resolve; }));
  const view = render(fixture());
  const dialog = await open();
  fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Old draft' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Add note' }));
  expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
  auth.user = { id: 'another-user', name: 'Bob' };
  view.rerender(fixture({ identity: 'another-user:space:page' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  const nextDialog = await open();
  expect(within(nextDialog).getByRole('textbox')).toHaveValue('');
  fireEvent.change(within(nextDialog).getByRole('textbox'), { target: { value: 'New account draft' } });
  await act(async () => { finish(true); });
  expect(screen.getByRole('textbox')).toHaveValue('New account draft');
  expect(screen.getByRole('button', { name: 'Add note' })).toBeEnabled();
});
