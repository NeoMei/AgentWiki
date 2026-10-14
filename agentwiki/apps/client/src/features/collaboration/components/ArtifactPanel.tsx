import { runSystemTemplateText } from '../systemTemplateText';
import { runtimeLabel } from '../../../i18n/runtime-label';
import React from 'react';
import type { CollaborationRun } from '../types';

export const ArtifactPanel: React.FC<{ run: CollaborationRun; t: (key: string, params?: Record<string, string | number>) => string; onHistory: () => void }> = ({ run, t, onHistory }) => {
  const artifacts = (run.tasks ?? []).flatMap((task) => task.artifacts.map((artifact) => ({ task, artifact })));
  return <section data-testid="dashboard-section-artifacts" className="aw-collab-side-panel aw-collab-artifact-panel min-h-0 min-w-0 lg:overflow-y-auto lg:overscroll-contain"><div className="aw-collab-panel-heading"><h2>{t('collaboration.dashboard.artifacts')}</h2><span className="aw-collab-count" aria-hidden="true">{artifacts.length}</span></div><div className="aw-collab-panel-body">{artifacts.length ? artifacts.map(({ task, artifact }) => <article key={artifact.id} className="aw-collab-artifact"><p className="[overflow-wrap:anywhere] text-sm font-medium">{artifactName(artifact.payload, artifact.preview && artifact.previewFormat !== 'kind_version' ? artifact.preview : `${['markdown', 'json', 'external_reference', 'evidence_summary'].includes(artifact.kind) ? t(`collaboration.artifactKind.${artifact.kind}`) : artifact.kind} v${artifact.version}`)}</p><p className="mt-1 [overflow-wrap:anywhere] text-xs text-gray-500">{runSystemTemplateText(run, null, task.name, t)} · {runtimeLabel(artifact.status, t)} · v{artifact.version}</p></article>) : <p className="text-sm text-gray-500">{t('collaboration.dashboard.noArtifacts')}</p>}</div><button type="button" onClick={onHistory} className="aw-collab-panel-history aw-collab-button aw-collab-button-ghost">{t('collaboration.dashboard.viewAllArtifacts')}</button></section>;
};

function artifactName(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== 'object') return fallback;
  const value = payload as Record<string, unknown>;
  for (const key of ['name', 'filename', 'title']) if (typeof value[key] === 'string' && value[key]) return String(value[key]);
  return fallback;
}
