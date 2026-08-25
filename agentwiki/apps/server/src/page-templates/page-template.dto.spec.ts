import 'reflect-metadata';
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
  category: 'reporting',
  defaultTitle: '团队周报',
  locale: 'zh-CN',
  sourcePageId: 'page-1',
  expectedSourceUpdatedAt: '2026-08-25T01:02:03.000Z',
};

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
});
