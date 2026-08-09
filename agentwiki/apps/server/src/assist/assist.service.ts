import { BadRequestException, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

export interface CreateAssistTaskInput {
  spaceId: string;
  pageId?: string;
  intent: string;
  snapshot?: Record<string, unknown>;
  userId?: string;
}

@Injectable()
export class AssistService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async createTask(input: CreateAssistTaskInput) {
    const configured = Number(this.config.get('ASSIST_MAX_OUTSTANDING_PER_USER') || 10);
    const maxOutstanding = Number.isInteger(configured) && configured > 0 ? configured : 10;
    return this.prisma.$transaction(async (tx) => {
      if (input.pageId) {
        const page = await tx.page.findFirst({
          where: { id: input.pageId, spaceId: input.spaceId, deletedAt: null },
          select: { id: true },
        });
        if (!page) throw new BadRequestException('Assist page must belong to the selected Space');
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

  async listForPage(pageId: string) {
    return this.prisma.assistTask.findMany({
      where: { pageId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
  }

  async get(id: string) {
    return this.prisma.assistTask.findUnique({ where: { id } });
  }
}
