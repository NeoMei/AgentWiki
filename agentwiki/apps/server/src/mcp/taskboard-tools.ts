import { z } from 'zod';
import { AuthorizationService, Principal } from '../core/authorization/authorization.service';
import { BusinessException } from '../core/filters/business-error';
import { ProjectTaskboardService } from '../project-taskboard/project-taskboard.service';
import { TASKBOARD_STATUSES } from '../project-taskboard/taskboard-core';

const SPACE = z.string().min(1).max(100).describe('Internal Space ID from list_spaces. Reuse the project mapping; do not guess between spaces.');
const READ = z.object({ spaceId: SPACE }).strict();
const IMPORT_FIELDS = {
  spaceId: SPACE,
  documents: z.array(z.object({
    sourcePath: z.string().trim().min(1).max(4096).describe('Stable source identity, not a server-readable path. Preserve it on retries and across agents.'),
    content: z.string().min(1).max(2_000_000).describe('Actual UTF-8 Markdown or board.json text read by the agent locally.'),
  }).strict()).min(1).max(20),
  project: z.string().trim().min(1).max(300).optional(),
  syncStatus: z.boolean().default(false),
};
const IMPORT = z.object(IMPORT_FIELDS).strict().superRefine((input, ctx) => {
  if (input.documents.reduce((sum, doc) => sum + Buffer.byteLength(doc.content, 'utf8'), 0) > 2_000_000) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Batch content exceeds 2 MB; split into smaller batches' });
  }
  if (new Set(input.documents.map((doc) => doc.sourcePath)).size !== input.documents.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Each document must have a unique sourcePath' });
  }
});
const STATUS_FIELDS = {
  spaceId: SPACE,
  taskId: z.string().min(1).max(1024).describe('Exact task ID from get_taskboard; task numbers may be ambiguous across plans.'),
  status: z.enum(TASKBOARD_STATUSES).optional(),
  current_step: z.string().max(10000).optional(),
  expected_status: z.enum(TASKBOARD_STATUSES).optional(),
  session_id: z.string().min(1).max(200).optional(),
  takeover: z.boolean().default(false),
};
const STATUS = z.object(STATUS_FIELDS).strict().refine((input) => input.status !== undefined || input.current_step !== undefined, { message: 'Provide status or current_step' });

type RegisterTool = (name: string, definition: any, handler: (args: any) => Promise<unknown>) => unknown;
const text = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data) }] });

export function registerTaskboardTools(register: RegisterTool, principal: Principal, authorization: AuthorizationService, taskboard: () => ProjectTaskboardService) {
  register('get_taskboard', {
    description: 'Read the shared taskboard and exact task IDs in an authorized Space using this MCP connection. No separate URL or API key is needed.',
    inputSchema: READ,
  }, async (raw) => {
    const { spaceId } = READ.parse(raw);
    return text(await taskboard().getBoard(principal, spaceId));
  });
  register('import_taskboard_plans', {
    description: 'Merge locally read Markdown plans or board.json into a Space taskboard. Up to 20 documents and 2 MB total per call. Each file commits separately; results report partial failures. Repeat stable sourcePath values to update without duplication. Preserves remote execution state unless syncStatus is explicitly requested. Does not read local paths or configure credentials.',
    inputSchema: IMPORT_FIELDS,
  }, async (raw) => {
    const { spaceId, documents, project, syncStatus } = IMPORT.parse(raw);
    // Reject missing write access for the entire call before processing any file.
    await authorization.assertSpaceAccess(principal, spaceId, ['owner', 'admin', 'editor']);
    const results: Array<Record<string, unknown>> = [];
    for (const document of documents) {
      try {
        const result = await taskboard().importPlan(principal, spaceId, { ...document, project, syncStatus });
        results.push({ sourcePath: document.sourcePath, status: 'imported', summary: result.summary });
      } catch (error) {
        // Do not hide authorization revocation, DB failures or unexpected errors as invalid files.
        if (!(error instanceof BusinessException) || error.statusCode !== 400) throw error;
        results.push({ sourcePath: document.sourcePath, status: 'failed', code: error.businessCode, message: error.message });
      }
    }
    const failed = results.filter((result) => result.status === 'failed').length;
    return { ...text({ spaceId, results, imported: results.length - failed, failed }), ...(failed ? { isError: true } : {}) };
  });
  register('update_taskboard_status', {
    description: 'Report progress on an exact task ID using the authenticated MCP actor. Reuse session_id; pass expected_status from get_taskboard for conflict detection. Existing dependency and claim checks apply. Never automatically take over another claim.',
    inputSchema: STATUS_FIELDS,
  }, async (raw) => {
    const { spaceId, taskId, ...patch } = STATUS.parse(raw);
    return text(await taskboard().updateStatus(principal, spaceId, taskId, patch));
  });
}
