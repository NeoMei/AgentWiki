import { systemCollaborationKeys } from '../../i18n/system-collaboration-keys';
import type { CollaborationRun, TemplateSummary } from './types';
const SYSTEM_SLUGS = new Set(['coding', 'bid-writing', 'paper-writing', 'video-script-writing', 'novel-writing']);
export function systemTemplateText(template: TemplateSummary | null | undefined, value: string, t: (key: string) => string): string {
  if (!template?.system || template.spaceId !== null || !SYSTEM_SLUGS.has(template.slug)) return value;
  const key = systemCollaborationKeys[value];
  return key ? t(key) : value;
}

export function runSystemTemplateText(run: CollaborationRun, template: TemplateSummary | null | undefined, value: string, t: (key: string) => string): string {
  if (run.systemTemplateSource && SYSTEM_SLUGS.has(run.systemTemplateSource.slug)) {
    const key = systemCollaborationKeys[value];
    return key ? t(key) : value;
  }
  // New DTOs explicitly return null for custom templates; only older DTOs use the legacy lookup.
  return run.systemTemplateSource === null ? value : systemTemplateText(template, value, t);
}
