import React from 'react';
import { FileText, Folder } from 'lucide-react';
import type { ExpandedTemplateNode } from './compositeTemplateTypes';

export const TemplateTreePreview: React.FC<{ nodes: ExpandedTemplateNode[]; emptyLabel: string }> = ({ nodes, emptyLabel }) => {
  if (!nodes.length) return <p className="text-sm text-gray-500">{emptyLabel}</p>;
  const children = new Map<string | null, ExpandedTemplateNode[]>();
  nodes.forEach((node) => children.set(node.parentNodeId, [...(children.get(node.parentNodeId) ?? []), node]));
  children.forEach((items) => items.sort((left, right) => left.order - right.order || left.nodeId.localeCompare(right.nodeId)));
  const renderLevel = (parentNodeId: string | null, level: number): React.ReactNode => (
    <ul role={level === 1 ? 'tree' : 'group'} className={level === 1 ? 'space-y-1' : 'ml-5 mt-1 space-y-1 border-l pl-3'}>
      {(children.get(parentNodeId) ?? []).map((node) => (
        <li key={node.nodeId} role="treeitem" aria-level={level} className="min-w-0">
          <span className="flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-gray-700">
            {node.kind === 'folder' ? <Folder size={15} className="shrink-0 text-amber-500" /> : <FileText size={15} className="shrink-0 text-gray-400" />}
            <span className="break-words">{node.kind === 'folder' ? node.name : node.title}</span>
          </span>
          {children.has(node.nodeId) ? renderLevel(node.nodeId, level + 1) : null}
        </li>
      ))}
    </ul>
  );
  return <div className="min-w-0 overflow-x-hidden rounded-[14px] border bg-gray-50 p-3">{renderLevel(null, 1)}</div>;
};
