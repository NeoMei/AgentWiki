import type {
  CollaborationTemplateDefinition,
  CompositeTemplateDefinition,
  TemplateNode,
} from '@neomei/agentwiki-sync-protocol';
import type { RoleBinding, RunJoinInstruction, SpaceMemberSummary } from '../collaboration/types';

export type CompositeTemplateLocale = 'zh-CN' | 'en';
export type CompositeTemplateKind = 'single_page' | 'page_group';
export type CompositeTemplateScope = 'system' | 'space';

export interface CompositeTemplateSummary {
  id: string;
  scope: CompositeTemplateScope;
  stableKey: string;
  category: 'planning' | 'reporting' | 'knowledge' | 'other';
  kind: CompositeTemplateKind;
  storageKind?: 'legacy_content' | 'definition';
  supportsCollaboration: boolean;
  effectiveSupportsCollaboration: boolean;
  pageCount: number;
  folderCount: number;
  roleCount: number;
  name: string;
  description: string;
  defaultTitle: string;
  sourceLocale: CompositeTemplateLocale | null;
  currentVersion: number;
  archivedAt: string | null;
  updatedAt: string;
}

export interface CompositeTemplateCatalog {
  data: CompositeTemplateSummary[];
  total: number;
  skip: number;
  take: number;
  capabilities: { canManage: boolean; canCreate: boolean };
}

export interface CompositeTemplateManagementDetail {
  templateId: string;
  scope: CompositeTemplateScope;
  stableKey: string;
  category: CompositeTemplateSummary['category'];
  name: string;
  description: string;
  defaultTitle: string;
  sourceLocale: CompositeTemplateLocale | null;
  currentVersion: number;
  version: number;
  archivedAt: string | null;
  updatedAt: string;
  locale: CompositeTemplateLocale;
  definitionHash: string;
  definition: CompositeTemplateDefinition;
  resultVersion?: number;
  noChange?: boolean;
}

/** Mutation shape returned by the composite write entrypoints (distinct from exact-version management reads). */
export interface CompositeTemplateWriteResult extends CompositeTemplateSummary {
  definitionHash: string;
  definition: CompositeTemplateDefinition;
  sourcePageId?: string | null;
  resultVersion?: number;
  noChange?: boolean;
}

export type FolderWorkflowSource =
  | { kind: 'structure_only' }
  | { kind: 'simple_pages' }
  | { kind: 'template'; versionId: string }
  | { kind: 'legacy_workflow'; templateId: string; version: number; taskTargets: Array<{ taskNodeId: string; pageId: string }> };

export interface FolderSnapshotSelection {
  excludedFolderIds: string[];
  excludedPageIds: string[];
  locale: CompositeTemplateLocale;
  roleSlotsByPage?: Array<{ pageId: string; roleSlotKey: string | null }>;
  source: FolderWorkflowSource;
}

export type FolderSourceNode =
  | { templateNodeId: string; sourceNodeId: string; parentSourceNodeId: string | null; parentTemplateNodeId: string | null; kind: 'folder'; name: string }
  | { templateNodeId: string; sourceNodeId: string; parentSourceNodeId: string; parentTemplateNodeId: string; kind: 'page'; title: string };

export interface FolderSnapshotWarning {
  code: 'ATTACHMENTS_NOT_COPIED' | 'SOURCE_CONTENT_REVIEW_REQUIRED';
  affectedPageIds: string[];
  message: string;
}

export interface FolderSourceToken {
  digest: string;
  treeRevision: string;
  pages: Array<{
    pageId: string;
    updatedAt: string;
    titleHash: string;
    contentHash: string;
    matchingPageVersionId: string | null;
  }>;
  workflowSource: Record<string, unknown>;
}

export interface FolderSnapshotPreview {
  definition: CompositeTemplateDefinition;
  tree: TemplateNode[];
  roles: CollaborationTemplateDefinition['roleSlots'];
  sourceNodes: FolderSourceNode[];
  warnings: FolderSnapshotWarning[];
  sourceToken: FolderSourceToken;
}

export interface SaveFolderTemplateInput {
  rootFolderId: string;
  selection: FolderSnapshotSelection;
  sourceToken: FolderSourceToken;
  acknowledgedWarnings: string[];
  name: string;
  description?: string;
  defaultTitle: string;
  category: CompositeTemplateSummary['category'];
  locale: CompositeTemplateLocale;
}

