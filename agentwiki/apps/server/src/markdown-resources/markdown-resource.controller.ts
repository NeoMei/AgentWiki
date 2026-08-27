import { Body, Controller, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { CombinedAuthGuard } from '../core/auth/combined-auth.guard';
import type { Principal } from '../core/authorization/authorization.service';
import { ResolveMarkdownResourcesDto } from './markdown-resource.dto';
import { MarkdownResourceService } from './markdown-resource.service';

@Controller('spaces/:spaceId/markdown')
@UseGuards(CombinedAuthGuard)
export class MarkdownResourceController {
  constructor(private readonly resources: MarkdownResourceService) {}

  @Post('resolve')
  resolve(
    @Req() request: Request,
    @Param('spaceId') spaceId: string,
    @Body() body: ResolveMarkdownResourcesDto,
  ) {
    return this.resources.resolve(
      spaceId,
      body.references,
      request.user as Principal,
    );
  }
}
