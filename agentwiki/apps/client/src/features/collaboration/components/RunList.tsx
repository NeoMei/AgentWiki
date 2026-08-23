import React from 'react';
import { CircleDot } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { RunSummary } from '../types';

export const RunList: React.FC<{
  spaceId: string;
  runs: RunSummary[];
  emptyLabel: string;
  statusLabel: (status: RunSummary['status']) => string;
  locale: string;
}> = ({ spaceId, runs, emptyLabel, statusLabel, locale }) => {
  if (!runs.length) return <div data-testid="collaboration-empty" className="rounded-xl border bg-white py-14 text-center text-sm text-gray-500">{emptyLabel}</div>;
  return (
    <div className="divide-y rounded-xl border bg-white">
      {runs.map((run) => (
        <Link key={run.id} to={`/spaces/${spaceId}/collaboration/runs/${run.id}`} className="flex min-w-0 items-center gap-3 p-4 hover:bg-gray-50">
          <CircleDot size={16} className="shrink-0 text-blue-600" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium text-gray-900">{run.name}</span>
            <span className="mt-1 block text-xs text-gray-500">{new Date(run.updatedAt).toLocaleString(locale)}</span>
          </span>
          <span className="shrink-0 rounded-full bg-gray-100 px-2 py-1 text-xs text-gray-700">{statusLabel(run.status)}</span>
        </Link>
      ))}
    </div>
  );
};
