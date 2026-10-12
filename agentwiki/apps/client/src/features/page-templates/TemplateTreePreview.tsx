import React from 'react';
import { FileText, Folder } from 'lucide-react';
import type { ExpandedTemplateNode } from './compositeTemplateTypes';
import './template-creation.css';

export const TemplateTreePreview: React.FC<{ nodes: ExpandedTemplateNode[]; emptyLabel: string }> = ({ nodes, emptyLabel }) => {
  if (!nodes.length) return <p className="template-tree-empty">{emptyLabel}</p>;
  const children = new Map<string | null, ExpandedTemplateNode[]>();
  nodes.forEach((node) => children.set(node.parentNodeId, [...(children.get(node.parentNodeId) ?? []), node]));
  children.forEach((items) => items.sort((left, right) => left.order - right.order || left.nodeId.localeCompare(right.nodeId)));
  const renderLevel = (parentNodeId: string | null, level: number): React.ReactNode => (
    <ul role={level === 1 ? 'tree' : 'group'} className={level === 1 ? 'template-tree-level' : 'template-tree-level template-tree-branch'}>
      {(children.get(parentNodeId) ?? []).map((node) => (
        <li key={node.nodeId} role="treeitem" aria-level={level} className="min-w-0">
          <span className={`template-tree-row ${node.kind === 'folder' ? 'is-folder' : ''}`}>
            {node.kind === 'folder' ? <Folder size={16} aria-hidden="true" /> : <FileText size={16} aria-hidden="true" />}
            <span className="break-words">{node.kind === 'folder' ? node.name : node.title}</span>
          </span>
          {children.has(node.nodeId) ? renderLevel(node.nodeId, level + 1) : null}
        </li>
      ))}
    </ul>
  );
  return <div className="template-tree">{renderLevel(null, 1)}</div>;
};
