import React, { useState } from 'react';
import { Bot, ChevronDown, ChevronRight, Edit, FileText, Folder, FolderPlus, MoreHorizontal, Pencil, Save, Trash2 } from 'lucide-react';
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
  selectedFolderId?: string | null;
  expandedFolderIds?: ReadonlySet<string>;
  branchErrors?: ReadonlyMap<string, string>;
  loadingBranches?: ReadonlySet<string>;
  onRetryBranch?: (folderId: string) => void;
  childLevels?: ReadonlyMap<string, ContentTreeNode[]>;
  onToggleFolder?: (folderId: string) => void;
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
  onConfigurePageAgent?: (page: ContentTreePageNode) => void;
  onConfigureFolderAgents?: (folder: ContentTreeFolderNode) => void;
  onSaveFolderAsTemplate?: (folder: ContentTreeFolderNode, trigger: HTMLElement) => void;
}

interface NodeRowLabels {
  actions: string;
  edit: string;
  delete: string;
  rename: string;
  deleteFolder: string;
  newSubfolder: string;
  configureAgent: string;
  saveAsTemplate: string;
  expand: (name: string) => string;
  collapse: (name: string) => string;
}

export const ContentTree: React.FC<ContentTreeProps> = ({
  nodes,
  loading,
  error,
  canEdit,
  levelParentFolderId,
  currentPageId,
  selectedFolderId,
  expandedFolderIds = new Set<string>(),
  childLevels = new Map<string, ContentTreeNode[]>(),
  onToggleFolder,
  branchErrors,
  loadingBranches,
  onRetryBranch,
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
  onConfigurePageAgent,
  onConfigureFolderAgents,
  onSaveFolderAsTemplate,
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
        {canEdit && emptyText ? (
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
    actions: t('common.actions'),
    edit: t('page.edit'),
    delete: t('page.delete'),
    rename: t('folder.rename'),
    deleteFolder: t('folder.delete'),
    newSubfolder: t('folder.createTitle'),
    configureAgent: t('pageTemplate.binding.action'),
    saveAsTemplate: t('pageTemplate.folderSave.action'),
    expand: (name) => t('folder.expand', { name }),
    collapse: (name) => t('folder.collapse', { name }),
  };

  const renderNodes = (levelNodes: ContentTreeNode[], parentFolderId: string | null, nested = false): React.ReactNode => (
    <ul className={nested ? 'ml-4 space-y-0.5' : 'space-y-0.5'} role={nested ? 'group' : 'tree'} data-testid={nested ? undefined : 'content-tree'}>
      {sortNodes(levelNodes).map((node) => {
        const expanded = node.kind === 'folder' && expandedFolderIds.has(node.id);
        return (
        <NodeRow
          key={node.id}
          node={node}
          canEdit={canEdit}
          currentPageId={currentPageId}
          selectedFolderId={selectedFolderId}
          expanded={expanded}
          onToggleFolder={onToggleFolder}
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
          onConfigurePageAgent={onConfigurePageAgent}
          onConfigureFolderAgents={onConfigureFolderAgents}
          onSaveFolderAsTemplate={onSaveFolderAsTemplate}
          onDragStart={setDrag}
          onDragEnd={() => setDrag(null)}
          onDrop={(_event, target, position) => {
            const request = buildMoveRequest(drag, target, position, parentFolderId);
            setDrag(null);
            if (request) onMove(request);
          }}
        >
          {expanded ? <>
            {renderNodes(childLevels.get(node.id) ?? [], node.id, true)}
            {loadingBranches?.has(node.id) ? <p role="status" className="ml-6 text-sm text-gray-400">{t('common.loading')}</p> : null}
            {branchErrors?.has(node.id) ? <div className="ml-6 text-sm text-red-500" role="alert">
              <p>{branchErrors.get(node.id)}</p>
              <button type="button" onClick={() => onRetryBranch?.(node.id)}>{t('common.retry')}</button>
            </div> : null}
          </> : null}
        </NodeRow>
      )})}
    </ul>
  );
  return <>{renderNodes(nodes, levelParentFolderId)}</>;
};

interface NodeRowProps {
  node: ContentTreeNode;
  canEdit: boolean;
  currentPageId?: string;
  selectedFolderId?: string | null;
  expanded: boolean;
  onToggleFolder?: (folderId: string) => void;
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
  onConfigurePageAgent?: (page: ContentTreePageNode) => void;
  onConfigureFolderAgents?: (folder: ContentTreeFolderNode) => void;
  onSaveFolderAsTemplate?: (folder: ContentTreeFolderNode, trigger: HTMLElement) => void;
  onDragStart: (drag: DragInfo) => void;
  onDragEnd: () => void;
  onDrop: (event: React.DragEvent, target: ContentTreeNode, position: MovePosition) => void;
  children?: React.ReactNode;
}

const NodeRow: React.FC<NodeRowProps> = (props) => {
  const { node, canEdit, currentPageId, selectedFolderId, pageDeleteDisabled, dragActive, labels } = props;
  const [dropHint, setDropHint] = useState<MovePosition | null>(null);
  const isPage = node.kind === 'page';
  const isCurrent = isPage ? node.id === currentPageId : node.id === selectedFolderId;
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
    <li
      className="relative"
      data-testid={'content-item-' + node.id}
      role="treeitem"
      aria-expanded={isPage ? undefined : props.expanded}
      aria-selected={isCurrent}
    >
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
        {isPage ? <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center"><FileText size={14} className="text-gray-400" /></span> : (
          <button type="button" data-testid={'content-toggle-' + node.id} aria-label={props.expanded ? labels.collapse(node.name) : labels.expand(node.name)}
            onClick={() => props.onToggleFolder?.(node.id)} className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
            {props.expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        )}
        {isPage ? (
          <button
            type="button"
            onClick={() => props.onOpenPage(node as ContentTreePageNode)}
            onKeyDown={(event) => handleTreeKeyDown(event, node, props)}
            className="min-w-0 flex-1 truncate rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            data-testid={'content-node-' + node.id}
            data-tree-focus
            title={node.title}
          >
            {node.title}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => props.onOpenFolder(node.id)}
            onKeyDown={(event) => handleTreeKeyDown(event, node, props)}
            className="min-w-0 flex-1 truncate rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            data-testid={'content-node-' + node.id}
            data-tree-focus
            title={node.name}
          >
            {node.name}
          </button>
        )}
        {canEdit ? (
          <details
            className="relative shrink-0"
            onKeyDown={(event) => {
              if (event.key !== 'Escape') return;
              event.preventDefault();
              event.stopPropagation();
              const details = event.currentTarget;
              details.open = false;
              details.querySelector<HTMLElement>('summary')?.focus();
            }}
          >
            <summary
              className="inline-flex h-7 w-7 cursor-pointer list-none items-center justify-center rounded text-gray-500 hover:bg-gray-200 hover:text-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 [&::-webkit-details-marker]:hidden"
              aria-label={`${labels.actions}: ${isPage ? node.title : node.name}`}
              title={labels.actions}
            >
              <MoreHorizontal size={16} />
            </summary>
          <span className="absolute right-0 top-full z-20 mt-1 flex items-center gap-0.5 rounded-md border border-gray-200 bg-white p-1 shadow-lg">
            {!isPage ? (
              <>
                {props.onConfigureFolderAgents ? <IconButton
                  testId={'content-agent-' + node.id}
                  title={labels.configureAgent}
                  onClick={() => props.onConfigureFolderAgents?.(node as ContentTreeFolderNode)}
                ><Bot size={13} /></IconButton> : null}
                {props.onSaveFolderAsTemplate ? <IconButton
                  testId={'content-save-template-' + node.id}
                  title={labels.saveAsTemplate}
                  onClick={(event) => props.onSaveFolderAsTemplate?.(
                    node as ContentTreeFolderNode,
                    event.currentTarget,
                  )}
                ><Save size={13} /></IconButton> : null}
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
                {props.onConfigurePageAgent ? <IconButton
                  testId={'content-agent-' + node.id}
                  title={labels.configureAgent}
                  onClick={() => props.onConfigurePageAgent?.(node as ContentTreePageNode)}
                ><Bot size={13} /></IconButton> : null}
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
          </details>
        ) : null}
      </div>
      {props.children}
    </li>
  );
};

const handleTreeKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, node: ContentTreeNode, props: NodeRowProps) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    if (node.kind === 'page') props.onOpenPage(node);
    else props.onOpenFolder(node.id);
    return;
  }
  if (node.kind === 'folder' && event.key === 'ArrowRight') {
    event.preventDefault();
    if (!props.expanded) props.onToggleFolder?.(node.id);
    else event.currentTarget.closest('li[role="treeitem"]')
      ?.querySelector<HTMLButtonElement>(':scope > [role="group"] [data-tree-focus]')?.focus();
    return;
  }
  if (node.kind === 'folder' && event.key === 'ArrowLeft') {
    event.preventDefault();
    if (props.expanded) props.onToggleFolder?.(node.id);
    else event.currentTarget.closest('li[role="treeitem"]')?.parentElement
      ?.closest('li[role="treeitem"]')
      ?.querySelector<HTMLButtonElement>(':scope > div [data-tree-focus]')?.focus();
    return;
  }
  const tree = event.currentTarget.closest('[role="tree"]');
  const items = tree ? [...tree.querySelectorAll<HTMLButtonElement>('[data-tree-focus]')] : [];
  const index = items.indexOf(event.currentTarget);
  const target = event.key === 'Home' ? items[0]
    : event.key === 'End' ? items[items.length - 1]
      : event.key === 'ArrowDown' ? items[index + 1]
        : event.key === 'ArrowUp' ? items[index - 1] : undefined;
  if (target) {
    event.preventDefault();
    target.focus();
  }
};

const IconButton: React.FC<{
  testId: string;
  title: string;
  danger?: boolean;
  disabled?: boolean;
  onClick: React.MouseEventHandler<HTMLButtonElement>;
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
      'inline-flex h-6 w-6 items-center justify-center rounded text-gray-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50 '
      + (danger ? 'hover:bg-red-50 hover:text-red-600' : 'hover:bg-blue-50 hover:text-blue-600')
    }
  >
    {children}
  </button>
);
