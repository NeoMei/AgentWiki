import { useCallback, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Transaction, type Text } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { isolateHistory } from '@codemirror/commands';
import { ModalDialog } from '../ModalDialog';
import { useLanguage } from '../../context/LanguageContext';
import {
  createTableDraft, locateTable, parseTableLocations, renderTableEdit,
  TABLE_MAX_COLUMNS, TABLE_MAX_ROWS, type SourceTable, type TableAlignment, type TableDraft, type TableReason,
} from './tableEditing';

interface TableEditorProps {
  table: SourceTable;
  onApply: (draft: TableDraft) => string | null;
  onClose: () => void;
  resolveReturnFocus: () => HTMLElement | null;
}
export const TableEditor = ({ table, onApply, onClose, resolveReturnFocus }: TableEditorProps) => {
  const { language } = useLanguage(); const zh = language === 'zh-CN';
  const copy = (cn: string, en: string) => zh ? cn : en;
  const titleId = useId(); const hintId = useId();
  const [draft, setDraft] = useState(() => createTableDraft(table));
  const [active, setActive] = useState({ row: 0, column: 0 });
  const [error, setError] = useState<string | null>(null);
  const sequence = useRef(0);
  const singleLineError = copy('单元格仅支持单行 Markdown，请在源码中编辑多行内容。', 'Cells support a single line of Markdown. Edit multiline content in the source.');
  const changeCell = (row: number, column: number, value: string) => {
    if (/[\r\n]/u.test(value)) { setError(singleLineError); return; }
    setError(null); setDraft((previous) => ({ ...previous, rows: previous.rows.map((item, i) => i === row
      ? { ...item, cells: item.cells.map((cell, j) => j === column ? value : cell) } : item) }));
  };
  const addRow = () => {
    const index = active.row + 1;
    setDraft((previous) => { const rows = [...previous.rows]; rows.splice(index, 0, { id: `new-row-${++sequence.current}`, originalIndex: null, cells: previous.columns.map(() => '') }); return { ...previous, rows }; });
    setActive({ ...active, row: index });
  };
  const removeRow = () => {
    setDraft((previous) => ({ ...previous, rows: previous.rows.filter((_, i) => i !== active.row) }));
    setActive({ ...active, row: Math.max(0, active.row - 1) });
  };
  const moveRow = (direction: number) => {
    setDraft((previous) => { const rows = [...previous.rows]; [rows[active.row], rows[active.row + direction]] = [rows[active.row + direction], rows[active.row]]; return { ...previous, rows }; });
    setActive({ ...active, row: active.row + direction });
  };
  const addColumn = () => {
    const index = active.column + 1;
    setDraft((previous) => {
      const columns = [...previous.columns]; columns.splice(index, 0, { id: `new-column-${++sequence.current}`, originalIndex: null, alignment: null });
      return { columns, rows: previous.rows.map((row) => { const cells = [...row.cells]; cells.splice(index, 0, ''); return { ...row, cells }; }) };
    });
    setActive({ ...active, column: index });
  };
  const removeColumn = () => {
    setDraft((previous) => ({ columns: previous.columns.filter((_, i) => i !== active.column), rows: previous.rows.map((row) => ({ ...row, cells: row.cells.filter((_, i) => i !== active.column) })) }));
    setActive({ ...active, column: Math.max(0, active.column - 1) });
  };
  const moveColumn = (direction: number) => {
    const move = <T,>(items: T[]) => { const next = [...items]; [next[active.column], next[active.column + direction]] = [next[active.column + direction], next[active.column]]; return next; };
    setDraft((previous) => ({ columns: move(previous.columns), rows: previous.rows.map((row) => ({ ...row, cells: move(row.cells) })) }));
    setActive({ ...active, column: active.column + direction });
  };
  return <ModalDialog labelledBy={titleId} onRequestClose={onClose} resolveReturnFocus={resolveReturnFocus}
    overlayClassName="document-picker-backdrop" className="document-table-editor">
    <div className="flex items-center justify-between gap-4"><h2 id={titleId} className="font-semibold">{copy('编辑表格', 'Edit table')}</h2><button type="button" onClick={onClose} aria-label={copy('关闭表格编辑器', 'Close table editor')}>×</button></div>
    <p id={hintId} className="text-sm text-gray-500">{copy('单元格内容为 Markdown；竖线会自动转义。选择单元格后可操作对应行列。', 'Cells contain Markdown; literal pipes are escaped automatically. Select a cell to operate on its row or column.')}</p>
    <div className="document-table-actions" role="group" aria-label={copy('行列操作', 'Row and column actions')}>
      <button type="button" onClick={addRow} disabled={draft.rows.length >= TABLE_MAX_ROWS}>{copy('在下方加行', 'Add row below')}</button>
      <button type="button" onClick={removeRow} disabled={active.row === 0}>{copy('删除行', 'Remove row')}</button>
      <button type="button" onClick={() => moveRow(-1)} disabled={active.row <= 1}>{copy('行上移', 'Move row up')}</button>
      <button type="button" onClick={() => moveRow(1)} disabled={active.row === 0 || active.row === draft.rows.length - 1}>{copy('行下移', 'Move row down')}</button>
      <button type="button" onClick={addColumn} disabled={draft.columns.length >= TABLE_MAX_COLUMNS}>{copy('在右侧加列', 'Add column right')}</button>
      <button type="button" onClick={removeColumn} disabled={draft.columns.length === 1}>{copy('删除列', 'Remove column')}</button>
      <button type="button" onClick={() => moveColumn(-1)} disabled={active.column === 0}>{copy('列左移', 'Move column left')}</button>
      <button type="button" onClick={() => moveColumn(1)} disabled={active.column === draft.columns.length - 1}>{copy('列右移', 'Move column right')}</button>
      <label>{copy(`第 ${active.column + 1} 列对齐`, `Alignment for column ${active.column + 1}`)} <select value={draft.columns[active.column].alignment ?? 'none'} onChange={(event) => {
        const alignment = event.target.value === 'none' ? null : event.target.value as TableAlignment;
        setDraft((previous) => ({ ...previous, columns: previous.columns.map((column, i) => i === active.column ? { ...column, alignment } : column) }));
      }}><option value="none">{copy('默认', 'Default')}</option><option value="left">{copy('左对齐', 'Left')}</option><option value="center">{copy('居中', 'Center')}</option><option value="right">{copy('右对齐', 'Right')}</option></select></label>
    </div>
    <div className="document-table-scroll" role="region" aria-label={copy('表格单元格', 'Table cells')}>
      <table><tbody>{draft.rows.map((row, rowIndex) => <tr key={row.id}>{row.cells.map((cell, columnIndex) => <td key={draft.columns[columnIndex].id} data-active={active.row === rowIndex && active.column === columnIndex}>
        <textarea rows={1} value={cell} data-modal-autofocus={rowIndex === 0 && columnIndex === 0 ? true : undefined}
          aria-label={copy(`${rowIndex === 0 ? '表头' : `第 ${rowIndex} 行`}，第 ${columnIndex + 1} 列（Markdown）`, `${rowIndex === 0 ? 'Header' : `Row ${rowIndex}`}, column ${columnIndex + 1} (Markdown)`)} aria-describedby={hintId}
          onFocus={() => setActive({ row: rowIndex, column: columnIndex })} onChange={(event) => changeCell(rowIndex, columnIndex, event.target.value)}
          onPaste={(event) => { if (/[\r\n]/u.test(event.clipboardData.getData('text/plain'))) { event.preventDefault(); setError(singleLineError); } }}
          onKeyDown={(event) => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); setError(singleLineError); } }} />
      </td>)}</tr>)}</tbody></table>
    </div>
    <p className="text-xs text-gray-500">{copy(`${draft.rows.length} 行（含表头）· ${draft.columns.length} 列；上限 100 行 / 30 列。`, `${draft.rows.length} rows including header · ${draft.columns.length} columns; limit 100 rows / 30 columns.`)}</p>
    {error ? <p role="alert" className="text-sm text-amber-800">{error}</p> : null}
    <div className="flex justify-end gap-2"><button type="button" onClick={onClose}>{copy('取消', 'Cancel')}</button><button type="button" className="document-table-apply" onClick={() => setError(onApply(draft))}>{copy('应用表格', 'Apply table')}</button></div>
  </ModalDialog>;
};

