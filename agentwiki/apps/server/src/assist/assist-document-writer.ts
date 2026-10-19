import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { AuthorizationService } from '../core/authorization/authorization.service';
import { ContentTreeService } from '../content-tree/content-tree.service';
import { SearchService } from '../core/search/search.service';
import { GraphMaintenance } from '../knowledge-graph/graph-maintenance';
import { sourceGenerationInvalidation } from '../core/page/source-generation';
import { assertAssistOutputScope, assertAssistTargetVersion, validateAssistTarget } from './assist-target';
import { AGENT_OUTPUT_LIMIT_ERROR, AGENT_SESSION_LIMITS as LIMIT, AgentAutoResult, AgentDocumentReceipt, AgentSessionContext } from './assist-session.types';

/** Revalidate at the publication boundary, including runners other than OpenCode. */
export function validateAutoDocumentResult(value: unknown): AgentAutoResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequestException('Invalid automatic assistant result');
  const result = value as Record<string, unknown>;
  const fields = result.action === 'answer' ? ['action', 'summary'] : result.action === 'update' ? ['action', 'summary', 'changes'] : result.action === 'create' ? ['action', 'summary', 'title', 'changes'] : [];
  // Runtime accounting never confers document capabilities or supplies targets.
  const metadata = ['raw', 'model', 'modelTier', 'attemptCount', 'usage', 'cost', 'attempts'];
  if (!fields.length || Object.keys(result).some(key => !fields.includes(key) && !metadata.includes(key))
    || typeof result.summary !== 'string' || !result.summary.trim()
    || (result.action !== 'answer' && (typeof result.changes !== 'string' || !result.changes.trim()))
    || (result.action === 'create' && (typeof result.title !== 'string' || !result.title.trim() || result.title.length > 200))) {
    throw new BadRequestException('Invalid automatic assistant result');
  }
  const canonical = Object.fromEntries(fields.map(key => [key, result[key]]));
  if (result.summary.length > LIMIT.answer || JSON.stringify(canonical).length > LIMIT.output) throw new BadRequestException(AGENT_OUTPUT_LIMIT_ERROR);
  return canonical as unknown as AgentAutoResult;
}

interface DocumentTask { id: string; pageId: string | null; spaceId: string; requestedByUserId: string | null; pageSnapshot: unknown }

/** The caller holds User -> Space locks and commits the task receipt atomically. */
@Injectable()
export class AssistDocumentWriter {
  private readonly logger = new Logger(AssistDocumentWriter.name);
  constructor(
    private readonly authorization: AuthorizationService,
    private readonly tree: ContentTreeService,
    private readonly search: SearchService,
    private readonly graph: GraphMaintenance,
  ) {}

  async write(tx: Prisma.TransactionClient, task: DocumentTask, context: AgentSessionContext, value: unknown): Promise<AgentDocumentReceipt> {
    const result = validateAutoDocumentResult(value);
    if (result.action === 'answer' || !task.requestedByUserId) throw new BadRequestException('A document action and requester are required');
    await this.authorization.assertLiveHumanSpaceAccess(tx, { userId: task.requestedByUserId }, task.spaceId, ['owner', 'editor'], { requireSpaceMembership: true });
    const lockedTx = await this.tree.lockPageMutationSpace(tx, task.spaceId);
    const userId = task.requestedByUserId;
    let saved: { id: string; title: string; updatedAt: Date; knowledgeKey: string; folderId: string | null; syncPath: string | null; content: string };
    if (result.action === 'update') {
      if (!task.pageId || context.pageId !== task.pageId) throw new BadRequestException('No current page to update');
      const snapshot = task.pageSnapshot as { updatedAt?: unknown } | null;
      if (typeof snapshot?.updatedAt !== 'string' || !Number.isFinite(Date.parse(snapshot.updatedAt))) throw new BadRequestException('Missing page version');
      const page = await lockedTx.page.findFirst({ where: { id: task.pageId, spaceId: task.spaceId, deletedAt: null }, select: {
        id: true, title: true, content: true, updatedAt: true, knowledgeKey: true, folderId: true, syncPath: true, syncPathKey: true, slug: true, format: true, parentId: true,
      } });
      if (!page || page.updatedAt.toISOString() !== snapshot.updatedAt) throw new ConflictException('Page changed; send the request again with its latest version');
      assertAssistTargetVersion(validateAssistTarget(task.pageSnapshot), page.updatedAt);
      assertAssistOutputScope(task.pageSnapshot, result.changes);
      await lockedTx.pageVersion.create({ data: { pageId: page.id, title: page.title, content: page.content, authorId: userId, slug: page.slug, format: page.format, parentId: page.parentId, folderId: page.folderId, syncPath: page.syncPath, syncPathKey: page.syncPathKey } });
      const changed = await lockedTx.page.updateMany({ where: { id: page.id, spaceId: task.spaceId, deletedAt: null, updatedAt: page.updatedAt }, data: {
        content: result.changes, ...sourceGenerationInvalidation(page, { content: result.changes }),
        lastChangeSetId: null, lastModifiedByUserId: userId, lastModifiedByAgentId: null, lastModifiedAt: new Date(),
      } });
      if (changed.count !== 1) throw new ConflictException('Page changed; send the request again with its latest version');
      const updated = await lockedTx.page.findUnique({ where: { id: page.id }, select: { id: true, title: true, updatedAt: true, knowledgeKey: true, folderId: true, syncPath: true, content: true } });
      if (!updated) throw new ConflictException('Page is no longer available');
      saved = updated;
    } else {
      const directory = context.directory;
      if (!directory || directory.unavailableReason) throw new BadRequestException('No available directory to create a document');
      const id = randomUUID();
      const title = result.title.trim();
      const placement = await this.tree.placePage(lockedTx, { spaceId: task.spaceId, pageId: id, folderId: directory.folderId, title, requireUniqueTitle: true });
      saved = await lockedTx.page.create({ data: {
        id, knowledgeKey: randomUUID(), title, slug: `agent-${id}`, content: result.changes, format: 'markdown', spaceId: task.spaceId,
        authorId: userId, parentId: null, folderId: placement.folderId, syncPath: placement.syncPath, syncPathKey: placement.syncPathKey,
        lastModifiedByUserId: userId, lastModifiedAt: new Date(),
      }, select: { id: true, title: true, updatedAt: true, knowledgeKey: true, folderId: true, syncPath: true, content: true } });
    }
    if (!saved.syncPath) throw new BadRequestException('Document has no canonical path');
    await this.tree.advancePageMutation(lockedTx, {
      spaceId: task.spaceId, expectedTreeRevision: lockedTx.contentTreeRevision, structural: result.action === 'create',
      changes: [{ operation: 'upsert', pageId: saved.knowledgeKey, folderId: saved.folderId, path: saved.syncPath, title: saved.title, body: saved.content }], actor: { userId },
    });
    return { operation: result.action === 'create' ? 'created' : 'updated', pageId: saved.id, title: saved.title, updatedAt: saved.updatedAt.toISOString(), url: `/pages/${encodeURIComponent(saved.id)}` };
  }

  async afterCommit(spaceId: string, document: AgentDocumentReceipt): Promise<void> {
    try { await this.search.indexPage(document.pageId); }
    catch { this.logger.warn(`Search indexing deferred for assistant document ${document.pageId}`); }
    try { this.graph.enqueue(spaceId); }
    catch { this.logger.warn(`Graph update deferred for assistant document ${document.pageId}`); }
  }
}
