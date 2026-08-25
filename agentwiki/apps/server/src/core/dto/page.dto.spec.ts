import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { validate } from 'class-validator';
import { CreatePageDto, UpdatePageDto } from './page.dto';

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
    [{ title: 'Blank', spaceId: 'space-1' }, true],
    [{ title: 'Direct', spaceId: 'space-1', content: '# Direct' }, true],
    [{ title: 'From template', spaceId: 'space-1', templateId: 'template-1', templateVersion: 2, templateLocale: 'zh-CN' }, true],
    [{ title: 'Partial', spaceId: 'space-1', templateId: 'template-1' }, false],
    [{ title: 'Mixed', spaceId: 'space-1', templateId: 'template-1', templateVersion: 2, templateLocale: 'en', content: '# Forged' }, false],
    [{ title: 'Wrong format', spaceId: 'space-1', templateId: 'template-1', templateVersion: 2, templateLocale: 'en', format: 'html' }, false],
  ])('validates the mutually exclusive template create shape %#', async (input, valid) => {
    if (valid) {
      await expect(transformCreateBody(input)).resolves.toBeDefined();
    } else {
      await expect(transformCreateBody(input)).rejects.toMatchObject({ status: 400 });
    }
  });
});

describe('UpdatePageDto', () => {
  it('requires an ISO timestamp identifying the page version being edited', async () => {
    const missing = Object.assign(new UpdatePageDto(), { title: 'Updated' });
    const invalid = Object.assign(new UpdatePageDto(), { title: 'Updated', expectedUpdatedAt: 'not-a-timestamp' });
    const valid = Object.assign(new UpdatePageDto(), { title: 'Updated', expectedUpdatedAt: '2026-07-27T08:00:00.000Z' });

    await expect(validate(missing)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ property: 'expectedUpdatedAt' }),
    ]));
    await expect(validate(invalid)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ property: 'expectedUpdatedAt' }),
    ]));
    await expect(validate(valid)).resolves.toEqual([]);
  });
});
