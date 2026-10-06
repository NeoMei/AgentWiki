import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import { visit } from 'unist-util-visit';

export const TABLE_MAX_ROWS = 100;
export const TABLE_MAX_COLUMNS = 30;
export type TableAlignment = 'left' | 'center' | 'right' | null;
export type TableReason = 'nested' | 'shape' | 'too-large' | 'selection';
interface SourceCell { content: string; from: number; to: number }
interface SourceRow { raw: string; eol: string; cells: SourceCell[] }
export interface SourceTable {
  from: number; to: number; raw: string; indent: string; newline: string;
  rows: SourceRow[]; separator: SourceRow; align: TableAlignment[];
}
export type TableLocation = { from: number; to: number } & (
  { kind: 'table'; table: SourceTable } | { kind: 'unsupported'; reason: TableReason }
);
export type LocatedTable = TableLocation | { kind: 'none' };
export interface TableDraft {
  columns: { id: string; originalIndex: number | null; alignment: TableAlignment }[];
  rows: { id: string; originalIndex: number | null; cells: string[] }[];
}
export type TableEdit = { kind: 'unchanged' } | { kind: 'invalid' } |
  { kind: 'change'; from: number; to: number; insert: string };

const parser = unified().use(remarkParse).use(remarkGfm);

// GFM table boundaries precede inline parsing: even pipes inside backticks must
// be escaped. Counting backslashes avoids both splitting \| and hiding \\|.
const rowCells = (raw: string): SourceCell[] => {
  const pipes: number[] = []; let backslashes = 0;
  for (let i = 0; i < raw.length; i += 1) {
    if (raw[i] === '|' && backslashes % 2 === 0) pipes.push(i);
    backslashes = raw[i] === '\\' ? backslashes + 1 : 0;
  }
  const first = pipes[0]; const last = pipes[pipes.length - 1];
  const left = first !== undefined && /^[ \t]*$/u.test(raw.slice(0, first)) ? first + 1 : 0;
  const right = last !== undefined && /^[ \t]*$/u.test(raw.slice(last + 1)) ? last : raw.length;
  if (left > right) return [];
  const boundaries = [left - 1, ...pipes.filter((offset) => offset >= left && offset < right), right];
  return boundaries.slice(0, -1).map((boundary, i) => {
    const start = boundary + 1; const end = boundaries[i + 1]; const cell = raw.slice(start, end);
    const leading = /^[ \t]*/u.exec(cell)![0].length;
    const content = cell.slice(leading).replace(/[ \t]+$/u, '');
    return { content, from: start + leading, to: content ? end - /[ \t]*$/u.exec(cell)![0].length : start + leading };
  });
};
const sourceRows = (raw: string): SourceRow[] => {
  const rows: SourceRow[] = []; const expression = /([^\r\n]*)(\r\n|\n|\r|$)/gu;
  for (const match of raw.matchAll(expression)) {
    if (!match[0]) break;
    rows.push({ raw: match[1], eol: match[2], cells: rowCells(match[1]) });
  }
  return rows;
};

