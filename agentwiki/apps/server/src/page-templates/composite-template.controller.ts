import {
  Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Req, UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { CombinedAuthGuard } from '../core/auth/combined-auth.guard';
import { HumanOnlyGuard } from '../core/auth/human-only.guard';
import type { Principal } from '../core/authorization/authorization.service';
import {
  CompositeTemplateDetailQueryDto,
  CompositeTemplateListQueryDto,
  CreateCompositeSpaceTemplateDto,
  CreateCompositeTemplateVersionDto,
  DeletePageBindingDto,
  ExistingRunPreviewDto,
  ExistingRunStartDto,
  FolderBindingMutationDto,
  FolderBindingPreviewDto,
  FolderSnapshotPreviewDto,
  InstantiateCompositeTemplateDto,
  PageBindingMutationDto,
  PageRunPreviewDto,
  PageRunStartDto,
  PreviewCompositeTemplateDto,
  SaveFolderTemplateDto,
  UpgradeLegacyWorkflowDto,
} from './composite-template.dto';
import { PageTemplateStateDto, UpdatePageTemplateDto } from './page-template.dto';
import { CompositeTemplateCatalogService } from './composite-template-catalog.service';
import { CompositeTemplatePreviewService } from './composite-template-preview.service';
import { TemplateInstantiationService } from './template-instantiation.service';
import { FolderTemplateSnapshotService } from './folder-template-snapshot.service';
import { LegacyWorkflowUpgradeService } from './legacy-workflow-upgrade.service';
import { PageAgentBindingService } from './page-agent-binding.service';
import { ExistingRunOrchestrationService } from './existing-run-orchestration.service';
import type { RunPageSelectionBinding } from './run-page-selection';

@Controller('spaces/:spaceId')
@UseGuards(CombinedAuthGuard, HumanOnlyGuard)
export class CompositeTemplateController {
  constructor(
    private readonly catalog: CompositeTemplateCatalogService,
    private readonly preview: CompositeTemplatePreviewService,
    private readonly instantiation: TemplateInstantiationService,
    private readonly snapshots: FolderTemplateSnapshotService,
    private readonly upgrades: LegacyWorkflowUpgradeService,
    private readonly bindings: PageAgentBindingService,
    private readonly orchestration: ExistingRunOrchestrationService,
  ) {}

  @Get('templates')
  list(@Req() req: Request, @Param('spaceId') spaceId: string, @Query() query: CompositeTemplateListQueryDto) {
    return this.catalog.list(spaceId, query, req.user as Principal);
  }

  @Post('templates')
  createTemplate(@Req() req: Request, @Param('spaceId') spaceId: string, @Body() body: CreateCompositeSpaceTemplateDto) {
    return this.catalog.createSpaceTemplate(spaceId, body, req.user as Principal);
  }

  @Get('templates/:templateId')
  detail(@Req() req: Request, @Param('spaceId') spaceId: string, @Param('templateId') templateId: string, @Query() query: CompositeTemplateDetailQueryDto) {
    return this.catalog.detail(spaceId, templateId, query.version, query.locale, req.user as Principal);
  }

  @Get('templates/:templateId/management')
  managementDetail(@Req() req: Request, @Param('spaceId') spaceId: string, @Param('templateId') templateId: string, @Query() query: CompositeTemplateDetailQueryDto) {
    return this.catalog.managementDetail(spaceId, templateId, query.version, query.locale, req.user as Principal);
  }

  @Patch('templates/:templateId')
  updateTemplate(@Req() req: Request, @Param('spaceId') spaceId: string, @Param('templateId') templateId: string, @Body() body: UpdatePageTemplateDto) {
    return this.catalog.updateMetadata(spaceId, templateId, body, req.user as Principal);
  }

  @Post('templates/:templateId/versions')
  createTemplateVersion(@Req() req: Request, @Param('spaceId') spaceId: string, @Param('templateId') templateId: string, @Body() body: CreateCompositeTemplateVersionDto) {
    return this.catalog.createVersion(spaceId, templateId, body, req.user as Principal);
  }

  @Delete('templates/:templateId')
  archiveTemplate(@Req() req: Request, @Param('spaceId') spaceId: string, @Param('templateId') templateId: string, @Body() body: PageTemplateStateDto) {
    return this.catalog.archive(spaceId, templateId, body, req.user as Principal);
  }

  @Post('templates/:templateId/restore')
  restoreTemplate(@Req() req: Request, @Param('spaceId') spaceId: string, @Param('templateId') templateId: string, @Body() body: PageTemplateStateDto) {
    return this.catalog.restore(spaceId, templateId, body, req.user as Principal);
  }

  @Post('templates/from-folder/preview')
  async previewFolderTemplate(@Req() req: Request, @Param('spaceId') spaceId: string, @Body() body: FolderSnapshotPreviewDto) {
    return serializeBigInts(await this.snapshots.preview(
      spaceId, body.rootFolderId, body.selection as any, req.user as Principal,
    ));
  }

  @Post('templates/from-folder')
  saveFolderTemplate(@Req() req: Request, @Param('spaceId') spaceId: string, @Body() body: SaveFolderTemplateDto) {
    return this.snapshots.save(spaceId, body as any, req.user as Principal);
  }

  @Post('templates/:templateId/preview')
  async previewTemplate(@Req() req: Request, @Param('spaceId') spaceId: string, @Param('templateId') templateId: string, @Body() body: PreviewCompositeTemplateDto) {
    return serializeBigInts(await this.preview.preview(spaceId, templateId, body, req.user as Principal));
  }

  @Post('templates/:templateId/instantiate')
  async instantiate(@Req() req: Request, @Param('spaceId') spaceId: string, @Param('templateId') templateId: string, @Body() body: InstantiateCompositeTemplateDto) {
    return serializeBigInts(await this.instantiation.instantiate(spaceId, templateId, {
      ...body,
      roleBindings: toBindings(body.roleBindings),
      expectedTreeRevision: BigInt(body.expectedTreeRevision),
    }, req.user as Principal));
  }

  @Get('collaboration-templates/:legacyId/upgrade/source')
  legacyUpgradeSource(@Req() req: Request, @Param('spaceId') spaceId: string, @Param('legacyId') legacyId: string) {
    return this.upgrades.source(spaceId, legacyId, req.user as Principal);
  }

  @Post('collaboration-templates/:legacyId/upgrade/preview')
  previewUpgrade(@Req() req: Request, @Param('spaceId') spaceId: string, @Param('legacyId') legacyId: string, @Body() body: UpgradeLegacyWorkflowDto) {
    return this.upgrades.preview(spaceId, legacyId, body as any, req.user as Principal);
  }

  @Post('collaboration-templates/:legacyId/upgrade')
  upgrade(@Req() req: Request, @Param('spaceId') spaceId: string, @Param('legacyId') legacyId: string, @Body() body: UpgradeLegacyWorkflowDto) {
    return this.upgrades.upgrade(spaceId, legacyId, body as any, req.user as Principal);
  }

  @Get('pages/:pageId/agent-binding')
  getPageBinding(@Req() req: Request, @Param('spaceId') spaceId: string, @Param('pageId') pageId: string) {
    return this.bindings.getBinding(spaceId, pageId, req.user as Principal);
  }

  @Put('pages/:pageId/agent-binding')
  setPageBinding(@Req() req: Request, @Param('spaceId') spaceId: string, @Param('pageId') pageId: string, @Body() body: PageBindingMutationDto) {
    return this.bindings.setBindingsInScope(spaceId, {
      pageIds: [pageId], expectedTreeRevision: BigInt(body.expectedTreeRevision),
      edits: [{ pageId, agentId: body.agentId, roleSlotKey: body.roleSlotKey, expectedUpdatedAt: body.expectedUpdatedAt }],
    }, req.user as Principal);
  }

  @Delete('pages/:pageId/agent-binding')
  deletePageBinding(@Req() req: Request, @Param('spaceId') spaceId: string, @Param('pageId') pageId: string, @Body() body: DeletePageBindingDto) {
    return this.bindings.setBindingsInScope(spaceId, {
      pageIds: [pageId], expectedTreeRevision: BigInt(body.expectedTreeRevision),
      edits: [{ pageId, agentId: null, roleSlotKey: null, expectedUpdatedAt: body.expectedUpdatedAt }],
    }, req.user as Principal);
  }

  @Post('folders/:folderId/agent-bindings/preview')
  async previewFolderBindings(@Req() req: Request, @Param('spaceId') spaceId: string, @Param('folderId') folderId: string, @Body() body: FolderBindingPreviewDto) {
    return serializeBigInts(await this.orchestration.previewFolderBindings(
      spaceId, folderId, body.pageIds, req.user as Principal,
    ));
  }

  @Post('folders/:folderId/agent-bindings')
  setFolderBindings(@Req() req: Request, @Param('spaceId') spaceId: string, @Param('folderId') folderId: string, @Body() body: FolderBindingMutationDto) {
    return this.orchestration.setFolderBindings(spaceId, folderId, {
      pageIds: body.pageIds,
      expectedTreeRevision: BigInt(body.expectedTreeRevision),
      edits: body.edits,
    }, req.user as Principal);
  }

  @Get('folders/:folderId/collaboration-source')
  discoverFolderSource(@Req() req: Request, @Param('spaceId') spaceId: string, @Param('folderId') folderId: string) {
    return this.orchestration.discoverFolderSource(spaceId, folderId, req.user as Principal);
  }

  @Post('pages/:pageId/collaboration-runs/preview')
  previewPageRun(@Req() req: Request, @Param('spaceId') spaceId: string, @Param('pageId') pageId: string, @Body() body: PageRunPreviewDto) {
    return this.orchestration.preview(spaceId, pageId, {
      source: { kind: 'page_selection' }, pageIds: [pageId],
      collaborationInputs: body.collaborationInputs ?? {}, bindings: toBindings(body.bindings) ?? [],
      bindingEdits: body.bindingEdits,
      roleSlotsByPage: body.roleSlotKey === undefined
        ? undefined : [{ pageId, roleSlotKey: body.roleSlotKey }],
    }, req.user as Principal);
  }

  @Post('pages/:pageId/collaboration-runs')
  startPageRun(@Req() req: Request, @Param('spaceId') spaceId: string, @Param('pageId') pageId: string, @Body() body: PageRunStartDto) {
    return this.orchestration.start(spaceId, pageId, {
      source: { kind: 'page_selection' }, pageIds: [pageId],
      collaborationInputs: body.collaborationInputs ?? {}, bindings: toBindings(body.bindings) ?? [],
      bindingEdits: body.bindingEdits, name: body.name,
      roleSlotsByPage: body.roleSlotKey === undefined
        ? undefined : [{ pageId, roleSlotKey: body.roleSlotKey }],
      expectedTreeRevision: BigInt(body.expectedTreeRevision), idempotencyKey: body.idempotencyKey,
    }, req.user as Principal);
  }

  @Post('folders/:folderId/collaboration-runs/preview')
  previewFolderRun(@Req() req: Request, @Param('spaceId') spaceId: string, @Param('folderId') folderId: string, @Body() body: ExistingRunPreviewDto) {
    return this.orchestration.preview(spaceId, folderId, {
      ...body, source: toRunSource(body.source), bindings: toBindings(body.bindings) ?? [],
    }, req.user as Principal);
  }

  @Post('folders/:folderId/collaboration-runs')
  startFolderRun(@Req() req: Request, @Param('spaceId') spaceId: string, @Param('folderId') folderId: string, @Body() body: ExistingRunStartDto) {
    return this.orchestration.start(spaceId, folderId, {
      ...body, source: toRunSource(body.source), bindings: toBindings(body.bindings) ?? [],
      expectedTreeRevision: BigInt(body.expectedTreeRevision),
    }, req.user as Principal);
  }
}

function toBindings(items: Array<{ kind: 'task_default' | 'role_override'; nodeId?: string; roleSlotId: string; agentId: string }> | undefined): RunPageSelectionBinding[] | undefined {
  return items?.map((item) => item.kind === 'task_default'
    ? { kind: 'task_default', nodeId: item.nodeId!, roleSlotId: item.roleSlotId, agentId: item.agentId }
    : { kind: 'role_override', roleSlotId: item.roleSlotId, agentId: item.agentId });
}

function toRunSource(source: ExistingRunPreviewDto['source']):
  | { kind: 'page_selection' }
  | { kind: 'template_instantiation'; sourceInstantiationId: string } {
  return source.kind === 'page_selection'
    ? { kind: 'page_selection' }
    : { kind: 'template_instantiation', sourceInstantiationId: source.sourceInstantiationId! };
}

function serializeBigInts<T>(value: T): T {
  if (typeof value === 'bigint') return value.toString() as T;
  if (Array.isArray(value)) return value.map(serializeBigInts) as T;
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, serializeBigInts(item)])) as T;
  }
  return value;
}
