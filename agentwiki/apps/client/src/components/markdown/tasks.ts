import { toString } from 'mdast-util-to-string';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { visit } from 'unist-util-visit';
import type { MarkdownTaskRef } from './markdownTypes';

const TASK_MARKER_PATTERN = /\[[ xX]\]/;

export function collectMarkdownTasks(source: string): MarkdownTaskRef[] {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(source);
  const tasks: MarkdownTaskRef[] = [];

  visit(tree, 'listItem', (node) => {
    if (typeof node.checked !== 'boolean') return;

    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (typeof start !== 'number' || typeof end !== 'number') return;

    const marker = TASK_MARKER_PATTERN.exec(source.slice(start, end));
    if (!marker || marker.index === undefined) return;

    tasks.push({
      index: tasks.length,
      start,
      end,
      markerOffset: start + marker.index + 1,
      checked: node.checked,
      signature: toString(node).trim().normalize('NFC'),
    });
  });

  return tasks;
}

export function toggleMarkdownTask(
  source: string,
  ref: MarkdownTaskRef,
  nextChecked: boolean,
): string | null {
  const current = collectMarkdownTasks(source).find(
    (task) =>
      task.start === ref.start &&
      task.end === ref.end &&
      task.markerOffset === ref.markerOffset,
  );

  if (
    !current ||
    current.signature !== ref.signature ||
    current.checked !== ref.checked
  ) {
    return null;
  }

  return `${source.slice(0, ref.markerOffset)}${nextChecked ? 'x' : ' '}${source.slice(ref.markerOffset + 1)}`;
}

export function rebaseMarkdownTask(source: string, ref: MarkdownTaskRef): MarkdownTaskRef | null {
  const matches = collectMarkdownTasks(source).filter((task) => task.signature === ref.signature);
  return matches.length === 1 ? matches[0] : null;
}
