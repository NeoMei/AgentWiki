import { Body, Controller, Delete, Get, Headers, Param, Patch, Post, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { BusinessException } from '../core/filters/business-error';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request } from 'express';
import { CombinedAuthGuard } from '../core/auth/combined-auth.guard';
import { AuthorizationService } from '../core/authorization/authorization.service';
import { CreateSourceDto, UpdateSourceDto } from '../core/dto/source.dto';
import { IngestQueue } from './ingest.queue';
import { SourceService } from './source.service';
import { extname } from 'path';
import { decodeUtf8Source, normalizeUploadFilename } from './source-upload';

const UPLOAD_EXTENSIONS = new Set(['.md', '.txt', '.ts', '.tsx', '.js', '.jsx', '.json', '.py', '.java', '.go', '.rs', '.sql', '.yaml', '.yml']);

@Controller()
@UseGuards(CombinedAuthGuard)
export class SourceController {
  constructor(private sources: SourceService, private queue: IngestQueue, private authorization: AuthorizationService) {}

  @Post('spaces/:spaceId/sources')
  async create(@Param('spaceId') spaceId: string, @Req() req: Request, @Body() dto: CreateSourceDto) {
    await this.authorization.assertSpaceAccess(req.user as any, spaceId, ['owner', 'editor'], 'sources:write');
    return this.sources.create(spaceId, req.user as any, dto);
  }

  @Post('spaces/:spaceId/sources/file')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024, files: 1 } }))
  async upload(@Param('spaceId') spaceId: string, @Req() req: Request, @UploadedFile() file: any, @Body('name') sourceName?: string) {
    await this.authorization.assertSpaceAccess(req.user as any, spaceId, ['owner', 'editor'], 'sources:write');
    if (!file) throw new BusinessException('SOURCE_INVALID', 'A file is required');
    const filename = normalizeUploadFilename(file.originalname || '');
    if (!UPLOAD_EXTENSIONS.has(extname(filename).toLowerCase())) {
      throw new BusinessException('SOURCE_INVALID', 'Unsupported source file type');
    }
    const displayName = typeof sourceName === 'string' && sourceName.trim()
      ? sourceName.trim().normalize('NFC').slice(0, 200)
      : filename;
    return this.sources.create(spaceId, req.user as any, {
      type: 'file', name: displayName, content: decodeUtf8Source(file.buffer),
    });
  }

  @Get('spaces/:spaceId/sources')
  async list(@Param('spaceId') spaceId: string, @Req() req: Request) {
    await this.authorization.assertSpaceAccess(req.user as any, spaceId, ['owner', 'admin', 'editor', 'viewer'], 'sources:read');
    return this.sources.list(spaceId);
  }

  @Get('sources/:id')
  async get(@Param('id') id: string, @Req() req: Request) {
    await this.authorization.assertSourceAccess(req.user as any, id);
    return this.sources.get(id);
  }

  @Patch('sources/:id')
  async update(@Param('id') id: string, @Req() req: Request, @Body() dto: UpdateSourceDto) {
    await this.authorization.assertSourceAccess(req.user as any, id, ['owner', 'editor'], 'sources:write');
    return this.sources.update(id, dto, req.user as any);
  }

  @Delete('sources/:id')
  async archive(@Param('id') id: string, @Req() req: Request) {
    await this.authorization.assertSourceAccess(req.user as any, id, ['owner', 'editor'], 'sources:write');
    return this.sources.update(id, { status: 'archived' }, req.user as any);
  }

  @Post('sources/:id/runs')
  async createRun(@Param('id') id: string, @Req() req: Request, @Headers('idempotency-key') idempotencyKey?: string) {
    await this.authorization.assertSourceAccess(req.user as any, id, ['owner', 'editor'], 'runs:write');
    const run = await this.sources.createRun(id, req.user as any, idempotencyKey);
    this.queue.enqueue();
    return run;
  }

  @Get('spaces/:spaceId/runs')
  async listRuns(@Param('spaceId') spaceId: string, @Req() req: Request) {
    await this.authorization.assertSpaceAccess(req.user as any, spaceId, ['owner', 'admin', 'editor', 'viewer'], 'runs:read');
    return this.sources.listRuns(spaceId);
  }

  @Get('runs/:id')
  async getRun(@Param('id') id: string, @Req() req: Request) {
    await this.authorization.assertIngestRunAccess(req.user as any, id);
    return this.sources.getRun(id);
  }

  @Post('runs/:id/retry')
  async retry(@Param('id') id: string, @Req() req: Request) {
    await this.authorization.assertIngestRunAccess(req.user as any, id, ['owner', 'editor'], 'runs:write');
    const run = await this.sources.retryRun(id, req.user as any);
    this.queue.enqueue();
    return run;
  }

  @Post('runs/:id/cancel')
  async cancel(@Param('id') id: string, @Req() req: Request) {
    await this.authorization.assertIngestRunAccess(req.user as any, id, ['owner', 'editor'], 'runs:write');
    return this.sources.cancelRun(id, req.user as any);
  }
}
