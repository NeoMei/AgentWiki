import api from '../../api/client';
import type {
  CreateTemplateInput,
  RunListKind,
  RunSummary,
  SpaceMemberSummary,
  TemplateDetail,
  TemplateSummary,
  UpdateTemplateInput,
  ValidationResult,
} from './types';

const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

export const collaborationApi = {
  listTemplates: async (spaceId: string): Promise<TemplateSummary[]> =>
    (await api.get<TemplateSummary[]>(`/spaces/${spaceId}/collaboration/templates`)).data,
  getTemplate: async (spaceId: string, templateId: string): Promise<TemplateDetail> =>
    (await api.get<TemplateDetail>(`/spaces/${spaceId}/collaboration/templates/${templateId}`)).data,
  createTemplate: async (spaceId: string, input: CreateTemplateInput): Promise<TemplateDetail> =>
    (await api.post<TemplateDetail>(`/spaces/${spaceId}/collaboration/templates`, input)).data,
  copyTemplate: async (spaceId: string, templateId: string, name: string): Promise<TemplateSummary> =>
    (await api.post<TemplateSummary>(`/spaces/${spaceId}/collaboration/templates/${templateId}/copy`, { name })).data,
  validateTemplate: async (spaceId: string, definition: unknown): Promise<ValidationResult> =>
    (await api.post<ValidationResult>(`/spaces/${spaceId}/collaboration/templates/validate`, { definition })).data,
  updateTemplate: async (spaceId: string, templateId: string, input: UpdateTemplateInput): Promise<TemplateDetail> =>
    (await api.put<TemplateDetail>(`/spaces/${spaceId}/collaboration/templates/${templateId}`, input)).data,
  archiveTemplate: async (spaceId: string, templateId: string, expectedVersion: number): Promise<TemplateDetail> =>
    (await api.post<TemplateDetail>(`/spaces/${spaceId}/collaboration/templates/${templateId}/archive`, { expectedVersion })).data,
  listRuns: async (spaceId: string, kind: RunListKind): Promise<RunSummary[]> => {
    const runs = (await api.get<RunSummary[]>(`/spaces/${spaceId}/collaboration/runs`, { params: { status: kind } })).data;
    return runs.filter((run) => kind === 'history' ? TERMINAL.has(run.status) : !TERMINAL.has(run.status));
  },
  listMembers: async (spaceId: string): Promise<SpaceMemberSummary[]> =>
    (await api.get<SpaceMemberSummary[]>(`/spaces/${spaceId}/members`)).data,
};

