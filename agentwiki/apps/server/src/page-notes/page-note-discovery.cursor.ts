import { createHash } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import type { Principal } from '../core/authorization/authorization.service';
import type { NoteDiscoveryQuery } from './page-note.schema';

const cursorSchema = z.object({
  v: z.literal(1),
  updatedAt: z.string().datetime({ offset: true }),
  id: z.string().min(1).max(100),
  scope: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

export function noteDiscoveryScope(principal: Principal, query: NoteDiscoveryQuery): string {
  return createHash('sha256').update(JSON.stringify([
    principal.userId, principal.agentId ?? null, query.spaceId ?? null, query.query, query.author, query.status,
  ])).digest('hex');
}

export function decodeNoteDiscoveryCursor(encoded: string | undefined, scope: string) {
  if (!encoded) return null;
  try {
    const bytes = Buffer.from(encoded, 'base64url');
    if (bytes.toString('base64url') !== encoded) throw new Error('Non-canonical cursor');
    const cursor = cursorSchema.parse(JSON.parse(bytes.toString('utf8')));
    if (cursor.scope !== scope) throw new Error('Cursor does not match this search');
    return { id: cursor.id, updatedAt: new Date(cursor.updatedAt) };
  } catch {
    throw new BadRequestException({ code: 'PAGE_NOTE_CURSOR_INVALID', message: 'Invalid note search cursor; start the search again' });
  }
}

export function encodeNoteDiscoveryCursor(note: { id: string; updatedAt: Date }, scope: string): string {
  return Buffer.from(JSON.stringify({ v: 1, id: note.id, updatedAt: note.updatedAt.toISOString(), scope })).toString('base64url');
}
