import { fireEvent, render, screen } from '@testing-library/react';
import type { FC, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { LanguageProvider } from '../../context/LanguageContext';
import type { DirectoryLevel } from './useSpaceDirectory';
import { SpaceDirectory } from './SpaceDirectory';

const folder = { kind: 'folder' as const, id: 'guide', name: 'Guide', path: '/Guide', sortOrder: 0, createdAt: 'now', updatedAt: 'now', hasChildren: true };
const page = { kind: 'page' as const, id: 'page-a', folderId: 'guide', title: 'Same title', path: '/Guide/Same title', sortOrder: 0, createdAt: 'now', updatedAt: 'now' };
const Providers: FC<{ children: ReactNode }> = ({ children }) => (
  <LanguageProvider><MemoryRouter>{children}</MemoryRouter></LanguageProvider>
);

describe('SpaceDirectory', () => {
  it('renders a persistent nested tree and expansion does not select the folder', () => {
    const levels = new Map<string | null, DirectoryLevel>([
      [null, { parentFolderId: null, treeRevision: '3', nodes: [folder] }],
      ['guide', { parentFolderId: 'guide', treeRevision: '3', nodes: [page] }],
    ]);
    const onToggleFolder = vi.fn();
    const onSelectFolder = vi.fn();
    render(<Providers><SpaceDirectory spaceName="Product Wiki" levels={levels} expandedFolderIds={new Set(['guide'])}
      selectedFolderId={null} selectedPageId="page-a" loading={false} error={null} canEdit={false}
      onToggleFolder={onToggleFolder} onSelectFolder={onSelectFolder} onOpenPage={() => undefined}
      onEditPage={() => undefined} onDeletePage={() => undefined} onCreateSubfolder={() => undefined}
      onRenameFolder={() => undefined} onDeleteFolder={() => undefined} onMove={() => undefined} />
    </Providers>);

    expect(screen.getByRole('heading', { name: 'Directory' })).toBeInTheDocument();
    expect(screen.getByTestId('content-item-page-a')).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByTestId('content-toggle-guide'));
    expect(onToggleFolder).toHaveBeenCalledWith('guide');
    expect(onSelectFolder).not.toHaveBeenCalled();
  });

  it('exposes the shared new-page intent from a page route', () => {
    const onCreatePage = vi.fn();
    const onCreateFolder = vi.fn();
    render(<Providers><SpaceDirectory spaceName="Product Wiki" levels={new Map()} expandedFolderIds={new Set()}
      selectedFolderId={null} selectedPageId="page-a" loading={false} error={null} canEdit
      onToggleFolder={() => undefined} onSelectFolder={() => undefined} onOpenPage={() => undefined}
      onEditPage={() => undefined} onDeletePage={() => undefined} onCreateSubfolder={() => undefined}
      onRenameFolder={() => undefined} onDeleteFolder={() => undefined} onMove={() => undefined}
      onCreatePage={onCreatePage} onCreateFolder={onCreateFolder} />
    </Providers>);

    fireEvent.click(screen.getByRole('button', { name: 'New page' }));
    fireEvent.click(screen.getByRole('button', { name: 'New folder' }));
    expect(onCreatePage).toHaveBeenCalledTimes(1);
    expect(onCreateFolder).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('link', { name: 'Search' })).toHaveAttribute('href', '/search');
  });

  it('restores and reports the workspace-owned scroll position', () => {
    const onDirectoryScrollTopChange = vi.fn();
    const { rerender } = render(<Providers><SpaceDirectory spaceName="Product Wiki" levels={new Map()} expandedFolderIds={new Set()}
      selectedFolderId={null} selectedPageId={null} loading={false} error={null} canEdit={false}
      directoryScrollTop={120} onDirectoryScrollTopChange={onDirectoryScrollTopChange}
      onToggleFolder={() => undefined} onSelectFolder={() => undefined} onOpenPage={() => undefined}
      onEditPage={() => undefined} onDeletePage={() => undefined} onCreateSubfolder={() => undefined}
      onRenameFolder={() => undefined} onDeleteFolder={() => undefined} onMove={() => undefined} />
    </Providers>);
    const scroller = screen.getByTestId('space-directory-scroll');
    expect(scroller.scrollTop).toBe(120);
    scroller.scrollTop = 245;
    fireEvent.scroll(scroller);
    expect(onDirectoryScrollTopChange).toHaveBeenLastCalledWith(245);

    rerender(<Providers><SpaceDirectory spaceName="Product Wiki" levels={new Map()} expandedFolderIds={new Set()}
      selectedFolderId={null} selectedPageId={null} loading={false} error={null} canEdit={false}
      directoryScrollTop={80} onDirectoryScrollTopChange={onDirectoryScrollTopChange}
      onToggleFolder={() => undefined} onSelectFolder={() => undefined} onOpenPage={() => undefined}
      onEditPage={() => undefined} onDeletePage={() => undefined} onCreateSubfolder={() => undefined}
      onRenameFolder={() => undefined} onDeleteFolder={() => undefined} onMove={() => undefined} />
    </Providers>);
    expect(scroller.scrollTop).toBe(80);
  });
});
