import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

const id = z.string().trim().min(1).max(100);
const timestamp = z.string().datetime({ offset: true });
export const NOTE_STATUS = z.enum(['pending', 'dispatched', 'awaiting-review', 'resolved']);
export const NOTE_TARGET = z.object({
  kind: z.literal('selection'),
  from: z.number().int().min(0).max(200000),
  to: z.number().int().min(1).max(200000),
  quote: z.string().min(1).max(200000),
  prefix: z.string().max(256),
  suffix: z.string().max(256),
  baseUpdatedAt: timestamp,
}).strict().refine(target => target.to > target.from
  && target.to - target.from === target.quote.length && target.from >= target.prefix.length,
{ message: 'Invalid UTF-16 selection offsets' });
export const NOTE_CREATE_FIELDS = {
  clientNoteId: id,
  body: z.string().trim().min(1).max(10000),
  target: NOTE_TARGET,
  status: NOTE_STATUS.optional(),
  taskId: id.optional(),
  recipientUserIds: z.array(id).max(50).optional(),
};
export const NOTE_CREATE = z.object(NOTE_CREATE_FIELDS).strict();
export const NOTE_UPDATE_FIELDS = {
  expectedUpdatedAt: timestamp,
  body: z.string().trim().min(1).max(10000).optional(),
  target: NOTE_TARGET.optional(),
  status: NOTE_STATUS.optional(),
  taskId: id.nullable().optional(),
};
export const NOTE_UPDATE = z.object(NOTE_UPDATE_FIELDS).strict().refine(input =>
  input.body !== undefined || input.target !== undefined || input.status !== undefined || input.taskId !== undefined,
{ message: 'Provide a note change' });
export const NOTE_DELETE = z.object({ expectedUpdatedAt: timestamp }).strict();
export const NOTE_ROUTE = z.object({ spaceId: id, pageId: id }).strict();
export const NOTE_ID = id;

const discoveryLimit = z.union([
  z.number(),
  z.string().regex(/^[1-9]\d*$/).transform(Number),
]).pipe(z.number().int().min(1).max(50)).default(20);
export const NOTE_DISCOVERY_QUERY = z.object({
  query: z.string().max(200).transform(value => value.trim()).default(''),
  spaceId: id.optional(),
  author: z.enum(['all', 'me', 'mentioned']).default('all'),
  status: z.enum(['all', 'open', 'resolved']).default('all'),
  cursor: z.string().min(1).max(512).regex(/^[A-Za-z0-9_-]+$/).optional(),
  limit: discoveryLimit,
}).strict();
export type NoteDiscoveryQuery = z.infer<typeof NOTE_DISCOVERY_QUERY>;
export const parseNoteDiscoveryQuery = (raw: unknown): NoteDiscoveryQuery => parseNoteInput(NOTE_DISCOVERY_QUERY, raw ?? {});

export function parseNoteInput<Schema extends z.ZodTypeAny>(schema: Schema, raw: unknown): z.output<Schema> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new BadRequestException({ code: 'PAGE_NOTE_INVALID', message: 'Invalid page note', details: parsed.error.flatten() });
  return parsed.data;
}