interface TableEditingToolsProps {
  source: string;
  selection: { from: number; to: number };
  view: () => EditorView | null;
  enabled: boolean;
  identity: string;
}
interface TableSnapshot { source: string; identity: string; view: EditorView; doc: Text; table: SourceTable }
export const TableEditingTools = ({ source, selection, view, enabled, identity }: TableEditingToolsProps) => {
  const { language } = useLanguage(); const zh = language === 'zh-CN';
  // Only detection uses normalized text so a CRLF document gets a visible fallback
  // at its actual CM cursor. No normalized string is ever written back to source.
  const locations = useMemo(() => parseTableLocations(source.replace(/\r\n?/gu, '\n')), [source]);
  const location = locateTable(locations, selection);
  const [snapshot, setSnapshot] = useState<TableSnapshot | null>(null);
  const [fallback, setFallback] = useState<string | null>(null);
  const live = useRef({ source, view, enabled, identity }); live.current = { source, view, enabled, identity };
  const mounted = useRef(true);
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useLayoutEffect(() => { setSnapshot(null); setFallback(null); }, [identity, enabled]);
  const resolveReturnFocus = useCallback(() => {
    const current = live.current;
    return mounted.current && current.enabled ? current.view()?.contentDOM ?? null : null;
  }, []);
  const fallbackCopy = (reason: TableReason | 'endings') => {
    if (reason === 'endings') return zh ? '当前文档的换行格式无法在表格面板中原样保留，请继续在源码中编辑。' : "This document's line endings cannot be preserved by the table editor. Edit the Markdown source instead.";
    if (reason === 'too-large') return zh ? '表格面板最多支持 100 行（含表头）和 30 列，请在源码中编辑更大的表格。' : 'The table editor supports up to 100 rows including the header and 30 columns. Edit larger tables in the source.';
    return zh ? '此表格位于嵌套内容中、行列不规则或选区跨越表格，请在源码中编辑。' : 'This table is nested, has uneven rows, or crosses the selection. Edit it in the Markdown source.';
  };
  const open = () => {
    const current = view(); if (!enabled || !current || !current.dom.isConnected || current.state.readOnly || !current.state.facet(EditorView.editable)) return;
    if (source !== current.state.doc.toString()) { setFallback(fallbackCopy('endings')); return; }
    const currentLocation = locateTable(locations, current.state.selection.main);
    if (currentLocation.kind === 'none') return;
    if (currentLocation.kind === 'unsupported') { setFallback(fallbackCopy(currentLocation.reason)); return; }
    setFallback(null); setSnapshot({ source, identity, view: current, doc: current.state.doc, table: currentLocation.table });
  };
  const apply = (draft: TableDraft) => {
    const current = live.current; const activeView = current.view();
    if (!snapshot || !mounted.current || !current.enabled || current.identity !== snapshot.identity || activeView !== snapshot.view
      || !activeView.dom.isConnected || activeView.state.readOnly || !activeView.state.facet(EditorView.editable)
      || current.source !== snapshot.source || activeView.state.doc !== snapshot.doc || activeView.state.doc.toString() !== snapshot.source
      || snapshot.source.slice(snapshot.table.from, snapshot.table.to) !== snapshot.table.raw) return zh ? '文档或编辑权限已变化，请关闭并重新打开表格。' : 'The document or editing permission changed. Close and reopen the table editor.';
    const result = renderTableEdit(snapshot.table, draft);
    if (result.kind === 'invalid') return zh ? '无法安全应用这些单元格，请检查单行内容或在源码中编辑。' : 'These cells cannot be applied safely. Check their single-line content or edit the source.';
    if (result.kind === 'change') activeView.dispatch({ changes: { from: result.from, to: result.to, insert: result.insert }, annotations: [Transaction.addToHistory.of(true), isolateHistory.of('full')] });
    setSnapshot(null); return null;
  };
  return <>
    {location.kind !== 'none' ? <button type="button" onMouseDown={(event) => event.preventDefault()} disabled={!enabled} onClick={open}>{location.kind === 'table' ? (zh ? '编辑表格' : 'Edit table') : (zh ? '表格源码' : 'Table source')}</button> : null}
    {fallback ? <span role="status" className="document-table-fallback">{fallback}</span> : null}
    {snapshot && enabled && snapshot.identity === identity ? <TableEditor table={snapshot.table} onApply={apply} onClose={() => setSnapshot(null)} resolveReturnFocus={resolveReturnFocus} /> : null}
  </>;
};
