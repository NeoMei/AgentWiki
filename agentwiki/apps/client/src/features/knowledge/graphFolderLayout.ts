import type { DisplayGraphNode, GraphGroup } from './graphGrouping';

export interface FolderGraphBox {
  group: GraphGroup;
  x: number;
  y: number;
  width: number;
  height: number;
  hiddenCount: number;
  moreX: number;
  moreY: number;
}

const WIDTH = 340;
const COLUMN_GAP = 32;
const ROW_GAP = 24;
const PREVIEW_LIMIT = 6;
const FIRST_NODE_Y = 88;
const NODE_ROW_GAP = 104;
const NODE_BOTTOM_SPACE = 96;
const MORE_HEIGHT = 40;

/** Lay out real pages inside folder cards; folder membership never creates a relationship. */
export function layoutFolderGraph(
  groups: GraphGroup[],
  expanded: Set<string>,
  edges: { source: string; target: string }[],
  selectedId?: string | null,
  columnCount?: number,
): {
  nodes: DisplayGraphNode[];
  boxes: FolderGraphBox[];
  bounds: { left: number; top: number; right: number; bottom: number } | undefined;
} {
  const knownIds = new Set(groups.flatMap(group => group.pages.map(page => page.id)));
  const neighbors = new Map<string, Set<string>>();
  for (const { source, target } of edges) {
    if (source === target || !knownIds.has(source) || !knownIds.has(target)) continue;
    if (!neighbors.has(source)) neighbors.set(source, new Set());
    if (!neighbors.has(target)) neighbors.set(target, new Set());
    neighbors.get(source)!.add(target);
    neighbors.get(target)!.add(source);
  }
  const ranked = groups.map(group => [...group.pages].sort((a, b) =>
    (neighbors.get(b.id)?.size ?? 0) - (neighbors.get(a.id)?.size ?? 0)
    || a.title.localeCompare(b.title, 'zh-CN') || a.id.localeCompare(b.id)));
  const visiblePages = groups.map((group, index) => {
    if (expanded.has(group.id)) return ranked[index];
    const pages = ranked[index].slice(0, PREVIEW_LIMIT);
    const selected = selectedId && ranked[index].find(page => page.id === selectedId);
    if (selected && !pages.some(page => page.id === selected.id)) pages[pages.length - 1] = selected;
    return pages;
  });
  const heights = groups.map((group, index) => {
    const count = visiblePages[index].length;
    if (count === 0) return 104;
    return FIRST_NODE_Y + (Math.ceil(count / 2) - 1) * NODE_ROW_GAP + NODE_BOTTOM_SPACE
      + (group.pages.length > count ? MORE_HEIGHT : 0);
  });
  const columns = Math.max(1, Math.min(groups.length, columnCount ?? (groups.length >= 5 ? 3 : 2)));
  const nodes: DisplayGraphNode[] = [];
  const boxes: FolderGraphBox[] = [];
  let rowY = 0;

  groups.forEach((group, index) => {
    const column = index % columns;
    if (index > 0 && column === 0) rowY += Math.max(...heights.slice(index - columns, index)) + ROW_GAP;
    const rowCount = Math.min(columns, groups.length - (index - column));
    const x = (column + (columns - rowCount) / 2) * (WIDTH + COLUMN_GAP);
    const y = rowY;
    const pages = visiblePages[index];
    const hiddenCount = group.pages.length - pages.length;
    const box: FolderGraphBox = {
      group, x, y, width: WIDTH, height: heights[index], hiddenCount,
      moreX: x + WIDTH / 2, moreY: y + heights[index] - MORE_HEIGHT / 2,
    };
    boxes.push(box);

    // Two columns leave 144px for each two-line title and keep the next circle below it.
    pages.forEach((page, pageIndex) => nodes.push({
      ...page, kind: 'page', groupId: group.id,
      x: x + (pageIndex === pages.length - 1 && pages.length % 2 === 1 ? WIDTH / 2 : 90 + pageIndex % 2 * 160),
      y: y + FIRST_NODE_Y + Math.floor(pageIndex / 2) * NODE_ROW_GAP,
      radius: pageIndex === 0 && pages.length > 1 ? 14 : 12,
    }));
  });

  return {
    nodes,
    boxes,
    bounds: boxes.length ? {
      left: Math.min(...boxes.map(box => box.x)),
      top: Math.min(...boxes.map(box => box.y)),
      right: Math.max(...boxes.map(box => box.x + box.width)),
      bottom: Math.max(...boxes.map(box => box.y + box.height)),
    } : undefined,
  };
}
