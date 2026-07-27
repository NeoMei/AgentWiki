import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronRight, Edit, FileText, Trash2 } from 'lucide-react';

export interface PageTreeNode {
  id: string;
  title: string;
  updatedAt?: string;
  children?: PageTreeNode[];
}

interface PageTreeProps {
  nodes: PageTreeNode[];
  currentPageId?: string;
  onSelect?: (id: string) => void;
  emptyText: string;
  onEdit?: (node: PageTreeNode) => void;
  onDelete?: (node: PageTreeNode) => void;
  editLabel?: string;
  deleteLabel?: string;
  onMove?: (dragId: string, targetId: string | null, position: 'into' | 'before' | 'after') => void;
}

export type MovePosition = 'into' | 'before' | 'after';

const Node: React.FC<{ node: PageTreeNode; depth: number; currentPageId?: string; collapsed: Set<string>; toggle: (id: string) => void; onSelect?: (id: string) => void; onEdit?: (n: PageTreeNode) => void; onDelete?: (n: PageTreeNode) => void; editLabel?: string; deleteLabel?: string; onMove?: PageTreeProps['onMove'] }> = ({ node, depth, currentPageId, collapsed, toggle, onSelect, onEdit, onDelete, editLabel, deleteLabel, onMove }) => {
  const hasChildren = !!node.children?.length;
  const isCollapsed = collapsed.has(node.id);
  const isCurrent = node.id === currentPageId;
  const [dropHint, setDropHint] = useState<MovePosition | null>(null);

  const handleDragStart = (event: React.DragEvent) => {
    event.dataTransfer.setData('text/agentwiki-page-id', node.id);
    event.dataTransfer.effectAllowed = 'move';
    // Show the whole card following the cursor so it is clear what is moving.
    const row = event.currentTarget as HTMLElement;
    const ghost = row.cloneNode(true) as HTMLElement;
    ghost.style.width = `${row.offsetWidth}px`;
    ghost.style.position = 'absolute';
    ghost.style.top = '-1000px';
    ghost.style.left = '-1000px';
    ghost.style.background = 'white';
    ghost.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
    ghost.style.borderRadius = '6px';
    ghost.style.opacity = '0.9';
    document.body.appendChild(ghost);
    event.dataTransfer.setDragImage(ghost, 16, 16);
    requestAnimationFrame(() => ghost.remove());
  };
  const handleDragOver = (event: React.DragEvent) => {
    if (!onMove) return;
    event.preventDefault();
    setDropHint(positionFromY(event));
    event.dataTransfer.dropEffect = 'move';
  };
  const positionFromY = (event: React.DragEvent): MovePosition => {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const ratio = (event.clientY - rect.top) / rect.height;
    return ratio < 0.3 ? 'before' : ratio > 0.7 ? 'after' : 'into';
  };
  const handleDrop = (event: React.DragEvent) => {
    if (!onMove) return;
    event.preventDefault();
    const dragId = event.dataTransfer.getData('text/agentwiki-page-id');
    // Compute position from the drop event directly; React state from the
    // preceding dragover has not flushed yet and would wrongly read as into.
    if (dragId && dragId !== node.id) onMove(dragId, node.id, positionFromY(event));
    setDropHint(null);
  };
  return (
    <li
      draggable={!!onMove}
      onDragStart={onMove ? handleDragStart : undefined}
      onDragOver={onMove ? handleDragOver : undefined}
      onDragLeave={onMove ? () => setDropHint(null) : undefined}
      onDrop={onMove ? handleDrop : undefined}
      data-testid={`tree-item-${node.id}`}
      className={dropHint === 'into' ? 'rounded-md ring-2 ring-blue-400' : ''}
    >
      {dropHint === 'before' ? <div className="h-0.5 rounded bg-blue-400" style={{ marginLeft: `${depth * 14 + 4}px` }} data-testid="drop-before" /> : null}
      {dropHint === 'into' ? (
        <div
          className="my-0.5 rounded border border-dashed border-blue-300 bg-blue-50/60 px-2 py-1 text-xs text-blue-500"
          style={{ marginLeft: `${(depth + 1) * 14 + 4}px` }}
          data-testid="drop-into-preview"
        >
          {node.title} →
        </div>
      ) : null}
      <div
        className={`group flex items-center gap-1 rounded-md py-1 pr-1 text-sm transition ${isCurrent ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-700 hover:bg-gray-100'}`}
        style={{ paddingLeft: `${depth * 14 + 4}px` }}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => toggle(node.id)}
            aria-label={isCollapsed ? 'expand' : 'collapse'}
            data-testid={`tree-toggle-${node.id}`}
            className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-gray-400 hover:bg-gray-200 hover:text-gray-600"
          >
            {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          </button>
        ) : (
          <span className="inline-block h-5 w-5 shrink-0" />
        )}
        <Link to={`/pages/${node.id}`} onClick={() => onSelect?.(node.id)} className="flex min-w-0 flex-1 items-center gap-1.5 truncate" data-testid={`tree-node-${node.id}`}>
          <FileText size={14} className="shrink-0 text-gray-400" />
          <span className="truncate">{node.title}</span>
        </Link>
        {onEdit || onDelete ? (
          <span className="flex items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
            {onEdit ? (
              <button type="button" onClick={() => onEdit(node)} aria-label={editLabel || 'edit'} data-testid={`tree-edit-${node.id}`} className="inline-flex h-5 w-5 items-center justify-center rounded text-gray-400 hover:bg-blue-50 hover:text-blue-600">
                <Edit size={13} />
              </button>
            ) : null}
            {onDelete ? (
              <button type="button" onClick={() => onDelete(node)} aria-label={deleteLabel || 'delete'} data-testid={`tree-delete-${node.id}`} className="inline-flex h-5 w-5 items-center justify-center rounded text-gray-400 hover:bg-red-50 hover:text-red-600">
                <Trash2 size={13} />
              </button>
            ) : null}
          </span>
        ) : null}
      </div>
      {hasChildren && !isCollapsed ? (
        <ul>
          {node.children!.map((child) => (
            <Node key={child.id} node={child} depth={depth + 1} currentPageId={currentPageId} collapsed={collapsed} toggle={toggle} onSelect={onSelect} onEdit={onEdit} onDelete={onDelete} editLabel={editLabel} deleteLabel={deleteLabel} onMove={onMove} />
          ))}
        </ul>
      ) : null}
      {dropHint === 'after' ? <div className="h-0.5 rounded bg-blue-400" style={{ marginLeft: `${depth * 14 + 4}px` }} data-testid="drop-after" /> : null}
    </li>
  );
};

export const PageTree: React.FC<PageTreeProps> = ({ nodes, currentPageId, onSelect, emptyText, onEdit, onDelete, editLabel, deleteLabel, onMove }) => {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggle = (id: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const tree = useMemo(() => nodes, [nodes]);
  if (!tree.length) return <p className="py-6 text-center text-sm text-gray-400">{emptyText}</p>;
  return (
    <ul className="space-y-0.5" data-testid="page-tree">
      {tree.map((node) => (
        <Node key={node.id} node={node} depth={0} currentPageId={currentPageId} collapsed={collapsed} toggle={toggle} onSelect={onSelect} onEdit={onEdit} onDelete={onDelete} editLabel={editLabel} deleteLabel={deleteLabel} onMove={onMove} />
      ))}
    </ul>
  );
};
