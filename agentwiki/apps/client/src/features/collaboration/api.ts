import api from '../../api/client';
import type {
  CreateTemplateInput,
  CollaborationRun,
  CollaborationRunDraftDetails,
  CollaborationHistoryKind,
  CollaborationHistoryPage,
  CreateRunDraftInput,
  RunListKind,
  RunSummary,
  SpaceMemberSummary,
  TemplateDetail,
  TemplateSummary,
  UpdateTemplateInput,
  UpdateRunDraftInput,
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
  createRunDraft: async (spaceId: string, input: CreateRunDraftInput): Promise<CollaborationRun> =>
    (await api.post<CollaborationRun>(`/spaces/${spaceId}/collaboration/runs/drafts`, input)).data,
  updateRunDraft: async (spaceId: string, runId: string, input: UpdateRunDraftInput): Promise<CollaborationRun> =>
    (await api.put<CollaborationRun>(`/spaces/${spaceId}/collaboration/runs/${runId}/draft`, input)).data,
  validateRunDraft: async (spaceId: string, runId: string, expectedVersion: number): Promise<CollaborationRun> =>
    (await api.post<CollaborationRun>(`/spaces/${spaceId}/collaboration/runs/${runId}/validate`, { expectedVersion })).data,
  startRun: async (
    spaceId: string,
    runId: string,
    input: { expectedVersion: number; idempotencyKey: string },
  ): Promise<CollaborationRun> =>
    (await api.post<CollaborationRun>(`/spaces/${spaceId}/collaboration/runs/${runId}/start`, input)).data,
  getRun: async (spaceId: string, runId: string): Promise<CollaborationRun> =>
    (await api.get<CollaborationRun>(`/spaces/${spaceId}/collaboration/runs/${runId}`)).data,
  getRunDraftDetails: async (spaceId: string, runId: string): Promise<CollaborationRunDraftDetails> =>
    (await api.get<CollaborationRunDraftDetails>(`/spaces/${spaceId}/collaboration/runs/${runId}/draft-details`)).data,
  getRunHistory: async <T = unknown>(
    spaceId: string,
    runId: string,
    kind: CollaborationHistoryKind,
    cursor?: string,
    limit = 50,
  ): Promise<CollaborationHistoryPage<T>> =>
    (await api.get<CollaborationHistoryPage<T>>(
      `/spaces/${spaceId}/collaboration/runs/${runId}/history/${kind}`,
      { params: { ...(cursor ? { cursor } : {}), limit } },
    )).data,
  pauseRun: async (spaceId: string, runId: string, input: RunActionInput): Promise<CollaborationRun> =>
    (await api.post<CollaborationRun>(`/spaces/${spaceId}/collaboration/runs/${runId}/actions/pause`, input)).data,
  resumeRun: async (spaceId: string, runId: string, input: RunActionInput): Promise<CollaborationRun> =>
    (await api.post<CollaborationRun>(`/spaces/${spaceId}/collaboration/runs/${runId}/actions/resume`, input)).data,
  failRun: async (spaceId: string, runId: string, input: RunActionInput): Promise<CollaborationRun> =>
    (await api.post<CollaborationRun>(`/spaces/${spaceId}/collaboration/runs/${runId}/actions/fail`, input)).data,
  cancelRun: async (spaceId: string, runId: string, input: RunActionInput): Promise<CollaborationRun> =>
    (await api.post<CollaborationRun>(`/spaces/${spaceId}/collaboration/runs/${runId}/actions/cancel`, input)).data,
  retryTask: async (spaceId: string, runId: string, taskId: string, input: RunActionInput): Promise<CollaborationRun> =>
    (await api.post<CollaborationRun>(`/spaces/${spaceId}/collaboration/runs/${runId}/tasks/${taskId}/retry`, input)).data,
  reassignTask: async (spaceId: string, runId: string, taskId: string, input: RunActionInput & { agentId: string }): Promise<CollaborationRun> =>
    (await api.post<CollaborationRun>(`/spaces/${spaceId}/collaboration/runs/${runId}/tasks/${taskId}/reassign`, input)).data,
  skipTask: async (spaceId: string, runId: string, taskId: string, input: RunActionInput): Promise<CollaborationRun> =>
    (await api.post<CollaborationRun>(`/spaces/${spaceId}/collaboration/runs/${runId}/tasks/${taskId}/skip`, input)).data,
  decideReview: async (
    spaceId: string,
    runId: string,
    reviewId: string,
    input: { kind: 'approve' | 'reject_for_revision' | 'terminate'; reason: string; idempotencyKey: string },
  ): Promise<CollaborationRun> =>
    (await api.post<CollaborationRun>(`/spaces/${spaceId}/collaboration/runs/${runId}/reviews/${reviewId}/decision`, input)).data,
};

export interface RunActionInput {
  reason: string;
  idempotencyKey: string;
}
