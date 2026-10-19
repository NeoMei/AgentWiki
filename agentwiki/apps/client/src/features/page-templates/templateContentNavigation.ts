import { newContentHref } from './newContentNavigation';

export interface TemplateContentTarget {
  templateId: string;
  kind: 'single_page' | 'page_group';
  scope: 'system' | 'space';
  folderId?: string | null;
}

export function templateContentHref(spaceId: string, target: TemplateContentTarget): string {
  const params = new URLSearchParams();
  params.set('template', target.templateId);
  params.set('kind', target.kind);
  params.set('scope', target.scope);
  if (target.folderId) params.set('folder', target.folderId);
  return `${newContentHref(spaceId)}?${params}`;
}

export function customTemplatesHref(spaceId: string, folderId?: string | null): string {
  const params = new URLSearchParams({ scope: 'space' });
  if (folderId) params.set('folder', folderId);
  return `${newContentHref(spaceId)}?${params}`;
}
