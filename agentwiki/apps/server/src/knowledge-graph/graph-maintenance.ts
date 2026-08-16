import { createHash } from 'crypto';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../database/prisma.service';
import { GraphRefreshService } from './graph-refresh.service';
@Injectable()
export class GraphMaintenance implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GraphMaintenance.name);
  private readonly pending = new Map<string, NodeJS.Timeout>();
  private sweepTimer?: NodeJS.Timeout;
  private workerEnabled = false;
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly refresh: GraphRefreshService,
  ) {}
  onModuleInit() {
    const role = String(this.config.get('PROCESS_ROLE') || 'api').toLowerCase();
    this.workerEnabled = role === 'worker' || role === 'all';
    if (!this.workerEnabled) return;
    const interval = Number(this.config.get('GRAPH_SWEEP_MS') || 6 * 60 * 60 * 1000);
    this.sweepTimer = setInterval(() => void this.sweep(), interval);
  }
  onModuleDestroy() {
    for (const timer of this.pending.values()) clearTimeout(timer);
    this.pending.clear();
    if (this.sweepTimer) clearInterval(this.sweepTimer);
  }
  enqueue(spaceId: string) {
    if (!this.workerEnabled) return;
    const existing = this.pending.get(spaceId);
    if (existing) clearTimeout(existing);
    this.pending.set(spaceId, setTimeout(() => {
      this.pending.delete(spaceId);
      void this.refresh.refresh(spaceId).catch((error: unknown) => {
        this.logger.error(`graph refresh failed for ${spaceId}: ${error instanceof Error ? error.message : String(error)}`);
      });
    }, 30_000));
  }
  async sweep() {
    const states = await this.prisma.spaceGraphState.findMany({
      where: { OR: [{ wikilinkEnabled: true }, { similarEnabled: true }, { llmEnabled: true }] },
      select: { spaceId: true, lastContentHash: true },
    });
    for (const state of states) {
      const pages = await this.prisma.page.findMany({
        where: { spaceId: state.spaceId, deletedAt: null },
        select: { id: true, content: true },
      });
      const hash = this.currentHash(pages);
      if (hash === state.lastContentHash) continue;
      await this.refresh.refresh(state.spaceId).catch((error: unknown) => {
        this.logger.error(`graph sweep failed for ${state.spaceId}: ${error instanceof Error ? error.message : String(error)}`);
      });
    }
  }
  private currentHash(pages: Array<{ id: string; content: string }>) {
    return createHash('sha256').update(pages.map((page) => `${page.id}:${page.content ?? ''}`).join('\n')).digest('hex');
  }
}
