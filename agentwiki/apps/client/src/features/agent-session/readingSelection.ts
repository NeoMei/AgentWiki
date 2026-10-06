import { captureAssistTarget, type AssistTarget } from '../page/assistTargets';
/** Map only renderer-proven literal text in one render instance. Never search for selected display text. */
export function captureReadingSelection(root: HTMLElement, range: Range, source: string, version: string, renderVersion: string): AssistTarget | null {
  if (version !== renderVersion || root.dataset.markdownSelectionVersion !== version || range.collapsed || !root.contains(range.commonAncestorContainer)) return null;
  const token = root.dataset.markdownSelectionRoot;
  if (!token) return null;
  const elements = root.querySelectorAll('[data-markdown-unmapped], img, svg, canvas, input, iframe, video, audio, .katex, .markdown-mermaid, [data-markdown-selection-root]');
  for (const element of elements) if (range.intersectsNode(element)) return null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let from: number | null = null, to: number | null = null;
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (!range.intersectsNode(node) || range.comparePoint(node, node.length) === -1 || range.comparePoint(node, 0) === 1) continue;
    const start = range.startContainer === node ? range.startOffset : 0;
    const end = range.endContainer === node ? range.endOffset : node.length;
    if (start === end) continue;
    const span = node.parentElement;
    if (!span || span.closest('[data-markdown-selection-root]') !== root) return null;
    if (span.dataset.markdownTextOwner !== token) { if (node.textContent?.trim()) return null; continue; }
    const sourceStart = Number(span.dataset.markdownTextStart), sourceEnd = Number(span.dataset.markdownTextEnd);
    if (span.childNodes.length !== 1 || !Number.isSafeInteger(sourceStart) || !Number.isSafeInteger(sourceEnd) || source.slice(sourceStart, sourceEnd) !== node.data) return null;
    const nextFrom = sourceStart + start, nextTo = sourceStart + end;
    if (to !== null && nextFrom < to) return null;
    from ??= nextFrom; to = nextTo;
  }
  return from === null || to === null ? null : captureAssistTarget(source, 'selection', from, to, version);
}
