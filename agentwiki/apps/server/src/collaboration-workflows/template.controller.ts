import { Body, Controller, Get, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { CombinedAuthGuard } from '../core/auth/combined-auth.guard';
import { HumanOnlyGuard } from '../core/auth/human-only.guard';
import type { Principal } from '../core/authorization/authorization.service';
import {
  ArchiveTemplateDto,
  CopyTemplateDto,
  CreateTemplateDto,
  UpdateTemplateDto,
  ValidateTemplateDto,
} from './template.dto';
import { TemplateService } from './template.service';

@Controller('spaces/:spaceId/collaboration/templates')
@UseGuards(CombinedAuthGuard, HumanOnlyGuard)
export class TemplateController {
  constructor(private readonly templates: TemplateService) {}

  @Get()
  list(@Req() req: Request, @Param('spaceId') spaceId: string) {
    return this.templates.list(spaceId, req.user as Principal);
  }

  @Post()
  create(
    @Req() req: Request,
    @Param('spaceId') spaceId: string,
    @Body() body: CreateTemplateDto,
  ) {
    return this.templates.createSpaceTemplate(spaceId, body, req.user as Principal);
  }

  @Post('validate')
  validate(
    @Req() req: Request,
    @Param('spaceId') spaceId: string,
    @Body() body: ValidateTemplateDto,
  ) {
    return this.templates.validateDefinition(spaceId, body.definition, req.user as Principal);
  }

  @Get(':templateId')
  get(
    @Req() req: Request,
    @Param('spaceId') spaceId: string,
    @Param('templateId') templateId: string,
  ) {
    return this.templates.get(spaceId, templateId, req.user as Principal);
  }

  @Post(':templateId/copy')
  copy(
    @Req() req: Request,
    @Param('spaceId') spaceId: string,
    @Param('templateId') templateId: string,
    @Body() body: CopyTemplateDto,
  ) {
    return this.templates.copySystemTemplate(spaceId, templateId, body.name, req.user as Principal);
  }

  @Put(':templateId')
  update(
    @Req() req: Request,
    @Param('spaceId') spaceId: string,
    @Param('templateId') templateId: string,
    @Body() body: UpdateTemplateDto,
  ) {
    return this.templates.updateSpaceTemplate(
      spaceId,
      templateId,
      body,
      req.user as Principal,
    );
  }

  @Post(':templateId/archive')
  archive(
    @Req() req: Request,
    @Param('spaceId') spaceId: string,
    @Param('templateId') templateId: string,
    @Body() body: ArchiveTemplateDto,
  ) {
    return this.templates.archiveSpaceTemplate(
      spaceId,
      templateId,
      body.expectedVersion,
      req.user as Principal,
    );
  }
}
