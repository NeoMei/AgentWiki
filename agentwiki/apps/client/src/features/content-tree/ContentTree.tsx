import React, { useState } from 'react';
import { Edit, FileText, Folder, FolderPlus, Pencil, Trash2 } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { buildMoveRequest, sortNodes } from './contentTreeState';
import type { ContentMoveRequest, DragInfo, MovePosition } from './contentTreeState';
import type { ContentTreeFolderNode, ContentTreeNode, ContentTreePageNode } from './contentTreeTypes';

export type { ContentMoveRequest, MovePosition };

export interface ContentTreeProps {
  nodes: ContentTreeNode[];
  loading: boolean;
  error: string | null;
  canEdit: boolean;
  /** Parent folder of the currently listed level; reorder target for before/after drops. */
  levelParentFolderId: string | null;
  currentPageId?: string;
  pageDeleteDisabled: boolean;
  emptyText: string;
  onOpenFolder: (folderId: string) => void;
  onOpenPage: (page: ContentTreePageNode) => void;
  onEditPage: (page: ContentTreePageNode) => void;
  onDeletePage: (page: ContentTreePageNode) => void;
  onCreateSubfolder: (parent: ContentTreeFolderNode | null) => void;
  onRenameFolder: (folder: ContentTreeFolderNode) => void;
  onDeleteFolder: (folder: ContentTreeFolderNode) => void;
  onMove: (request: ContentMoveRequest) => void;
}

interface NodeRowLabels {
  edit: string;
  delete: string;
  rename: string;
  deleteFolder: string;
  newSubfolder: string;
}

export const ContentTree: React.FC<ContentTreeProps> = ({
  nodes,
  loading,
  error,
  canEdit,
  levelParentFolderId,
  currentPageId,
  pageDeleteDisabled,
  emptyText,
  onOpenFolder,
  onOpenPage,
  onEditPage,
  onDeletePage,
  onCreateSubfolder,
  onRenameFolder,
  onDeleteFolder,
  onMove,
}) => {
  const { t } = useLanguage();
  const [drag, setDrag] = useState<DragInfo | null>(null);

  if (loading) {
    return <p className="py-6 text-center text-sm text-gray-400" data-testid="content-tree-loading">{t('common.loading')}</p>;
  }
  if (error) {
    return <p className="py-6 text-center text-sm text-red-500" data-testid="content-tree-error">{error}</p>;
  }
  if (!nodes.length) {
    return (
      <div className="py-10 text-center" data-testid="content-tree-empty">
        <Folder size={36} className="mx-auto mb-3 text-gray-300" />
        <p className="text-gray-500">{emptyText}</p>
        {canEdit ? (
          <button
            type="button"
            onClick={() => onCreateSubfolder(null)}
            className="mt-3 inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
          >
            <FolderPlus size={15} />
            {t('folder.createTitle')}
          </button>
        ) : null}
      </div>
    );
  }

  const labels: NodeRowLabels = {
    edit: t('page.edit'),
    delete: t('page.delete'),
    rename: t('folder.rename'),
    deleteFolder: t('folder.delete'),
    newSubfolder: t('folder.createTitle'),
  };

  return (
    <ul className="space-y-0.5" data-testid="content-tree">
      {sortNodes(nodes).map((node) => (
        <NodeRow
          key={node.id}
          node={node}
          canEdit={canEdit}
          currentPageId={currentPageId}
          pageDeleteDisabled={pageDeleteDisabled}
          dragActive={drag}
          labels={labels}
          onOpenFolder={onOpenFolder}
          onOpenPage={onOpenPage}
          onEditPage={onEditPage}
          onDeletePage={onDeletePage}
          onCreateSubfolder={onCreateSubfolder}
          onRenameFolder={onRenameFolder}
          onDeleteFolder={onDeleteFolder}
          onDragStart={setDrag}
          onDragEnd={() => setDrag(null)}
          onDrop={(_event, target, position) => {
            const request = buildMoveRequest(drag, target, position, levelParentFolderId);
            setDrag(null);
            if (request) onMove(request);
          }}
        />
      ))}
    </ul>
  );
};

interface NodeRowProps {
  node: ContentTreeNode;
  canEdit: boolean;
  currentPageId?: string;
  pageDeleteDisabled: boolean;
  dragActive: DragInfo | null;
  labels: NodeRowLabels;
  onOpenFolder: (folderId: string) => void;
  onOpenPage: (page: ContentTreePageNode) => void;
  onEditPage: (page: ContentTreePageNode) => void;
  onDeletePage: (page: ContentTreePageNode) => void;
  onCreateSubfolder: (parent: ContentTreeFolderNode | null) => void;
  onRenameFolder: (folder: ContentTreeFolderNode) => void;
  onDeleteFolder: (folder: ContentTreeFolderNode) => void;
  onDragStart: (drag: DragInfo) => void;
  onDragEnd: () => void;
  onDrop: (event: React.DragEvent, target: ContentTreeNode, position: MovePosition) => void;
}

