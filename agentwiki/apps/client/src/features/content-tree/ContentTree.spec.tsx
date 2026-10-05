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

 it('keeps a historical blank page visibly named and clickable without renaming it', () => {
   localStorage.setItem('agentwiki.language.v1', 'en');
   const onSelectPage = vi.fn(); const blank = { ...page, title: ' 　' };
   render(<LanguageProvider><ContentTree nodes={[blank]} loading={false} error={null} canEdit={false} levelParentFolderId={null} pageDeleteDisabled={false} emptyText="Empty" onOpenPage={onSelectPage} onOpenFolder={vi.fn()} onEditPage={vi.fn()} onDeletePage={vi.fn()} onCreateSubfolder={vi.fn()} onRenameFolder={vi.fn()} onDeleteFolder={vi.fn()} onMove={vi.fn()} /></LanguageProvider>);
   const button = screen.getByRole('button', { name: 'Untitled page' });
   fireEvent.click(button); expect(onSelectPage).toHaveBeenCalledWith(blank);
   expect(button).toHaveClass('min-h-8'); expect(blank.title).toBe(' 　');
 });

describe('direct directory operations', () => {
  const props = { nodes: [folder, page], loading: false, error: null, canEdit: true, levelParentFolderId: null, pageDeleteDisabled: false, emptyText: '', onOpenFolder: vi.fn(), onOpenPage: vi.fn(), onEditPage: vi.fn(), onDeletePage: vi.fn(), onCreateSubfolder: vi.fn(), onRenameFolder: vi.fn(), onDeleteFolder: vi.fn(), onMove: vi.fn() };
  it('shows text actions and supports keyboard menu navigation', () => {
    render(<LanguageProvider><ContentTree {...props} /></LanguageProvider>); const opener = screen.getByLabelText('Actions: Project'); fireEvent.keyDown(opener, { key: 'ArrowDown' }); expect(screen.getByRole('button', { name: 'New folder' })).toHaveFocus(); expect(screen.getByTestId('content-rename-folder-1')).toHaveTextContent('Rename'); fireEvent.keyDown(screen.getByRole('button', { name: 'New folder' }), { key: 'ArrowDown' }); expect(screen.getByTestId('content-rename-folder-1')).toHaveFocus();
  });
  it('cancels inline rename and submits exact page without opening it', async () => {
    const onRenameNode = vi.fn().mockResolvedValue(undefined); render(<LanguageProvider><ContentTree {...props} onRenameNode={onRenameNode} /></LanguageProvider>); fireEvent.click(screen.getByTestId('content-rename-folder-1')); const input = screen.getByRole('textbox', { name: 'Rename: Project' }); fireEvent.change(input, { target: { value: 'Changed' } }); fireEvent.keyDown(input, { key: 'Escape' }); expect(onRenameNode).not.toHaveBeenCalled(); expect(screen.queryByRole('textbox')).not.toBeInTheDocument(); fireEvent.click(screen.getByTestId('content-rename-page-1')); fireEvent.change(screen.getByRole('textbox', { name: 'Rename: Brief' }), { target: { value: 'New brief' } }); fireEvent.submit(screen.getByRole('textbox').closest('form')!); await waitFor(() => expect(onRenameNode).toHaveBeenCalledWith(page, 'New brief')); expect(props.onOpenPage).not.toHaveBeenCalled();
  });
  it('keeps original source when inline mutation is denied', async () => {
    render(<LanguageProvider><ContentTree {...props} onRenameNode={vi.fn().mockRejectedValue(new Error('Permission denied'))} /></LanguageProvider>); fireEvent.click(screen.getByTestId('content-rename-page-1')); fireEvent.submit(screen.getByRole('textbox').closest('form')!); expect(await screen.findByRole('alert')).toHaveTextContent('Permission denied'); expect(page.title).toBe('Brief');
  });
});

it('activates the actions menu with Enter and Space and forbids mutation after permission loss', () => {
  const props = { nodes: [folder], loading: false, error: null, canEdit: true, levelParentFolderId: null, pageDeleteDisabled: false, emptyText: '', onOpenFolder: vi.fn(), onOpenPage: vi.fn(), onEditPage: vi.fn(), onDeletePage: vi.fn(), onCreateSubfolder: vi.fn(), onRenameFolder: vi.fn(), onDeleteFolder: vi.fn(), onMove: vi.fn(), onRenameNode: vi.fn() };
  const view = render(<LanguageProvider><ContentTree {...props} /></LanguageProvider>);
  const opener = screen.getByLabelText('Actions: Project'); fireEvent.keyDown(opener, { key: 'Enter' }); expect(opener.closest('details')).toHaveAttribute('open'); fireEvent.keyDown(opener, { key: ' ' }); expect(opener.closest('details')).not.toHaveAttribute('open');
  fireEvent.click(screen.getByTestId('content-rename-folder-1')); expect(screen.getByRole('textbox')).toBeInTheDocument(); view.rerender(<LanguageProvider><ContentTree {...props} canEdit={false} /></LanguageProvider>); expect(screen.queryByRole('textbox')).not.toBeInTheDocument(); expect(screen.getByTestId('content-row-folder-1')).toHaveAttribute('draggable', 'false');
});
it('binds an inline rename to the node version shown when rename started', async () => {
  const onRenameNode = vi.fn().mockResolvedValue(undefined);
  const props = { nodes: [page], loading: false, error: null, canEdit: true, levelParentFolderId: null, pageDeleteDisabled: false, emptyText: '', onOpenFolder: vi.fn(), onOpenPage: vi.fn(), onEditPage: vi.fn(), onDeletePage: vi.fn(), onCreateSubfolder: vi.fn(), onRenameFolder: vi.fn(), onDeleteFolder: vi.fn(), onMove: vi.fn(), onRenameNode };
  const view = render(<LanguageProvider><ContentTree {...props} /></LanguageProvider>); fireEvent.click(screen.getByTestId('content-rename-page-1'));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'My title' } });
  view.rerender(<LanguageProvider><ContentTree {...props} nodes={[{ ...page, title: 'Remote title', updatedAt: 'newer-at' }]} /></LanguageProvider>);
  fireEvent.submit(screen.getByRole('textbox').closest('form')!);
  await waitFor(() => expect(onRenameNode).toHaveBeenCalledWith(page, 'My title'));
});
