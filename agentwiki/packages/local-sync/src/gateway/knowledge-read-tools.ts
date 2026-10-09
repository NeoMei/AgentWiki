import { z } from 'zod';
import { SAFE_SPACE_ID_PATTERN } from '../workspace/layout.js';

const spaceId = z.string().regex(SAFE_SPACE_ID_PATTERN).describe(
  'Internal Space ID from wiki_list_spaces. Selects that Space connection; required when multiple Spaces are connected.',
).optional();

// Space selection stays with SpaceMcpBridge, including its existing single-Space
// compatibility. This layer validates the read arguments, not authorization.
const READ_FIELDS: Record<string, z.ZodRawShape> = {
  list_spaces: { spaceId },
  list_pages: {
    spaceId,
    skip: z.number().int().min(0).describe('Number of pages to skip; default 0.').optional(),
    take: z.number().int().min(1).max(100).describe('Page batch size, 1–100; default 20.').optional(),
  },
  search_pages: {
    spaceId,
    query: z.string().min(1).describe('Required search text, such as a title, keyword or alias.'),
    limit: z.number().int().min(1).max(50).describe('Maximum matches, 1–50; default 10.').optional(),
  },
  get_page: { spaceId, pageId: z.string().min(1).describe('Required Page ID returned by search_pages, list_pages or list_graph.') },
  list_graph: { spaceId },
  list_sources: { spaceId },
};

export function knowledgeReadToolDefinition(name: string): {
  inputSchema: z.ZodRawShape;
  normalize(input: unknown): Record<string, unknown>;
} | undefined {
  if (!Object.hasOwn(READ_FIELDS, name)) return undefined;
  const fields = READ_FIELDS[name]!;
  const validated = z.object(fields);
  // Required read fields are optional only at the transport boundary so old
  // __args clients remain valid. Validate required fields after merging forms.
  const inputSchema: z.ZodRawShape = {
    ...Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, value.optional()])),
    __args: z.record(z.unknown()).describe('Legacy argument wrapper; prefer named fields. Duplicate fields must agree.').optional(),
  };
  const transport = z.object(inputSchema);
  return {
    inputSchema,
    normalize(input) {
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
