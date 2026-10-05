import { EditorSelection, Transaction, type EditorState, type TransactionSpec } from '@codemirror/state';
import { isolateHistory } from '@codemirror/commands';
import { syntaxTree } from '@codemirror/language';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import { visit } from 'unist-util-visit';
import type { PageLinkTarget } from '../markdownLinks';
export type FormatCommand = 'bold' | 'italic' | 'code' | 'link';
export type InsertCommand = 'heading' | 'list' | 'task' | 'quote' | 'table' | 'code';
const annotations = () => [Transaction.addToHistory.of(true), isolateHistory.of('full')];
export const formatTransaction = (state: EditorState, command: FormatCommand): TransactionSpec => {
  const { from, to } = state.selection.main;
  const text = state.sliceDoc(from, to);
  let prefix = command === 'bold' ? '**' : command === 'italic' ? '*' : '`';
  let suffix = prefix;
  if (command === 'code') {
    const runs = text.match(/`+/gu) ?? [];
    prefix = suffix = '`'.repeat(Math.max(0, ...runs.map((run) => run.length)) + 1);
    if (/^`|`$|^ | $/u.test(text)) { prefix += ' '; suffix = ` ${suffix}`; }
  }
  if (command === 'link') {
    const label = text || 'link';
    const insert = `[${label.replace(/([\\[\]])/gu, '\\$1')}](https://)`;
    const start = from + insert.lastIndexOf('https://');
    return { changes: { from, to, insert }, selection: EditorSelection.single(start, start + 8), annotations: annotations() };
  }
  return {
    changes: { from, to, insert: `${prefix}${text}${suffix}` },
    selection: EditorSelection.single(from + prefix.length, from + prefix.length + text.length),
    annotations: annotations(),
  };
};
const insertions: Record<InsertCommand, { text: string; caret: number }> = {
  heading: { text: '## ', caret: 3 },
  list: { text: '- ', caret: 2 },
  task: { text: '- [ ] ', caret: 6 },
  quote: { text: '> ', caret: 2 },
  table: { text: '| Column 1 | Column 2 |\n| --- | --- |\n|  |  |', caret: 2 },
  code: { text: '```\n\n```', caret: 4 },
};
export const insertionTransaction = (state: EditorState, command: InsertCommand, slashFrom?: number): TransactionSpec => {
  const { from: selectionFrom, to } = state.selection.main;
  const from = slashFrom ?? selectionFrom;
  const before = state.doc.lineAt(from);
  const prefix = from > before.from ? '\n' : '';
  const { text, caret } = insertions[command];
  const suffix = to < state.doc.lineAt(to).to ? '\n' : '';
  return { changes: { from, to, insert: prefix + text + suffix }, selection: { anchor: from + prefix.length + caret }, annotations: annotations() };
};
export const pageLinkTransaction = (state: EditorState, page: PageLinkTarget): TransactionSpec => {
  const { from, to } = state.selection.main;
  const label = (page.title || page.id).replace(/[[\]|\r\n]/gu, ' ').replace(/\s+/gu, ' ').trim();
  const insert = `[[${page.id}|${label}]]`;
  return { changes: { from, to, insert }, selection: { anchor: from + insert.length }, annotations: annotations() };
};
export const slashRange = (state: EditorState, composing: boolean): { from: number; to: number; query: string } | null => {
  if (composing || !state.selection.main.empty) return null;
  const to = state.selection.main.head;
  const line = state.doc.lineAt(to);
  const match = /^\s{0,3}\/([\p{L}\p{N}-]*)$/u.exec(state.sliceDoc(line.from, to));
  if (!match) return null;
  // CM's incremental tree may not cover newly typed source yet. Parse only after
  // the cheap trigger check so fenced/code pseudo-commands never open the menu.
  for (let node = syntaxTree(state).resolveInner(to, -1); node; node = node.parent!) {
    if (/Code/u.test(node.name)) return null;
  }
  let code = false;
  visit(unified().use(remarkParse).parse(state.doc.toString()), 'code', (node) => {
    if ((node.position?.start.offset ?? Infinity) <= to && (node.position?.end.offset ?? -1) >= to) code = true;
  });
  return code ? null : { from: line.from + state.sliceDoc(line.from, to).indexOf('/'), to, query: match[1] };
};
