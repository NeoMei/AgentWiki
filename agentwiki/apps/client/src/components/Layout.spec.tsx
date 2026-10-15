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
  it.each([
    '/spaces/space-1',
    '/spaces/space-1/',
    '/spaces/space-1?folder=folder-1',
    '/spaces/space-1/graph',
    '/spaces/space-1/sources',
    '/spaces/space-1/sources?tab=runs',
    '/spaces/space-1/collaboration',
    '/spaces/space-1/taskboard',
    '/spaces/space-1/members',
    '/spaces/space-1/settings',
    '/spaces/space-1/settings/',
    '/spaces/space-1/settings/page-templates',
    '/spaces/space-1/new?folder=folder-1',
    '/spaces/space-1/docs',
    '/spaces/space-1/runs',
    '/spaces/space-1/runs/run-1',
    '/spaces/space-1/collaboration/templates/new',
    '/spaces/space-1/collaboration/templates/template-1',
    '/spaces/space-1/collaboration/templates/template-1/start',
    '/spaces/space-1/collaboration/runs/run-1',
    '/pages/page-1',
    '/pages/page-1/',
    '/pages/page-1/edit',
    '/pages/page-1/edit/',
    '/pages/page-1/versions',
    '/pages/page-1/versions?version=2',
  ])('keeps the workspace header edge-to-edge for %s', (path) => {
    renderLayout(path);
    const main = screen.getByRole('main');
    expect(main).toHaveClass('w-full');
    expect(main).not.toHaveClass('container');
    expect(main).not.toHaveClass('px-4');
    expect(main).not.toHaveClass('py-8');
    expect(main.parentElement).toHaveClass('bg-white');
  });

  it.each([
    '/dashboard',
    '/search?q=wiki',
    '/agents/agent-1',
    '/profile',
    '/review',
  ])('keeps the existing constrained container for non-workspace route %s', (path) => {
    renderLayout(path);
    const main = screen.getByRole('main');
    expect(main).toHaveClass('container', 'mx-auto', 'px-4', 'py-8');
    expect(main).not.toHaveClass('w-full');
    expect(main.parentElement).toHaveClass('bg-gray-50');
  });
});
