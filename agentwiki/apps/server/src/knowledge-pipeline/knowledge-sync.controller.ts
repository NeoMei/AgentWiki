import { Controller, Get, Headers, Param, Post, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request } from 'express';
import { AuthorizationService } from '../core/authorization/authorization.service';
import { CombinedAuthGuard } from '../core/auth/combined-auth.guard';
import { BusinessException } from '../core/filters/business-error';
import { IngestQueue } from './ingest.queue';
import { KnowledgeSyncService } from './knowledge-sync.service';

@Controller()
@UseGuards(CombinedAuthGuard)
export class KnowledgeSyncController {
  constructor(
    private readonly syncs: KnowledgeSyncService,
    private readonly authorization: AuthorizationService,
    private readonly queue: IngestQueue,
  ) {}

  @Get('spaces/:spaceId/knowledge-syncs/:sourceKey')
  async state(@Param('spaceId') spaceId: string, @Param('sourceKey') sourceKey: string, @Req() req: Request) {
    await this.authorization.assertSpaceAccess(req.user as any, spaceId,
      ['owner', 'admin', 'editor', 'viewer'], 'sources:read');
    const state = await this.syncs.getState(spaceId, sourceKey);
    return {
      ...state,
      documents: state.documents.map(({ path, contentHash }) => ({ path, contentHash })),
    };
  }

  @Post('spaces/:spaceId/knowledge-syncs')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024, files: 1 } }))
  async create(
    @Param('spaceId') spaceId: string,
    @Req() req: Request,
    @UploadedFile() file: { originalname: string; buffer: Buffer } | undefined,
    @Headers('idempotency-key') idempotencyKey?: string,
    @Headers('x-agentwiki-user-confirmed') confirmed?: string,
  ) {
    await this.authorization.assertSpaceAccess(req.user as any, spaceId, ['owner', 'editor'], 'sources:write');
    await this.authorization.assertSpaceAccess(req.user as any, spaceId, ['owner', 'editor'], 'runs:write');
    if (!file || !file.originalname.toLowerCase().endsWith('.okf.json')) {
      throw new BusinessException('SOURCE_INVALID', 'A .okf.json file is required');
    }
    const result = await this.syncs.createSync(spaceId, req.user as any, file.buffer,
      idempotencyKey || '', confirmed === 'true');
    if (result.status === 'queued') this.queue.enqueue();
    return result;
  }
}
