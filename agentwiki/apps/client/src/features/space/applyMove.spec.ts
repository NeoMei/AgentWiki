import { describe, expect, it } from 'vitest';
import { applyMove } from './SpaceView';
import { PageTreeNode } from '../../components/PageTree';

const n = (id: string, children: PageTreeNode[] = []): PageTreeNode => ({ id, title: id, children });

describe('applyMove', () => {
  it('moves a node into another as its child', () => {
    const items = applyMove([n('A'), n('B')], 'B', 'A', 'into');
    expect(items).toEqual([
      { id: 'A', parentId: null, sortOrder: 0 },
      { id: 'B', parentId: 'A', sortOrder: 0 },
    ]);
  });

  it('reorders siblings with before/after', () => {
    const items = applyMove([n('A'), n('B'), n('C')], 'C', 'A', 'before');
    expect(items.filter((i) => i.parentId === null).map((i) => i.id)).toEqual(['C', 'A', 'B']);
  });

  it('moves a child up to root level', () => {
    const tree = [n('A', [n('A1')]), n('B')];
    const items = applyMove(tree, 'A1', 'B', 'after');
    expect(items.find((i) => i.id === 'A1')?.parentId).toBeNull();
    expect(items.filter((i) => i.parentId === null).map((i) => i.id)).toEqual(['A', 'B', 'A1']);
  });

  it('prevents dropping a node into its own subtree', () => {
    const tree = [n('A', [n('A1', [n('A1a')])])];
    const items = applyMove(tree, 'A', 'A1a', 'into');
    expect(items).toEqual([]);
  });

  it('assigns sequential sortOrder within each sibling group', () => {
    const items = applyMove([n('A'), n('B'), n('C')], 'C', 'A', 'into');
    const aChildren = items.filter((i) => i.parentId === 'A');
    expect(aChildren).toEqual([{ id: 'C', parentId: 'A', sortOrder: 0 }]);
  });
});
