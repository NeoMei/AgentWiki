import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { LanguageProvider } from '../../src/context/LanguageContext';
import { SpaceDirectory } from '../../src/features/space-workspace/SpaceDirectory';
import type { ContentMoveRequest } from '../../src/features/content-tree/ContentTree';
import type { ContentTreeNode } from '../../src/features/content-tree/contentTreeTypes';
import '../../src/index.css';

// Local browser fixture: exercises real drag geometry and callbacks, no server persistence claim.
const initial: ContentTreeNode[] = [
  ...['a', 'b'].map((id, sortOrder) => ({ kind: 'folder' as const, id, name: `Folder ${id}`, sortOrder, path: `/${id}`, createdAt: 'fixture', updatedAt: 'fixture', hasChildren: true })),
  ...['First', 'Second', 'Third'].map((title, sortOrder) => ({ kind: 'page' as const, id: `p${sortOrder}`, title, sortOrder, folderId: 'a', path: `/a/${title}`, createdAt: 'fixture', updatedAt: 'fixture' })),
];
function Fixture() {
  const [nodes, setNodes] = useState(initial);
  const [folderParents, setFolderParents] = useState<Record<string, string | null>>({ a: null, b: null });
  const [request, setRequest] = useState<ContentMoveRequest | null>(null);
  const canEdit = !new URLSearchParams(window.location.search).has('readonly');
  const levels = new Map([null, 'a', 'b'].map((parentFolderId) => [parentFolderId, {
    parentFolderId, treeRevision: 'fixture', nodes: nodes.filter((node) => (node.kind === 'folder' ? folderParents[node.id] : node.folderId) === parentFolderId),
  }]));
  const onMove = (input: ContentMoveRequest) => {
    setRequest(input);
    if (input.kind === 'folder') setFolderParents((old) => ({ ...old, [input.id]: input.targetFolderId }));
    setNodes((old) => {
      const moved = old.find((node) => node.id === input.id);
      if (!moved) return old;
      const siblings = old.filter((node) => node.kind === input.kind && (node.kind === 'folder' ? folderParents[node.id] : node.folderId) === input.targetFolderId && node.id !== input.id).sort((a, b) => a.sortOrder - b.sortOrder);
      const index = input.beforeId ? siblings.findIndex((node) => node.id === input.beforeId) : siblings.length;
      siblings.splice(index, 0, moved.kind === 'page' ? { ...moved, folderId: input.targetFolderId } : moved);
      return [...old.filter((node) => node.id !== input.id && !siblings.some((item) => item.id === node.id)), ...siblings.map((node, sortOrder) => ({ ...node, sortOrder }))];
    });
  };
  return <LanguageProvider><MemoryRouter><div className="p-4">
    <output data-testid="move-request">{JSON.stringify(request)}</output>
    <SpaceDirectory spaceName="Reorder" levels={levels} expandedFolderIds={new Set(['a', 'b'])} selectedFolderId={null} selectedPageId={null}
      onToggleFolder={() => {}} onSelectFolder={() => {}} loading={false} error={null} canEdit={canEdit} onOpenPage={() => {}}
      onEditPage={() => {}} onDeletePage={() => {}} onCreateSubfolder={() => {}} onRenameFolder={() => {}} onDeleteFolder={() => {}} onMove={onMove} />
  </div></MemoryRouter></LanguageProvider>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
