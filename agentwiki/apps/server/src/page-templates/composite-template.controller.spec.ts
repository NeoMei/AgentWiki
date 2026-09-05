import {
  CanActivate, ExecutionContext, INestApplication, RequestMethod, ValidationPipe,
} from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { HttpAdapterHost } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { AddressInfo } from 'net';
import { CombinedAuthGuard } from '../core/auth/combined-auth.guard';
import { HumanOnlyGuard } from '../core/auth/human-only.guard';
import { AllExceptionsFilter } from '../core/filters/all-exceptions.filter';
import { BusinessException } from '../core/filters/business-error';
import { CompositeTemplateCatalogService } from './composite-template-catalog.service';
import { CompositeTemplatePreviewService } from './composite-template-preview.service';
import { CompositeTemplateController } from './composite-template.controller';
import { ExistingRunOrchestrationService } from './existing-run-orchestration.service';
import { FolderTemplateSnapshotService } from './folder-template-snapshot.service';
import { LegacyWorkflowUpgradeService } from './legacy-workflow-upgrade.service';
import { PageAgentBindingService } from './page-agent-binding.service';
import { TemplateInstantiationService } from './template-instantiation.service';

describe('CompositeTemplateController', () => {
  const services = {
    catalog: {
      list: jest.fn(), detail: jest.fn(), managementDetail: jest.fn(),
      createSpaceTemplate: jest.fn(), createVersion: jest.fn(), updateMetadata: jest.fn(),
      archive: jest.fn(), restore: jest.fn(),
    },
    preview: { preview: jest.fn() },
    instantiation: { instantiate: jest.fn() },
    snapshots: { preview: jest.fn(), save: jest.fn() },
    upgrades: { source: jest.fn(), preview: jest.fn(), upgrade: jest.fn() },
    bindings: { previewBindings: jest.fn(), setBindingsInScope: jest.fn() },
    orchestration: {
      preview: jest.fn(), start: jest.fn(),
      previewFolderBindings: jest.fn(), setFolderBindings: jest.fn(), discoverFolderSource: jest.fn(),
    },
  } as any;
  const controller = new CompositeTemplateController(
    services.catalog, services.preview, services.instantiation, services.snapshots,
    services.upgrades, services.bindings, services.orchestration,
  );
  const request = { user: { userId: 'user-1' } } as any;

  beforeEach(() => jest.clearAllMocks());

  it('declares the design routes behind ordered human-only guards', () => {
    expect(Reflect.getMetadata(PATH_METADATA, CompositeTemplateController)).toBe('spaces/:spaceId');
    expect(Reflect.getMetadata(GUARDS_METADATA, CompositeTemplateController))
      .toEqual([CombinedAuthGuard, HumanOnlyGuard]);
    const routes = [
      ['list', 'templates', RequestMethod.GET],
      ['detail', 'templates/:templateId', RequestMethod.GET],
      ['managementDetail', 'templates/:templateId/management', RequestMethod.GET],
      ['createTemplate', 'templates', RequestMethod.POST],
      ['updateTemplate', 'templates/:templateId', RequestMethod.PATCH],
      ['createTemplateVersion', 'templates/:templateId/versions', RequestMethod.POST],
      ['archiveTemplate', 'templates/:templateId', RequestMethod.DELETE],
      ['restoreTemplate', 'templates/:templateId/restore', RequestMethod.POST],
      ['previewTemplate', 'templates/:templateId/preview', RequestMethod.POST],
      ['instantiate', 'templates/:templateId/instantiate', RequestMethod.POST],
      ['previewFolderTemplate', 'templates/from-folder/preview', RequestMethod.POST],
      ['saveFolderTemplate', 'templates/from-folder', RequestMethod.POST],
      ['legacyUpgradeSource', 'collaboration-templates/:legacyId/upgrade/source', RequestMethod.GET],
      ['previewUpgrade', 'collaboration-templates/:legacyId/upgrade/preview', RequestMethod.POST],
      ['upgrade', 'collaboration-templates/:legacyId/upgrade', RequestMethod.POST],
      ['getPageBinding', 'pages/:pageId/agent-binding', RequestMethod.GET],
      ['setPageBinding', 'pages/:pageId/agent-binding', RequestMethod.PUT],
      ['deletePageBinding', 'pages/:pageId/agent-binding', RequestMethod.DELETE],
      ['previewFolderBindings', 'folders/:folderId/agent-bindings/preview', RequestMethod.POST],
      ['setFolderBindings', 'folders/:folderId/agent-bindings', RequestMethod.POST],
      ['discoverFolderSource', 'folders/:folderId/collaboration-source', RequestMethod.GET],
      ['previewPageRun', 'pages/:pageId/collaboration-runs/preview', RequestMethod.POST],
      ['startPageRun', 'pages/:pageId/collaboration-runs', RequestMethod.POST],
      ['previewFolderRun', 'folders/:folderId/collaboration-runs/preview', RequestMethod.POST],
      ['startFolderRun', 'folders/:folderId/collaboration-runs', RequestMethod.POST],
    ] as const;
    for (const [name, path, method] of routes) {
      const handler = (CompositeTemplateController.prototype as any)[name];
      expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(path);
      expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(method);
    }
  });

  it('returns composite records for all management writes and delegates source reads', async () => {
    const metadata = {
      name: 'Renamed', description: '', category: 'other', defaultTitle: 'Root',
      expectedUpdatedAt: '2026-09-05T00:00:00.000Z',
    } as any;
    const state = { expectedUpdatedAt: '2026-09-05T00:00:00.000Z' };
    const compositeRecord = {
      id: 'template-1', currentVersion: 1, definition: { schemaVersion: 1, kind: 'page_group' },
      definitionHash: 'a'.repeat(64),
    };
    services.catalog.updateMetadata.mockResolvedValue({ ...compositeRecord, archivedAt: null });
    services.catalog.archive.mockResolvedValue({
      ...compositeRecord, archivedAt: new Date('2026-09-05T03:00:00.000Z'),
    });
    services.catalog.restore.mockResolvedValue({ ...compositeRecord, archivedAt: null });
    await (controller as any).managementDetail(request, 'space-1', 'template-1', { locale: 'en', version: 1 });
    await expect((controller as any).updateTemplate(request, 'space-1', 'template-1', metadata))
      .resolves.toMatchObject({ definition: compositeRecord.definition, definitionHash: compositeRecord.definitionHash });
    await expect((controller as any).archiveTemplate(request, 'space-1', 'template-1', state))
      .resolves.toMatchObject({ definition: compositeRecord.definition, definitionHash: compositeRecord.definitionHash });
    await expect((controller as any).restoreTemplate(request, 'space-1', 'template-1', state))
      .resolves.toMatchObject({ definition: compositeRecord.definition, definitionHash: compositeRecord.definitionHash });
    await (controller as any).legacyUpgradeSource(request, 'space-1', 'legacy-1');
    await (controller as any).discoverFolderSource(request, 'space-1', 'folder-1');
    expect(services.catalog.managementDetail).toHaveBeenCalledWith(
      'space-1', 'template-1', 1, 'en', request.user,
    );
    expect(services.catalog.updateMetadata).toHaveBeenCalledWith(
      'space-1', 'template-1', metadata, request.user,
    );
    expect(services.catalog.archive).toHaveBeenCalledWith(
      'space-1', 'template-1', state, request.user,
    );
    expect(services.catalog.restore).toHaveBeenCalledWith(
      'space-1', 'template-1', state, request.user,
    );
    expect(services.upgrades.source).toHaveBeenCalledWith('space-1', 'legacy-1', request.user);
    expect(services.orchestration.discoverFolderSource).toHaveBeenCalledWith(
      'space-1', 'folder-1', request.user,
    );
  });

  it('converts bigint boundaries and never accepts a preview body on instantiate', async () => {
    services.preview.preview.mockResolvedValue({ treeRevision: 9007199254740993n });
    services.instantiation.instantiate.mockResolvedValue({ treeRevision: 9007199254740994n });
    await expect(controller.previewTemplate(request, 'space-1', 'template-1', {
      templateVersion: 2, locale: 'en', variables: {}, collaborationEnabled: false,
    } as any)).resolves.toEqual({ treeRevision: '9007199254740993' });
    await expect(controller.instantiate(request, 'space-1', 'template-1', {
      templateVersion: 2, locale: 'en', variables: {}, collaborationEnabled: false,
      expectedTreeRevision: '9007199254740993', idempotencyKey: 'instantiate-0001',
    } as any)).resolves.toEqual({ treeRevision: '9007199254740994' });
    expect(services.instantiation.instantiate).toHaveBeenCalledWith(
      'space-1', 'template-1', expect.objectContaining({ expectedTreeRevision: 9007199254740993n }), request.user,
    );
  });

  it('delegates page and Folder run operations with server route scope', async () => {
    await controller.startPageRun(request, 'space-1', 'page-1', {
      expectedTreeRevision: '3', idempotencyKey: 'page-run-0001', name: 'Page run',
    } as any);
    await controller.previewFolderRun(request, 'space-1', 'folder-1', {
      source: { kind: 'page_selection' }, pageIds: ['page-1'], collaborationInputs: {}, bindings: [],
    } as any);
    expect(services.orchestration.start).toHaveBeenCalledWith('space-1', 'page-1', expect.objectContaining({
      pageIds: ['page-1'], expectedTreeRevision: 3n,
    }), request.user);
    expect(services.orchestration.preview).toHaveBeenCalledWith('space-1', 'folder-1', expect.objectContaining({
      pageIds: ['page-1'], source: { kind: 'page_selection' },
    }), request.user);
  });

  it('keeps the Folder id in binding preview and mutation scope', async () => {
    await controller.previewFolderBindings(request, 'space-1', 'folder-1', {});
    await controller.setFolderBindings(request, 'space-1', 'folder-1', {
      pageIds: ['page-1'], expectedTreeRevision: '9',
      edits: [{ pageId: 'page-1', agentId: null, roleSlotKey: null, expectedUpdatedAt: null }],
    });
    expect(services.orchestration.previewFolderBindings).toHaveBeenCalledWith(
      'space-1', 'folder-1', undefined, request.user,
    );
    expect(services.orchestration.setFolderBindings).toHaveBeenCalledWith(
      'space-1', 'folder-1', expect.objectContaining({ expectedTreeRevision: 9n }), request.user,
    );
  });
});

