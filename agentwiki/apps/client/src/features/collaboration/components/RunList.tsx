import React from 'react';
import { ChevronRight, CircleDot } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { RunSummary } from '../types';

export const RunList: React.FC<{
  spaceId: string;
  runs: RunSummary[];
  emptyLabel: string;
  statusLabel: (status: RunSummary['status']) => string;
  locale: string;
}> = ({ spaceId, runs, emptyLabel, statusLabel, locale }) => {
  if (!runs.length) return <div data-testid="collaboration-empty" className="aw-collab-empty">{emptyLabel}</div>;
  return (
    <div className="aw-collab-run-list">
      {runs.map((run) => (
        <Link key={run.id} to={`/spaces/${spaceId}/collaboration/runs/${run.id}`} className="aw-collab-run-row">
          <CircleDot size={16} className="aw-collab-run-icon" aria-hidden="true" />
          <span className="aw-collab-run-name">{run.name}</span>
          <span className="aw-collab-status" data-status={run.status}>{statusLabel(run.status)}</span>
          <time className="aw-collab-run-date" dateTime={run.updatedAt}>{new Date(run.updatedAt).toLocaleString(locale)}</time>
          <ChevronRight size={14} className="aw-collab-run-chevron" aria-hidden="true" />
        </Link>
      ))}
    </div>
  );
};
