import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { LanguageProvider } from '../../src/context/LanguageContext';
import { ContentTree } from '../../src/features/content-tree/ContentTree';
import type { ContentTreePageNode } from '../../src/features/content-tree/contentTreeTypes';
import { SpaceDirectory } from '../../src/features/space-workspace/SpaceDirectory';
import '../../src/index.css';

// Browser-only geometry fixture; no identity or backend requests.
const pages: ContentTreePageNode[] = ['First page', 'Second page', 'Third page'].map((title, index) => ({
  kind: 'page', id: `page-${index}`, title, folderId: null, path: `/${title}`, sortOrder: index,
  createdAt: 'fixture', updatedAt: 'fixture',
}));
const levels = new Map([[null, { parentFolderId: null, treeRevision: 'fixture', nodes: pages }]]);
function Fixture() {
  const [actions, setActions] = useState<string[]>([]);
  const record = (action: string, page: ContentTreePageNode) => setActions((previous) => [...previous, `${action}:${page.id}`]);
  const props = {
    loading: false, error: null, canEdit: true, pageDeleteDisabled: false, emptyText: '',
    onOpenFolder: () => {}, onOpenPage: (page: ContentTreePageNode) => record('open', page),
    onEditPage: (page: ContentTreePageNode) => record('edit', page), onDeletePage: (page: ContentTreePageNode) => record('delete', page),
    onConfigurePageAgent: (page: ContentTreePageNode) => record('agent', page),
    onCreateSubfolder: () => {}, onRenameFolder: () => {}, onDeleteFolder: () => {}, onMove: () => {},
  };
  return <LanguageProvider><MemoryRouter><div className="p-4">
    <output data-testid="action-log">{actions.join(',')}</output>
    <div className="flex flex-col lg:flex-row">
      <section aria-label="Left directory fixture"><SpaceDirectory {...props} spaceName="Fixture" levels={levels}
        expandedFolderIds={new Set()} selectedFolderId={null} selectedPageId={null}
        onToggleFolder={() => {}} onSelectFolder={() => {}} /></section>
      <section aria-label="Right tree fixture" className="min-w-0 flex-1 px-4 pt-24">
        <ContentTree {...props} nodes={pages} levelParentFolderId={null} />
      </section>
    </div>
  </div></MemoryRouter></LanguageProvider>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
