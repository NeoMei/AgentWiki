import { z } from 'zod';

/**
 * Job state and work items for the deterministic Orchestrator state machine.
 * State is persisted to local checkpoints so an interrupted Agent can resume.
 */

export const JobPhaseSchema = z.enum([
  'idle',
  'discover',
  'collect',
  'organize',
  'validate',
  'preview',
  'confirm',
  'push',
  'pull',
  'merge',
  'done',
  'failed',
]);

export type JobPhase = z.infer<typeof JobPhaseSchema>;

export const WorkItemTypeSchema = z.enum([
  'inspect-adapter',
  'collect-artifacts',
  'organize-page',
  'organize-memory',
  'organize-relation',
  'validate-item',
  'repair-item',
  'resolve-conflict',
  'confirm-push',
  'materialize-pull',
]);

export type WorkItemType = z.infer<typeof WorkItemTypeSchema>;

export const WorkItemSchema = z.object({
  workItemId: z.string().min(1),
  jobId: z.string().min(1),
  type: WorkItemTypeSchema,
  phase: JobPhaseSchema,
  artifactIds: z.array(z.string().min(1)).optional(),
  itemIds: z.array(z.string().min(1)).optional(),
  instructions: z.string().min(1),
  contextBudget: z.object({
    tokens: z.number().int().positive().optional(),
    artifacts: z.number().int().positive().optional(),
  }).optional(),
  attempts: z.number().int().nonnegative().default(0),
  maxAttempts: z.number().int().positive().default(3),
  status: z.enum(['pending', 'in-progress', 'completed', 'failed']).default('pending'),
  result: z.record(z.unknown()).optional(),
  error: z.string().optional(),
});

export type WorkItem = z.infer<typeof WorkItemSchema>;

export const JobStateSchema = z.object({
  jobId: z.string().min(1),
  spaceId: z.string().min(1),
  recipeId: z.string().min(1),
  recipeVersion: z.string().min(1),
  phase: JobPhaseSchema,
  adapterIds: z.array(z.string().min(1)),
  sourcePaths: z.array(z.string().min(1)),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  workItems: z.array(WorkItemSchema),
  checkpoint: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type JobState = z.infer<typeof JobStateSchema>;

export function assertJobPhase(value: unknown): JobPhase {
  return JobPhaseSchema.parse(value);
}

export function assertWorkItemType(value: unknown): WorkItemType {
  return WorkItemTypeSchema.parse(value);
}

export function assertWorkItem(value: unknown): WorkItem {
  return WorkItemSchema.parse(value);
}

export function assertJobState(value: unknown): JobState {
  return JobStateSchema.parse(value);
}
