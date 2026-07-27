import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { PageTree, PageTreeNode } from './PageTree';

const tree: PageTreeNode[] = [
  { id: 'a', title: 'Alpha', children: [
    { id: 'a1', title: 'Alpha One', children: [] },
    { id: 'a2', title: 'Alpha Two', children: [
      { id: 'a2i', title: 'Alpha Two Inner', children: [] },
    ] },
  ] },
  { id: 'b', title: 'Beta', children: [] },
];

const renderTree = (props = {}) => render(<MemoryRouter><PageTree nodes={tree} emptyText="空" {...props} /></MemoryRouter>);

describe('PageTree', () => {
  afterEach(cleanup);

  it('renders all nodes expanded by default with indentation', () => {
    renderTree();
    expect(screen.getByTestId('tree-node-a')).toHaveTextContent('Alpha');
    expect(screen.getByTestId('tree-node-a1')).toHaveTextContent('Alpha One');
    expect(screen.getByTestId('tree-node-a2i')).toHaveTextContent('Alpha Two Inner');
    expect(screen.getByTestId('tree-node-b')).toHaveTextContent('Beta');
  });

  it('collapses and expands a branch', () => {
    renderTree();
    expect(screen.getByTestId('tree-node-a1')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('tree-toggle-a'));
    expect(screen.queryByTestId('tree-node-a1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('tree-node-a2i')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('tree-toggle-a'));
    expect(screen.getByTestId('tree-node-a1')).toBeInTheDocument();
  });

  it('marks the current page', () => {
    renderTree({ currentPageId: 'a2' });
    expect(screen.getByTestId('tree-node-a2').parentElement?.className).toContain('bg-blue-50');
  });

  it('shows empty text when no nodes', () => {
    render(<MemoryRouter><PageTree nodes={[]} emptyText="空" /></MemoryRouter>);
    expect(screen.getByText('空')).toBeInTheDocument();
  });
});
