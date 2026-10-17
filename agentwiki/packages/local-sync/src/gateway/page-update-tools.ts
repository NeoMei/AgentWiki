import { z } from 'zod';
import { SAFE_SPACE_ID_PATTERN } from '../workspace/layout.js';

const fields = {
  spaceId: z.string().regex(SAFE_SPACE_ID_PATTERN).describe('Internal Space ID from wiki_list_spaces.'),
  pageId: z.string().min(1).max(100).describe('Existing Page ID from wiki_get_page.'),
  expectedUpdatedAt: z.string().datetime({ offset: true }).describe('Producer baseline updatedAt from wiki_get_page.'),
  expectedTreeRevision: z.string().regex(/^(?:0|[1-9]\d*)$/u).describe('Producer baseline treeRevision from wiki_list_folders.'),
  title: z.string().min(1).max(200).regex(/\S/u).optional(),
  content: z.string().max(200000).optional(),
  folderId: z.string().min(1).max(100).nullable().optional(),
};
const validated = z.object(fields).strict().refine(
  input => input.title !== undefined || input.content !== undefined || input.folderId !== undefined,
  { message: 'Provide at least one Page field to update: title, content or folderId' },
);
// Optional only at transport boundary: legacy callers supply required fields in __args.
const transport = z.object({
  ...Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, value.optional()])),
  __args: z.record(z.unknown()).describe('Legacy argument wrapper; duplicate named fields must agree.').optional(),
}).strict();

export function pageUpdateToolDefinition(name: string) {
  if (name !== 'propose_page_update') return undefined;
  return {
    inputSchema: transport,
    normalize(input: unknown): Record<string, unknown> {
      const { __args, ...direct } = transport.parse(input);
      const legacy = __args as Record<string, unknown> | undefined;
      const merged: Record<string, unknown> = { ...legacy };
      for (const [key, value] of Object.entries(direct)) {
        if (value === undefined) continue;
        if (legacy?.[key] !== undefined && legacy[key] !== value) {
          throw new Error(`Conflicting ${key} arguments; named fields and __args must agree`);
        }
        merged[key] = value;
      }
      return validated.parse(merged);
    },
  };
}
