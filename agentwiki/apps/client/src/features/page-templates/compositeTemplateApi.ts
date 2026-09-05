import api from '../../api/client';
import type {
  CompositeInstantiationResult,
  CompositeTemplateManagementDetail,
  CompositeTemplateWriteResult,
  CompositePreviewInputPayload,
  CompositeTemplateCatalog,
  CompositeTemplateKind,
  CompositeTemplateLocale,
  CompositeTemplatePreview,
  ExistingRunPreview,
  FolderCollaborationSource,
  FolderAgentBindingPreview,
  FolderSnapshotPreview,
  FolderSnapshotSelection,
  LegacyWorkflowUpgradeInput,
  LegacyWorkflowUpgradePreview,
  LegacyWorkflowUpgradeSource,
  PageAgentBindingEdit,
  PageAgentBindingSnapshot,
  SaveFolderTemplateInput,
} from './compositeTemplateTypes';
import type { CompositeTemplateDefinition } from '@neomei/agentwiki-sync-protocol';

const segment = (value: string) => encodeURIComponent(value);
const spacePath = (spaceId: string) => `/spaces/${segment(spaceId)}`;

export async function listCompositeTemplates(spaceId: string, options: {
  locale: CompositeTemplateLocale;
  scope?: 'all' | 'system' | 'space';
  kind?: CompositeTemplateKind;
  archived?: 'active' | 'archived' | 'all';
  category?: 'planning' | 'reporting' | 'knowledge' | 'other';
  supportsCollaboration?: boolean;
  q?: string;
  skip?: number;
  take?: number;
  signal?: AbortSignal;
}): Promise<CompositeTemplateCatalog> {
  return (await api.get<CompositeTemplateCatalog>(`${spacePath(spaceId)}/templates`, {
    params: {
      locale: options.locale,
      scope: options.scope ?? 'all',
      ...(options.kind ? { kind: options.kind } : {}),
      archived: options.archived ?? 'active', skip: options.skip ?? 0, take: options.take ?? 100,
      ...(options.category ? { category: options.category } : {}),
      ...(options.supportsCollaboration === undefined ? {} : { supportsCollaboration: options.supportsCollaboration }),
      ...(options.q?.trim() ? { q: options.q.trim() } : {}),
    },
    signal: options.signal,
  })).data;
}

export async function getCompositeTemplateManagement(
  spaceId: string,
  templateId: string,
  version: number,
  locale: CompositeTemplateLocale,
): Promise<CompositeTemplateManagementDetail> {
  return (await api.get<CompositeTemplateManagementDetail>(
    `${spacePath(spaceId)}/templates/${segment(templateId)}/management`,
    { params: { version, locale } },
  )).data;
}

export async function updateCompositeTemplateMetadata(spaceId: string, templateId: string, input: {
  name: string;
  description?: string;
  category: 'planning' | 'reporting' | 'knowledge' | 'other';
  defaultTitle: string;
  expectedUpdatedAt: string;
}): Promise<CompositeTemplateWriteResult> {
  return (await api.patch<CompositeTemplateWriteResult>(
    `${spacePath(spaceId)}/templates/${segment(templateId)}`, input,
  )).data;
}

export async function createCompositeTemplateVersion(spaceId: string, templateId: string, input: {
  expectedCurrentVersion: number;
  definition: CompositeTemplateDefinition;
}): Promise<CompositeTemplateWriteResult> {
  return (await api.post<CompositeTemplateWriteResult>(
    `${spacePath(spaceId)}/templates/${segment(templateId)}/versions`, input,
  )).data;
}

export async function archiveCompositeTemplate(
  spaceId: string, templateId: string, expectedUpdatedAt: string,
): Promise<CompositeTemplateWriteResult> {
  return (await api.delete<CompositeTemplateWriteResult>(
    `${spacePath(spaceId)}/templates/${segment(templateId)}`, { data: { expectedUpdatedAt } },
  )).data;
}

export async function restoreCompositeTemplate(
  spaceId: string, templateId: string, expectedUpdatedAt: string,
): Promise<CompositeTemplateWriteResult> {
  return (await api.post<CompositeTemplateWriteResult>(
    `${spacePath(spaceId)}/templates/${segment(templateId)}/restore`, { expectedUpdatedAt },
  )).data;
}

export async function previewFolderTemplate(
  spaceId: string,
  rootFolderId: string,
  selection: FolderSnapshotSelection,
  signal?: AbortSignal,
): Promise<FolderSnapshotPreview> {
  return (await api.post<FolderSnapshotPreview>(`${spacePath(spaceId)}/templates/from-folder/preview`, {
    rootFolderId, selection,
  }, { signal })).data;
}

export async function saveFolderTemplate(
  spaceId: string,
  input: SaveFolderTemplateInput,
): Promise<CompositeTemplateWriteResult> {
  return (await api.post<CompositeTemplateWriteResult>(
    `${spacePath(spaceId)}/templates/from-folder`, input,
  )).data;
}

export async function discoverFolderCollaborationSource(
  spaceId: string,
  folderId: string,
): Promise<FolderCollaborationSource> {
  return (await api.get<FolderCollaborationSource>(
    `${spacePath(spaceId)}/folders/${segment(folderId)}/collaboration-source`,
  )).data;
}

export async function getLegacyWorkflowUpgradeSource(
  spaceId: string,
  legacyId: string,
): Promise<LegacyWorkflowUpgradeSource> {
  return (await api.get<LegacyWorkflowUpgradeSource>(
    `${spacePath(spaceId)}/collaboration-templates/${segment(legacyId)}/upgrade/source`,
  )).data;
}

export async function previewLegacyWorkflowUpgrade(
  spaceId: string,
  legacyId: string,
  input: LegacyWorkflowUpgradeInput,
): Promise<LegacyWorkflowUpgradePreview> {
  return (await api.post<LegacyWorkflowUpgradePreview>(
    `${spacePath(spaceId)}/collaboration-templates/${segment(legacyId)}/upgrade/preview`, input,
  )).data;
}

export async function upgradeLegacyWorkflow(
  spaceId: string,
  legacyId: string,
  input: LegacyWorkflowUpgradeInput,
): Promise<CompositeTemplateWriteResult & { resultVersion: number }> {
  return (await api.post<CompositeTemplateWriteResult & { resultVersion: number }>(
    `${spacePath(spaceId)}/collaboration-templates/${segment(legacyId)}/upgrade`, input,
  )).data;
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
