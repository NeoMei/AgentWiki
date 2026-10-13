import { z } from 'zod';

const id = z.string().min(1).max(100);
const timestamp = z.string().datetime({ offset: true });
const scope = { spaceId: id, pageId: id };
const status = z.enum(['pending', 'dispatched', 'awaiting-review', 'resolved']);
const target = z.object({
  kind: z.literal('selection'), from: z.number().int().min(0).max(200000), to: z.number().int().min(1).max(200000),
  quote: z.string().min(1).max(200000), prefix: z.string().max(256), suffix: z.string().max(256), baseUpdatedAt: timestamp,
}).strict();
export const PAGE_NOTE_REMOTE_INPUT_SCHEMAS: Record<string, z.ZodRawShape> = {
  list_page_notes: scope,
  create_page_note: { ...scope, clientNoteId: id, body: z.string().trim().min(1).max(10000), target, status: status.optional(), taskId: id.optional() },
  update_page_note: { ...scope, noteId: id, expectedUpdatedAt: timestamp, body: z.string().trim().min(1).max(10000).optional(), target: target.optional(), status: status.optional(), taskId: id.nullable().optional() },
  delete_page_note: { ...scope, noteId: id, expectedUpdatedAt: timestamp },
};