const NodeRow: React.FC<NodeRowProps> = (props) => {
  const { node, canEdit, currentPageId, pageDeleteDisabled, dragActive, labels } = props;
  const [dropHint, setDropHint] = useState<MovePosition | null>(null);
  const isPage = node.kind === 'page';
  const isCurrent = isPage && node.id === currentPageId;
  const selfDrag = dragActive?.id === node.id;
  const rowClass = 'group flex items-center gap-1 rounded-md py-1 pr-1 text-sm transition '
    + (isCurrent ? 'bg-blue-50 font-medium text-blue-700' : 'text-gray-700 hover:bg-gray-100')
    + (dropHint === 'into' ? ' ring-2 ring-blue-400' : '');

  const handleDragOver = (event: React.DragEvent) => {
    if (!dragActive || selfDrag) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const ratio = rect.height ? (event.clientY - rect.top) / rect.height : 0.5;
    const next: MovePosition = ratio < 0.35 ? 'before' : ratio > 0.65 ? 'after' : 'into';
    if (next !== 'into' && dragActive.kind !== node.kind) return;
    if (next === 'into' && isPage) {
      setDropHint(null);
    } else {
      setDropHint(next);
    }
  };

  return (
    <li className="relative" data-testid={'content-item-' + node.id}>
      {dropHint === 'before' ? <div className="pointer-events-none absolute -top-px left-2 right-2 h-0.5 rounded bg-blue-500" data-testid="drop-before" /> : null}
      {dropHint === 'after' ? <div className="pointer-events-none absolute -bottom-px left-2 right-2 h-0.5 rounded bg-blue-500" data-testid="drop-after" /> : null}
      <div
        draggable
        data-testid={'content-row-' + node.id}
        onDragStart={(event) => {
          event.dataTransfer.setData('text/agentwiki-node-id', node.id);
          event.dataTransfer.effectAllowed = 'move';
          props.onDragStart({ kind: node.kind, id: node.id });
        }}
        onDragEnd={() => {
          setDropHint(null);
          props.onDragEnd();
        }}
        onDragOver={handleDragOver}
        onDragLeave={() => setDropHint(null)}
        onDrop={(event) => {
          event.preventDefault();
          const position: MovePosition = dropHint ?? 'into';
          setDropHint(null);
          props.onDrop(event, node, position);
        }}
        className={rowClass}
      >
        <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center">
          {isPage ? <FileText size={14} className="text-gray-400" /> : <Folder size={14} className="text-amber-500" />}
        </span>
        {isPage ? (
          <button
            type="button"
            onClick={() => props.onOpenPage(node as ContentTreePageNode)}
            className="min-w-0 flex-1 truncate text-left"
            data-testid={'content-node-' + node.id}
          >
            {node.title}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => props.onOpenFolder(node.id)}
            className="min-w-0 flex-1 truncate text-left"
            data-testid={'content-node-' + node.id}
          >
            {node.name}
          </button>
        )}
        {canEdit ? (
          <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
            {!isPage ? (
              <>
                <IconButton
                  testId={'content-newsubfolder-' + node.id}
                  title={labels.newSubfolder}
                  onClick={() => props.onCreateSubfolder(node as ContentTreeFolderNode)}
                >
                  <FolderPlus size={13} />
                </IconButton>
                <IconButton
                  testId={'content-rename-' + node.id}
                  title={labels.rename}
                  onClick={() => props.onRenameFolder(node as ContentTreeFolderNode)}
                >
                  <Pencil size={13} />
                </IconButton>
                <IconButton
                  testId={'content-deletefolder-' + node.id}
                  title={labels.deleteFolder}
                  danger
                  onClick={() => props.onDeleteFolder(node as ContentTreeFolderNode)}
                >
                  <Trash2 size={13} />
                </IconButton>
              </>
            ) : (
              <>
                <IconButton
                  testId={'content-edit-' + node.id}
                  title={labels.edit}
                  onClick={() => props.onEditPage(node as ContentTreePageNode)}
                >
                  <Edit size={13} />
                </IconButton>
                <IconButton
                  testId={'content-deletepage-' + node.id}
                  title={labels.delete}
                  danger
                  disabled={pageDeleteDisabled}
                  onClick={() => props.onDeletePage(node as ContentTreePageNode)}
                >
                  <Trash2 size={13} />
                </IconButton>
              </>
            )}
          </span>
        ) : null}
      </div>
    </li>
  );
};

const IconButton: React.FC<{
  testId: string;
  title: string;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}> = ({ testId, title, danger, disabled, onClick, children }) => (
  <button
    type="button"
    disabled={disabled}
    onClick={onClick}
    title={title}
    aria-label={title}
    data-testid={testId}
    className={
      'inline-flex h-5 w-5 items-center justify-center rounded text-gray-400 disabled:cursor-not-allowed disabled:opacity-50 '
      + (danger ? 'hover:bg-red-50 hover:text-red-600' : 'hover:bg-blue-50 hover:text-blue-600')
    }
  >
    {children}
  </button>
);
