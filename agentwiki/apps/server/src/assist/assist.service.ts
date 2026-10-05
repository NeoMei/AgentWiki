import { BadRequestException, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { AuthorizationService } from '../core/authorization/authorization.service';
import { assertAssistTargetVersion, validateAssistTarget } from './assist-target';

export interface CreateAssistTaskInput {
  spaceId: string;
  pageId?: string;
  intent: string;
  snapshot?: Record<string, unknown>;
  userId?: string;
}

/** Strip internal routing details (model names, costs, usage) from assist
 *  results before they leave the API. The client only needs the summary,
 *  generated content, and failure code. */
function sanitizeResult(result: unknown): unknown {
  if (!result || typeof result !== 'object') return result;
  const { model: _model, modelTier: _modelTier, usage: _usage, cost: _cost, attempts, ...rest } = result as Record<string, unknown>;
  const clean: Record<string, unknown> = { ...rest };
  if (Array.isArray(attempts)) {
    clean.attempts = attempts.map((a: any) => {
      if (!a || typeof a !== 'object') return a;
      const { model: _m, tier: _t, cost: _c, usage: _u, ...restAttempt } = a;
      return restAttempt;
    });
  }
  return clean;
}

@Injectable()
export class AssistService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly authorization: AuthorizationService,
  ) {}

  async createTask(input: CreateAssistTaskInput) {
    // Bound the page snapshot so a single request cannot push an unbounded
    // payload into the database and the opencode prompt (cost / timeout).
    if (input.snapshot && JSON.stringify(input.snapshot).length > 50_000) {
      throw new BadRequestException('Page snapshot is too large');
    }
    if (!input.userId) throw new BadRequestException('Assist requester is required');
    const target = validateAssistTarget(input.snapshot);
    if (target && !input.pageId) throw new BadRequestException('Scoped Assist requires a page');
    const configured = Number(this.config.get('ASSIST_MAX_OUTSTANDING_PER_USER') || 10);
    const maxOutstanding = Number.isInteger(configured) && configured > 0 ? configured : 10;
    return this.prisma.$transaction(async (tx) => {
      await this.authorization.assertLiveHumanSpaceAccess(tx, { userId: input.userId! }, input.spaceId, ['owner', 'editor']);
      if (input.pageId) {
        const page = await tx.page.findFirst({
          where: { id: input.pageId, spaceId: input.spaceId, deletedAt: null },
          select: { id: true, updatedAt: true },
        });
        if (!page) throw new BadRequestException('Assist page must belong to the selected Space');
        assertAssistTargetVersion(target, page.updatedAt);
      }
      const outstanding = await tx.assistTask.count({
        where: {
          spaceId: input.spaceId,
          requestedByUserId: input.userId,
          status: { in: ['queued', 'running'] },
        },
      });
      if (outstanding >= maxOutstanding) {
        throw new HttpException('Too many outstanding assist tasks', HttpStatus.TOO_MANY_REQUESTS);
      }
      return tx.assistTask.create({
        data: {
          spaceId: input.spaceId,
          pageId: input.pageId,
          intent: input.intent,
          pageSnapshot: (input.snapshot as Prisma.InputJsonValue) ?? Prisma.JsonNull,
          requestedByUserId: input.userId,
          status: 'queued',
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async listForPage(pageId: string, userId: string, spaceId: string) {
    if (!userId) throw new BadRequestException('Assist requester is required');
    if (!spaceId) throw new BadRequestException('Assist Space is required');
    const tasks = await this.prisma.assistTask.findMany({
      where: { pageId, requestedByUserId: userId, spaceId },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });
    return tasks.map((task) => ({
      ...task,
      result: task.result ? sanitizeResult(task.result) : null,
    }));
  }

  async get(id: string, userId: string) {
    if (!userId) throw new BadRequestException('Assist requester is required');
    const task = await this.prisma.assistTask.findFirst({ where: { id, requestedByUserId: userId } });
    if (!task) return null;
    return {
      ...task,
      result: task.result ? sanitizeResult(task.result) : null,
    };
  }
}
