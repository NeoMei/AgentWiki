import { describe, expect, it } from 'vitest';
import { boxesOverlap, layoutGraphLabels, type LabelNode } from './graphLabelLayout';
const measure = (text: string) => Array.from(text).reduce((n, c) => n + (c.codePointAt(0)! > 127 ? 14 : c === 'W' ? 13 : 7), 0);
const dense: LabelNode[] = Array.from({ length: 80 }, (_, i) => ({ id: String(i), title: `${i % 2 ? 'WWWW very long English title' : '非常长的中文知识标题'} ${i} 🧩`, x: 30 + (i % 10) * 55, y: 30 + Math.floor(i / 10) * 55, radius: 10 }));
describe('measured graph label geometry', () => {
  it.each([0.25, 1, 4])('bounds and separates labels at scale %s', scale => {
    const nodes = dense.map(n => ({ ...n, x: n.x * scale, y: n.y * scale, radius: n.radius * scale }));
    const labels = layoutGraphLabels(nodes, 600, 500, measure);
    expect(labels.length).toBeGreaterThan(0);
    expect(labels.length).toBeLessThan(nodes.length);
    for (const box of labels) {
      expect(box.x).toBeGreaterThanOrEqual(8); expect(box.y).toBeGreaterThanOrEqual(8);
      expect(box.x + box.width).toBeLessThanOrEqual(592); expect(box.y + box.height).toBeLessThanOrEqual(492);
      for (const line of box.lines) expect(measure(line)).toBeLessThanOrEqual(box.width);
      for (const other of labels) if (box !== other) expect(boxesOverlap(box, other)).toBe(false);
      for (const node of nodes) expect(Math.hypot(node.x - Math.max(box.x, Math.min(node.x, box.x + box.width)), node.y - Math.max(box.y, Math.min(node.y, box.y + box.height)))).toBeGreaterThanOrEqual(node.radius + 4);
    }
  });
  it('wraps measured CJK/Latin to two lines, ellipsizes and prioritizes selection', () => {
    const nodes = [{ id: 'a', title: '中文标题'.repeat(25), x: 150, y: 100, radius: 12 }, { id: 'b', title: 'W'.repeat(80), x: 150, y: 100, radius: 12 }];
    const labels = layoutGraphLabels(nodes, 320, 240, measure, 'b');
    expect(labels[0].id).toBe('b'); expect(labels[0].lines).toHaveLength(2); expect(labels[0].lines[1]).toMatch(/…$/u);
    expect(layoutGraphLabels(nodes, 10, 10, measure)).toEqual([]);
  });
});
