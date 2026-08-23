import { Injectable } from '@nestjs/common';
import { RedisService } from '../database/redis.service';
import { PrismaService } from '../database/prisma.service';

export const COLLABORATION_RUN_CHANNEL = 'agentwiki:collaboration:runs';

@Injectable()
export class CollaborationEventsService {
  constructor(private readonly prisma: PrismaService, private readonly redis: RedisService) {}

  async publishRunChanged(spaceId: string, runId: string, eventSequence: number): Promise<void> {
    await this.redis.publish(COLLABORATION_RUN_CHANNEL, JSON.stringify({ spaceId, runId, eventSequence }));
  }

  async publishCurrentRun(runId: string): Promise<void> {
    const run = await this.prisma.collaborationRun.findUnique({
      where: { id: runId },
      select: { spaceId: true, eventSequence: true },
    });
    if (run) await this.publishRunChanged(run.spaceId, runId, run.eventSequence);
  }
}
