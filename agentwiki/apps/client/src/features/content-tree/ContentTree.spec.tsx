import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../context/LanguageContext';
import { ContentTree } from './ContentTree';
import type { ContentTreeFolderNode, ContentTreePageNode } from './contentTreeTypes';

const folder: ContentTreeFolderNode = {
  kind: 'folder', id: 'folder-1', name: 'Project', path: '/Project', sortOrder: 0,
  createdAt: '2026-09-05T00:00:00.000Z', updatedAt: '2026-09-05T00:00:00.000Z', hasChildren: true,
};
const page: ContentTreePageNode = {
  kind: 'page', id: 'page-1', folderId: 'folder-1', title: 'Brief', path: '/Project/Brief', sortOrder: 1,
  createdAt: '2026-09-05T00:00:00.000Z', updatedAt: '2026-09-05T00:00:00.000Z',
};

describe('ContentTree Agent binding entry points', () => {
  it('passes the exact selected Page or Folder to the late-binding action', () => {
    const onConfigurePageAgent = vi.fn();
    const onConfigureFolderAgents = vi.fn();
    render(<LanguageProvider><ContentTree nodes={[folder, page]} loading={false} error={null} canEdit
      levelParentFolderId={null} pageDeleteDisabled={false} emptyText="Empty"
      onOpenFolder={() => undefined} onOpenPage={() => undefined} onEditPage={() => undefined}
      onDeletePage={() => undefined} onCreateSubfolder={() => undefined} onRenameFolder={() => undefined}
      onDeleteFolder={() => undefined} onMove={() => undefined}
      onConfigurePageAgent={onConfigurePageAgent} onConfigureFolderAgents={onConfigureFolderAgents} />
    </LanguageProvider>);

    fireEvent.click(screen.getByTestId('content-agent-folder-1'));
    fireEvent.click(screen.getByTestId('content-agent-page-1'));

    expect(onConfigureFolderAgents).toHaveBeenCalledWith(folder);
    expect(onConfigurePageAgent).toHaveBeenCalledWith(page);
  });

  it('passes the exact Folder and opener element to the template save action', () => {
    const onSaveFolderAsTemplate = vi.fn();
    render(<LanguageProvider><ContentTree nodes={[folder, page]} loading={false} error={null} canEdit
      levelParentFolderId={null} pageDeleteDisabled={false} emptyText="Empty"
      onOpenFolder={() => undefined} onOpenPage={() => undefined} onEditPage={() => undefined}
      onDeletePage={() => undefined} onCreateSubfolder={() => undefined} onRenameFolder={() => undefined}
      onDeleteFolder={() => undefined} onMove={() => undefined}
      onSaveFolderAsTemplate={onSaveFolderAsTemplate} />
    </LanguageProvider>);

    const opener = screen.getByTestId('content-save-template-folder-1');
    fireEvent.click(opener);

    expect(onSaveFolderAsTemplate).toHaveBeenCalledWith(folder, opener);
  });
});

describe('ContentTree directory navigation', () => {
  it('keeps folder expansion separate from folder selection and exposes the real tree state', () => {
    const onToggleFolder = vi.fn();
    const onOpenFolder = vi.fn();
    render(<LanguageProvider><ContentTree nodes={[folder]} loading={false} error={null} canEdit={false}
      levelParentFolderId={null} pageDeleteDisabled={false} emptyText="Empty"
      expandedFolderIds={new Set()} onToggleFolder={onToggleFolder}
      childLevels={new Map()}
      onOpenFolder={onOpenFolder} onOpenPage={() => undefined} onEditPage={() => undefined}
      onDeletePage={() => undefined} onCreateSubfolder={() => undefined} onRenameFolder={() => undefined}
      onDeleteFolder={() => undefined} onMove={() => undefined} />
    </LanguageProvider>);

    const item = screen.getByRole('treeitem', { name: /Project/u });
    expect(item).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(screen.getByTestId('content-toggle-folder-1'));
    expect(onToggleFolder).toHaveBeenCalledWith('folder-1');
    expect(onOpenFolder).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByTestId('content-node-folder-1'), { key: 'ArrowRight' });
    expect(onToggleFolder).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByTestId('content-node-folder-1'));
    expect(onOpenFolder).toHaveBeenCalledWith('folder-1');
  });

  it('uses page ids for duplicate titles and supports keyboard open', () => {
    const duplicate = { ...page, id: 'page-2' };
    const onOpenPage = vi.fn();
    render(<LanguageProvider><ContentTree nodes={[page, duplicate]} loading={false} error={null} canEdit={false}
      levelParentFolderId={null} pageDeleteDisabled={false} emptyText="Empty"
      onOpenFolder={() => undefined} onOpenPage={onOpenPage} onEditPage={() => undefined}
      onDeletePage={() => undefined} onCreateSubfolder={() => undefined} onRenameFolder={() => undefined}
      onDeleteFolder={() => undefined} onMove={() => undefined} />
    </LanguageProvider>);

    const second = screen.getByTestId('content-node-page-2');
    fireEvent.keyDown(second, { key: 'Enter' });
    expect(onOpenPage).toHaveBeenCalledWith(duplicate);
    expect(screen.getByTestId('content-node-page-1')).toHaveAttribute('title', 'Brief');
    expect(second).toHaveAttribute('title', 'Brief');
    screen.getByTestId('content-node-page-1').focus();
    fireEvent.keyDown(screen.getByTestId('content-node-page-1'), { key: 'ArrowDown' });
    expect(second).toHaveFocus();
  });

  it('keeps row actions behind one keyboard-focusable menu and closes it with Escape', async () => {
    render(<LanguageProvider><ContentTree nodes={[folder]} loading={false} error={null} canEdit
      levelParentFolderId={null} pageDeleteDisabled={false} emptyText="Empty"
      onOpenFolder={() => undefined} onOpenPage={() => undefined} onEditPage={() => undefined}
      onDeletePage={() => undefined} onCreateSubfolder={() => undefined} onRenameFolder={() => undefined}
      onDeleteFolder={() => undefined} onMove={() => undefined} />
    </LanguageProvider>);

    const actions = screen.getByLabelText('Actions: Project');
    expect(actions.tagName).toBe('SUMMARY');
    expect(actions).toHaveClass('focus-visible:ring-2');
    fireEvent.click(actions);
    expect(actions.closest('details')).toHaveAttribute('open');
    const rename = screen.getByTestId('content-rename-folder-1');
    rename.focus();
    fireEvent.keyDown(rename, { key: 'Escape' });
    expect(actions.closest('details')).not.toHaveAttribute('open');
    await waitFor(() => expect(actions).toHaveFocus());
  });
});
