export type PageTemplateLocale = 'zh-CN' | 'en';
export type PageTemplateScope = 'system' | 'space';
export type PageTemplateCategory = 'planning' | 'reporting' | 'knowledge' | 'other';

export interface PageTemplateSummary {
  id: string;
  scope: PageTemplateScope;
  stableKey: string;
  category: PageTemplateCategory;
  name: string;
  description: string;
  defaultTitle: string;
  sourceLocale: PageTemplateLocale | null;
  currentVersion: number;
  archivedAt: string | null;
  updatedAt: string;
}

export interface PageTemplateListResponse {
  system: PageTemplateSummary[];
  space: PageTemplateSummary[];
  totalSpace: number;
  skip: number;
  take: number;
  capabilities: { canManage: boolean };
}

export interface PageTemplateDetail extends PageTemplateSummary {
  content: string;
  contentLocale: PageTemplateLocale;
  sourcePageId: string | null;
}

export interface SavePageTemplateInput {
  name: string;
  description?: string;
  category: PageTemplateCategory;
  defaultTitle: string;
  locale: PageTemplateLocale;
  sourcePageId: string;
  expectedSourceUpdatedAt: string;
}