describe('CompositeTemplateController HTTP boundary', () => {
  let app: INestApplication;
  let baseUrl: string;
  const writes = {
    createTemplate: jest.fn(), instantiate: jest.fn(), setBindings: jest.fn(), start: jest.fn(),
  };

  class PrincipalProbe implements CanActivate {
    canActivate(context: ExecutionContext) {
      const request = context.switchToHttp().getRequest();
      request.user = request.headers.authorization === 'Bearer agent-token'
        ? { userId: 'owner-1', agentId: 'agent-1', type: 'agent' }
        : request.headers.authorization === 'Bearer viewer-token'
          ? { userId: 'viewer-1', type: 'human' }
        : { userId: 'owner-1', type: 'human' };
      return true;
    }
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [CompositeTemplateController],
      providers: [
        HumanOnlyGuard,
        { provide: CompositeTemplateCatalogService, useValue: {
          list: jest.fn(), detail: jest.fn(),
          managementDetail: jest.fn().mockResolvedValue({ templateId: 'template-1' }),
          createSpaceTemplate: writes.createTemplate,
          createVersion: jest.fn(), updateMetadata: jest.fn(), archive: jest.fn(), restore: jest.fn(),
        } },
        { provide: CompositeTemplatePreviewService, useValue: { preview: jest.fn() } },
        { provide: TemplateInstantiationService, useValue: { instantiate: writes.instantiate } },
        { provide: FolderTemplateSnapshotService, useValue: {
          preview: jest.fn().mockResolvedValue({ treeRevision: 4n }), save: jest.fn(),
        } },
        { provide: LegacyWorkflowUpgradeService, useValue: {
          source: jest.fn().mockResolvedValue({ legacyId: 'legacy-1' }), preview: jest.fn(), upgrade: jest.fn(),
        } },
        { provide: PageAgentBindingService, useValue: { getBinding: jest.fn(), setBindingsInScope: writes.setBindings } },
        { provide: ExistingRunOrchestrationService, useValue: {
          preview: jest.fn(), previewFolderBindings: jest.fn(), setFolderBindings: jest.fn(),
          discoverFolderSource: jest.fn().mockResolvedValue({ source: null }),
          start: writes.start.mockImplementation((_spaceId, _scopeId, _input, principal) =>
            principal.userId === 'viewer-1'
              ? Promise.reject(new BusinessException('SPACE_ACCESS_DENIED'))
              : Promise.resolve({ runId: 'run-1' })),
        } },
      ],
    }).overrideGuard(CombinedAuthGuard).useClass(PrincipalProbe).compile();
    app = moduleRef.createNestApplication();
    app.useLogger(false);
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({
      whitelist: true, forbidNonWhitelisted: true, transform: true,
      transformOptions: { enableImplicitConversion: true },
    }));
    app.useGlobalFilters(new AllExceptionsFilter(app.get(HttpAdapterHost)));
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => app.close());
  beforeEach(() => jest.clearAllMocks());

  it('rejects an Agent at the human HTTP guard before any template write', async () => {
    const response = await fetch(`${baseUrl}/api/spaces/space-1/templates/template-1/instantiate`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer agent-token' },
      body: JSON.stringify({
        templateVersion: 1, locale: 'en', variables: {}, collaborationEnabled: false,
        expectedTreeRevision: '0', idempotencyKey: 'instantiate-0001',
      }),
    });
    expect(response.status).toBe(403);
    expect(writes.instantiate).not.toHaveBeenCalled();
  });

  it('rejects a forged unknown field under the production pipe before service execution', async () => {
    const response = await fetch(`${baseUrl}/api/spaces/space-1/templates/template-1/instantiate`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        templateVersion: 1, locale: 'en', variables: {}, collaborationEnabled: false,
        expectedTreeRevision: '0', idempotencyKey: 'instantiate-0001',
        taskPageIds: { forged: 'page-1' },
      }),
    });
    expect(response.status).toBe(400);
    expect(writes.instantiate).not.toHaveBeenCalled();
  });

  it('matches static management/source reads and rejects unknown composite write fields', async () => {
    for (const path of [
      '/api/spaces/space-1/templates/template-1/management?locale=en&version=1',
      '/api/spaces/space-1/collaboration-templates/legacy-1/upgrade/source',
      '/api/spaces/space-1/folders/folder-1/collaboration-source',
    ]) {
      const response = await fetch(`${baseUrl}${path}`);
      expect(response.status).toBe(200);
    }
    const response = await fetch(`${baseUrl}/api/spaces/space-1/templates`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Workspace', category: 'other', defaultTitle: 'Root', locale: 'en',
        definition: { schemaVersion: 1, kind: 'page_group', nodes: [], collaboration: null },
        sourcePageId: 'forged',
      }),
    });
    expect(response.status).toBe(400);
    expect(writes.createTemplate).not.toHaveBeenCalled();
  });

  it('matches static from-folder preview before the template-id preview route', async () => {
    const response = await fetch(`${baseUrl}/api/spaces/space-1/templates/from-folder/preview`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        rootFolderId: 'folder-1',
        selection: {
          excludedFolderIds: [], excludedPageIds: [], locale: 'en',
          source: { kind: 'structure_only' },
        },
      }),
    });
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ treeRevision: '4' });
  });

  it('returns Viewer service denial as HTTP 403 without a Run write', async () => {
    const response = await fetch(`${baseUrl}/api/spaces/space-1/pages/page-1/collaboration-runs`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer viewer-token' },
      body: JSON.stringify({
        name: 'Denied', expectedTreeRevision: '0', idempotencyKey: 'page-run-0001',
      }),
    });
    expect(response.status).toBe(403);
    expect(writes.start).toHaveBeenCalledTimes(1);
  });
});
