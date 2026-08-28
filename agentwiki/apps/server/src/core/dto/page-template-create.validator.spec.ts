import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { CreatePageDto } from './page.dto';

const productionPipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
});

function transformBody(input: object) {
  return productionPipe.transform(input, { type: 'body', metatype: CreatePageDto });
}

describe('IsPageTemplateCreateShape', () => {
  it.each([
    [{ title: 'Blank', spaceId: 'space-1', expectedTreeRevision: '0' }, true],
    [{ title: 'Only id', spaceId: 'space-1', templateId: 'template-1' }, false],
    [{ title: 'Id and version', spaceId: 'space-1', templateId: 'template-1', templateVersion: 2 }, false],
    [{ title: 'Version and locale only', spaceId: 'space-1', templateVersion: 2, templateLocale: 'en' }, false],
    [{ title: 'All fields', spaceId: 'space-1', templateId: 'template-1', templateVersion: 2, templateLocale: 'zh-CN', expectedTreeRevision: '0' }, true],
    [{ title: 'Mixed', spaceId: 'space-1', templateId: 'template-1', templateVersion: 2, templateLocale: 'en', content: '# Forged' }, false],
    [{ title: 'Wrong format', spaceId: 'space-1', templateId: 'template-1', templateVersion: 2, templateLocale: 'en', format: 'html' }, false],
  ])('validates template-field completeness and content exclusivity %#', async (input, valid) => {
    if (valid) {
      await expect(transformBody(input)).resolves.toBeDefined();
    } else {
      await expect(transformBody(input)).rejects.toMatchObject({ status: 400 });
    }
  });

  it.each([
    ['empty templateId', ''],
    ['whitespace templateId', '   '],
    ['numeric templateId', 123],
    ['boolean templateId', true],
    ['null templateId', null],
    ['array templateId', []],
    ['object templateId', {}],
  ])('rejects %s under the production ValidationPipe', async (_case, templateId) => {
    await expect(transformBody({
      title: 'From template', spaceId: 'space-1', templateId,
      templateVersion: 2, templateLocale: 'en',
    })).rejects.toMatchObject({ status: 400 });
  });

  it.each([
    ['string templateVersion', '2'],
    ['boolean templateVersion', true],
    ['null templateVersion', null],
    ['array templateVersion', []],
    ['object templateVersion', {}],
  ])('rejects %s under the production ValidationPipe', async (_case, templateVersion) => {
    await expect(transformBody({
      title: 'From template', spaceId: 'space-1', templateId: 'template-1',
      templateVersion, templateLocale: 'en',
    })).rejects.toMatchObject({ status: 400 });
  });

  it.each([
    ['numeric templateLocale', 123],
    ['boolean templateLocale', true],
    ['null templateLocale', null],
    ['array templateLocale', []],
    ['object templateLocale', {}],
  ])('rejects %s under the production ValidationPipe', async (_case, templateLocale) => {
    await expect(transformBody({
      title: 'From template', spaceId: 'space-1', templateId: 'template-1',
      templateVersion: 2, templateLocale,
    })).rejects.toMatchObject({ status: 400 });
  });

  it.each([
    ['all null', { templateId: null, templateVersion: null, templateLocale: null }],
    ['mixed null', { templateId: null, templateVersion: 2, templateLocale: 'en' }],
    ['templateId-only null', { templateId: null }],
    ['templateVersion-only null', { templateVersion: null }],
    ['templateLocale-only null', { templateLocale: null }],
  ])('rejects %s template fields under the production ValidationPipe', async (_case, fields) => {
    await expect(transformBody({ title: 'Invalid', spaceId: 'space-1', ...fields }))
      .rejects.toMatchObject({ status: 400 });
  });
});
