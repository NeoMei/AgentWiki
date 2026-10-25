import { BadRequestException, ConflictException, HttpException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AssistSession, AssistTask, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { BusinessException } from '../core/filters/business-error';
import { AuthorizationService } from '../core/authorization/authorization.service';
import { SpaceRevisionWriterService } from '../core/sync/space-revision-writer.service';
import { assertAssistTargetVersion, validateAssistTarget } from './assist-target';
import { sanitizeAgentProgress } from './assist-progress';
import { assertDirectoryReadable, captureDirectory, DirectoryLimitException, directoryScope, InaccessibleDirectoryException, readDirectoryTree, readSessionTurnMetadata, unavailableDirectory, validDirectoryContext, validDirectoryRequest } from './assist-directory.context';
import {
  AGENT_OUTPUT_LIMIT_ERROR, AGENT_SESSION_LIMITS as LIMIT, AgentHistoryTurn, AgentSessionContext, AgentSessionDetail,
  AgentDocumentReceipt, AgentSessionSummary, AgentTurnMode, AgentTurnRequest, AgentTurnStatus, AgentTurnView,
  safeAgentFailureCode, safeAgentFailureMessage,
} from './assist-session.types';

/** A single conversation has lost its source; unrelated sessions remain usable. */
class InaccessibleSessionException extends BadRequestException {}

const readRoles = ['owner', 'admin', 'editor', 'viewer'] as const;
const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

@Injectable()
export class AssistSessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: AuthorizationService,
    private readonly revisionWriter: SpaceRevisionWriterService,
    private readonly config: ConfigService,
  ) {}

  async create(spaceId: string, userId: string, title?: string): Promise<AgentSessionSummary> {
    this.id(spaceId); this.id(userId);
    if (title !== undefined && (typeof title !== 'string' || !title.trim() || title.length > 120)) throw new BadRequestException('Session title must contain 1–120 characters');
    return this.prisma.$transaction(async tx => {
      await this.lockAccess(tx, userId, spaceId);
      return this.summary(await tx.assistSession.create({ data: { spaceId, requestedByUserId: userId, title: title?.trim() || 'New conversation' } }));
    });
  }

  async list(spaceId: string, userId: string): Promise<AgentSessionSummary[]> {
    this.id(spaceId); this.id(userId);
    return this.prisma.$transaction(async tx => {
      await this.lockAccess(tx, userId, spaceId);
      const sessions = await tx.assistSession.findMany({ where: { spaceId, requestedByUserId: userId }, orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], take: LIMIT.sessions });
      // A title may quote private source text. Omit the entire inaccessible
      // conversation, while allowing other/new sessions to be discovered.
      const visible: AgentSessionSummary[] = [];
      for (const session of sessions) {
        try {
          await this.authorizedTurns(tx, session);
          visible.push(this.summary(session));
        } catch (error) {
          if (error instanceof InaccessibleSessionException || error instanceof InaccessibleDirectoryException
            || (error instanceof BusinessException && error.businessCode === 'SPACE_ACCESS_DENIED')) continue;
          throw error; // Database failures and corrupt data must stay observable.
        }
      }
      return visible;
    });
  }

  async get(id: string, userId: string): Promise<AgentSessionDetail> {
    return this.prisma.$transaction(async tx => {
      const session = await this.session(tx, id, userId);
      const turns = await this.authorizedTurns(tx, session);
      return { ...this.summary(session), turns: turns.map(turn => this.view(turn)) };
    });
  }

  async send(id: string, userId: string, input: AgentTurnRequest): Promise<AgentTurnView> {
    if (isObject(input) && input.mode === undefined) input = { ...input, mode: 'auto' };
    this.validateRequest(input);
    // Row locks serialize normal callers. Unique indexes also protect external
    // writers; a retry re-reads the canonical idempotent result after a race.
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.prisma.$transaction(async tx => {
          const session = await this.session(tx, id, userId);
          await tx.$queryRaw`SELECT "id" FROM "AssistSession" WHERE "id" = ${id} FOR UPDATE`;
          const turns = await this.authorizedTurns(tx, session);
          const existing = turns.find(turn => turn.clientRequestId === input.clientRequestId);
          if (existing) return this.view(existing);
          if (turns.some(turn => turn.status === 'queued' || turn.status === 'running')) throw new ConflictException('A turn is already active in this session');
          if (turns.length >= LIMIT.turns) throw new BadRequestException('Session reached 100 turns; start a new conversation');
          await this.authorization.assertLiveHumanSpaceAccess(tx, { userId }, session.spaceId, input.mode === 'proposal' ? ['owner', 'editor'] : [...readRoles]);
          const page = input.pageId == null ? null : await this.page(tx, input.pageId, session.spaceId);
          const snapshot = page ? (input.snapshot ? this.snapshot(input.snapshot, page.updatedAt) : { title: page.title, content: page.content, updatedAt: page.updatedAt.toISOString() }) : null;
          if (JSON.stringify(snapshot).length > LIMIT.snapshot) throw new BadRequestException('Page snapshot is too large (50000 characters)');
          if (page) assertAssistTargetVersion(validateAssistTarget(snapshot), page.updatedAt);
          const references: AgentSessionContext['references'] = [];
          for (const pageId of input.referencePageIds || []) {
            const reference = await this.page(tx, pageId, session.spaceId);
            references.push({ pageId, title: reference.title, content: reference.content, updatedAt: reference.updatedAt.toISOString() });
          }
          if (input.annotations?.some(note => note.quote && !((snapshot?.content as string | undefined) || '').includes(note.quote))) throw new BadRequestException('Annotation quote does not match the sent snapshot');
          const context: AgentSessionContext = { pageId: page?.id ?? null, references, noteIds: input.noteIds || [],
            ...(input.annotations ? { annotations: input.annotations.map(({ id, body, quote }) => ({ id, body, quote })) } : {}) };
          if (JSON.stringify(snapshot).length + JSON.stringify(context).length > LIMIT.context) throw new BadRequestException('Selected context is too large (100000 characters)');
          const directory = input.directory ?? { folderId: page?.folderId ?? null };
          try {
            context.directory = await captureDirectory(tx, session.spaceId, directory);
          } catch (error) {
            if (!page || input.directory !== undefined || !(error instanceof DirectoryLimitException)) throw error;
            context.directory = await unavailableDirectory(tx, session.spaceId, directory, error);
          }
          const configured = Number(this.config.get('ASSIST_MAX_OUTSTANDING_PER_USER') || 10);
          const max = Number.isInteger(configured) && configured > 0 ? configured : 10;
          if (await tx.assistTask.count({ where: { requestedByUserId: userId, spaceId: session.spaceId, status: { in: ['queued', 'running'] } } }) >= max) throw new HttpException('Too many outstanding assist tasks', 429);
          const turn = await tx.assistTask.create({ data: {
            sessionId: id, spaceId: session.spaceId, requestedByUserId: userId,
            pageId: page?.id ?? null, clientRequestId: input.clientRequestId, intent: input.intent,
            mode: input.mode, pageSnapshot: snapshot === null ? Prisma.DbNull : snapshot as Prisma.InputJsonValue,
            context: context as unknown as Prisma.InputJsonValue, status: 'queued',
          } });
          await tx.assistSession.update({ where: { id }, data: { updatedAt: new Date(), ...(turns.length === 0 && session.title === 'New conversation' ? { title: input.intent.trim().replace(/\s+/gu, ' ').slice(0, 120) } : {}) } });
          return this.view(turn);
        }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
      } catch (error) {
        if (attempt < 2 && ['P2002', 'P2034'].includes((error as { code?: string }).code || '')) continue;
        throw error;
      }
    }
  }

  async cancel(id: string, userId: string): Promise<AgentTurnView> {
    this.id(id); this.id(userId);
    return this.prisma.$transaction(async tx => {
      const task = await tx.assistTask.findFirst({ where: { id, requestedByUserId: userId }, select: { sessionId: true } });
      if (!task?.sessionId) throw new NotFoundException('Session turn not found');
      const session = await this.session(tx, task.sessionId, userId);
      const turns = await this.authorizedTurns(tx, session);
      const turn = turns.find(row => row.id === id);
      if (!turn) throw new NotFoundException('Session turn not found');
      await tx.assistTask.updateMany({ where: { id, requestedByUserId: userId, sessionId: session.id, status: { in: ['queued', 'running'] } }, data: {
        status: 'cancelled', completedAt: new Date(), leaseOwner: null, leaseExpiresAt: null, lockedAt: null, progressText: '', result: Prisma.DbNull,
      } });
      const cancelled = (await this.authorizedTurns(tx, session)).find(row => row.id === id);
      return this.view(cancelled!);
    });
  }

  /** Called during start, polling, progress and final publication with live DB state. */
  async executionContext(tx: Prisma.TransactionClient, task: Pick<AssistTask, 'id' | 'sessionId' | 'spaceId' | 'requestedByUserId'>, includeDirectoryContent = false) {
    if (!task.sessionId || !task.requestedByUserId) throw new BadRequestException('Invalid session turn');
    const session = await this.session(tx, task.sessionId, task.requestedByUserId);
    if (session.spaceId !== task.spaceId) throw new BadRequestException('Session Space mismatch');
    const turns = await this.authorizedTurns(tx, session);
    const currentIndex = turns.findIndex(turn => turn.id === task.id);
    if (currentIndex < 0) throw new NotFoundException('Session turn not found');
    const current = turns[currentIndex];
    let currentContext = this.context(current);
    if (includeDirectoryContent && currentContext.directory) {
      const stored = await tx.assistTask.findFirst({ where: { id: current.id, sessionId: session.id, spaceId: session.spaceId, requestedByUserId: session.requestedByUserId }, select: { context: true } });
      if (!stored) throw new NotFoundException('Session turn not found');
      currentContext = this.context(stored);
    }
    if (currentContext.pageId !== null) {
      const source = await tx.page.findFirst({ where: { id: currentContext.pageId, spaceId: session.spaceId, deletedAt: null }, select: { updatedAt: true } });
      if (!source) throw new InaccessibleSessionException('Session source is no longer available');
      const snapshot = current.pageSnapshot;
      if (!isObject(snapshot) || typeof snapshot.updatedAt !== 'string' || snapshot.updatedAt !== source.updatedAt.toISOString()) throw new ConflictException('Page snapshot is stale');
      assertAssistTargetVersion(validateAssistTarget(snapshot), source.updatedAt);
    }
    // Keep terminal failures/cancellations in the bounded replay window. A
    // user commonly follows a failed directory scan with “继续”; dropping
    // that turn makes the model report that the Session has no context.
    const replayable = turns.slice(0, currentIndex).filter(turn => ['done', 'failed', 'cancelled'].includes(turn.status));
    const history: AgentHistoryTurn[] = [];
    let characters = 2; // Serialized array brackets also count toward the window.
    for (const turn of replayable.slice(-LIMIT.historyTurns).reverse()) {
      const result = this.publicResult(turn);
      const context = this.context(turn);
      const status = turn.status as AgentTurnStatus;
      const failureCode = this.failureCode(turn);
      const failure = status === 'failed'
        ? (failureCode ? safeAgentFailureMessage(failureCode) : 'Assistant failed; retry with a new turn')
        : status === 'cancelled' ? 'The previous assistant turn was cancelled before completion' : undefined;
      const item: AgentHistoryTurn = { intent: turn.intent, answer: result?.summary || '', mode: turn.mode as AgentTurnMode, pageId: turn.pageId,
        status,
        pageSnapshot: isObject(turn.pageSnapshot) ? turn.pageSnapshot : null,
        references: context.references,
        ...(failure ? { error: failure } : {}),
        ...(failureCode ? { failureCode } : {}),
        ...(context.directory ? { directory: directoryScope(context.directory) } : {}),
        ...(result?.changes ? { changes: result.changes } : {}),
        ...(result?.action ? { action: result.action } : {}),
        ...(result?.document ? { document: result.document } : {}),
        ...(context.annotations ? { annotations: context.annotations } : {}) };
      const size = JSON.stringify(item).length + (history.length ? 1 : 0);
      if (characters + size > LIMIT.history) break;
      history.unshift(item); characters += size;
    }
    const access = await this.authorization.assertLiveHumanSpaceAccess(tx, { userId: session.requestedByUserId }, session.spaceId, [...readRoles]);
    const canWrite = ['owner', 'admin', 'editor'].includes(access.role);
    const actions = { update: canWrite && current.pageId !== null, create: canWrite && !!currentContext.directory && !currentContext.directory.unavailableReason };
    return { context: currentContext, actions, history, historyWindow: { included: history.length, omitted: replayable.length - history.length, maxTurns: LIMIT.historyTurns, maxCharacters: LIMIT.history } };
  }

  private async lockAccess(tx: Prisma.TransactionClient, userId: string, spaceId: string) {
    await this.authorization.lockLiveHumanPrincipal(tx, { userId });
    await this.revisionWriter.lockSpace(tx, spaceId);
    await this.authorization.assertLiveHumanSpaceAccess(tx, { userId }, spaceId, [...readRoles]);
  }

  private async session(tx: Prisma.TransactionClient, id: string, userId: string) {
    this.id(id); this.id(userId);
    const session = await tx.assistSession.findFirst({ where: { id, requestedByUserId: userId } });
    if (!session) throw new NotFoundException('Session not found');
    await this.lockAccess(tx, userId, session.spaceId);
    return session;
  }

  private async authorizedTurns(tx: Prisma.TransactionClient, session: AssistSession) {
    const turns = await readSessionTurnMetadata(tx, session.id, LIMIT.turns + 1);
    if (turns.length > LIMIT.turns) throw new BadRequestException('Session exceeded 100 turns');
    const sourceIds = new Set<string>();
    let directoryTree: Awaited<ReturnType<typeof readDirectoryTree>> | undefined;
    for (const turn of turns) {
      if (turn.requestedByUserId !== session.requestedByUserId || turn.spaceId !== session.spaceId || !['auto', 'question', 'proposal'].includes(turn.mode)) throw new BadRequestException('Invalid session binding');
      const context = this.context(turn);
      if (turn.pageId !== context.pageId) throw new InaccessibleSessionException('Session source is no longer available');
      if (context.pageId !== null) sourceIds.add(context.pageId);
      else if (turn.mode === 'proposal' || !context.directory) throw new BadRequestException('A page is required for this session turn');
      if (context.directory) {
        if (!context.directory.unavailableReason) directoryTree ??= await readDirectoryTree(tx, session.spaceId);
        await assertDirectoryReadable(tx, session.spaceId, context.directory, directoryTree);
      }
      context.references.forEach(ref => sourceIds.add(ref.pageId));
      const document = turn.mode === 'auto' && turn.status === 'done' && isObject(turn.result) ? this.documentReceipt(turn.result.document) : undefined;
      if (document) {
        if ((document.operation === 'updated' && document.pageId !== turn.pageId) || !context.directory) throw new BadRequestException('Invalid saved document binding');
        sourceIds.add(document.pageId);
      }
    }
    if (turns.some(turn => turn.mode === 'proposal')) await this.authorization.assertLiveHumanSpaceAccess(tx, { userId: session.requestedByUserId }, session.spaceId, ['owner', 'editor']);
    if (sourceIds.size && await tx.page.count({ where: { id: { in: [...sourceIds] }, spaceId: session.spaceId, deletedAt: null } }) !== sourceIds.size) throw new InaccessibleSessionException('Session page must exist in the selected Space');
    return turns;
  }

  private async page(tx: Prisma.TransactionClient, id: string, spaceId: string) {
    const page = await tx.page.findFirst({ where: { id, spaceId, deletedAt: null }, select: { id: true, title: true, content: true, updatedAt: true, folderId: true } });
    if (!page) throw new BadRequestException('Session page must exist in the selected Space');
    return page;
  }

  private context(task: Pick<AssistTask, 'context'>): AgentSessionContext {
    const value = task.context;
    if (!isObject(value) || (value.pageId !== null && typeof value.pageId !== 'string') || !Array.isArray(value.references) || value.references.length > LIMIT.references || !Array.isArray(value.noteIds)
      || value.references.some(ref => !isObject(ref) || ['pageId', 'title', 'content', 'updatedAt'].some(key => typeof ref[key] !== 'string'))
      || value.noteIds.some(id => typeof id !== 'string')) throw new BadRequestException('Invalid session context');
    if (value.annotations !== undefined && (!Array.isArray(value.annotations) || value.annotations.length > LIMIT.noteIds
      || JSON.stringify(value.annotations).length > LIMIT.annotations
      || value.annotations.some(note => !isObject(note) || typeof note.id !== 'string' || !(value.noteIds as string[]).includes(note.id) || typeof note.body !== 'string' || typeof note.quote !== 'string'))) throw new BadRequestException('Invalid session annotations');
    if (value.directory !== undefined && !validDirectoryContext(value.directory)) throw new BadRequestException('Invalid session directory context');
    return value as unknown as AgentSessionContext;
  }

  private snapshot(input: NonNullable<AgentTurnRequest['snapshot']>, updatedAt: Date): Record<string, unknown> {
    if (input.updatedAt !== undefined && new Date(input.updatedAt).getTime() !== updatedAt.getTime()) throw new ConflictException('Page snapshot is stale');
    return { title: input.title, content: input.content, updatedAt: updatedAt.toISOString(),
      ...(input.draftRevision !== undefined ? { draftRevision: input.draftRevision } : {}),
      ...(input.remoteRevision !== undefined ? { remoteRevision: input.remoteRevision } : {}),
      ...(input.assistTarget !== undefined ? { assistTarget: input.assistTarget } : {}),
    };
  }

  private validateRequest(input: AgentTurnRequest) {
    if (!isObject(input)) throw new BadRequestException('Turn request is required');
    this.id(input.clientRequestId);
    if (input.pageId != null) this.id(input.pageId);
    if (input.directory !== undefined && !validDirectoryRequest(input.directory)) throw new BadRequestException('Invalid directory scope');
    if (input.pageId == null && (input.mode === 'proposal' || input.directory === undefined)) throw new BadRequestException('Questions without a page require an explicit directory; proposals require a page');
    if (input.pageId == null && (input.snapshot !== undefined || input.noteIds?.length || input.annotations?.length)) throw new BadRequestException('Page snapshots and annotations require a page');
    if (!['auto', 'question', 'proposal'].includes(input.mode || '')) throw new BadRequestException('Invalid turn mode');
    if (typeof input.intent !== 'string' || !input.intent.trim() || input.intent.length > LIMIT.intent) throw new BadRequestException('Intent must contain 1–10000 characters');
    for (const [ids, maximum] of [[input.referencePageIds, LIMIT.references], [input.noteIds, LIMIT.noteIds]] as const) {
      if (ids === undefined) continue;
      if (!Array.isArray(ids) || ids.length > maximum || new Set(ids).size !== ids.length) throw new BadRequestException('Too many or duplicate context identifiers');
      ids.forEach(id => this.id(id));
    }
    if (input.annotations !== undefined) {
      if (!Array.isArray(input.annotations) || input.annotations.length > LIMIT.noteIds
        || JSON.stringify(input.annotations).length > LIMIT.annotations) throw new BadRequestException('Annotations are too large (10000 characters)');
      const seen = new Set<string>();
      for (const note of input.annotations) {
        if (!isObject(note) || typeof note.id !== 'string' || !input.noteIds?.includes(note.id) || seen.has(note.id)
          || typeof note.body !== 'string' || typeof note.quote !== 'string') throw new BadRequestException('Invalid explicitly selected annotation');
        seen.add(note.id);
      }
    }
    const snapshot = input.snapshot;
    if (snapshot !== undefined) {
      if (!isObject(snapshot) || typeof snapshot.title !== 'string' || typeof snapshot.content !== 'string'
        || (snapshot.updatedAt !== undefined && (typeof snapshot.updatedAt !== 'string' || !Number.isFinite(Date.parse(snapshot.updatedAt))))
        || [snapshot.draftRevision, snapshot.remoteRevision].some(value => value !== undefined && (!Number.isSafeInteger(value) || value < 0))) throw new BadRequestException('Invalid page snapshot');
      if (JSON.stringify(snapshot).length > LIMIT.snapshot) throw new BadRequestException('Page snapshot is too large (50000 characters)');
    }
  }

  private id(value: unknown) {
    if (typeof value !== 'string' || !value.trim() || value.length > 128) throw new BadRequestException('Identifier must contain 1–128 characters');
  }
  private summary(session: AssistSession): AgentSessionSummary {
    return { id: session.id, spaceId: session.spaceId, title: session.title, createdAt: session.createdAt.toISOString(), updatedAt: session.updatedAt.toISOString() };
  }
  private documentReceipt(value: unknown): AgentDocumentReceipt | undefined {
    if (!isObject(value) || !['created', 'updated'].includes(String(value.operation))
      || ['pageId', 'title', 'updatedAt'].some(key => typeof value[key] !== 'string')
      || !value.pageId || !Number.isFinite(Date.parse(value.updatedAt as string))) return undefined;
    return { operation: value.operation as 'created' | 'updated', pageId: value.pageId as string, title: value.title as string,
      updatedAt: value.updatedAt as string, url: `/pages/${encodeURIComponent(value.pageId as string)}` };
  }
  private publicResult(task: AssistTask): AgentTurnView['result'] {
    if (task.status !== 'done' || !isObject(task.result)) return null;
    const action = task.mode === 'auto' && ['answer', 'update', 'create'].includes(String(task.result.action))
      ? task.result.action as 'answer' | 'update' | 'create' : undefined;
    const document = action === 'create' || action === 'update' ? this.documentReceipt(task.result.document) : undefined;
    return { ...(typeof task.result.summary === 'string' ? { summary: task.result.summary } : {}),
      ...((task.mode === 'proposal' || (action && action !== 'answer')) && typeof task.result.changes === 'string' ? { changes: task.result.changes } : {}),
      ...(action ? { action } : {}), ...(document ? { document } : {}) };
  }
  private failureCode(task: AssistTask) {
    if (task.status !== 'failed') return undefined;
    if (task.error === AGENT_OUTPUT_LIMIT_ERROR) return 'output_limit' as const;
    const failure = isObject(task.result) ? task.result.failure : undefined;
    return isObject(failure) ? safeAgentFailureCode(failure.code) : undefined;
  }
  private view(task: AssistTask): AgentTurnView {
    const context = this.context(task);
    const failureCode = this.failureCode(task);
    const progress = task.status === 'running' && isObject(task.result) ? sanitizeAgentProgress(task.result.progress) : undefined;
    return { id: task.id, sessionId: task.sessionId!, pageId: task.pageId, mode: task.mode as AgentTurnMode,
      intent: task.intent, status: task.status as AgentTurnStatus, createdAt: task.createdAt.toISOString(),
      pageSnapshot: isObject(task.pageSnapshot) ? task.pageSnapshot : null,
      ...(context.directory ? { directory: directoryScope(context.directory) } : {}),
      references: context.references.map(({ pageId, title, updatedAt }) => ({ pageId, title, updatedAt })),
      noteIds: context.noteIds, ...(context.annotations ? { annotations: context.annotations.map(({ id, body, quote }) => ({ id, body, quote })) } : {}), progressText: task.progressText || '', ...(progress ? { progress } : {}), result: this.publicResult(task),
      ...(failureCode ? { failureCode } : {}),
      error: task.status === 'failed' ? (failureCode ? safeAgentFailureMessage(failureCode) : 'Assistant failed; retry with a new turn') : null };
  }
}
