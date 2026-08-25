import api from '../../api/client';
import type {
  PageTemplateCategory,
  PageTemplateDetail,
  PageTemplateListResponse,
  PageTemplateLocale,
  SavePageTemplateInput,
} from './pageTemplateTypes';

export interface ListPageTemplatesOptions {
  locale: PageTemplateLocale;
  scope?: 'all' | 'system' | 'space';
  archived?: 'active' | 'archived' | 'all';
  category?: PageTemplateCategory;
  q?: string;
  skip?: number;
  take?: number;
}

export interface UpdatePageTemplateInput {
  name: string;
  description?: string;
  category: PageTemplateCategory;
  defaultTitle: string;
  expectedUpdatedAt: string;
}

export interface CreatePageTemplateVersionInput {
  sourcePageId: string;
  expectedSourceUpdatedAt: string;
  expectedCurrentVersion: number;
}

const segment = (value: string) => encodeURIComponent(value);
const collectionPath = (spaceId: string) => `/spaces/${segment(spaceId)}/page-templates`;
const templatePath = (spaceId: string, templateId: string) =>
  `${collectionPath(spaceId)}/${segment(templateId)}`;

export async function listPageTemplates(
  spaceId: string,
  options: ListPageTemplatesOptions,
): Promise<PageTemplateListResponse> {
  const response = await api.get(collectionPath(spaceId), {
    params: {
      locale: options.locale,
      scope: options.scope ?? 'all',
      archived: options.archived ?? 'active',
      skip: options.skip ?? 0,
      take: options.take ?? 100,
      ...(options.category ? { category: options.category } : {}),
      ...(options.q?.trim() ? { q: options.q.trim() } : {}),
    },
  });
  return response.data;
}

export async function createPageTemplate(
  spaceId: string,
  input: SavePageTemplateInput,
): Promise<PageTemplateDetail> {
  return (await api.post(collectionPath(spaceId), input)).data;
}

export async function updatePageTemplate(
  spaceId: string,
  templateId: string,
  input: UpdatePageTemplateInput,
): Promise<PageTemplateDetail> {
  return (await api.patch(templatePath(spaceId, templateId), input)).data;
}

export async function createPageTemplateVersion(
  spaceId: string,
  templateId: string,
  input: CreatePageTemplateVersionInput,
): Promise<PageTemplateDetail & { noChange?: boolean }> {
  return (await api.post(`${templatePath(spaceId, templateId)}/versions`, input)).data;
}

export async function archivePageTemplate(
  spaceId: string,
  templateId: string,
  expectedUpdatedAt: string,
): Promise<PageTemplateDetail> {
  return (await api.delete(templatePath(spaceId, templateId), {
    data: { expectedUpdatedAt },
  })).data;
}

export async function restorePageTemplate(
  spaceId: string,
  templateId: string,
  expectedUpdatedAt: string,
): Promise<PageTemplateDetail> {
  return (await api.post(`${templatePath(spaceId, templateId)}/restore`, {
    expectedUpdatedAt,
  })).data;
}
