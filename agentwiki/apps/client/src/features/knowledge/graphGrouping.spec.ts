import { describe, expect, it } from 'vitest';
import { buildGraphGroups, projectGroupedGraph } from './graphGrouping';

const folders = [{ id: 'f', name: 'Project', path: 'Project', parentId: null }, { id: 'child', name: 'Notes', path: 'Project/Notes', parentId: 'f' }, { id: 'empty', name: 'Empty', path: 'Empty', parentId: null }];
const pages = [{ id: 'p', title: 'Plan', folderId: 'child', path: 'pages/Project/Notes/Plan.md', x: 100, y: 100, radius: 20 }, { id: 'q', title: 'Root', folderId: null, path: 'pages/Root.md', x: 200, y: 200, radius: 20 }, { id: 'r', title: 'Unknown', folderId: 'missing', path: 'pages/Guess/Unknown.md', x: 300, y: 300, radius: 20 }];

describe('graph folder grouping', () => {
  it('uses folder identity and canonical metadata, includes empty folders and separates missing placement', () => {
    const groups = buildGraphGroups(pages, folders);
    expect(groups.find(g => g.folder?.id === 'f')?.pages).toHaveLength(0);
    expect(groups.find(g => g.folder?.id === 'child')).toMatchObject({ folder: { path: 'Project/Notes' }, pages: [{ id: 'p' }] });
    expect(groups.find(g => g.kind === 'ungrouped')?.pages.map(p => p.id)).toEqual(['q']);
    expect(groups.find(g => g.kind === 'unavailable')?.pages.map(p => p.id)).toEqual(['r']);
    expect(groups).toHaveLength(5);
  });
  it('starts with folder nodes, expands pages, and aggregates only existing filtered relations', () => {
    const groups = buildGraphGroups(pages.slice(0, 2), folders);
    const edges = [{ id: 'e', source: 'p', target: 'q', relation: 'references', strength: 1 }];
    const collapsed = projectGroupedGraph(groups, new Set(), edges);
    expect(collapsed.nodes.every(n => n.kind === 'group')).toBe(true);
    expect(collapsed.edges).toHaveLength(1);
    expect(collapsed.edges[0].source).toBe(groups.find(g => g.folder?.id === 'child')?.id);
    const expanded = projectGroupedGraph(groups, new Set([groups.find(g => g.folder?.id === 'child')!.id]), edges);
    expect(expanded.nodes.find(n => n.id === 'p')).toMatchObject({ kind: 'page', title: 'Plan' });
    expect(expanded.edges[0].source).toBe('p');
    expect(projectGroupedGraph(groups, new Set(), []).edges).toEqual([]);
  });
});
