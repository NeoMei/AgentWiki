import { fireEvent, render, screen } from '@testing-library/react';
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
