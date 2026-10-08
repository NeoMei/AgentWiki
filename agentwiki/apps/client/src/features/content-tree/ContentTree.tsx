import React, { useEffect, useRef, useState } from 'react';
import { Bot, ChevronDown, ChevronRight, Edit, FileText, Folder, FolderPlus, Pencil, Save, Trash2 } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { TreeActionMenu } from './TreeActionMenu';
import { buildMoveRequest, sortNodes } from './contentTreeState';
import type { ContentMoveRequest, DragInfo, MovePosition } from './contentTreeState';
import type { ContentTreeFolderNode, ContentTreeNode, ContentTreePageNode } from './contentTreeTypes';

export type { ContentMoveRequest, MovePosition };

export interface ContentTreeProps {
  nodes: ContentTreeNode[];
  highlightQuery?: string;
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
  reorderDisabled?: boolean;
  /** Unmount inline input when navigation or identity changes; stale requests cannot alter new UI. */
  mutationScopeKey?: string;
  onRenameNode?: (node: ContentTreeNode, name: string) => Promise<void>;
  onCreateFolderInline?: (parent: ContentTreeFolderNode | null, name: string) => Promise<void>;
  onCreatePageInline?: (parent: ContentTreeFolderNode | null, title: string) => Promise<void>;
  onConfigurePageAgent?: (page: ContentTreePageNode) => void;
  onConfigureFolderAgents?: (folder: ContentTreeFolderNode) => void;
  saveFolderTemplateDisabledReason?: string;
  onSaveFolderAsTemplate?: (folder: ContentTreeFolderNode, trigger: HTMLElement) => void;
}

interface NodeRowLabels {
  untitledPage: string;
  actions: string;
  edit: string;
  delete: string;
  rename: string;
  deleteFolder: string;
  newSubfolder: string;
  newPage: string;
  configureAgent: string;
  saveAsTemplate: string;
  expand: (name: string) => string;
  collapse: (name: string) => string;
}