export interface LegacyWorkflowUpgradeSource {
  legacyId: string;
  version: number;
  definitionHash: string;
  definition: CollaborationTemplateDefinition;
}

export interface LegacyWorkflowUpgradeInput {
  expectedLegacyVersion: number;
  expectedLegacyDefinitionHash: string;
  name: string;
  description?: string;
  defaultTitle: string;
  category: CompositeTemplateSummary['category'];
  locale: CompositeTemplateLocale;
  nodes: TemplateNode[];
  taskTargets: Array<{ taskNodeId: string; pageNodeId: string }>;
}

export interface LegacyWorkflowUpgradePreview {
  definition: CompositeTemplateDefinition;
  definitionHash: string;
  upgradeRequestHash: string;
  issues: Array<{ code: string; nodeId?: string }>;
}

export interface FolderCollaborationSource {
  source: null | {
    sourceInstantiationId: string;
    compositeTemplateVersionId: string;
    templateId: string;
    templateVersion: number;
    rootFolderId: string;
    nodes: Array<{ templateNodeId: string; kind: 'folder' | 'page'; folderId: string | null; pageId: string | null }>;
  };
}

export type ExpandedTemplateNode =
  | { nodeId: string; parentNodeId: string | null; kind: 'folder'; order: number; name: string }
  | { nodeId: string; parentNodeId: string | null; kind: 'page'; order: number; title: string; content: string };

export interface CompositePreviewIssue { code: string; [key: string]: unknown }
export interface CompositePreviewRole { id: string; name: string; description: string; required: boolean }
export interface CompositePreviewInput { key: string; label: string; required: boolean; type: 'short_text' | 'long_text' | 'number' | 'boolean' | 'url' }
export interface CompositePreviewTask { nodeId: string; name: string; roleSlotId: string; outputKind?: string; humanAcceptance?: boolean }

export interface CompositeTemplatePreview {
  templateId?: string;
  templateVersion?: number;
  locale?: CompositeTemplateLocale;
  definitionHash?: string;
  treeRevision: string;
  nodes: ExpandedTemplateNode[];
  pageCount: number;
  folderCount: number;
  roleCount: number;
  roles: CompositePreviewRole[];
  inputs: CompositePreviewInput[];
  inputValues: Record<string, string | number | boolean>;
  tasks: CompositePreviewTask[];
  assignments: Array<{ nodeId: string; roleSlotId: string; agentId: string }>;
  participants: string[];
  issues: CompositePreviewIssue[];
}

export interface CompositePreviewInputPayload {
  templateVersion: number;
  locale: CompositeTemplateLocale;
  rootName?: string;
  variables: Record<string, never>;
  collaborationEnabled: boolean;
  collaborationInputs?: Record<string, string | number | boolean>;
  roleBindings?: Array<{
    kind: 'task_default' | 'role_override'; nodeId?: string; roleSlotId: string; agentId: string;
  }>;
  enabledTaskNodeIds?: string[];
  expectedTreeRevision?: string;
  targetParentFolderId?: string | null;
}

export interface CompositeInstantiationResult {
  instantiationId: string;
  rootFolderId: string | null;
  pageIds: string[];
  runId: string | null;
  treeRevision: string;
}

export interface PageAgentBindingSnapshot {
  pageId: string;
  title?: string;
  agentId: string | null;
  roleSlotKey: string | null;
  updatedAt: string | null;
}

export interface PageAgentBindingEdit {
  pageId: string;
  agentId: string | null;
  roleSlotKey: string | null;
  expectedUpdatedAt: string | null;
}

export interface FolderAgentBindingPreview {
  treeRevision: string;
  pages: PageAgentBindingSnapshot[];
}

export interface ExistingRunPreview {
  treeRevision: string;
  pageIds: string[];
  pages: Array<{ pageId: string; title: string }>;
  inputs: Record<string, string | number | boolean>;
  inputDefinitions: CompositePreviewInput[];
  roles: CompositePreviewRole[];
  tasks: CompositePreviewTask[];
  assignments: Array<{ nodeId: string; roleSlotId: string; agentId: string }>;
  participants: string[];
  issues: CompositePreviewIssue[];
}

export interface CreationRunResult {
  id: string;
  roleBindings: RoleBinding[];
  joinInstructions?: RunJoinInstruction[];
}

export type { CollaborationTemplateDefinition, CompositeTemplateDefinition, TemplateNode, RoleBinding, SpaceMemberSummary };
