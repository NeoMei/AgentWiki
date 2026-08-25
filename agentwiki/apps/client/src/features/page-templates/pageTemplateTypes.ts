export type PageTemplateLocale = 'zh-CN' | 'en';
export type PageTemplateCategory = 'planning' | 'reporting' | 'knowledge' | 'other';

interface PageTemplateSummaryBase {
  id: string;
  stableKey: string;
  category: PageTemplateCategory;
  name: string;
  description: string;
  defaultTitle: string;
  currentVersion: number;
  archivedAt: string | null;
  updatedAt: string;
}

export type PageTemplateSummary = PageTemplateSummaryBase & (
  | { scope: 'system'; sourceLocale: null }
  | { scope: 'space'; sourceLocale: PageTemplateLocale }
);

export interface PageTemplateListResponse {
  system: PageTemplateSummary[];
  space: PageTemplateSummary[];
  totalSpace: number;
  skip: number;
  take: number;
  capabilities: { canManage: boolean };
}

export interface PageTemplateSourcePage {
  id: string;
  title: string;
  format: 'markdown';
  updatedAt: string;
}

export interface PageTemplateSourcePageListResponse {
  data: PageTemplateSourcePage[];
  total: number;
  skip: number;
  take: number;
}

export type PageTemplateDetail = PageTemplateSummary & {
  content: string;
  contentLocale: PageTemplateLocale;
  sourcePageId: string | null;
};

export interface SavePageTemplateInput {
  name: string;
  description?: string;
  category: PageTemplateCategory;
  defaultTitle: string;
  locale: PageTemplateLocale;
  sourcePageId: string;
  expectedSourceUpdatedAt: string;
}