/** Parse once per source revision; cursor movement only calls locateTable. */
export const parseTableLocations = (source: string): TableLocation[] => {
  const tree = parser.parse(source); const locations: TableLocation[] = [];
  visit(tree, 'table', (node, _index, parent) => {
    const start = node.position?.start.offset; const to = node.position?.end.offset;
    if (start === undefined || to === undefined) return;
    const lineStart = source.lastIndexOf('\n', start - 1) + 1;
    const indent = source.slice(lineStart, start);
    const from = /^ {0,3}$/u.test(indent) ? lineStart : start;
    const fail = (reason: TableReason) => locations.push({ from, to, kind: 'unsupported', reason });
    if (parent !== tree) { fail('nested'); return; }
    if (!/^ {0,3}$/u.test(indent)) { fail('shape'); return; }
    const align = node.align ?? []; const raw = source.slice(from, to); const lines = sourceRows(raw);
    if (align.length > TABLE_MAX_COLUMNS || node.children.length > TABLE_MAX_ROWS) { fail('too-large'); return; }
    if (!align.length || lines.length !== node.children.length + 1
      || lines.some((row) => row.cells.length !== align.length)
      || node.children.some((row) => row.children.length !== align.length)) { fail('shape'); return; }
    const [header, separator, ...body] = lines;
    locations.push({ from, to, kind: 'table', table: {
      from, to, raw, indent, newline: header.eol || '\n', rows: [header, ...body], separator, align,
    } });
  });
  return locations;
};
export const locateTable = (locations: TableLocation[], range: { from: number; to: number }): LocatedTable => {
  const overlaps = locations.filter((item) => range.from <= item.to && range.to >= item.from);
  if (!overlaps.length) return { kind: 'none' };
  const location = overlaps[0];
  if (overlaps.length !== 1 || range.from < location.from || range.to > location.to) return { ...location, kind: 'unsupported', reason: 'selection' };
  return location;
};
export const createTableDraft = (table: SourceTable): TableDraft => ({
  columns: table.align.map((alignment, index) => ({ id: `column-${index}`, originalIndex: index, alignment })),
  rows: table.rows.map((row, index) => ({ id: `row-${index}`, originalIndex: index, cells: row.cells.map((cell) => cell.content) })),
});
const escapePipes = (content: string) => {
  let output = ''; let backslashes = 0;
  for (const character of content) {
    if (character === '|' && backslashes % 2 === 0) output += '\\';
    output += character;
    backslashes = character === '\\' ? backslashes + 1 : 0;
  }
  return output;
};
const delimiter = (alignment: TableAlignment) => `${alignment === 'left' || alignment === 'center' ? ':' : ''}---${alignment === 'right' || alignment === 'center' ? ':' : ''}`;
const replaceCells = (row: SourceRow, values: string[]) => {
  let raw = row.raw;
  for (let i = row.cells.length - 1; i >= 0; i -= 1) {
    const cell = row.cells[i]; if (values[i] === cell.content) continue;
    let value = escapePipes(values[i]);
    if (raw[cell.to] === '|' && (/\\+$/u.exec(value)?.[0].length ?? 0) % 2 === 1) value += ' ';
    raw = raw.slice(0, cell.from) + value + raw.slice(cell.to);
  }
  return raw;
};

/** Return only one bounded replacement; untouched rows retain their original bytes. */
export const renderTableEdit = (table: SourceTable, draft: TableDraft): TableEdit => {
  if (!draft.columns.length || draft.columns.length > TABLE_MAX_COLUMNS || !draft.rows.length
    || draft.rows.length > TABLE_MAX_ROWS || draft.rows[0].originalIndex !== 0
    || draft.rows.some((row) => row.cells.length !== draft.columns.length || row.cells.some((cell) => /[\r\n]/u.test(cell)))) return { kind: 'invalid' };
  const sameColumns = draft.columns.length === table.align.length && draft.columns.every((column, i) => column.originalIndex === i);
  const sameRows = draft.rows.length === table.rows.length && draft.rows.every((row, i) => row.originalIndex === i);
  const sameAlign = sameColumns && draft.columns.every((column, i) => column.alignment === table.align[i]);
  if (sameColumns && sameRows && sameAlign && draft.rows.every((row, i) => row.cells.every((value, j) => value === table.rows[i].cells[j].content))) return { kind: 'unchanged' };
  const canonical = (values: string[]) => `${table.indent}| ${values.join(' | ')} |`;
  const rows = draft.rows.map((row) => {
    const original = row.originalIndex === null ? undefined : table.rows[row.originalIndex];
    const cells = row.cells.map((value, i) => {
      const originalColumn = draft.columns[i].originalIndex;
      const previous = original && originalColumn !== null ? original.cells[originalColumn]?.content : undefined;
      return value === previous ? value : escapePipes(value);
    });
    if (original && sameColumns) {
      const raw = replaceCells(original, row.cells);
      if (rowCells(raw).length === draft.columns.length) return { raw, eol: original.eol };
      // Clearing an edge cell without outer pipes needs explicit edges to
      // retain its column. Canonicalize only this necessarily changed row.
    }
    return { raw: canonical(cells), eol: original?.eol || table.newline };
  });
  const alignValues = draft.columns.map((column, i) => sameColumns && column.alignment === table.align[i]
    ? table.separator.cells[i].content : delimiter(column.alignment));
  rows.splice(1, 0, { raw: sameColumns ? replaceCells(table.separator, alignValues) : canonical(alignValues), eol: table.separator.eol });
  const insert = rows.map((row, i) => row.raw + (i < rows.length - 1 ? row.eol || table.newline : '')).join('');
  const parsed = parseTableLocations(insert);
  const result = parsed[0];
  if (parsed.length !== 1 || result?.kind !== 'table' || result.from !== 0 || result.to !== insert.length
    || result.table.rows.length !== draft.rows.length || result.table.align.length !== draft.columns.length) return { kind: 'invalid' };
  return insert === table.raw ? { kind: 'unchanged' } : { kind: 'change', from: table.from, to: table.to, insert };
};
