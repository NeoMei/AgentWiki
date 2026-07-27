import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { MemoryService } from './memory.service';

@Injectable()
export class MemoryMaintenance implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  constructor(private readonly memories: MemoryService) {}
  onModuleInit() {
    void this.memories.archiveExpired();
    this.timer = setInterval(() => void this.memories.archiveExpired(), 60 * 60 * 1000);
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }
}
