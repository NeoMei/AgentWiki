import api from '../../api/client';
import type {
  CompositeInstantiationResult,
  CompositePreviewInputPayload,
  CompositeTemplateCatalog,
  CompositeTemplateKind,
  CompositeTemplateLocale,
  CompositeTemplatePreview,
  ExistingRunPreview,
  FolderAgentBindingPreview,
  PageAgentBindingEdit,
  PageAgentBindingSnapshot,
} from './compositeTemplateTypes';

const segment = (value: string) => encodeURIComponent(value);
const spacePath = (spaceId: string) => `/spaces/${segment(spaceId)}`;

export async function listCompositeTemplates(spaceId: string, options: {
  locale: CompositeTemplateLocale;
  scope?: 'all' | 'system' | 'space';
  kind?: CompositeTemplateKind;
  skip?: number;
  take?: number;
  signal?: AbortSignal;
}): Promise<CompositeTemplateCatalog> {
  return (await api.get<CompositeTemplateCatalog>(`${spacePath(spaceId)}/templates`, {
    params: {
      locale: options.locale,
      scope: options.scope ?? 'all',
      ...(options.kind ? { kind: options.kind } : {}),
      archived: 'active', skip: options.skip ?? 0, take: options.take ?? 100,
    },
    signal: options.signal,
  })).data;
}

export async function previewCompositeTemplate(spaceId: string, templateId: string,
  input: CompositePreviewInputPayload, signal?: AbortSignal): Promise<CompositeTemplatePreview> {
  return (await api.post<CompositeTemplatePreview>(
    `${spacePath(spaceId)}/templates/${segment(templateId)}/preview`, input, { signal },
  )).data;
}

export async function instantiateCompositeTemplate(spaceId: string, templateId: string,
  input: CompositePreviewInputPayload & { expectedTreeRevision: string; idempotencyKey: string },
  signal?: AbortSignal): Promise<CompositeInstantiationResult> {
  return (await api.post<CompositeInstantiationResult>(
    `${spacePath(spaceId)}/templates/${segment(templateId)}/instantiate`, input, { signal },
  )).data;
}

export async function getPageAgentBinding(spaceId: string, pageId: string): Promise<PageAgentBindingSnapshot> {
  return (await api.get<PageAgentBindingSnapshot>(`${spacePath(spaceId)}/pages/${segment(pageId)}/agent-binding`)).data;
}

export async function setPageAgentBinding(spaceId: string, pageId: string, input: {
  agentId: string | null; roleSlotKey: string | null; expectedUpdatedAt: string | null; expectedTreeRevision: string;
}): Promise<PageAgentBindingSnapshot[]> {
  return (await api.put<PageAgentBindingSnapshot[]>(`${spacePath(spaceId)}/pages/${segment(pageId)}/agent-binding`, input)).data;
}

export async function deletePageAgentBinding(spaceId: string, pageId: string, input: {
  expectedUpdatedAt: string | null; expectedTreeRevision: string;
}): Promise<PageAgentBindingSnapshot[]> {
  return (await api.delete<PageAgentBindingSnapshot[]>(`${spacePath(spaceId)}/pages/${segment(pageId)}/agent-binding`, { data: input })).data;
}

export async function previewFolderAgentBindings(spaceId: string, folderId: string, pageIds?: string[], signal?: AbortSignal): Promise<FolderAgentBindingPreview> {
  return (await api.post<FolderAgentBindingPreview>(
    `${spacePath(spaceId)}/folders/${segment(folderId)}/agent-bindings/preview`, pageIds ? { pageIds } : {}, { signal },
  )).data;
}

export async function setFolderAgentBindings(spaceId: string, folderId: string, input: {
  pageIds: string[]; expectedTreeRevision: string; edits: PageAgentBindingEdit[];
}): Promise<PageAgentBindingSnapshot[]> {
  return (await api.post<PageAgentBindingSnapshot[]>(`${spacePath(spaceId)}/folders/${segment(folderId)}/agent-bindings`, input)).data;
}

type PageRunPayload = {
  name: string;
  collaborationInputs: Record<string, string | number | boolean>;
  bindings: Array<{ kind: 'task_default' | 'role_override'; nodeId?: string; roleSlotId: string; agentId: string }>;
  bindingEdits?: PageAgentBindingEdit[];
  roleSlotKey?: string;
  expectedTreeRevision: string;
  idempotencyKey: string;
};

export async function previewExistingPageRun(spaceId: string, pageId: string,
  input: Omit<PageRunPayload, 'name' | 'expectedTreeRevision' | 'idempotencyKey'>,
  signal?: AbortSignal): Promise<ExistingRunPreview> {
  return (await api.post<ExistingRunPreview>(`${spacePath(spaceId)}/pages/${segment(pageId)}/collaboration-runs/preview`, input, { signal })).data;
}

export async function startExistingPageRun(spaceId: string, pageId: string, input: PageRunPayload,
  signal?: AbortSignal): Promise<{ runId: string }> {
  return (await api.post<{ runId: string }>(`${spacePath(spaceId)}/pages/${segment(pageId)}/collaboration-runs`, input, { signal })).data;
}

export async function startExistingFolderRun(spaceId: string, folderId: string, input: {
  source: { kind: 'page_selection' };
  pageIds: string[];
  collaborationInputs: Record<string, string | number | boolean>;
  bindings: Array<{ kind: 'task_default' | 'role_override'; nodeId?: string; roleSlotId: string; agentId: string }>;
  bindingEdits: PageAgentBindingEdit[];
  roleSlotsByPage: Array<{ pageId: string; roleSlotKey: string | null }>;
  name: string;
  expectedTreeRevision: string;
  idempotencyKey: string;
}, signal?: AbortSignal): Promise<{ runId: string }> {
  return (await api.post<{ runId: string }>(`${spacePath(spaceId)}/folders/${segment(folderId)}/collaboration-runs`, input, { signal })).data;
}
