import { BadRequestException } from '@nestjs/common';
import * as schema from './page-note.schema';

const parse = (raw: unknown) => (schema as typeof schema & {
  parseNoteDiscoveryQuery(value: unknown): { query: string; author: string; status: string; limit: number; spaceId?: string; cursor?: string };
}).parseNoteDiscoveryQuery(raw);

describe('note discovery query validation', () => {
  it('defaults to all accessible notes and normalizes a literal search', () => {
    expect(parse({})).toEqual({ query: '', author: 'all', status: 'all', limit: 20 });
    expect(parse({ query: '  quotation  ', spaceId: 'space', limit: '50', author: 'mentioned', status: 'open' }))
      .toEqual({ query: 'quotation', spaceId: 'space', limit: 50, author: 'mentioned', status: 'open' });
  });
  it.each([{ limit: '0' }, { limit: 51 }, { limit: [] }, { limit: true }, { query: ['x'] }, { query: 'x'.repeat(201) },
    { author: 'private' }, { status: 'pending' }, { spaceId: ' ' }, { cursor: 'x'.repeat(1025) }, { extra: true }])('rejects unsupported or unbounded query %j', raw => {
    expect(() => parse(raw)).toThrow(BadRequestException);
  });
});
