import type { DisplayGraphNode, GraphGroup, GraphPage } from './graphGrouping';

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

const WIDTH = 460;
const COLUMN_GAP = 100;
const ROW_GAP = 44;
const PREVIEW_LIMIT = 5;

/** Lay out real pages inside folder cards; folder membership never creates a relationship. */
export function layoutFolderGraph(
  groups: GraphGroup[],
  expanded: Set<string>,
  edges: { source: string; target: string }[],
  selectedId?: string | null,
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
  const heights = groups.map((group, index) => group.pages.length === 0 ? 160
    : expanded.has(group.id) ? Math.max(300, 152 + (Math.ceil(ranked[index].length / 3) - 1) * 94)
      : 300);
  const nodes: DisplayGraphNode[] = [];
  const boxes: FolderGraphBox[] = [];
  let rowY = 0;

  groups.forEach((group, index) => {
    const column = index % 2;
    if (index > 0 && column === 0) rowY += Math.max(heights[index - 2], heights[index - 1] + 22) + ROW_GAP;
    const centered = groups.length > 1 && groups.length % 2 === 1 && index === groups.length - 1;
    const x = centered ? (WIDTH + COLUMN_GAP) / 2 : column * (WIDTH + COLUMN_GAP);
    const y = rowY + (column === 1 ? 22 : 0);
    const open = expanded.has(group.id);
    const pages = open ? ranked[index] : ranked[index].slice(0, PREVIEW_LIMIT);
    const selected = selectedId && ranked[index].find(page => page.id === selectedId);
    if (!open && selected && !pages.some(page => page.id === selected.id)) pages[pages.length - 1] = selected;
    const hiddenCount = group.pages.length - pages.length;
    const box: FolderGraphBox = {
      group, x, y, width: WIDTH, height: heights[index], hiddenCount,
      moreX: x + 402, moreY: y + 215,
    };
    boxes.push(box);

    const addPage = (page: GraphPage, pageIndex: number, px: number, py: number) => nodes.push({
      ...page, kind: 'page', groupId: group.id, x: x + px, y: y + py,
      radius: pageIndex === 0 && pages.length > 1 ? 16 : 13,
    });
    if (pages.length === 1) {
      addPage(pages[0], 0, WIDTH / 2, 156);
    } else if (open) {
      // Start with the representative page in the middle column, then fill stable rows.
      pages.forEach((page, pageIndex) => {
        const slot = pageIndex === 0 ? 1 : pageIndex === 1 ? 0 : pageIndex;
        addPage(page, pageIndex, 76 + slot % 3 * 154, 92 + Math.floor(slot / 3) * 94);
      });
    } else {
      const positions = [[230, 150], [64, 90], [64, 202], [180, 245], [320, 245]];
      pages.forEach((page, pageIndex) => addPage(page, pageIndex, ...positions[pageIndex] as [number, number]));
    }
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
