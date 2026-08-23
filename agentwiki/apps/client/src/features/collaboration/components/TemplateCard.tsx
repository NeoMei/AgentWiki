import React from 'react';
import { Archive, Copy, LockKeyhole, Pencil, Play } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { TemplateSummary } from '../types';

interface TemplateCardProps {
  spaceId: string;
  template: TemplateSummary;
  name: string;
  description: string;
  canManage: boolean;
  canStart: boolean;
  labels: {
    system: string;
    space: string;
    copy: string;
    edit: string;
    archive: string;
    start: string;
  };
  onCopy: (template: TemplateSummary) => void;
  onArchive: (template: TemplateSummary) => void;
}

export const TemplateCard: React.FC<TemplateCardProps> = ({
  spaceId, template, name, description, canManage, canStart, labels, onCopy, onArchive,
}) => (
  <article className="flex min-w-0 flex-col rounded-xl border bg-white p-5 shadow-sm">
    <div className="flex min-w-0 items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="break-words text-base font-semibold text-gray-900">{name}</h2>
        <p className="mt-2 text-sm leading-6 text-gray-600">{description}</p>
      </div>
      <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-xs ${template.system ? 'bg-slate-100 text-slate-700' : 'bg-blue-50 text-blue-700'}`}>
        {template.system ? <LockKeyhole size={12} aria-hidden="true" /> : null}
        {template.system ? labels.system : labels.space}
      </span>
    </div>
    <div className="mt-auto flex flex-wrap gap-2 pt-5">
      {canStart ? (
        <Link
          to={`/spaces/${spaceId}/collaboration/templates/${template.id}/start`}
          className="inline-flex min-h-10 items-center gap-1 rounded-lg bg-blue-600 px-3 text-sm font-medium text-white hover:bg-blue-700"
        >
          <Play size={14} aria-hidden="true" />{labels.start}
        </Link>
      ) : null}
      {template.system && canManage ? (
        <button type="button" onClick={() => onCopy(template)} className="inline-flex min-h-10 items-center gap-1 rounded-lg border px-3 text-sm hover:bg-gray-50">
          <Copy size={14} aria-hidden="true" />{labels.copy}
        </button>
      ) : null}
      {!template.system && canManage ? (
        <>
          <Link to={`/spaces/${spaceId}/collaboration/templates/${template.id}`} className="inline-flex min-h-10 items-center gap-1 rounded-lg border px-3 text-sm hover:bg-gray-50">
            <Pencil size={14} aria-hidden="true" />{labels.edit}
          </Link>
          <button type="button" onClick={() => onArchive(template)} className="inline-flex min-h-10 items-center gap-1 rounded-lg border border-red-200 px-3 text-sm text-red-700 hover:bg-red-50">
            <Archive size={14} aria-hidden="true" />{labels.archive}
          </button>
        </>
      ) : null}
    </div>
  </article>
);
