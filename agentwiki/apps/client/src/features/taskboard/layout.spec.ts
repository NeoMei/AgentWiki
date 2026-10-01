import { describe, expect, it } from 'vitest';
import { layoutTaskboardColumns } from './layout';

const measured = (ids: string[], height = 100) => ({ ids, heights: ids.map(() => height) });

describe('taskboard measured hierarchy layout', () => {
  it('centers a late parent child group without moving sibling parents', () => {
    const result = layoutTaskboardColumns([
      measured(['root'], 100),
      measured(['p1', 'p2', 'p3'], 100),
      measured(['late-child'], 100),
    ], ['root', 'p3']);
    expect(result.tops['1:p3'] + 50).toBeCloseTo(result.tops['2:late-child'] + 50, 0);
    expect(result.tops['1:p2'] + 100 + 16).toBeLessThanOrEqual(result.tops['1:p3']);
    expect(result.h).toBeGreaterThan(0);
    expect(result.wires[0]).toContain('V');
  });

  it('packs multi-child groups and arbitrary depth inside the measured canvas', () => {
    const result = layoutTaskboardColumns([
      measured(['root'], 60),
      measured(['p1', 'p2'], 140),
      measured(['c1', 'c2', 'c3'], 180),
      measured(['leaf'], 90),
    ], ['root', 'p2', 'c3']);
    for (const [key, top] of Object.entries(result.tops)) {
      expect(Number.isFinite(top)).toBe(true);
      expect(top).toBeGreaterThanOrEqual(24);
      const height = key.startsWith('1:') ? 140 : key.startsWith('2:') ? 180 : key.startsWith('3:') ? 90 : 60;
      expect(top + height).toBeLessThanOrEqual(result.h - 24);
    }
    expect(result.width).toBeGreaterThanOrEqual(960);
    expect(result.wires).toHaveLength(1 + 2 + 3);
  });
});

it('retains exact center alignment and bounded sibling spacing across twenty mixed-height columns', () => {
  const columns = Array.from({ length: 20 }, (_, ci) => ({ ids: [`n-${ci}-a`, `n-${ci}-b`], heights: [51 + ci * 5, 125 + ci * 2] }));
  const path = columns.map(col => col.ids[1]);
  const result = layoutTaskboardColumns(columns, path);
  for (let ci = 0; ci < columns.length; ci++) {
    const a = result.tops[`${ci}:n-${ci}-a`], b = result.tops[`${ci}:n-${ci}-b`];
    expect(a).toBeGreaterThanOrEqual(24); expect(b + columns[ci].heights[1]).toBeLessThanOrEqual(result.h - 24);
    expect(b - a - columns[ci].heights[0]).toBeCloseTo(16);
    if (ci > 0) {
      const parentCenter = result.tops[`${ci - 1}:n-${ci - 1}-b`] + columns[ci - 1].heights[1] / 2;
      expect((a + b + columns[ci].heights[1]) / 2).toBeCloseTo(parentCenter);
    }
  }
  expect(result.width).toBeGreaterThan(5000);
});
it('handles an empty board and preserves a centered single measured node', () => {
  expect(layoutTaskboardColumns([], []).tops).toEqual({});
  expect(layoutTaskboardColumns([measured(['only'], 100)], ['only'])).toMatchObject({ h: 580, width: 960, tops: { '0:only': 240 }, wires: [] });
});
