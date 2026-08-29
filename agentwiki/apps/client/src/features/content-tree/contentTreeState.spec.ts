import { describe, expect, it } from 'vitest';
import {
  buildMoveRequest,
  crumbsForFolder,
  createFolderIndex,
  isSelfOrDescendantFolder,
  registerFolders,
  sortNodes,
} from './contentTreeState';
import type { ContentTreeNode } from './contentTreeTypes';

const folder = (id: string, name: string, sortOrder = 0): ContentTreeNode => ({
  kind: 'folder',
  id,
  name,
  path: 'pages/' + name,
  sortOrder,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  hasChildren: false,
});

const page = (id: string, title: string, folderId: string | null, sortOrder = 0): ContentTreeNode => ({
  kind: 'page',
  id,
  folderId,
  title,
  path: 'pages/' + title + '.md',
  sortOrder,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
});

describe('sortNodes', () => {
  it('orders folders before pages and respects sortOrder within each kind', () => {
    const sorted = sortNodes([
      page('p2', 'Beta', null, 2),
      folder('f2', 'B', 2),
      page('p1', 'Alpha', null, 1),
      folder('f1', 'A', 1),
    ]);
    expect(sorted.map((node) => node.id)).toEqual(['f1', 'f2', 'p1', 'p2']);
  });
});

describe('folder breadcrumbs', () => {
  it('builds a parent chain from the registered folder index', () => {
    const index = createFolderIndex();
    registerFolders(index, [folder('root-child', '项目')], null);
    registerFolders(index, [folder('deep', '子目录')], 'root-child');
    const crumbs = crumbsForFolder(index, 'deep', 'Space');
    expect(crumbs).toEqual([
      { id: null, name: 'Space' },
      { id: 'root-child', name: '项目' },
      { id: 'deep', name: '子目录' },
    ]);
  });

  it('falls back to the root crumb for unknown folders', () => {
    const index = createFolderIndex();
    expect(crumbsForFolder(index, 'missing', 'Space')).toEqual([{ id: null, name: 'Space' }]);
  });
});

describe('isSelfOrDescendantFolder', () => {
  it('detects self, descendants, and unrelated folders', () => {
    const index = createFolderIndex();
    registerFolders(index, [folder('a', 'A'), folder('b', 'B')], null);
    registerFolders(index, [folder('a1', 'A1')], 'a');
    expect(isSelfOrDescendantFolder(index, 'a', 'a')).toBe(true);
    expect(isSelfOrDescendantFolder(index, 'a', 'a1')).toBe(true);
    expect(isSelfOrDescendantFolder(index, 'a', 'b')).toBe(false);
    expect(isSelfOrDescendantFolder(index, 'a', null)).toBe(false);
  });
});

describe('buildMoveRequest', () => {
  it('drops into folders and rejects drops into pages', () => {
    expect(buildMoveRequest({ kind: 'page', id: 'p1' }, folder('f1', 'A'), 'into', null))
      .toMatchObject({ kind: 'page', id: 'p1', targetFolderId: 'f1' });
    expect(buildMoveRequest({ kind: 'page', id: 'p1' }, page('p2', 'B', null), 'into', null)).toBeNull();
  });

  it('ignores self drops', () => {
    expect(buildMoveRequest({ kind: 'folder', id: 'f1' }, folder('f1', 'A'), 'before', null)).toBeNull();
    expect(buildMoveRequest(null, folder('f1', 'A'), 'into', null)).toBeNull();
  });

  it('reorders relative to pages using the page folder as the parent', () => {
    const request = buildMoveRequest({ kind: 'page', id: 'p1' }, page('p2', 'B', 'f1'), 'after', null);
    expect(request).toMatchObject({ kind: 'page', id: 'p1', targetFolderId: 'f1', beforeId: 'p2' });
  });

  it('reorders relative to folder rows using the listed level parent, not the root', () => {
    const request = buildMoveRequest({ kind: 'folder', id: 'f1' }, folder('f2', 'B'), 'before', 'parent-1');
    expect(request).toMatchObject({ kind: 'folder', id: 'f1', targetFolderId: 'parent-1', beforeId: 'f2' });
  });

  it('rejects cross-kind reordering the server cannot represent', () => {
    expect(buildMoveRequest({ kind: 'page', id: 'p1' }, folder('f1', 'A'), 'before', 'parent-1')).toBeNull();
    expect(buildMoveRequest({ kind: 'folder', id: 'f1' }, page('p1', 'A', 'parent-1'), 'after', 'parent-1')).toBeNull();
  });
});
