export const GRAPH_LABEL_FONT = '14px sans-serif';
export const GRAPH_LABEL_LINE_HEIGHT = 20;
export interface LabelNode { id: string; title: string; x: number; y: number; radius: number }
export interface LabelBox { id: string; lines: string[]; x: number; y: number; width: number; height: number }
export const boxesOverlap = (a: LabelBox, b: LabelBox, gap = 4) =>
  a.x < b.x + b.width + gap && a.x + a.width + gap > b.x && a.y < b.y + b.height + gap && a.y + a.height + gap > b.y;

/** Bounded screen-space labels. Measurement must use the same font as painting. */
export function layoutGraphLabels(nodes: LabelNode[], width: number, height: number,
  measure: (text: string) => number, selectedId?: string | null): LabelBox[] {
  if (!selectedId) return [];
  const margin = 8;
  const maxWidth = Math.min(160, width - margin * 2);
  if (maxWidth < measure('…') || height < GRAPH_LABEL_LINE_HEIGHT + margin * 2) return [];
  const lineLimit = Math.min(2, Math.floor((height - margin * 2) / GRAPH_LABEL_LINE_HEIGHT));
  const labels: LabelBox[] = [];
  const ordered = nodes.filter(node => node.id === selectedId);
  for (const node of ordered) {
    if (node.x + node.radius < 0 || node.x - node.radius > width || node.y + node.radius < 0 || node.y - node.radius > height) continue;
    // Array.from preserves surrogate pairs; measured widths handle CJK and Latin equally.
    const chars = Array.from(node.title.replace(/\s+/gu, ' ').trim());
    const lines: string[] = [];
    let offset = 0;
    while (offset < chars.length && lines.length < lineLimit) {
      let line = '';
      while (offset < chars.length && measure(line + chars[offset]) <= maxWidth) line += chars[offset++];
      if (!line) { offset++; line = '…'; }
      if (lines.length === lineLimit - 1 && offset < chars.length) {
        const parts = Array.from(line);
        while (parts.length && measure(parts.join('') + '…') > maxWidth) parts.pop();
        line = parts.join('') + '…';
      }
      lines.push(line);
    }
    if (!lines.length) continue;
    const boxWidth = Math.max(...lines.map(measure));
    const boxHeight = lines.length * GRAPH_LABEL_LINE_HEIGHT;
    const distance = node.radius + 8;
    const candidates = [
      [node.x - boxWidth / 2, node.y + distance],
      [node.x - boxWidth / 2, node.y - distance - boxHeight],
      [node.x + distance, node.y - boxHeight / 2],
      [node.x - distance - boxWidth, node.y - boxHeight / 2],
    ];
    for (const [x, y] of candidates) {
      const box: LabelBox = { id: node.id, lines, x, y, width: boxWidth, height: boxHeight };
      if (x < margin || y < margin || x + boxWidth > width - margin || y + boxHeight > height - margin) continue;
      if (labels.some(other => boxesOverlap(box, other))) continue;
      // Rectangle-circle intersection, with a small gutter around every node.
      if (nodes.some(other => Math.hypot(other.x - Math.max(x, Math.min(other.x, x + boxWidth)),
        other.y - Math.max(y, Math.min(other.y, y + boxHeight))) < other.radius + 4)) continue;
      labels.push(box);
      break;
    }
    // Dense graphs still expose the selected name; clamp the fallback inside the viewport.
    if (!labels.length) labels.push({ id: node.id, lines, width: boxWidth, height: boxHeight,
      x: Math.max(margin, Math.min(width - margin - boxWidth, node.x - boxWidth / 2)),
      y: Math.max(margin, Math.min(height - margin - boxHeight, node.y + distance)) });
  }
  return labels;
}
