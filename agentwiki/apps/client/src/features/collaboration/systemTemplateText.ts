import { systemCollaborationKeys } from '../../i18n/system-collaboration-messages';
import type { TemplateSummary } from './types';
const SYSTEM_SLUGS = new Set(['coding', 'bid-writing', 'paper-writing', 'video-script-writing', 'novel-writing']);
export function systemTemplateText(template: TemplateSummary | null | undefined, value: string, t: (key: string) => string): string {
  if (!template?.system || template.spaceId !== null || !SYSTEM_SLUGS.has(template.slug)) return value;
  const key = systemCollaborationKeys[value];
  return key ? t(key) : value;
}
