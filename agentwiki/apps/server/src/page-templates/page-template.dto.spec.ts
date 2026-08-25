import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { PageTemplateCategory } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CreatePageTemplateDto,
  CreatePageTemplateVersionDto,
  PageTemplateListQueryDto,
  PageTemplateStateDto,
  UpdatePageTemplateDto,
} from './page-template.dto';

const validCreate = {
  name: '团队周报',
  description: '汇总团队进展',
  category: PageTemplateCategory.reporting,
  defaultTitle: '团队周报',
  locale: 'zh-CN',
  sourcePageId: 'page-1',
  expectedSourceUpdatedAt: '2026-08-25T01:02:03.000Z',
};

const productionPipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
});

function transformBody<T extends object>(type: new () => T, input: object) {
  return productionPipe.transform(input, { type: 'body', metatype: type });
}

function transformQuery<T extends object>(type: new () => T, input: object) {
  return productionPipe.transform(input, { type: 'query', metatype: type });
}

async function errors<T extends object>(type: new () => T, input: object) {
  return validate(plainToInstance(type, input));
}

describe('page template DTO validation', () => {
  it('requires a supported list locale', async () => {
    await expect(errors(PageTemplateListQueryDto, {})).resolves.not.toHaveLength(0);
    await expect(errors(PageTemplateListQueryDto, { locale: 'fr' })).resolves.not.toHaveLength(0);
  });

  it('rejects a page size above 100 after query transformation', async () => {
    const input = plainToInstance(PageTemplateListQueryDto, { locale: 'en', take: '101' });
    expect(input.take).toBe(101);
    await expect(validate(input)).resolves.not.toHaveLength(0);
  });

  it('rejects invalid categories', async () => {
    await expect(errors(CreatePageTemplateDto, { ...validCreate, category: 'finance' }))
      .resolves.not.toHaveLength(0);
  });

  it('accepts Prisma PageTemplateCategory values including the Space-only other category', async () => {
    await expect(transformBody(CreatePageTemplateDto, {
      ...validCreate, category: PageTemplateCategory.other,
    })).resolves.toMatchObject({ category: PageTemplateCategory.other });
  });

  it('rejects template names longer than 80 characters', async () => {
    await expect(errors(CreatePageTemplateDto, { ...validCreate, name: 'x'.repeat(81) }))
      .resolves.not.toHaveLength(0);
  });

  it('rejects invalid ISO timestamps for all mutation preconditions', async () => {
    const [createErrors, updateErrors, versionErrors, stateErrors] = await Promise.all([
      errors(CreatePageTemplateDto, { ...validCreate, expectedSourceUpdatedAt: 'yesterday' }),
      errors(UpdatePageTemplateDto, {
        name: '团队周报', category: 'reporting', defaultTitle: '团队周报', expectedUpdatedAt: 'soon',
      }),
      errors(CreatePageTemplateVersionDto, {
        sourcePageId: 'page-1', expectedSourceUpdatedAt: 'later', expectedCurrentVersion: 1,
      }),
      errors(PageTemplateStateDto, { expectedUpdatedAt: 'now' }),
    ]);
    expect(createErrors).not.toHaveLength(0);
    expect(updateErrors).not.toHaveLength(0);
    expect(versionErrors).not.toHaveLength(0);
    expect(stateErrors).not.toHaveLength(0);
  });

  it('accepts valid list and mutation bodies', async () => {
    const cases: Array<[new () => object, object]> = [
      [PageTemplateListQueryDto, { locale: 'zh-CN', scope: 'all', archived: 'active', category: 'planning', q: '任务', skip: '0', take: '100' }],
      [CreatePageTemplateDto, validCreate],
      [UpdatePageTemplateDto, {
        name: '团队周报', description: '更新说明', category: 'reporting', defaultTitle: '团队周报',
        expectedUpdatedAt: '2026-08-25T01:02:03.000Z',
      }],
      [CreatePageTemplateVersionDto, {
        sourcePageId: 'page-1', expectedSourceUpdatedAt: '2026-08-25T01:02:03.000Z', expectedCurrentVersion: 2,
      }],
      [PageTemplateStateDto, { expectedUpdatedAt: '2026-08-25T01:02:03.000Z' }],
    ];

    for (const [type, input] of cases) {
      await expect(errors(type, input)).resolves.toHaveLength(0);
    }
  });

  it('rejects non-string raw mutation text under the production ValidationPipe', async () => {
    const invalidCreateFields = ['name', 'description', 'defaultTitle', 'sourcePageId', 'expectedSourceUpdatedAt'] as const;
    for (const field of invalidCreateFields) {
      await expect(transformBody(CreatePageTemplateDto, { ...validCreate, [field]: 123 }))
        .rejects.toMatchObject({ status: 400 });
    }

    await expect(transformBody(UpdatePageTemplateDto, {
      name: 123,
      category: PageTemplateCategory.reporting,
      defaultTitle: '团队周报',
      expectedUpdatedAt: '2026-08-25T01:02:03.000Z',
    })).rejects.toMatchObject({ status: 400 });
    await expect(transformBody(CreatePageTemplateVersionDto, {
      sourcePageId: 123,
      expectedSourceUpdatedAt: '2026-08-25T01:02:03.000Z',
      expectedCurrentVersion: 1,
    })).rejects.toMatchObject({ status: 400 });
    await expect(transformBody(PageTemplateStateDto, { expectedUpdatedAt: 123 }))
      .rejects.toMatchObject({ status: 400 });
    await expect(transformBody(CreatePageTemplateDto, { ...validCreate, description: null }))
      .rejects.toMatchObject({ status: 400 });
  });

  it('rejects a string raw expectedCurrentVersion under the production ValidationPipe', async () => {
    await expect(transformBody(CreatePageTemplateVersionDto, {
      sourcePageId: 'page-1',
      expectedSourceUpdatedAt: '2026-08-25T01:02:03.000Z',
      expectedCurrentVersion: '2',
    })).rejects.toMatchObject({ status: 400 });
  });

  it('keeps explicit numeric conversion for query skip and take', async () => {
    await expect(transformQuery(PageTemplateListQueryDto, {
      locale: 'en', skip: '2', take: '25',
    })).resolves.toMatchObject({ skip: 2, take: 25 });
  });
});
