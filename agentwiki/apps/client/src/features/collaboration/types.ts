import type { CollaborationTemplateDefinition } from '@neomei/agentwiki-sync-protocol';

export type HumanSpaceRole = 'owner' | 'admin' | 'editor' | 'viewer';

export interface SpaceMemberSummary {
  type: 'human' | 'agent';
  userId?: string;
  agentId?: string;
  role: string;
  agent?: { id: string; name: string; status: string; revokedAt?: string | null };
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
  templateVersion?: number;
  createdAt?: string;
  updatedAt: string;
  startedAt?: string | null;
  finishedAt?: string | null;
}

export interface RoleBinding {
  roleSlotId: string;
  roleSlotName?: string;
  agentId: string;
}

export interface RunJoinInstruction {
  agentId: string;
  roleSlotIds: string[];
  taskIds: string[];
}

export interface CollaborationRun extends RunSummary {
  spaceId?: string;
  templateId?: string;
  templateVersion?: number;
  snapshotHash?: string;
  version: number;
  inputs?: Record<string, string | number | boolean>;
  roleBindings: RoleBinding[];
  templateSnapshot?: CollaborationTemplateDefinition;
  joinInstructions?: RunJoinInstruction[];
  startedById?: string;
  pauseReason?: string | null;
  eventSequence?: number;
  createdAt?: string;
  tasks?: CollaborationTask[];
  dependencies?: Array<{ id: string; fromNodeId: string; toNodeId: string; mode: 'all' | 'any' }>;
  reviews?: CollaborationReview[];
  events?: CollaborationRunEvent[];
}

export interface CollaborationRunDraftDetails extends CollaborationRun {
  inputs: Record<string, string | number | boolean>;
}

export interface CollaborationTodo {
  id: string;
  ordinal: number;
  name: string;
  status: 'pending' | 'doing' | 'done' | 'failed';
  required: boolean;
  generation: number;
  summary?: string | null;
  evidence?: unknown;
}

export interface CollaborationAttempt {
  id: string;
  status: string;
  attemptNumber: number;
  agentId: string;
  leaseExpiresAt: string;
  maxExecutionAt?: string;
  failureCode?: string | null;
}

export interface CollaborationArtifact {
  id: string;
  taskId?: string;
  generation?: number;
  version: number;
  kind: string;
  status: string;
  payload?: unknown;
  evidence?: unknown;
  preview?: string;
  createdAt: string;
}

export interface CollaborationTask {
  id: string;
  nodeId: string;
  ordinal: number;
  name: string;
  objective?: string;
  objectivePreview?: string | null;
  roleSlotId: string;
  assigneeAgentId: string;
  status: string;
  generation: number;
  skippable: boolean;
  completedAt?: string | null;
  todos: CollaborationTodo[];
  todoCounts?: { total: number; pending: number; doing: number; done: number; failed: number };
  attempts: CollaborationAttempt[];
  artifacts: CollaborationArtifact[];
}

export interface CollaborationReview {
  id: string;
  nodeId: string;
  status: string;
  minimumRole: HumanSpaceRole;
  reviewerUserIds: string[];
  allowTerminate: boolean;
  revisionTaskId: string;
  artifactId: string;
  reason?: string | null;
  createdAt: string;
}

export interface CollaborationRunEvent {
  id: string;
  sequence: number;
  type: string;
  actorKind: string;
  operation: string;
  target: string;
  createdAt: string;
  metadata?: unknown;
}

export type CollaborationHistoryKind = 'events' | 'todos' | 'attempts' | 'artifacts' | 'reviews';

export interface CollaborationHistoryPage<T = unknown> {
  items: T[];
  nextCursor: string | null;
}

export interface CreateRunDraftInput {
  templateId: string;
  name: string;
  inputs: Record<string, string | number | boolean>;
  roleBindings: RoleBinding[];
}

export interface UpdateRunDraftInput {
  expectedVersion: number;
  name?: string;
  inputs?: Record<string, string | number | boolean>;
  roleBindings?: RoleBinding[];
}

export interface AgentInstruction {
  agentId: string;
  roleSlots: string[];
  text: string;
}

export type RunListKind = 'active' | 'history';

export interface RunListPage {
  items: RunSummary[];
  nextCursor: string | null;
}
