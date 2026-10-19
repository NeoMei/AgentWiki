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
    expect(result.nodes[0]).toMatchObject({ id: 'hub', kind: 'page' });
    expect(result.nodes[0].radius).toBeGreaterThan(result.nodes[1].radius);
    expect(result.nodes.every(node => node.kind === 'page')).toBe(true);
    expect(result.nodes.map(node => node.id).sort()).toEqual(['a', 'b', 'c', 'd', 'hub']);
    expect(result).not.toHaveProperty('edges');
  });

  it('limits previews, reveals a selected hidden page, and expands all pages without changing source data', () => {
    const pages = Array.from({ length: 13 }, (_, index) => page(String(index).padStart(2, '0')));
    const groups = [group('folder', pages)];
    const preview = layoutFolderGraph(groups, new Set(), [], '12');
    expect(preview.nodes).toHaveLength(6);
    expect(preview.nodes.map(node => node.id)).toEqual(['00', '01', '02', '03', '04', '12']);
    expect(preview.boxes[0].hiddenCount).toBe(7);
    const expanded = layoutFolderGraph(groups, new Set(['folder']), []);
    expect(expanded.nodes).toHaveLength(13);
    expect(expanded.boxes[0].hiddenCount).toBe(0);
    expect(expanded.boxes[0].height).toBeGreaterThan(300);
    for (const node of expanded.nodes) {
      // A 144px label, 8px below the circle, has room for two 18px lines.
      expect(node.x - 72).toBeGreaterThanOrEqual(12);
      expect(node.x + 72).toBeLessThanOrEqual(expanded.boxes[0].width - 12);
      expect(node.y + node.radius + 8 + 36).toBeLessThan(expanded.boxes[0].height);
    }
    const lastPreviewLabelBottom = Math.max(...preview.nodes.map(node => node.y + node.radius + 8 + 36));
    expect(preview.boxes[0].moreY - 16).toBeGreaterThan(lastPreviewLabelBottom);
    expect(preview.boxes[0].moreY + 16).toBeLessThan(preview.boxes[0].height);
    expect(pages.map(node => node.x)).toEqual(Array(13).fill(0));
  });

  it('keeps real empty folders and separates unavailable placement without inventing a folder node', () => {
    const groups: GraphGroup[] = [group('empty'), { id: 'unavailable', kind: 'unavailable', pages: [page('missing')] }];
    const result = layoutFolderGraph(groups, new Set(), []);
    expect(result.boxes).toHaveLength(2);
    expect(result.boxes[0].height).toBeLessThanOrEqual(112);
    expect(result.boxes[0].hiddenCount).toBe(0);
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]).toMatchObject({ id: 'missing', groupId: 'unavailable' });
    expect(result.nodes[0].x).toBe(result.boxes[1].x + result.boxes[1].width / 2);
    expect(result.boxes[0].y).toBe(result.boxes[1].y);
    expect(layoutFolderGraph([], new Set(), [])).toEqual({ nodes: [], boxes: [], bounds: undefined });
  });

  it('centers the final odd card below the tallest row and includes every card in the bounds', () => {
    const groups = [group('one', [page('a')]), group('two', Array.from({ length: 15 }, (_, i) => page(`b${i}`))), group('three', [page('c')])];
    const { boxes, bounds } = layoutFolderGraph(groups, new Set(['two']), []);
    expect(boxes[0].x).toBe(0);
    expect(boxes[1].x).toBeGreaterThan(boxes[0].width);
    expect(boxes[2].x).toBe(boxes[1].x / 2);
    expect(boxes[2].y).toBeGreaterThanOrEqual(Math.max(...boxes.slice(0, 2).map(box => box.y + box.height)) + 24);
    expect(bounds).toEqual({ left: 0, top: 0, right: boxes[1].x + boxes[1].width, bottom: boxes[2].y + boxes[2].height });
  });

  it('fits three small folders within a desktop graph stage without hiding a sixth page', () => {
    const groups = [3, 6, 1].map((count, index) => group(`folder-${index}`,
      Array.from({ length: count }, (_, pageIndex) => page(`${index}-${pageIndex}`))));
    const { nodes, boxes, bounds } = layoutFolderGraph(groups, new Set(), []);
    expect(nodes).toHaveLength(10);
    expect(boxes.every(box => box.hiddenCount === 0)).toBe(true);
    expect(bounds!.right).toBeLessThanOrEqual(752);
    expect(bounds!.bottom).toBeLessThanOrEqual(620);
    expect(boxes[0].height).toBeLessThanOrEqual(288);
    expect(boxes[1].height).toBeLessThanOrEqual(392);
  });

  it('reserves separate areas for every two-line label and circle when a folder is expanded', () => {
    const { nodes, boxes } = layoutFolderGraph([group('folder', Array.from({ length: 17 }, (_, i) => page(`page-${i}`)))], new Set(['folder']), []);
    for (const [index, node] of nodes.entries()) {
      const label = { left: node.x - 72, right: node.x + 72, top: node.y + node.radius + 8, bottom: node.y + node.radius + 44 };
      expect(node.y - node.radius).toBeGreaterThanOrEqual(boxes[0].y + 56);
      for (const other of nodes.slice(index + 1)) {
        const otherTop = other.y - other.radius;
        const otherBottom = other.y + other.radius + 44;
        expect(label.right <= other.x - 72 || label.left >= other.x + 72
          || label.bottom < otherTop || node.y - node.radius > otherBottom).toBe(true);
      }
    }
  });

  it('packs five or more folders into aligned rows of three without overlapping cards', () => {
    const groups = Array.from({ length: 8 }, (_, i) => group(`folder-${i}`, Array.from({ length: i + 1 }, (_, j) => page(`${i}-${j}`))));
    const { boxes, bounds } = layoutFolderGraph(groups, new Set(['folder-4']), []);
    expect(new Set(boxes.slice(0, 3).map(box => box.y)).size).toBe(1);
    expect(new Set(boxes.slice(0, 3).map(box => box.x)).size).toBe(3);
    expect(bounds!.right).toBeLessThanOrEqual(1120);
    expect(boxes[3].y).toBeGreaterThanOrEqual(Math.max(...boxes.slice(0, 3).map(box => box.y + box.height)) + 24);
    for (const [index, box] of boxes.entries()) {
      for (const other of boxes.slice(index + 1)) {
        expect(box.x + box.width < other.x || box.x > other.x + other.width
          || box.y + box.height < other.y || box.y > other.y + other.height).toBe(true);
      }
    }
  });

  it.each([0.65, 0.81])('keeps padded two-line labels clear of the next circle and bottom border at scale %s', scale => {
    const { nodes, boxes } = layoutFolderGraph([group('folder', Array.from({ length: 6 }, (_, i) => page(`page-${i}`)))], new Set(), []);
    for (const [index, node] of nodes.entries()) {
      // Label padding and the 8px circle-to-label gap remain CSS pixels while the graph scales.
      const labelBottom = (node.y + node.radius) * scale + 8 + 40;
      const next = nodes[index + 2];
      if (next) expect((next.y - next.radius) * scale - labelBottom).toBeGreaterThanOrEqual(2);
      else expect(boxes[0].height * scale - labelBottom).toBeGreaterThanOrEqual(6);
    }
  });

  it('uses the requested column count for narrow and wide stages without adding empty columns', () => {
    const groups = ['one', 'two', 'three'].map(id => group(id, [page(id)]));
    const narrow = layoutFolderGraph(groups, new Set(), [], null, 1);
    expect(new Set(narrow.boxes.map(box => box.x)).size).toBe(1);
    expect(narrow.bounds!.right).toBeLessThanOrEqual(360);
    expect(narrow.boxes[2].y).toBeGreaterThan(narrow.boxes[1].y + narrow.boxes[1].height);
    const wide = layoutFolderGraph(groups, new Set(), [], null, 3);
    expect(new Set(wide.boxes.map(box => box.y)).size).toBe(1);
    const single = layoutFolderGraph(groups.slice(0, 1), new Set(), [], null, 3);
    expect(single.boxes[0].x).toBe(0);
    expect(single.bounds!.right).toBe(single.boxes[0].width);
  });

  it('breaks equal relationship counts by title then id regardless of input page order', () => {
    const input = [page('z', 'Same'), page('b', 'Before'), page('a', 'Same')];
    const first = layoutFolderGraph([group('folder', input)], new Set(), []);
    const reversed = layoutFolderGraph([group('folder', [...input].reverse())], new Set(), []);
    expect(first.nodes.map(node => node.id)).toEqual(['b', 'a', 'z']);
    expect(reversed.nodes).toEqual(first.nodes);
  });
});
