import api from '../../api/client';
import type {
  PageTemplateCategory,
  PageTemplateDetail,
  PageTemplateListResponse,
  PageTemplateLocale,
  PageTemplateSourcePageListResponse,
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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isLocale = (value: unknown): value is PageTemplateLocale => value === 'zh-CN' || value === 'en';
const isCategory = (value: unknown): value is PageTemplateCategory =>
  value === 'planning' || value === 'reporting' || value === 'knowledge' || value === 'other';

function isSummary(value: unknown, expectedScope: 'system' | 'space'): value is PageTemplateListResponse['system'][number] {
  if (!isRecord(value) || value.scope !== expectedScope) return false;
  if (expectedScope === 'system' ? value.sourceLocale !== null : !isLocale(value.sourceLocale)) return false;
  return ['id', 'stableKey', 'name', 'description', 'defaultTitle', 'updatedAt']
    .every((key) => typeof value[key] === 'string')
    && isCategory(value.category)
    && Number.isInteger(value.currentVersion)
    && (value.currentVersion as number) >= 1
    && (value.archivedAt === null || typeof value.archivedAt === 'string');
}

function parsePageTemplateListResponse(value: unknown): PageTemplateListResponse {
  if (!isRecord(value)
    || !Array.isArray(value.system)
    || !Array.isArray(value.space)
    || !value.system.every((item) => isSummary(item, 'system'))
    || !value.space.every((item) => isSummary(item, 'space'))
    || !Number.isInteger(value.totalSpace)
    || (value.totalSpace as number) < 0
    || !Number.isInteger(value.skip)
    || (value.skip as number) < 0
    || !Number.isInteger(value.take)
    || (value.take as number) < 1
    || (value.take as number) > 100
    || !isRecord(value.capabilities)
    || typeof value.capabilities.canManage !== 'boolean') {
    throw new TypeError('Invalid page template catalog response');
  }
  return value as unknown as PageTemplateListResponse;
}

function parsePageTemplateDetail(value: unknown): PageTemplateDetail {
  if (!isRecord(value)
    || (value.scope !== 'system' && value.scope !== 'space')
    || !isSummary(value, value.scope)
    || typeof value.content !== 'string'
    || !isLocale(value.contentLocale)
    || (value.sourcePageId !== null && typeof value.sourcePageId !== 'string')) {
    throw new TypeError('Invalid page template detail response');
  }
  return value as unknown as PageTemplateDetail;
}

function parsePageTemplateSourcePageListResponse(value: unknown): PageTemplateSourcePageListResponse {
  if (!isRecord(value)
    || !Array.isArray(value.data)
    || !value.data.every((item) => isRecord(item)
      && typeof item.id === 'string'
      && typeof item.title === 'string'
      && item.format === 'markdown'
      && typeof item.updatedAt === 'string')
    || !Number.isInteger(value.total)
    || (value.total as number) < 0
    || !Number.isInteger(value.skip)
    || (value.skip as number) < 0
    || !Number.isInteger(value.take)
    || (value.take as number) < 1
    || (value.take as number) > 100) {
    throw new TypeError('Invalid page template source page response');
  }
  return value as unknown as PageTemplateSourcePageListResponse;
}

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
  return parsePageTemplateListResponse(response.data);
}

export async function listPageTemplateSourcePages(
  spaceId: string,
  options: { skip?: number; take?: number } = {},
): Promise<PageTemplateSourcePageListResponse> {
  const response = await api.get(`${collectionPath(spaceId)}/source-pages`, {
    params: {
      skip: options.skip ?? 0,
      take: options.take ?? 100,
    },
  });
  return parsePageTemplateSourcePageListResponse(response.data);
}

export async function getPageTemplate(
  spaceId: string,
  templateId: string,
  locale: PageTemplateLocale,
): Promise<PageTemplateDetail> {
  const response = await api.get(templatePath(spaceId, templateId), { params: { locale } });
  return parsePageTemplateDetail(response.data);
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
