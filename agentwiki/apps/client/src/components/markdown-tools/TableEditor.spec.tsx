import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../context/LanguageContext';
import { TableEditor } from './TableEditor';
import { createTableDraft, parseTableLocations, renderTableEdit, type TableDraft } from './tableEditing';
const source = '| Name | Value |\n| --- | --- |\n| a | b |\n| c | d |';
const parsed = parseTableLocations(source)[0];
if (parsed.kind !== 'table') throw new Error('Missing table');
const table = parsed.table;
const renderEditor = (onApply = vi.fn<(_: TableDraft) => string | null>().mockReturnValue(null), onClose = vi.fn()) => {
  const resolveReturnFocus = () => document.querySelector<HTMLElement>('#editor-return');
  const mounted = render(<LanguageProvider><TableEditor table={table} onApply={onApply} onClose={onClose} resolveReturnFocus={resolveReturnFocus} /></LanguageProvider>);
  return { ...mounted, onApply, onClose };
};
const bodyCell = () => screen.getByRole('textbox', { name: 'Row 1, column 1 (Markdown)' });
describe('TableEditor dialog', () => {
  beforeEach(() => { localStorage.setItem('agentwiki.language.v1', 'en'); });
  afterEach(cleanup);
  it('renders labelled Markdown cells and preserves a no-op draft', () => {
    const { onApply } = renderEditor();
    expect(screen.getByRole('dialog', { name: 'Edit table' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Header, column 1 (Markdown)' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Apply table' }));
    expect(onApply).toHaveBeenCalledWith(createTableDraft(table));
  });
  it('rejects pasted multiline content visibly without replacing the draft', () => {
    const { onApply } = renderEditor();
    const paste = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(paste, 'clipboardData', { value: { getData: () => 'first\r\nsecond' } });
    fireEvent(bodyCell(), paste);
    expect(paste.defaultPrevented).toBe(true); expect(bodyCell()).toHaveValue('a');
    expect(screen.getByRole('alert')).toHaveTextContent('single line');
    fireEvent.change(bodyCell(), { target: { value: 'line1\nline2' } });
    expect(bodyCell()).toHaveValue('a');
    fireEvent.click(screen.getByRole('button', { name: 'Apply table' }));
    expect(onApply.mock.calls[0][0].rows[1].cells[0]).toBe('a');
  });
  it('provides explicit row/column moves, alignment and bounded add/remove actions', () => {
    const { onApply } = renderEditor();
    expect(screen.getByRole('button', { name: 'Remove row' })).toBeDisabled();
    fireEvent.focus(bodyCell()); fireEvent.click(screen.getByRole('button', { name: 'Move row down' }));
    fireEvent.click(screen.getByRole('button', { name: 'Move column right' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Alignment for column 2' }), { target: { value: 'center' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add row below' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove row' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add column right' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove column' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply table' }));
    const draft = onApply.mock.calls[0][0];
    expect(renderTableEdit(table, draft)).toMatchObject({ insert: '| Value | Name |\n| --- | :---: |\n| d | c |\n| b | a |' });
  });
  it('uses ModalDialog Tab/Escape and cancels without applying', () => {
    const { onApply, onClose } = renderEditor();
    const dialog = screen.getByRole('dialog'); const apply = within(dialog).getByRole('button', { name: 'Apply table' });
    apply.focus(); fireEvent.keyDown(apply, { key: 'Tab' });
    expect(screen.getByRole('button', { name: 'Close table editor' })).toHaveFocus();
    fireEvent.keyDown(dialog, { key: 'Escape' }); expect(onClose).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' })); expect(onApply).not.toHaveBeenCalled();
  });
});
