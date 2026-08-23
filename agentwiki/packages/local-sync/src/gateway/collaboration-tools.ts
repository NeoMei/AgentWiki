import { z } from 'zod';
import {
  CollaborationGetRunInputSchema,
  CollaborationHeartbeatInputSchema,
  CollaborationJoinRunInputSchema,
  CollaborationNextActionInputSchema,
  CollaborationSubmitResultInputSchema,
  CollaborationUpdateTodoInputSchema,
} from '@neomei/agentwiki-sync-protocol';

export const COLLABORATION_REMOTE_INPUT_SCHEMAS: Record<string, z.ZodRawShape> = {
  collaboration_join_run: CollaborationJoinRunInputSchema.shape,
  collaboration_next_action: CollaborationNextActionInputSchema.shape,
  collaboration_heartbeat: CollaborationHeartbeatInputSchema.shape,
  collaboration_update_todo: CollaborationUpdateTodoInputSchema.shape,
  collaboration_submit_result: CollaborationSubmitResultInputSchema.shape,
  collaboration_get_run: CollaborationGetRunInputSchema.shape,
};

export function exactRemoteToolSchema(name: string): z.ZodRawShape | undefined {
  return COLLABORATION_REMOTE_INPUT_SCHEMAS[name];
}
