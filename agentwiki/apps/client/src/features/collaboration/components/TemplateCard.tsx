import React from 'react';
import { Archive, Copy, LockKeyhole, Pencil, Play, RefreshCw, Workflow } from 'lucide-react';
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
    pendingUpgrade: string;
    upgrade: string;
  };
  onCopy: (template: TemplateSummary) => void;
  onArchive: (template: TemplateSummary) => void;
  onUpgrade?: (template: TemplateSummary, trigger: HTMLElement) => void;
}

export const TemplateCard: React.FC<TemplateCardProps> = ({
  spaceId, template, name, description, canManage, canStart, labels, onCopy, onArchive, onUpgrade,
}) => (
  <article className="aw-collab-template">
    <div className="aw-collab-template-icon" aria-hidden="true"><Workflow size={18} /></div>
    <div className="aw-collab-template-content">
      <div className="aw-collab-template-title">
        <h2>{name}</h2>
        <span className="aw-collab-badge">
          {template.system ? <LockKeyhole size={11} aria-hidden="true" /> : null}
          {template.system ? labels.system : labels.space}
        </span>
        {!template.system ? <span className="aw-collab-badge aw-collab-badge-warning">{labels.pendingUpgrade}</span> : null}
      </div>
      <p className="aw-collab-template-description">{description}</p>
    </div>
    <div className="aw-collab-template-actions">
      {canStart ? (
        <Link
          to={`/spaces/${spaceId}/collaboration/templates/${template.id}/start`}
          className="aw-collab-button"
        >
          <Play size={14} aria-hidden="true" />{labels.start}
        </Link>
      ) : null}
      {template.system && canManage ? (
        <button type="button" onClick={() => onCopy(template)} className="aw-collab-button aw-collab-button-ghost">
          <Copy size={14} aria-hidden="true" />{labels.copy}
        </button>
      ) : null}
      {!template.system && canManage ? (
        <>
          {onUpgrade ? <button type="button" aria-label={`${labels.upgrade} ${name}`} onClick={(event) => onUpgrade(template, event.currentTarget)} className="aw-collab-button">
            <RefreshCw size={14} aria-hidden="true" />{labels.upgrade}
          </button> : null}
          <Link to={`/spaces/${spaceId}/collaboration/templates/${template.id}`} className="aw-collab-button aw-collab-button-ghost">
            <Pencil size={14} aria-hidden="true" />{labels.edit}
          </Link>
          <button type="button" onClick={() => onArchive(template)} className="aw-collab-button aw-collab-button-ghost aw-collab-button-danger">
            <Archive size={14} aria-hidden="true" />{labels.archive}
          </button>
        </>
      ) : null}
    </div>
  </article>
);