export const ContentTree: React.FC<ContentTreeProps> = ({
  nodes,
  highlightQuery,
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
  reorderDisabled = false,
  mutationScopeKey = '',
  onRenameNode,
  onCreateFolderInline,
  onCreatePageInline,
  onConfigurePageAgent,
  onConfigureFolderAgents,
  onSaveFolderAsTemplate,
  saveFolderTemplateDisabledReason,
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
    untitledPage: t('page.untitled'),
    actions: t('common.actions'),
    edit: t('page.edit'),
    delete: t('page.delete'),
    rename: t('folder.rename'),
    deleteFolder: t('folder.delete'),
    newSubfolder: t('folder.createTitle'),
    newPage: t('page.new'),
    configureAgent: t('pageTemplate.binding.action'),
    saveAsTemplate: t('pageTemplate.folderSave.action'),
    expand: (name) => t('folder.expand', { name }),
    collapse: (name) => t('folder.collapse', { name }),
  };

  const renderNodes = (levelNodes: ContentTreeNode[], parentFolderId: string | null, nested = false): React.ReactNode => (
    <ul className={nested ? 'ml-[15px] space-y-0.5 border-l border-gray-200' : 'space-y-0.5'} role={nested ? 'group' : 'tree'} data-testid={nested ? undefined : 'content-tree'}>
      {sortNodes(levelNodes).map((node) => {
        const expanded = node.kind === 'folder' && expandedFolderIds.has(node.id);
        return (
        <NodeRow
          key={`${mutationScopeKey}:${node.id}`}
          node={node}
          highlightQuery={highlightQuery}
          canEdit={canEdit}
          reorderDisabled={reorderDisabled}
          onRenameNode={onRenameNode}
          onCreateFolderInline={onCreateFolderInline}
          onCreatePageInline={onCreatePageInline}
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
          saveFolderTemplateDisabledReason={saveFolderTemplateDisabledReason}
          onDragStart={setDrag}
          onDragEnd={() => setDrag(null)}
          onDrop={(_event, target, position) => {
            const request = buildMoveRequest(drag, target, position, parentFolderId);
            setDrag(null);
            if (request && canEdit && !reorderDisabled) onMove(request);
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
  highlightQuery?: string;
  canEdit: boolean;
  currentPageId?: string;
  selectedFolderId?: string | null;
  expanded: boolean;
  onToggleFolder?: (folderId: string) => void;
  pageDeleteDisabled: boolean;
  dragActive: DragInfo | null;
  reorderDisabled: boolean;
  onRenameNode?: (node: ContentTreeNode, name: string) => Promise<void>;
  onCreateFolderInline?: (parent: ContentTreeFolderNode | null, name: string) => Promise<void>;
  onCreatePageInline?: (parent: ContentTreeFolderNode | null, title: string) => Promise<void>;
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
  saveFolderTemplateDisabledReason?: string;
  onSaveFolderAsTemplate?: (folder: ContentTreeFolderNode, trigger: HTMLElement) => void;
  onDragStart: (drag: DragInfo) => void;
  onDragEnd: () => void;
  onDrop: (event: React.DragEvent, target: ContentTreeNode, position: MovePosition) => void;
  children?: React.ReactNode;
}

const NodeRow: React.FC<NodeRowProps> = (props) => {
  const { node, canEdit, currentPageId, selectedFolderId, pageDeleteDisabled, dragActive, labels } = props;
  const [inlineMode, setInlineMode] = useState<'rename' | 'create' | 'page' | null>(null);
  const rowRef = useRef<HTMLLIElement>(null);
  const renameSnapshotRef = useRef<ContentTreeNode | null>(null);
  useEffect(() => { if (!canEdit) setInlineMode(null); }, [canEdit]);
  const finishInline = () => { setInlineMode(null); requestAnimationFrame(() => rowRef.current?.querySelector<HTMLElement>('[aria-haspopup="menu"]')?.focus()); };
  const [dropHint, setDropHint] = useState<MovePosition | null>(null);
  const isPage = node.kind === 'page';
  const isCurrent = isPage ? node.id === currentPageId : node.id === selectedFolderId;
  const selfDrag = dragActive?.id === node.id;
  const rowClass = 'group flex items-center gap-1 rounded-md py-1 pr-1 text-sm transition '
    + (isCurrent ? 'bg-blue-50 font-medium text-blue-700' : 'text-gray-700 hover:bg-gray-100')
    + (dropHint === 'into' ? ' ring-2 ring-blue-400' : '');

  const handleDragOver = (event: React.DragEvent) => {
    if (!canEdit || props.reorderDisabled || !dragActive || selfDrag) return;
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
      ref={rowRef}
      className="relative"
      data-testid={'content-item-' + node.id}
      role="treeitem"
      aria-expanded={isPage ? undefined : props.expanded}
      aria-selected={isCurrent}
    >
      {dropHint === 'before' ? <div className="pointer-events-none absolute -top-px left-2 right-2 h-0.5 rounded bg-blue-500" data-testid="drop-before" /> : null}
      {dropHint === 'after' ? <div className="pointer-events-none absolute -bottom-px left-2 right-2 h-0.5 rounded bg-blue-500" data-testid="drop-after" /> : null}
      <div
        draggable={canEdit && !props.reorderDisabled && !inlineMode}
        data-testid={'content-row-' + node.id}
        onDragStart={(event) => {
          if (!canEdit || props.reorderDisabled || inlineMode) { event.preventDefault(); return; }
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
          if (!canEdit || props.reorderDisabled) return;
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
        {inlineMode === 'rename' && props.onRenameNode ? <InlineTreeName
          label={`${labels.rename}: ${isPage ? node.title : node.name}`}
          initialName={isPage ? node.title : node.name}
          onCancel={finishInline}
          onSubmit={(name) => props.onRenameNode!(renameSnapshotRef.current ?? node, name)}
        /> : isPage ? (
          <button
            type="button"
            onClick={() => props.onOpenPage(node as ContentTreePageNode)}
            onKeyDown={(event) => handleTreeKeyDown(event, node, props)}
            className="min-h-8 min-w-0 flex-1 truncate rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            data-testid={'content-node-' + node.id}
            data-tree-focus
            title={node.title.trim() || labels.untitledPage}
          >
            {highlightTitle(node.title.trim() || labels.untitledPage, props.highlightQuery)}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => props.onOpenFolder(node.id)}
            onKeyDown={(event) => handleTreeKeyDown(event, node, props)}
            className="min-h-8 min-w-0 flex-1 truncate rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            data-testid={'content-node-' + node.id}
            data-tree-focus
            title={node.name}
          >
            {highlightTitle(node.name, props.highlightQuery)}
          </button>
        )}
        {canEdit ? (
          <TreeActionMenu label={`${labels.actions}: ${isPage ? node.title : node.name}`} title={labels.actions}>
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
                  disabled={!!props.saveFolderTemplateDisabledReason}
                  disabledReason={props.saveFolderTemplateDisabledReason}
                  onClick={(event) => props.onSaveFolderAsTemplate?.(
                    node as ContentTreeFolderNode,
                    rowRef.current?.querySelector<HTMLElement>('[aria-haspopup="menu"]') ?? event.currentTarget,
                  )}
                ><Save size={13} /></IconButton> : null}
                {props.onCreatePageInline ? <IconButton testId={'content-newpage-' + node.id} title={labels.newPage}
                  onClick={() => { setInlineMode('page'); }}><FileText size={13} /></IconButton> : null}
                <IconButton
                  testId={'content-newsubfolder-' + node.id}
                  title={labels.newSubfolder}
                  onClick={() => { if (props.onCreateFolderInline) { setInlineMode('create'); } else props.onCreateSubfolder(node as ContentTreeFolderNode); }}
                >
                  <FolderPlus size={13} />
                </IconButton>
                <IconButton
                  testId={'content-rename-' + node.id}
                  title={labels.rename}
                  onClick={() => { if (props.onRenameNode) { renameSnapshotRef.current = node; setInlineMode('rename'); } else props.onRenameFolder(node as ContentTreeFolderNode); }}
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
                {props.onRenameNode ? <IconButton testId={'content-rename-' + node.id} title={labels.rename}
                  onClick={() => { renameSnapshotRef.current = node; setInlineMode('rename'); }}><Pencil size={13} /></IconButton> : null}
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
          </TreeActionMenu>
        ) : null}
      </div>
      {inlineMode === 'create' && node.kind === 'folder' && props.onCreateFolderInline ? <div className="ml-6 py-1"><InlineTreeName
        label={`${labels.newSubfolder}: ${node.name}`} onCancel={finishInline}
        onSubmit={(name) => props.onCreateFolderInline!(node, name)}
      /></div> : null}
      {inlineMode === 'page' && node.kind === 'folder' && props.onCreatePageInline ? <div className="ml-6 py-1"><InlineTreeName
        label={`${labels.newPage}: ${node.name}`} onCancel={finishInline}
        onSubmit={(title) => props.onCreatePageInline!(node, title)}
      /></div> : null}
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
  disabledReason?: string;
  onClick: React.MouseEventHandler<HTMLButtonElement>;
  children: React.ReactNode;
}> = ({ testId, title, danger, disabled, disabledReason, onClick, children }) => (
  <>
  <button
    type="button"
    disabled={disabled}
    onClick={onClick}
    title={title}
    aria-label={title}
    aria-describedby={disabledReason ? `${testId}-reason` : undefined}
    data-testid={testId}
    className={
      'inline-flex min-h-8 items-center gap-2 rounded px-2 text-left text-xs text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50 '
      + (danger ? 'hover:bg-red-50 hover:text-red-600' : 'hover:bg-blue-50 hover:text-blue-600')
    }
  >
    {children}<span>{title}</span>
  </button>
  {disabledReason ? <p id={`${testId}-reason`} className="px-2 pb-2 text-xs text-gray-500">{disabledReason}</p> : null}
  </>
);

export const InlineTreeName: React.FC<{
  label: string;
  initialName?: string;
  onSubmit: (name: string) => Promise<void>;
  onCancel: () => void;
}> = ({ label, initialName = '', onSubmit, onCancel }) => {
  const { t } = useLanguage();
  const [name, setName] = useState(initialName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeRef = useRef(true);
  const submittingRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { activeRef.current = true; inputRef.current?.focus(); inputRef.current?.select(); return () => { activeRef.current = false; }; }, []);
  return <form className="min-w-0 flex-1" onSubmit={async (event) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || submittingRef.current) return;
    submittingRef.current = true; setBusy(true); setError(null);
    try { await onSubmit(trimmed); if (activeRef.current) onCancel(); }
    catch (failure) { if (activeRef.current) setError(failure instanceof Error ? failure.message : t('folder.saveFailed')); }
    finally { submittingRef.current = false; if (activeRef.current) setBusy(false); }
  }} onKeyDown={(event) => { event.stopPropagation(); if (event.key === 'Escape' && !busy) { event.preventDefault(); onCancel(); } }}>
    <input ref={inputRef} aria-label={label} maxLength={200} disabled={busy} value={name} onChange={(event) => setName(event.target.value)} className="min-h-8 w-full rounded border border-gray-300 px-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
    <div className="flex gap-2 text-xs"><button type="submit" disabled={busy || !name.trim()}>{t('common.save')}</button><button type="button" disabled={busy} onClick={onCancel}>{t('common.cancel')}</button></div>
    {error ? <p role="alert" className="text-xs text-red-600">{error}</p> : null}
  </form>;
};


function highlightTitle(text: string, query?: string): React.ReactNode {
  const needle = query?.trim().toLocaleLowerCase();
  if (!needle) return text;
  const lower = text.toLocaleLowerCase();
  const pieces: React.ReactNode[] = [];
  let offset = 0;
  let match = lower.indexOf(needle);
  while (match !== -1) {
    pieces.push(text.slice(offset, match));
    pieces.push(<mark key={match} className="rounded bg-yellow-100 text-inherit">{text.slice(match, match + needle.length)}</mark>);
    offset = match + needle.length;
    match = lower.indexOf(needle, offset);
  }
  pieces.push(text.slice(offset));
  return pieces;
}
