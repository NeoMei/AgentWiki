import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { Layout } from './Layout';

vi.mock('./Navbar', () => ({ Navbar: () => <header>navbar</header> }));

const renderLayout = (path: string) => render(
  <MemoryRouter initialEntries={[path]}>
    <Routes>
      <Route element={<Layout />}>
        <Route path="*" element={<p>content</p>} />
      </Route>
    </Routes>
  </MemoryRouter>,
);

describe('Layout workspace sizing', () => {
  it.each(['/pages/page-1', '/pages/page-1/edit', '/pages/page-1/edit/'])('uses an edge-to-edge surface for document route %s', (path) => {
    renderLayout(path);
    const main = screen.getByRole('main');
    expect(main).toHaveClass('w-full');
    expect(main).not.toHaveClass('px-4', 'py-8');
    expect(main.parentElement).toHaveClass('bg-white');
  });

  it.each(['/pages/page-1/versions', '/spaces/space-1', '/spaces/space-1/settings'])('retains the surrounding workspace layout for %s', (path) => {
    renderLayout(path);
    const main = screen.getByRole('main');
    expect(main).toHaveClass('w-full', 'px-4', 'py-8');
    expect(main.parentElement).toHaveClass('bg-gray-50');
  });

  it('gives space and page workspaces the full application width', () => {
    const { unmount } = renderLayout('/pages/page-1/edit');
    expect(screen.getByRole('main')).toHaveClass('w-full');
    expect(screen.getByRole('main')).not.toHaveClass('container');

    unmount();
    renderLayout('/spaces/space-1?folder=folder-1');
    expect(screen.getByRole('main')).toHaveClass('w-full');
  });

  it('keeps the existing constrained container for non-workspace routes', () => {
    renderLayout('/search?q=wiki');
    expect(screen.getByRole('main')).toHaveClass('container');
    expect(screen.getByRole('main')).not.toHaveClass('w-full');
  });
});
