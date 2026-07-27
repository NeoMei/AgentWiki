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
  async upload(@Param('spaceId') spaceId: string, @Req() req: Request, @UploadedFile() file: any) {
    await this.authorization.assertSpaceAccess(req.user as any, spaceId, ['owner', 'editor'], 'sources:write');
    if (!file) throw new BusinessException('SOURCE_INVALID', 'A file is required');
    if (!UPLOAD_EXTENSIONS.has(extname(file.originalname || '').toLowerCase())) {
      throw new BusinessException('SOURCE_INVALID', 'Unsupported source file type');
    }
    return this.sources.create(spaceId, req.user as any, {
      type: 'file', name: file.originalname, content: file.buffer.toString('utf8'),
    });
  }

  @Get('spaces/:spaceId/sources')
  async list(@Param('spaceId') spaceId: string, @Req() req: Request) {
    await this.authorization.assertSpaceAccess(req.user as any, spaceId, ['owner', 'editor', 'viewer'], 'sources:read');
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
    return this.sources.update(id, dto);
  }

  @Delete('sources/:id')
  async archive(@Param('id') id: string, @Req() req: Request) {
    await this.authorization.assertSourceAccess(req.user as any, id, ['owner', 'editor'], 'sources:write');
    return this.sources.update(id, { status: 'archived' });
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
    await this.authorization.assertSpaceAccess(req.user as any, spaceId, ['owner', 'editor', 'viewer'], 'runs:read');
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
    const run = await this.sources.retryRun(id);
    this.queue.enqueue();
    return run;
  }

  @Post('runs/:id/cancel')
  async cancel(@Param('id') id: string, @Req() req: Request) {
    await this.authorization.assertIngestRunAccess(req.user as any, id, ['owner', 'editor'], 'runs:write');
    return this.sources.cancelRun(id);
  }
}
