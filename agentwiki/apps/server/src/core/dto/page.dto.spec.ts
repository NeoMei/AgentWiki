import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { validate } from 'class-validator';
import { CreatePageDto, RestorePageVersionDto, UpdatePageDto } from './page.dto';

const productionPipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
});

function transformCreateBody(input: object) {
  return productionPipe.transform(input, { type: 'body', metatype: CreatePageDto });
}

describe('CreatePageDto', () => {
  it.each([
    [{ title: 'Blank', spaceId: 'space-1', expectedTreeRevision: '0' }, true],
    [{ title: 'Direct', spaceId: 'space-1', content: '# Direct', folderId: null, expectedTreeRevision: '42' }, true],
    [{ title: 'From template', spaceId: 'space-1', templateId: 'template-1', templateVersion: 2, templateLocale: 'zh-CN', folderId: 'folder-1', expectedTreeRevision: '42' }, true],
    [{ title: 'Missing revision', spaceId: 'space-1' }, false],
    [{ title: 'Leading zero revision', spaceId: 'space-1', expectedTreeRevision: '01' }, false],
    [{ title: 'Partial', spaceId: 'space-1', templateId: 'template-1', expectedTreeRevision: '1' }, false],
    [{ title: 'Mixed', spaceId: 'space-1', templateId: 'template-1', templateVersion: 2, templateLocale: 'en', content: '# Forged', expectedTreeRevision: '1' }, false],
    [{ title: 'Wrong format', spaceId: 'space-1', templateId: 'template-1', templateVersion: 2, templateLocale: 'en', format: 'html', expectedTreeRevision: '1' }, false],
    [{ title: 'Ambiguous placement', spaceId: 'space-1', folderId: 'folder-1', parentId: 'page-parent', expectedTreeRevision: '1' }, false],
  ])('validates the mutually exclusive template create shape %#', async (input, valid) => {
    if (valid) {
      await expect(transformCreateBody(input)).resolves.toBeDefined();
    } else {
      await expect(transformCreateBody(input)).rejects.toMatchObject({ status: 400 });
    }
  });

  it('rejects unknown write fields while retaining the Release A parentId input for service gating', async () => {
    await expect(transformCreateBody({
      title: 'Legacy', spaceId: 'space-1', parentId: 'page-parent', expectedTreeRevision: '1',
    })).resolves.toMatchObject({ parentId: 'page-parent' });
    await expect(transformCreateBody({
      title: 'Legacy root', spaceId: 'space-1', parentId: null, expectedTreeRevision: '1',
    })).resolves.toMatchObject({ parentId: null });
    await expect(transformCreateBody({
      title: 'Forged', spaceId: 'space-1', folderId: null, expectedTreeRevision: '1', recursive: true,
    })).rejects.toMatchObject({ status: 400 });
  });
});

describe('UpdatePageDto', () => {
  it('requires an ISO timestamp identifying the page version being edited', async () => {
    const missing = Object.assign(new UpdatePageDto(), { title: 'Updated' });
    const invalid = Object.assign(new UpdatePageDto(), { title: 'Updated', expectedUpdatedAt: 'not-a-timestamp' });
    const valid = Object.assign(new UpdatePageDto(), {
      title: 'Updated',
      expectedUpdatedAt: '2026-07-27T08:00:00.000Z',
      expectedTreeRevision: '0',
    });

    await expect(validate(missing)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ property: 'expectedUpdatedAt' }),
    ]));
    await expect(validate(invalid)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ property: 'expectedUpdatedAt' }),
    ]));
    await expect(validate(valid)).resolves.toEqual([]);
  });

  it('requires a decimal tree revision for title or Folder placement changes but not body-only edits', async () => {
    const bodyOnly = {
      expectedUpdatedAt: '2026-07-27T08:00:00.000Z', content: 'Body only',
    };
    const titleWithoutTreeRevision = {
      expectedUpdatedAt: '2026-07-27T08:00:00.000Z', title: 'Renamed',
    };
    const folderWithTreeRevision = {
      expectedUpdatedAt: '2026-07-27T08:00:00.000Z', folderId: null, expectedTreeRevision: '9',
    };

    await expect(productionPipe.transform(bodyOnly, { type: 'body', metatype: UpdatePageDto }))
      .resolves.toBeDefined();
    await expect(productionPipe.transform(titleWithoutTreeRevision, { type: 'body', metatype: UpdatePageDto }))
      .rejects.toMatchObject({ status: 400 });
    await expect(productionPipe.transform(folderWithTreeRevision, { type: 'body', metatype: UpdatePageDto }))
      .resolves.toMatchObject({ folderId: null, expectedTreeRevision: '9' });
  });

  it('rejects legacy parentId and every other unknown update field', async () => {
    await expect(productionPipe.transform({
      expectedUpdatedAt: '2026-07-27T08:00:00.000Z', parentId: 'legacy-parent',
    }, { type: 'body', metatype: UpdatePageDto })).rejects.toMatchObject({ status: 400 });
  });
});

describe('RestorePageVersionDto', () => {
  it('preserves the legacy empty body while accepting only a decimal tree revision', async () => {
    await expect(productionPipe.transform({}, {
      type: 'body', metatype: RestorePageVersionDto,
    })).resolves.toBeDefined();
    await expect(productionPipe.transform({ expectedTreeRevision: '12' }, {
      type: 'body', metatype: RestorePageVersionDto,
    })).resolves.toMatchObject({ expectedTreeRevision: '12' });
    await expect(productionPipe.transform({ expectedTreeRevision: 12 }, {
      type: 'body', metatype: RestorePageVersionDto,
    })).rejects.toMatchObject({ status: 400 });
    await expect(productionPipe.transform({ expectedTreeRevision: '12', extra: true }, {
      type: 'body', metatype: RestorePageVersionDto,
    })).rejects.toMatchObject({ status: 400 });
  });
});
