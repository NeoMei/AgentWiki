import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  AttachmentListQueryDto,
  AttachmentRenameConfirmDto,
  AttachmentRenamePreviewDto,
  AttachmentStateDto,
} from './attachment.dto';

const productionPipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
});

function transformQuery<T extends object>(type: new () => T, input: object) {
  return productionPipe.transform(input, { type: 'query', metatype: type });
}

function transformBody<T extends object>(type: new () => T, input: object) {
  return productionPipe.transform(input, { type: 'body', metatype: type });
}

describe('attachment DTO validation', () => {
  it('applies stable active-list pagination defaults', async () => {
    await expect(transformQuery(AttachmentListQueryDto, {})).resolves.toEqual({
      status: 'active',
      skip: 0,
      take: 100,
    });
  });

  it.each([
    { take: '0' },
    { take: '101' },
    { take: '1.5' },
    { skip: '-1' },
    { skip: '1e100' },
  ])('rejects invalid pagination %j', async (input) => {
    await expect(transformQuery(AttachmentListQueryDto, input))
      .rejects.toMatchObject({ status: 400 });
  });

  it('accepts pagination from one through one hundred and explicit status filters', async () => {
    await expect(transformQuery(AttachmentListQueryDto, {
      q: '图片', status: 'archived', skip: '2', take: '1',
    })).resolves.toEqual({ q: '图片', status: 'archived', skip: 2, take: 1 });
    await expect(transformQuery(AttachmentListQueryDto, { status: 'all', take: '100' }))
      .resolves.toMatchObject({ status: 'all', take: 100 });
  });

  it('rejects query text over 80 characters and unknown status values', async () => {
    await expect(validate(plainToInstance(AttachmentListQueryDto, { q: 'x'.repeat(81) })))
      .resolves.not.toHaveLength(0);
    await expect(transformQuery(AttachmentListQueryDto, { status: 'deleted' }))
      .rejects.toMatchObject({ status: 400 });
  });

  it('requires a strict ISO expectedUpdatedAt and rejects implicit body conversion', async () => {
    await expect(transformBody(AttachmentStateDto, {
      expectedUpdatedAt: '2026-08-27T01:02:03.000Z',
    })).resolves.toEqual({ expectedUpdatedAt: '2026-08-27T01:02:03.000Z' });
    for (const expectedUpdatedAt of ['now', '2026-08-27', 123]) {
      await expect(transformBody(AttachmentStateDto, { expectedUpdatedAt }))
        .rejects.toMatchObject({ status: 400 });
    }
  });

  it('rejects non-whitelisted list and state fields', async () => {
    await expect(transformQuery(AttachmentListQueryDto, { extra: 'no' }))
      .rejects.toMatchObject({ status: 400 });
    await expect(transformBody(AttachmentStateDto, {
      expectedUpdatedAt: '2026-08-27T01:02:03.000Z', extra: 'no',
    })).rejects.toMatchObject({ status: 400 });
  });

  it('accepts a strict rename preview name and no concurrency fields', async () => {
    await expect(transformBody(AttachmentRenamePreviewDto, {
      displayName: 'Renamed image.png',
    })).resolves.toEqual({ displayName: 'Renamed image.png' });
    await expect(transformBody(AttachmentRenamePreviewDto, {
      displayName: 'Renamed image.png', expectedUpdatedAt: '2026-09-05T00:00:00.000Z',
    })).rejects.toMatchObject({ status: 400 });
  });

  it('requires only the opaque preview token for rename confirmation', async () => {
    const valid = { previewToken: 'v1.valid-preview-token' };
    await expect(transformBody(AttachmentRenameConfirmDto, valid))
      .resolves.toEqual(valid);
    for (const input of [
      { previewToken: '' },
      { previewToken: 17 },
      { previewToken: 'x'.repeat(16_385) },
      { ...valid, displayName: 'swapped.png' },
      { ...valid, expectedUpdatedAt: '2026-09-05T00:00:00.000Z' },
      { ...valid, expectedTreeRevision: '17' },
      { ...valid, extra: 'not-allowed' },
    ]) {
      await expect(transformBody(AttachmentRenameConfirmDto, input))
        .rejects.toMatchObject({ status: 400 });
    }
  });
});
