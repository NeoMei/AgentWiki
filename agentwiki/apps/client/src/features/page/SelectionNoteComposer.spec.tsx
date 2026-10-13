import { createRef } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureAssistTarget } from './assistTargets';
import { SelectionNoteComposer } from './SelectionNoteComposer';

const auth = vi.hoisted(() => ({ user: { id: 'user', name: 'Alice' } }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => auth }));

const version = '2026-10-14T00:00:00.000Z';
const source = 'A selected passage';
let rect = { left: 100, top: 120, right: 190, bottom: 144, width: 90, height: 24 };
const rootRef = createRef<HTMLDivElement>();
const target = captureAssistTarget(source, 'selection', 2, 10, version)!;
const onAdd = vi.fn(() => true);
const props = { rootRef, source, updatedAt: version, identity: 'user:space:page', language: 'en', disabled: false, captureTarget: () => target, onAdd };
const fixture = (overrides: Partial<typeof props> = {}) => <><div ref={rootRef}><p>{source}</p></div><SelectionNoteComposer {...props} {...overrides} /></>;
const select = async () => {
  const text = rootRef.current!.querySelector('p')!.firstChild!;
  const range = document.createRange(); range.setStart(text, 2); range.setEnd(text, 10);
  window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
  fireEvent.mouseUp(rootRef.current!);
  return screen.findByRole('button', { name: 'Add note to selection' });
};
const open = async () => { fireEvent.click(await select()); return screen.getByRole('dialog', { name: 'Add personal note' }); };
beforeEach(() => {
  auth.user = { id: 'user', name: 'Alice' };
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

  it('captures the original passage before focus moves, saves only the private note and closes', async () => {
    render(fixture()); const dialog = await open();
    expect(within(dialog).getByRole('textbox', { name: 'Note' })).toHaveFocus();
    expect(within(dialog).getByRole('blockquote')).toHaveTextContent('selected');
    window.getSelection()!.removeAllRanges();
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Explain this' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add note' }));
    expect(onAdd).toHaveBeenCalledExactlyOnceWith(target, 'Explain this');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(rootRef.current).toHaveTextContent(source);
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
    expect(screen.getByRole('alert')).toBeVisible();
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
