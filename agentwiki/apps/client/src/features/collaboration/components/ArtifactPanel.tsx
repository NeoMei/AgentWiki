import React from 'react';
import type { CollaborationRun } from '../types';

export const ArtifactPanel: React.FC<{ run: CollaborationRun; t: (key: string, params?: Record<string, string | number>) => string }> = ({ run, t }) => {
  const artifacts = (run.tasks ?? []).flatMap((task) => task.artifacts.map((artifact) => ({ task, artifact })));
  return <section data-testid="dashboard-section-artifacts" className="order-4 min-w-0 rounded-xl border bg-white p-4 lg:col-start-3 lg:row-start-2"><h2 className="font-semibold">{t('collaboration.dashboard.artifacts')}</h2><div className="mt-3 space-y-3">{artifacts.length ? artifacts.map(({ task, artifact }) => <article key={artifact.id} className="min-w-0 rounded-lg border p-3"><p className="break-words text-sm font-medium">{artifactName(artifact.payload, `${artifact.kind} v${artifact.version}`)}</p><p className="mt-1 text-xs text-gray-500">{task.name} · {artifact.status} · v{artifact.version}</p></article>) : <p className="text-sm text-gray-500">{t('collaboration.dashboard.noArtifacts')}</p>}</div></section>;
};

function artifactName(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== 'object') return fallback;
  const value = payload as Record<string, unknown>;
  for (const key of ['name', 'filename', 'title']) if (typeof value[key] === 'string' && value[key]) return String(value[key]);
  return fallback;
}

