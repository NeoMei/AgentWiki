import { Injectable } from '@nestjs/common';
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
  constructor(private readonly prisma: PrismaService) {}

  async createTask(input: CreateAssistTaskInput) {
    return this.prisma.assistTask.create({
      data: {
        spaceId: input.spaceId,
        pageId: input.pageId,
        intent: input.intent,
        pageSnapshot: (input.snapshot as Prisma.InputJsonValue) ?? Prisma.JsonNull,
        requestedByUserId: input.userId,
        status: 'queued',
      },
    });
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
