export interface GraphPage {
  id: string;
  title: string;
  folderId?: string | null;
  path?: string | null;
  x: number;
  y: number;
  radius: number;
}
export interface GraphFolder { id: string; name: string; path: string; parentId: string | null }
export interface GraphGroup {
  id: string;
  kind: 'folder' | 'ungrouped' | 'unavailable';
  folder?: GraphFolder;
  pages: GraphPage[];
}
export interface DisplayGraphNode extends GraphPage { kind: 'group' | 'page'; groupId?: string; count?: number }
export interface DisplayGraphEdge { id: string; source: string; target: string; strength: number }

/** Folder IDs are authoritative; never reconstruct a folder from a page's path. */
export function buildGraphGroups(pages: GraphPage[], folders: GraphFolder[]): GraphGroup[] {
  const groups: GraphGroup[] = folders.map(folder => ({ id: `folder:${folder.id}`, kind: 'folder', folder, pages: [] }));
  const byId = new Map(groups.map(group => [group.folder!.id, group]));
  const ungrouped: GraphGroup = { id: 'group:ungrouped', kind: 'ungrouped', pages: [] };
  const unavailable: GraphGroup = { id: 'group:unavailable', kind: 'unavailable', pages: [] };
  for (const page of pages) (page.folderId ? byId.get(page.folderId) ?? unavailable : ungrouped).pages.push(page);
  if (ungrouped.pages.length) groups.push(ungrouped);
  if (unavailable.pages.length) groups.push(unavailable);
  return groups;
}

/** Project collapsed endpoints onto their folder, retaining every actual visible relation. */
export function projectGroupedGraph(groups: GraphGroup[], expanded: Set<string>, edges: DisplayGraphEdge[]) {
  const nodes: DisplayGraphNode[] = [];
  const endpoint = new Map<string, string>();
  const columns = Math.max(1, Math.min(3, groups.length));
  const rowHeights = new Map<number, number>();
  groups.forEach((group, index) => {
    const row = Math.floor(index / columns);
    const height = expanded.has(group.id) ? 180 + Math.ceil(group.pages.length / 2) * 100 : 180;
    rowHeights.set(row, Math.max(rowHeights.get(row) ?? 0, height));
  });
  let rowY = 90;
  groups.forEach((group, index) => {
    const row = Math.floor(index / columns);
    if (index && index % columns === 0) rowY += rowHeights.get(row - 1)!;
    const x = 150 + index % columns * 340;
    nodes.push({ id: group.id, title: group.folder?.name ?? '', kind: 'group', groupId: group.id,
      x, y: rowY, radius: 30, count: group.pages.length });
    group.pages.forEach((page, pageIndex) => {
      const open = expanded.has(group.id);
      endpoint.set(page.id, open ? page.id : group.id);
      if (open) nodes.push({ ...page, kind: 'page', groupId: group.id,
        x: x + (pageIndex % 2 === 0 ? -75 : 75), y: rowY + 110 + Math.floor(pageIndex / 2) * 100 });
    });
  });
  const projectedEdges = edges.flatMap(edge => {
    const source = endpoint.get(edge.source);
    const target = endpoint.get(edge.target);
    return source && target && source !== target ? [{ ...edge, source, target }] : [];
  });
  return { nodes, edges: projectedEdges };
}
