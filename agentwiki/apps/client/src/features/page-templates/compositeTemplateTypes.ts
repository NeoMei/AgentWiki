import type { CollaborationTemplateDefinition } from '@neomei/agentwiki-sync-protocol';
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
  capabilities: { canManage: boolean };
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

export type { CollaborationTemplateDefinition, RoleBinding, SpaceMemberSummary };
