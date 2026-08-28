import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { ResolveMarkdownResourcesDto } from './markdown-resource.dto';

const productionPipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
});

function transformBody(input: unknown) {
  return productionPipe.transform(input, {
    type: 'body',
    metatype: ResolveMarkdownResourcesDto,
  });
}

describe('Markdown resource DTO validation', () => {
  it('accepts one through one hundred unique bounded references', async () => {
    const references = Array.from({ length: 100 }, (_, index) => ({
      key: `page-${index}`,
      kind: 'page' as const,
      target: `Page ${index}`,
      ...(index === 0 ? { heading: 'Overview' } : {}),
      ...(index === 1 ? { blockId: 'block-1' } : {}),
    }));

    await expect(transformBody({ sourcePageId: 'source-page', references }))
      .resolves.toEqual({ sourcePageId: 'source-page', references });
  });

  it.each([
    { references: [] },
    { references: Array.from({ length: 101 }, (_, index) => ({ key: `k-${index}`, kind: 'page', target: `p-${index}` })) },
  ])('rejects an empty or over-limit request array', async (input) => {
    await expect(transformBody(input)).rejects.toMatchObject({ status: 400 });
  });

  it.each([
    { key: '', kind: 'page', target: 'Page' },
    { key: ' '.repeat(3), kind: 'page', target: 'Page' },
    { key: 'x'.repeat(513), kind: 'page', target: 'Page' },
    { key: 'key', kind: 'page', target: '' },
    { key: 'key', kind: 'page', target: ' '.repeat(3) },
    { key: 'key', kind: 'page', target: 'x'.repeat(513) },
    { key: 'key', kind: 'other', target: 'Page' },
    { key: 'key', kind: 'page', target: 'Page', heading: '' },
    { key: 'key', kind: 'page', target: 'Page', heading: 'x'.repeat(513) },
    { key: 'key', kind: 'page', target: 'Page', blockId: '' },
    { key: 'key', kind: 'page', target: 'Page', blockId: 'not valid' },
    { key: 'key', kind: 'page', target: 'Page', blockId: 'x'.repeat(513) },
    { key: 'key', kind: 'page', target: 'Page', heading: 'H', blockId: 'block' },
    { key: 'key', kind: 'attachment', target: 'image.png', heading: 'H' },
    { key: 'key', kind: 'attachment', target: 'image.png', blockId: 'block' },
    { key: 'key', kind: 'page', target: 'Page', heading: null },
    { key: 'key', kind: 'page', target: 'Page', blockId: null },
  ])('rejects malformed or over-limit reference %j', async (reference) => {
    await expect(transformBody({ references: [reference] }))
      .rejects.toMatchObject({ status: 400 });
  });

  it('rejects unknown request and nested fields rather than accepting page content', async () => {
    await expect(transformBody({ references: [{
      key: 'page', kind: 'page', target: 'Page', content: '# secret',
    }] })).rejects.toMatchObject({ status: 400 });
    await expect(transformBody({ references: [{
      key: 'page', kind: 'page', target: 'Page',
    }], content: '# secret' })).rejects.toMatchObject({ status: 400 });
    await expect(transformBody({ references: [{
      key: 'page', kind: 'page', target: 'Page',
    }], sourcePageId: '' })).rejects.toMatchObject({ status: 400 });
  });

  it.each([
    [
      { key: 'Same', kind: 'page', target: 'One' },
      { key: ' same ', kind: 'page', target: 'Two' },
    ],
    [
      { key: 'one', kind: 'page', target: ' Cafe\u0301 ', heading: ' Intro ' },
      { key: 'two', kind: 'page', target: 'CAF\u00c9', heading: 'intro' },
    ],
  ])('fails closed on duplicate normalized keys or references', async (...references) => {
    await expect(transformBody({ references }))
      .rejects.toMatchObject({ status: 400 });
  });

  it.each([
    [
      { key: 'Stra\u00dfe', kind: 'page', target: 'One' },
      { key: 'STRASSE', kind: 'page', target: 'Two' },
    ],
    [
      { key: 'one', kind: 'page', target: '\u039f\u03a3' },
      { key: 'two', kind: 'page', target: '\u03bf\u03c3' },
    ],
  ])('rejects duplicate Unicode 15.1 full-fold identities', async (...references) => {
    await expect(transformBody({ references }))
      .rejects.toMatchObject({ status: 400 });
  });

  it('allows the same target when kind or fragment identity differs', async () => {
    const references = [
      { key: 'page', kind: 'page', target: 'Asset' },
      { key: 'attachment', kind: 'attachment', target: 'Asset' },
      { key: 'heading-a', kind: 'page', target: 'Asset', heading: 'A' },
      { key: 'heading-b', kind: 'page', target: 'Asset', heading: 'B' },
    ];
    await expect(transformBody({ references })).resolves.toEqual({ references });
  });

  it('keeps attachment duplicate identity aligned with the stored Task 3 nameKey contract', async () => {
    const references = [
      { key: 'one', kind: 'attachment', target: 'Stra\u00dfe.png' },
      { key: 'two', kind: 'attachment', target: 'STRASSE.png' },
    ];

    await expect(transformBody({ references })).resolves.toEqual({ references });
  });
});
