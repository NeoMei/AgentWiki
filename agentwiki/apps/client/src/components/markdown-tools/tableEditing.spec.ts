import { EditorState } from '@codemirror/state';
import { history, undo, undoDepth, isolateHistory } from '@codemirror/commands';
import { describe, expect, it } from 'vitest';
import fixtures from '../../../../../docs/verification/document-workspace-20261006/visual-editor-probe/fixtures.json';
import { createTableDraft, locateTable, parseTableLocations, renderTableEdit } from './tableEditing';

const sample = '| Name | Value |\n| :--- | ---: |\n| 甲\\|乙 | `x\\|y` |\n| **中文** | C:\\\\临时 |';
const tableAt = (source: string, cursor = source.indexOf('| Name')) => {
  const result = locateTable(parseTableLocations(source), { from: cursor, to: cursor });
  if (result.kind !== 'table') throw new Error(`Expected table: ${JSON.stringify(result)}`);
  return result.table;
};

describe('source preserving GFM table editing', () => {
  it('keeps no-op and reverted cell drafts byte-identical', () => {
    const table = tableAt(sample); const draft = createTableDraft(table);
    expect(renderTableEdit(table, draft)).toEqual({ kind: 'unchanged' });
    draft.rows[1].cells[0] = 'changed'; draft.rows[1].cells[0] = '甲\\|乙';
    expect(renderTableEdit(table, draft)).toEqual({ kind: 'unchanged' });
  });
  it('changes only a cell interior and escapes literal pipes without reescaping existing ones', () => {
    const table = tableAt(sample); const draft = createTableDraft(table);
    draft.rows[1].cells[0] = 'new|value\\|kept';
    const result = renderTableEdit(table, draft);
    expect(result).toEqual({ kind: 'change', from: 0, to: sample.length, insert: sample.replace('甲\\|乙', 'new\\|value\\|kept') });
  });
  it('keeps optional edge pipes and protects a newly trailing backslash', () => {
    const source = 'Name|Value\n:---|---:\na|b'; const table = tableAt(source, 1); const draft = createTableDraft(table);
    draft.rows[1].cells[0] = 'path\\';
    expect(renderTableEdit(table, draft)).toMatchObject({ insert: 'Name|Value\n:---|---:\npath\\ |b' });
  });
  it('handles empty cells, alignment, row and column structure', () => {
    const table = tableAt('| Name | Value |\n| ---- | ---: |\n|  | b |'); const draft = createTableDraft(table);
    draft.rows[1].cells[0] = 'a'; draft.columns[0].alignment = 'center';
    expect(renderTableEdit(table, draft)).toMatchObject({ insert: '| Name | Value |\n| :---: | ---: |\n|  a| b |' });
    draft.rows.push({ id: 'new', originalIndex: null, cells: ['c', 'd'] });
    draft.columns.reverse(); draft.rows.forEach((row) => row.cells.reverse());
    const changed = renderTableEdit(table, draft);
    expect(changed).toMatchObject({ insert: '| Value | Name |\n| ---: | :---: |\n| b | a |\n| d | c |' });
    draft.rows.splice(1, 1); draft.columns.splice(0, 1); draft.rows.forEach((row) => row.cells.splice(0, 1));
    expect(renderTableEdit(table, draft)).toMatchObject({ insert: '| Name |\n| :---: |\n| c |' });
  });
  it('keeps Unicode whitespace as cell content and safely clears optional outer-pipe edge cells', () => {
    const raw = 'Name|Value\n---|---\n\u00a0keep\u00a0|other'; const table = tableAt(raw, 1); const draft = createTableDraft(table);
    expect(draft.rows[1].cells[0]).toBe('\u00a0keep\u00a0');
    draft.rows[1].cells[0] = ''; draft.rows[1].cells[1] = '';
    expect(renderTableEdit(table, draft)).toMatchObject({ insert: 'Name|Value\n---|---\n|  |  |' });
  });
  it('preserves indentation and escapes pipes following even backslash runs', () => {
    const raw = '  | Name | Value |\n  | --- | --- |\n  | old | `x\\|y` |'; const table = tableAt(raw, 4); const draft = createTableDraft(table);
    draft.rows[1].cells[0] = 'path' + '\\'.repeat(2) + '|leaf';
    expect(renderTableEdit(table, draft)).toMatchObject({ insert: raw.replace('old', 'path' + '\\'.repeat(3) + '|leaf') });
  });
  it('limits columns and retains a header-only table after removing its final body row', () => {
    const many = Array.from({ length: 31 }, (_, i) => `C${i}`);
    const raw = '| ' + many.join(' | ') + ' |\n| ' + many.map(() => '---').join(' | ') + ' |';
    expect(locateTable(parseTableLocations(raw), { from: 2, to: 2 })).toMatchObject({ kind: 'unsupported', reason: 'too-large' });
    const table = tableAt(sample); const draft = createTableDraft(table); draft.rows.splice(1);
    expect(renderTableEdit(table, draft)).toMatchObject({ insert: '| Name | Value |\n| :--- | ---: |' });
    draft.rows.splice(0); expect(renderTableEdit(table, draft)).toMatchObject({ kind: 'invalid' });
  });
  it('moves body rows by retaining their raw formatting', () => {
    const table = tableAt(sample); const draft = createTableDraft(table);
    [draft.rows[1], draft.rows[2]] = [draft.rows[2], draft.rows[1]];
    expect(renderTableEdit(table, draft)).toMatchObject({ insert: '| Name | Value |\n| :--- | ---: |\n| **中文** | C:\\\\临时 |\n| 甲\\|乙 | `x\\|y` |' });
  });
  it.each(['\n', '\r\n'])('pure helper preserves %j and the trailing source boundary', (eol) => {
    const raw = sample.replace(/\n/gu, eol); const source = `prefix${eol}${eol}${raw}${eol}${eol}suffix${eol}`;
    const table = tableAt(source); const draft = createTableDraft(table); draft.rows[1].cells[0] = 'edit';
    const change = renderTableEdit(table, draft);
    expect(change.kind).toBe('change');
    if (change.kind !== 'change') return;
    expect(source.slice(0, change.from) + change.insert + source.slice(change.to)).toBe(source.replace('甲\\|乙', 'edit'));
  });
  it('rejects multiline input and invalid shapes instead of losing source', () => {
    const table = tableAt(sample); const draft = createTableDraft(table); draft.rows[1].cells[0] = 'first\nsecond';
    expect(renderTableEdit(table, draft)).toMatchObject({ kind: 'invalid' });
    for (const source of ['| A | B |\n| --- | --- |\n| only |', '| A | B |\n| --- | --- |\n| `x|y` | z |']) {
      expect(locateTable(parseTableLocations(source), { from: 1, to: 1 })).toMatchObject({ kind: 'unsupported', reason: 'shape' });
    }
  });
  it('rejects nested, crossed and oversized tables but ignores fenced lookalikes', () => {
    expect(locateTable(parseTableLocations('> | A |\n> | --- |\n> | a |'), { from: 3, to: 3 })).toMatchObject({ kind: 'unsupported', reason: 'nested' });
    expect(locateTable(parseTableLocations('```\n' + sample + '\n```'), { from: 8, to: 8 })).toEqual({ kind: 'none' });
    expect(locateTable(parseTableLocations(sample + '\n\nafter'), { from: 0, to: sample.length + 3 })).toMatchObject({ kind: 'unsupported', reason: 'selection' });
    const large = '| Name |\n| --- |\n' + Array.from({ length: 100 }, () => '| body |').join('\n');
    expect(locateTable(parseTableLocations(large), { from: 1, to: 1 })).toMatchObject({ kind: 'unsupported', reason: 'too-large' });
  });
  it.each(fixtures)('preserves all outside raw bytes for corpus $id (helper only for CRLF)', ({ input }) => {
    const prefix = input + '\n\n'; const suffix = '\n\n' + input;
    const source = prefix + sample + suffix; const table = tableAt(source, prefix.length + 2); const draft = createTableDraft(table);
    draft.rows[1].cells[0] = 'changed'; const result = renderTableEdit(table, draft);
    expect(result.kind).toBe('change'); if (result.kind !== 'change') return;
    expect(source.slice(0, result.from)).toBe(prefix); expect(source.slice(result.to)).toBe(suffix);
    expect(prefix + result.insert + suffix).toBe(prefix + sample.replace('甲\\|乙', 'changed') + suffix);
    if (!source.includes('\r')) {
      let state = EditorState.create({ doc: source, extensions: [history()] });
      state = state.update({ changes: result, annotations: isolateHistory.of('full') }).state;
      expect(undoDepth(state)).toBe(1);
      undo({ state, dispatch: (tr) => { state = tr.state; } });
      expect(state.doc.toString()).toBe(source);
    }
  });
});
