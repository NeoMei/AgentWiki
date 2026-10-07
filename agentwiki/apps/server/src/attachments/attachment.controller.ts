import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  Query,
} from '@nestjs/common';
import type { Readable } from 'node:stream';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { CombinedAuthGuard } from '../core/auth/combined-auth.guard';
import { HumanOnlyGuard } from '../core/auth/human-only.guard';
import type { Principal } from '../core/authorization/authorization.service';
import {
  AttachmentListQueryDto,
  AttachmentRenameConfirmDto,
  AttachmentRenamePreviewDto,
  AttachmentStateDto,
} from './attachment.dto';
import { AttachmentService } from './attachment.service';

function contentDisposition(displayName: string): string {
  const normalized = displayName.normalize('NFC');
  const ascii = normalized
    .replace(/[^\x20-\x7e]/g, '_')
    .replace(/["\\]/g, '_');
  return `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(normalized)}`;
}

@Controller('spaces/:spaceId/attachments')
@UseGuards(CombinedAuthGuard)
export class SpaceAttachmentController {
  constructor(private readonly attachments: AttachmentService) {}

  @Get()
  list(
    @Req() req: Request,
    @Param('spaceId') spaceId: string,
    @Query() query: AttachmentListQueryDto,
  ) {
    return this.attachments.list(spaceId, query, req.user as Principal);
  }

  @Post()
  @UseGuards(HumanOnlyGuard)
  @UseInterceptors(FileInterceptor('file'))
  upload(
    @Req() req: Request,
    @Param('spaceId') spaceId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    if (!file) throw new BadRequestException('Attachment file is required');
    return this.attachments.upload(spaceId, file, req.user as Principal);
  }

  @Post(':attachmentId/archive')
  @UseGuards(HumanOnlyGuard)
  archive(
    @Req() req: Request,
    @Param('spaceId') spaceId: string,
    @Param('attachmentId') attachmentId: string,
    @Body() body: AttachmentStateDto,
  ) {
    return this.attachments.archive(spaceId, attachmentId, body, req.user as Principal);
  }

  @Post(':attachmentId/restore')
  @UseGuards(HumanOnlyGuard)
  restore(
    @Req() req: Request,
    @Param('spaceId') spaceId: string,
    @Param('attachmentId') attachmentId: string,
    @Body() body: AttachmentStateDto,
  ) {
    return this.attachments.restore(spaceId, attachmentId, body, req.user as Principal);
  }

  @Post(':attachmentId/rename/preview')
  @UseGuards(HumanOnlyGuard)
  previewRename(
    @Req() req: Request,
    @Param('spaceId') spaceId: string,
    @Param('attachmentId') attachmentId: string,
    @Body() body: AttachmentRenamePreviewDto,
  ) {
    return this.attachments.previewRename(spaceId, attachmentId, body, req.user as Principal);
  }

  @Post(':attachmentId/rename')
  @UseGuards(HumanOnlyGuard)
  rename(
    @Req() req: Request,
    @Param('spaceId') spaceId: string,
    @Param('attachmentId') attachmentId: string,
    @Body() body: AttachmentRenameConfirmDto,
  ) {
    return this.attachments.rename(spaceId, attachmentId, body, req.user as Principal);
  }
}

@Controller('attachments')
@UseGuards(CombinedAuthGuard)
export class AttachmentContentController {
  constructor(private readonly attachments: AttachmentService) {}

  @Get(':attachmentId/content')
  async getContent(
    @Req() req: Request,
    @Param('attachmentId') attachmentId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const content = await this.attachments.content(
      attachmentId,
      req.user as Principal,
    );
    response.setHeader('X-Content-Type-Options', 'nosniff');
    // Browser-private storage is allowed, but every reuse must pass the live
    // permission check above. Separate every supported credential transport.
    response.setHeader('Cache-Control', 'private, no-cache');
    response.vary('Authorization');
    response.vary('X-API-Key');
    response.setHeader('ETag', `"${content.contentHash}"`);
    if (req.fresh) {
      // The authorized service opened a file stream. A 304 has no body: close
      // that stream now rather than leaking its file descriptor.
      (content.stream as Readable).destroy();
      response.status(304);
      return;
    }
    response.setHeader('Content-Type', content.mimeType);
    response.setHeader('Content-Length', content.sizeBytes.toString(10));
    response.setHeader('Content-Disposition', contentDisposition(content.displayName));
    return new StreamableFile(content.stream as Readable);
  }
}
