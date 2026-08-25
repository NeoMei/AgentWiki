import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { CombinedAuthGuard } from '../core/auth/combined-auth.guard';
import { HumanOnlyGuard } from '../core/auth/human-only.guard';
import type { Principal } from '../core/authorization/authorization.service';
import {
  CreatePageTemplateDto,
  CreatePageTemplateVersionDto,
  PageTemplateListQueryDto,
  PageTemplateLocaleQueryDto,
  PageTemplateSourceListQueryDto,
  PageTemplateStateDto,
  UpdatePageTemplateDto,
} from './page-template.dto';
import { PageTemplateService } from './page-template.service';

@Controller('spaces/:spaceId/page-templates')
@UseGuards(CombinedAuthGuard, HumanOnlyGuard)
export class PageTemplateController {
  constructor(private readonly templates: PageTemplateService) {}

  @Get()
  list(
    @Req() req: Request,
    @Param('spaceId') spaceId: string,
    @Query() query: PageTemplateListQueryDto,
  ) {
    return this.templates.list(spaceId, query, req.user as Principal);
  }

  @Get('source-pages')
  listSourcePages(
    @Req() req: Request,
    @Param('spaceId') spaceId: string,
    @Query() query: PageTemplateSourceListQueryDto,
  ) {
    return this.templates.listSourcePages(spaceId, query, req.user as Principal);
  }

  @Get(':templateId')
  get(
    @Req() req: Request,
    @Param('spaceId') spaceId: string,
    @Param('templateId') templateId: string,
    @Query() query: PageTemplateLocaleQueryDto,
  ) {
    return this.templates.get(spaceId, templateId, query.locale, req.user as Principal);
  }

  @Post()
  create(
    @Req() req: Request,
    @Param('spaceId') spaceId: string,
    @Body() body: CreatePageTemplateDto,
  ) {
    return this.templates.createSpaceTemplate(spaceId, body, req.user as Principal);
  }

  @Patch(':templateId')
  update(
    @Req() req: Request,
    @Param('spaceId') spaceId: string,
    @Param('templateId') templateId: string,
    @Body() body: UpdatePageTemplateDto,
  ) {
    return this.templates.updateMetadata(spaceId, templateId, body, req.user as Principal);
  }

  @Post(':templateId/versions')
  createVersion(
    @Req() req: Request,
    @Param('spaceId') spaceId: string,
    @Param('templateId') templateId: string,
    @Body() body: CreatePageTemplateVersionDto,
  ) {
    return this.templates.createVersion(spaceId, templateId, body, req.user as Principal);
  }

  @Delete(':templateId')
  archive(
    @Req() req: Request,
    @Param('spaceId') spaceId: string,
    @Param('templateId') templateId: string,
    @Body() body: PageTemplateStateDto,
  ) {
    return this.templates.archive(spaceId, templateId, body, req.user as Principal);
  }

  @Post(':templateId/restore')
  restore(
    @Req() req: Request,
    @Param('spaceId') spaceId: string,
    @Param('templateId') templateId: string,
    @Body() body: PageTemplateStateDto,
  ) {
    return this.templates.restore(spaceId, templateId, body, req.user as Principal);
  }
}
