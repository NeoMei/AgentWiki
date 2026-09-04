import {
  ForbiddenException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../database/prisma.service';
import { GraphRefreshService, graphSnapshotHash } from './graph-refresh.service';

function isDeletedSpaceRefresh(error: unknown): boolean {
  return error instanceof ForbiddenException && error.message === 'Space not found';
}

@Injectable()
export class GraphMaintenance implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GraphMaintenance.name);
  private readonly pending = new Map<string, NodeJS.Timeout>();
  private sweepTimer?: NodeJS.Timeout;
  private sweepEnabled = false;
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly refresh: GraphRefreshService,
  ) {}
  onModuleInit() {
    const role = String(this.config.get('PROCESS_ROLE') || 'api').toLowerCase();
    this.sweepEnabled = role === 'worker' || role === 'all';
    if (!this.sweepEnabled) return;
    const interval = Number(this.config.get('GRAPH_SWEEP_MS') || 6 * 60 * 60 * 1000);
    this.sweepTimer = setInterval(() => void this.safeSweep(), interval);
  }
  onModuleDestroy() {
    for (const timer of this.pending.values()) clearTimeout(timer);
    this.pending.clear();
    if (this.sweepTimer) clearInterval(this.sweepTimer);
  }
  enqueue(spaceId: string) {
    const existing = this.pending.get(spaceId);
    if (existing) clearTimeout(existing);
    this.pending.set(spaceId, setTimeout(() => {
      this.pending.delete(spaceId);
      void this.refresh.refresh(spaceId).catch((error: unknown) => {
        if (isDeletedSpaceRefresh(error)) return;
        this.logger.error(`graph refresh failed for ${spaceId}: ${error instanceof Error ? error.message : String(error)}`);
      });
    }, 30_000));
  }
  async sweep() {
    const spaces = await this.prisma.space.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        graphState: {
          select: {
            wikilinkEnabled: true,
            similarEnabled: true,
            llmEnabled: true,
            lastContentHash: true,
          },
        },
      },
    });
    for (const space of spaces) {
      const state = space.graphState;
      if (state && !state.wikilinkEnabled && !state.similarEnabled && !state.llmEnabled) continue;
      const pages = await this.prisma.page.findMany({
        where: { spaceId: space.id, deletedAt: null },
        select: { id: true, updatedAt: true },
      });
      const hash = graphSnapshotHash(pages);
      if (hash === state?.lastContentHash) continue;
      await this.refresh.refresh(space.id).catch((error: unknown) => {
        if (isDeletedSpaceRefresh(error)) return;
        this.logger.error(`graph sweep failed for ${space.id}: ${error instanceof Error ? error.message : String(error)}`);
      });
    }
  }

  private async safeSweep() {
    try {
      await this.sweep();
    } catch (error) {
      this.logger.error(`graph sweep failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
