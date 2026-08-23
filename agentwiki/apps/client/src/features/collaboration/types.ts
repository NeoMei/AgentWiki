import type { CollaborationTemplateDefinition } from '@neomei/agentwiki-sync-protocol';

export type HumanSpaceRole = 'owner' | 'admin' | 'editor' | 'viewer';

export interface SpaceMemberSummary {
  type: 'human' | 'agent';
  userId?: string;
  role: string;
}

export interface TemplateSummary {
  id: string;
  spaceId: string | null;
  slug: string;
  name: string;
  description: string;
  system: boolean;
  version: number;
  definition?: CollaborationTemplateDefinition;
  archivedAt?: string | null;
  updatedAt?: string;
}

export interface TemplateDetail extends TemplateSummary {
  definition: CollaborationTemplateDefinition;
}

export interface CreateTemplateInput {
  name: string;
  slug?: string;
  description?: string;
  definition: CollaborationTemplateDefinition;
}

export interface UpdateTemplateInput {
  expectedVersion: number;
  name?: string;
  description?: string;
  definition: CollaborationTemplateDefinition;
}

export interface ValidationIssue {
  code: string;
  path?: string;
  message?: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

export type CollaborationRunStatus =
  | 'draft' | 'ready' | 'running' | 'waiting_review' | 'paused' | 'retry_wait'
  | 'completed' | 'failed' | 'cancelled';

export interface RunSummary {
  id: string;
  name: string;
  status: CollaborationRunStatus;
  templateId?: string;
  updatedAt: string;
  startedAt?: string | null;
  finishedAt?: string | null;
}

export type RunListKind = 'active' | 'history';

