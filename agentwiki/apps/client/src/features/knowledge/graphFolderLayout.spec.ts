import { describe, expect, it } from 'vitest';
import { layoutFolderGraph } from './graphFolderLayout';
import type { GraphGroup, GraphPage } from './graphGrouping';

const page = (id: string, title = id): GraphPage => ({ id, title, x: 0, y: 0, radius: 20 });
const group = (id: string, pages: GraphPage[] = []): GraphGroup => ({
  id, kind: 'folder', folder: { id, name: id, path: id, parentId: null }, pages,
});

describe('folder graph layout', () => {
  it('shows pages directly and chooses a representative from real distinct relationships', () => {
    const groups = [group('folder', ['a', 'b', 'c', 'd', 'hub'].map(id => page(id)))];
    const result = layoutFolderGraph(groups, new Set(), [
      { source: 'hub', target: 'b' }, { source: 'c', target: 'hub' }, { source: 'hub', target: 'd' },
      { source: 'a', target: 'b' }, { source: 'a', target: 'b' },
      { source: 'a', target: 'missing' }, { source: 'a', target: 'a' },
    ]);
    expect(result.nodes[0]).toMatchObject({ id: 'hub', kind: 'page', x: 230, y: 150, radius: 16 });
    expect(result.nodes.every(node => node.kind === 'page')).toBe(true);
    expect(result.nodes.map(node => node.id).sort()).toEqual(['a', 'b', 'c', 'd', 'hub']);
    expect(result).not.toHaveProperty('edges');
  });

  it('limits previews, reveals a selected hidden page, and expands all pages without changing source data', () => {
    const pages = Array.from({ length: 13 }, (_, index) => page(String(index).padStart(2, '0')));
    const groups = [group('folder', pages)];
    const preview = layoutFolderGraph(groups, new Set(), [], '12');
    expect(preview.nodes).toHaveLength(5);
    expect(preview.nodes.map(node => node.id)).toEqual(['00', '01', '02', '03', '12']);
    expect(preview.boxes[0].hiddenCount).toBe(8);
    const expanded = layoutFolderGraph(groups, new Set(['folder']), []);
    expect(expanded.nodes).toHaveLength(13);
    expect(expanded.boxes[0].hiddenCount).toBe(0);
    expect(expanded.boxes[0].height).toBeGreaterThan(300);
    for (const node of expanded.nodes) {
      // Space for a 128px label and the caption underneath its circle stays inside its card.
      expect(node.x - 64).toBeGreaterThanOrEqual(0);
      expect(node.x + 64).toBeLessThanOrEqual(460);
      expect(node.y + 44).toBeLessThan(expanded.boxes[0].height);
    }
    expect(pages.map(node => node.x)).toEqual(Array(13).fill(0));
  });

  it('keeps real empty folders and separates unavailable placement without inventing a folder node', () => {
    const groups: GraphGroup[] = [group('empty'), { id: 'unavailable', kind: 'unavailable', pages: [page('missing')] }];
    const result = layoutFolderGraph(groups, new Set(), []);
    expect(result.boxes).toHaveLength(2);
    expect(result.boxes[0]).toMatchObject({ height: 160, hiddenCount: 0 });
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]).toMatchObject({ id: 'missing', groupId: 'unavailable', x: 790, y: 178, radius: 13 });
    expect(layoutFolderGraph([], new Set(), [])).toEqual({ nodes: [], boxes: [], bounds: undefined });
  });

  it('centers the final odd card below the tallest row and includes every card in the bounds', () => {
    const groups = [group('one', [page('a')]), group('two', Array.from({ length: 15 }, (_, i) => page(`b${i}`))), group('three', [page('c')])];
    const { boxes, bounds } = layoutFolderGraph(groups, new Set(['two']), []);
    expect(boxes[0].x).toBe(0);
    expect(boxes[1].x).toBe(560);
    expect(boxes[2].x).toBe(280);
    expect(boxes[2].y).toBeGreaterThanOrEqual(Math.max(...boxes.slice(0, 2).map(box => box.y + box.height)) + 44);
    expect(bounds).toEqual({ left: 0, top: 0, right: 1020, bottom: boxes[2].y + boxes[2].height });
  });

  it('breaks equal relationship counts by title then id regardless of input page order', () => {
    const input = [page('z', 'Same'), page('b', 'Before'), page('a', 'Same')];
    const first = layoutFolderGraph([group('folder', input)], new Set(), []);
    const reversed = layoutFolderGraph([group('folder', [...input].reverse())], new Set(), []);
    expect(first.nodes.map(node => node.id)).toEqual(['b', 'a', 'z']);
    expect(reversed.nodes).toEqual(first.nodes);
  });
});
