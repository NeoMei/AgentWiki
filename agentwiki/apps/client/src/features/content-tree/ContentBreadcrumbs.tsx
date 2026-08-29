import React from 'react';
import { ChevronRight, Folder } from 'lucide-react';
import type { Crumb } from './contentTreeState';

export interface ContentBreadcrumbsProps {
  crumbs: Crumb[];
  onSelect: (folderId: string | null) => void;
}

export const ContentBreadcrumbs: React.FC<ContentBreadcrumbsProps> = ({ crumbs, onSelect }) => (
  <nav aria-label="breadcrumb" className="flex flex-wrap items-center gap-1 text-sm" data-testid="content-breadcrumbs">
    {crumbs.map((crumb, index) => {
      const isLast = index === crumbs.length - 1;
      return (
        <React.Fragment key={crumb.id ?? 'root'}>
          {index > 0 ? <ChevronRight size={13} className="shrink-0 text-gray-300" /> : null}
          {isLast ? (
            <span className="flex min-w-0 items-center gap-1 font-medium text-gray-700">
              <Folder size={13} className="shrink-0 text-amber-500" />
              <span className="truncate">{crumb.name}</span>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => onSelect(crumb.id)}
              className="flex min-w-0 items-center gap-1 rounded px-1 text-gray-500 hover:bg-gray-100 hover:text-blue-600"
            >
              <Folder size={13} className="shrink-0 text-gray-400" />
              <span className="truncate">{crumb.name}</span>
            </button>
          )}
        </React.Fragment>
      );
    })}
  </nav>
);

