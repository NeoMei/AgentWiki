import { ValidationPipe } from '@nestjs/common';
import { ResolvePageConflictDto } from '../collaboration-workflows/review.dto';
import {
  CompositeTemplateListQueryDto,
  ExistingRunPreviewDto,
  FolderBindingMutationDto,
  FolderBindingPreviewDto,
  FolderSnapshotPreviewDto,
  InstantiateCompositeTemplateDto,
  PreviewCompositeTemplateDto,
} from './composite-template.dto';

const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
});

describe('Composite template HTTP DTOs', () => {
  it('rejects client-forged definitions and runtime targets before preview execution', async () => {
    await expect(pipe.transform({
      templateVersion: 1,
      locale: 'en',
      rootName: 'Project',
      variables: {},
      collaborationEnabled: true,
      definition: { schemaVersion: 1 },
      taskPageIds: { task: 'page-forged' },
    }, { type: 'body', metatype: PreviewCompositeTemplateDto }))
      .rejects.toMatchObject({ status: 400 });
    await expect(pipe.transform({
      templateVersion: 1, locale: 'en', variables: {}, collaborationEnabled: true,
      roleBindings: [{ kind: 'role_override', nodeId: 'smuggled-task', roleSlotId: 'writer', agentId: 'agent-1' }],
    }, { type: 'body', metatype: PreviewCompositeTemplateDto }))
      .rejects.toMatchObject({ status: 400 });
  });

  it('preserves decimal tree revisions and rejects unknown instantiate fields', async () => {
    const body = await pipe.transform({
      templateVersion: 2,
      locale: 'zh-CN',
      variables: {},
      collaborationEnabled: false,
      expectedTreeRevision: '9007199254740993',
      idempotencyKey: 'instantiate-0001',
    }, { type: 'body', metatype: InstantiateCompositeTemplateDto });
    expect(body.expectedTreeRevision).toBe('9007199254740993');

    await expect(pipe.transform({ ...body, markdown: '# forged' }, {
      type: 'body', metatype: InstantiateCompositeTemplateDto,
    })).rejects.toMatchObject({ status: 400 });
  });

  it('keeps catalog kind and scope as independent bounded filters', async () => {
    const query = await pipe.transform({
      locale: 'en', scope: 'system', kind: 'page_group', supportsCollaboration: 'true', take: '25',
    }, { type: 'query', metatype: CompositeTemplateListQueryDto });
    expect(query).toEqual(expect.objectContaining({
      locale: 'en', scope: 'system', kind: 'page_group', supportsCollaboration: true, skip: 0, take: 25,
    }));
  });

  it('requires Folder binding edits and revision on writes but not previews', async () => {
    await expect(pipe.transform({}, {
      type: 'body', metatype: FolderBindingPreviewDto,
    })).resolves.toEqual({});
    await expect(pipe.transform({ pageIds: ['page-1'] }, {
      type: 'body', metatype: FolderBindingMutationDto,
    })).rejects.toMatchObject({ status: 400 });
    await expect(pipe.transform({
      pageIds: ['page-1'], expectedTreeRevision: '7', edits: [],
    }, { type: 'body', metatype: FolderBindingMutationDto }))
      .resolves.toEqual(expect.objectContaining({ expectedTreeRevision: '7', edits: [] }));
  });

  it('rejects fields that belong to another discriminated source branch', async () => {
    await expect(pipe.transform({
      rootFolderId: 'folder-1',
      selection: {
        excludedFolderIds: [], excludedPageIds: [], locale: 'en',
        source: { kind: 'structure_only', versionId: 'smuggled-version' },
      },
    }, { type: 'body', metatype: FolderSnapshotPreviewDto }))
      .rejects.toMatchObject({ status: 400 });
    await expect(pipe.transform({
      source: { kind: 'page_selection', sourceInstantiationId: 'smuggled-instance' },
      pageIds: ['page-1'], collaborationInputs: {}, bindings: [],
    }, { type: 'body', metatype: ExistingRunPreviewDto }))
      .rejects.toMatchObject({ status: 400 });
  });
});

describe('ResolvePageConflictDto nullable required version', () => {
  const base = {
    kind: 'regenerate',
    expectedContentHash: 'a'.repeat(64),
    idempotencyKey: 'conflict-0001',
  };

  it.each([null, 'page-version-1'])('accepts explicit expectedPageVersionId %p', async (value) => {
    const result = await pipe.transform({ ...base, expectedPageVersionId: value }, {
      type: 'body', metatype: ResolvePageConflictDto,
    });
    expect(result.expectedPageVersionId).toBe(value);
  });

  it('rejects a missing expectedPageVersionId', async () => {
    await expect(pipe.transform(base, { type: 'body', metatype: ResolvePageConflictDto }))
      .rejects.toMatchObject({ status: 400 });
  });
});
