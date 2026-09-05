import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TemplateTreePreview } from './TemplateTreePreview';

describe('TemplateTreePreview', () => {
  it('renders the complete hierarchy with nested tree semantics', () => {
    render(<TemplateTreePreview nodes={[
      { nodeId: 'root', parentNodeId: null, kind: 'folder', order: 0, name: '项目管理工作区' },
      { nodeId: 'governance', parentNodeId: 'root', kind: 'folder', order: 1, name: '治理' },
      { nodeId: 'risks', parentNodeId: 'governance', kind: 'page', order: 0, title: '风险与阻塞', content: '' },
    ]} emptyLabel="没有内容" />);
    const tree = screen.getByRole('tree');
    expect(within(tree).getByText('项目管理工作区')).toBeVisible();
    expect(within(tree).getByText('治理')).toBeVisible();
    expect(within(tree).getByText('风险与阻塞')).toBeVisible();
    expect(screen.getAllByRole('treeitem')).toHaveLength(3);
    expect(screen.getByText('风险与阻塞').closest('[role="treeitem"]')).toHaveAttribute('aria-level', '3');
  });
});
