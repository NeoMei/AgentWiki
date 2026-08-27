import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../../api/client';
import {
  collectMarkdownResourceOccurrences,
  collectMarkdownResourceRefs,
  extractMarkdownSection,
  resolveMarkdownResources,
} from './resources';

vi.mock('../../api/client', () => ({
  default: { post: vi.fn() },
}));

describe('collectMarkdownResourceRefs', () => {
  it('returns exact source ranges only for syntax-valid Wiki links', () => {
    const source = [
      '[[Real page]]',
      '`[[Real page]]`',
      '```md',
      '[[Real page]]',
      '```',
      '[ordinary [[Real page]]](https://example.com)',
      '[[Real page#Heading|Alias]]',
      '![[Real page]]',
    ].join('\n');

    const occurrences = collectMarkdownResourceOccurrences(source);

    expect(occurrences.map(({ from, to, reference }) => ({
      literal: source.slice(from, to),
      target: reference.target,
      heading: reference.heading,
    }))).toEqual([
      { literal: '[[Real page]]', target: 'Real page', heading: undefined },
      { literal: '[[Real page#Heading|Alias]]', target: 'Real page', heading: 'Heading' },
    ]);
  });

  it('collects explicit AST wiki/embed nodes, preserves fragments and classifies embedded images', () => {
    const refs = collectMarkdownResourceRefs([
      '[[Road Map|Plan]] and [[Road Map#Intro]]',
      '',
      '![[Chapter#Details|Excerpt]] ![[diagram.PNG|Architecture]]',
      '',
      '`[[ignored]]`',
      '',
      '```md',
      '![[also-ignored.png]]',
      '```',
    ].join('\n'));

    expect(refs).toEqual([
      expect.objectContaining({ kind: 'page', target: 'Road Map' }),
      expect.objectContaining({ kind: 'page', target: 'Road Map', heading: 'Intro' }),
      expect.objectContaining({ kind: 'page', target: 'Chapter', heading: 'Details' }),
      expect.objectContaining({ kind: 'attachment', target: 'diagram.PNG' }),
    ]);
  });

  it('dedupes canonical NFC/case-insensitive identities without treating aliases as identity', () => {
    const refs = collectMarkdownResourceRefs('[[  CAFÉ |One]] [[cafe\u0301|Two]] ![[PIC.PNG|One]] ![[pic.png|Two]]');

    expect(refs).toHaveLength(2);
    expect(refs.map((ref) => ref.kind)).toEqual(['page', 'attachment']);
  });

  it('full-folds page identities while preserving the attachment-name identity contract', () => {
    const refs = collectMarkdownResourceRefs(
      '[[Straße]] [[STRASSE]] [[ΟΣ]] [[οσ]] ![[Straße.png]] ![[STRASSE.png]]',
    );

    expect(refs.map(({ kind, target }) => ({ kind, target }))).toEqual([
      { kind: 'page', target: 'Straße' },
      { kind: 'page', target: 'ΟΣ' },
      { kind: 'attachment', target: 'Straße.png' },
      { kind: 'attachment', target: 'STRASSE.png' },
    ]);
  });

  it('rejects more than 100 unique identities before any API request', async () => {
    const source = Array.from({ length: 101 }, (_, index) => `[[Page ${index}]]`).join(' ');

    expect(() => collectMarkdownResourceRefs(source)).toThrow('Markdown resource limit exceeded');
    expect(api.post).not.toHaveBeenCalled();
  });

  it('allows an explicit editor collection limit and batches 201 references through the 100-item resolver contract', async () => {
    const source = Array.from({ length: 201 }, (_, index) => `[[Page ${index}]]`).join('\n');
    const references = collectMarkdownResourceRefs(source, { maxReferences: 250 });
    vi.mocked(api.post).mockImplementation(async (_url, body) => ({
      data: (body as { references: Array<{ key: string }> }).references.map((reference) => ({
        key: reference.key,
        status: 'unresolved',
      })),
    }));

    const resources = await resolveMarkdownResources('space-editor', references);

    expect(resources).toHaveProperty('size', 201);
    expect(api.post).toHaveBeenCalledTimes(3);
    expect(vi.mocked(api.post).mock.calls.map(([, body]) => (body as any).references.length)).toEqual([100, 100, 1]);
  });

  it('accepts a 512-character target and rejects a 513-character target locally', () => {
    expect(collectMarkdownResourceRefs(`[[${'a'.repeat(512)}]]`)).toHaveLength(1);
    expect(() => collectMarkdownResourceRefs(`[[${'a'.repeat(513)}]]`)).toThrow(
      'Markdown resource reference is too long',
    );
    expect(api.post).not.toHaveBeenCalled();
  });

  it.each([
    [300, true],
    [512, true],
    [513, false],
  ])('counts %i non-BMP target characters as Unicode code points', (count, accepted) => {
    const collect = () => collectMarkdownResourceRefs(`[[${'😀'.repeat(count)}]]`);
    if (accepted) expect(collect()).toHaveLength(1);
    else expect(collect).toThrow('Markdown resource reference is too long');
    expect(api.post).not.toHaveBeenCalled();
  });

  it.each([
    ['BMP characters', 'a', 512, true],
    ['BMP characters', 'a', 513, false],
    ['surrogate-pair characters', '😀', 512, true],
    ['surrogate-pair characters', '😀', 513, false],
    ['presentation sequences', '❤️', 257, true],
    ['presentation sequences', '❤️', 512, true],
    ['presentation sequences', '❤️', 513, false],
  ])('matches validator.js length for %s (%s × %i)', (_kind, unit, count, accepted) => {
    const collect = () => collectMarkdownResourceRefs(`[[${unit.repeat(count)}]]`);
    if (accepted) expect(collect()).toHaveLength(1);
    else expect(collect).toThrow('Markdown resource reference is too long');
    expect(api.post).not.toHaveBeenCalled();
  });

  it.each([
    ['![[image.png#Heading]] [[Good Page]]'],
    ['![[image.png#^|Picture]] [[Good Page]]'],
    ['![[Page#^bad id]] [[Good Page]]'],
    ['![[Page#^block-one]] [[Good Page]]'],
    ['![[Page#^|Alias]] [[Good Page]]'],
  ])('skips unsupported embed fragments without poisoning valid references: %s', (source) => {
    expect(collectMarkdownResourceRefs(source)).toEqual([
      expect.objectContaining({ kind: 'page', target: 'Good Page' }),
    ]);
  });
});

describe('resolveMarkdownResources', () => {
  beforeEach(() => vi.clearAllMocks());

  it('revalidates exported request inputs before calling the API', async () => {
    await expect(resolveMarkdownResources('space-1', [{
      canonicalKey: 'oversized',
      kind: 'page',
      target: 'a'.repeat(513),
    }])).rejects.toThrow('Markdown resource reference is too long');
    expect(api.post).not.toHaveBeenCalled();
  });

  it.each([
    [300, true],
    [512, true],
    [513, false],
  ])('revalidates %i non-BMP target characters by Unicode code point', async (count, accepted) => {
    const references = [{ canonicalKey: `emoji-${count}`, kind: 'page' as const, target: '😀'.repeat(count) }];
    if (accepted) {
      vi.mocked(api.post).mockResolvedValue({ data: [{ key: 'r0', status: 'unresolved' }] });
      await expect(resolveMarkdownResources('space-1', references)).resolves.toHaveProperty('size', 1);
    } else {
      await expect(resolveMarkdownResources('space-1', references)).rejects.toThrow(
        'Markdown resource reference is too long',
      );
      expect(api.post).not.toHaveBeenCalled();
    }
  });

  it.each([
    ['BMP characters', 'a', 512, true],
    ['BMP characters', 'a', 513, false],
    ['surrogate-pair characters', '😀', 512, true],
    ['surrogate-pair characters', '😀', 513, false],
    ['presentation sequences', '❤️', 257, true],
    ['presentation sequences', '❤️', 512, true],
    ['presentation sequences', '❤️', 513, false],
  ])('revalidates validator.js length for %s (%s × %i)', async (_kind, unit, count, accepted) => {
    const references = [{ canonicalKey: `${_kind}-${count}`, kind: 'page' as const, target: unit.repeat(count) }];
    if (accepted) {
      vi.mocked(api.post).mockResolvedValue({ data: [{ key: 'r0', status: 'unresolved' }] });
      await expect(resolveMarkdownResources('space-1', references)).resolves.toHaveProperty('size', 1);
    } else {
      await expect(resolveMarkdownResources('space-1', references)).rejects.toThrow(
        'Markdown resource reference is too long',
      );
      expect(api.post).not.toHaveBeenCalled();
    }
  });

  it.each([
    ['non-array input', null],
    ['empty array', []],
    ['blank target', [{ canonicalKey: 'blank', kind: 'page', target: '   ' }]],
    ['both fragments', [{ canonicalKey: 'both', kind: 'page', target: 'Page', heading: 'H', blockId: 'block' }]],
    ['invalid block', [{ canonicalKey: 'block', kind: 'page', target: 'Page', blockId: 'bad id' }]],
    ['attachment heading', [{ canonicalKey: 'image-heading', kind: 'attachment', target: 'image.png', heading: 'H' }]],
    ['attachment block', [{ canonicalKey: 'image-block', kind: 'attachment', target: 'image.png', blockId: 'block' }]],
    ['invalid kind', [{ canonicalKey: 'kind', kind: 'other', target: 'Page' }]],
    ['duplicate page identity', [
      { canonicalKey: 'one', kind: 'page', target: 'Straße' },
      { canonicalKey: 'two', kind: 'page', target: 'STRASSE' },
    ]],
    ['duplicate attachment identity', [
      { canonicalKey: 'one', kind: 'attachment', target: 'PIC.PNG' },
      { canonicalKey: 'two', kind: 'attachment', target: 'pic.png' },
    ]],
  ])('rejects an exported request that the server DTO rejects: %s', async (_case, references) => {
    await expect(resolveMarkdownResources('space-1', references as any)).rejects.toThrow(
      'Invalid Markdown resource request',
    );
    expect(api.post).not.toHaveBeenCalled();
  });

  it('uses an encoded Space path, excludes source/aliases and maps strict keyed responses', async () => {
    const references = collectMarkdownResourceRefs('[[Page#Heading|Alias]] ![[diagram.png|Picture]]');
    vi.mocked(api.post).mockImplementation(async (_url, body) => ({
      data: (body as { references: Array<{ key: string; kind: string }> }).references.map((ref) => ref.kind === 'page'
        ? { key: ref.key, status: 'resolved', kind: 'page', pageId: 'page-1', title: 'Page', slug: 'page' }
        : { key: ref.key, status: 'resolved', kind: 'attachment', attachmentId: 'attachment-1', displayName: 'diagram.png', mimeType: 'image/png', width: 800, height: 600 }),
    }));
    const signal = new AbortController().signal;

    const result = await resolveMarkdownResources('space /?#', references, signal);

    const [url, body, config] = vi.mocked(api.post).mock.calls[0];
    expect(url).toBe('/spaces/space%20%2F%3F%23/markdown/resolve');
    expect(config).toEqual({ signal });
    expect(body).toEqual({ references: [
      { key: 'r0', kind: 'page', target: 'Page', heading: 'Heading' },
      { key: 'r1', kind: 'attachment', target: 'diagram.png' },
    ] });
    expect(JSON.stringify(body)).not.toContain('Alias');
    expect(result.size).toBe(2);
    expect([...result.values()]).toEqual([
      expect.objectContaining({ status: 'resolved', kind: 'page', pageId: 'page-1' }),
      expect.objectContaining({ status: 'resolved', kind: 'attachment', attachmentId: 'attachment-1' }),
    ]);
  });

  it('keeps attachment Straße and STRASSE identities distinct like the server DTO', async () => {
    const references = collectMarkdownResourceRefs('![[Straße.png]] ![[STRASSE.png]]');
    vi.mocked(api.post).mockImplementation(async (_url, body) => ({
      data: (body as { references: Array<{ key: string; target: string }> }).references.map((ref) => ({
        key: ref.key,
        status: 'resolved',
        kind: 'attachment',
        attachmentId: ref.target,
        displayName: ref.target,
        mimeType: 'image/png',
        width: 1,
        height: 1,
      })),
    }));

    await expect(resolveMarkdownResources('space-1', references)).resolves.toHaveProperty('size', 2);
  });

  it.each([
    ['missing key', [{ key: 'r0', status: 'unresolved' }]],
    ['duplicate key', [{ key: 'r0', status: 'unresolved' }, { key: 'r0', status: 'unresolved' }]],
    ['unknown key', [{ key: 'other', status: 'unresolved' }]],
    ['kind mismatch', [{ key: 'r0', status: 'resolved', kind: 'attachment', attachmentId: 'a', displayName: 'x.png', mimeType: 'image/png', width: 1, height: 1 }]],
  ])('rejects a malformed resolver response: %s', async (_case, data) => {
    const references = collectMarkdownResourceRefs('[[Page]] ![[image.png]]');
    vi.mocked(api.post).mockResolvedValue({ data });

    await expect(resolveMarkdownResources('space-1', references)).rejects.toThrow('Invalid Markdown resource response');
  });
});

describe('extractMarkdownSection', () => {
  const source = [
    '# Top',
    '',
    'before',
    '',
    '## Target',
    '',
    '  preserved spacing  ',
    '',
    '### Nested',
    '',
    'nested body',
    '',
    '## Next',
    '',
    'after',
  ].join('\n');

  it('returns the original source slice through but excluding the next same/higher heading', () => {
    expect(extractMarkdownSection(source, 'Target')).toBe(
      '## Target\n\n  preserved spacing  \n\n### Nested\n\nnested body\n\n',
    );
  });

  it('normalizes heading identity, returns the first duplicate and returns null when missing', () => {
    const duplicates = '## CAFÉ\n\nfirst\n\n## cafe\u0301\n\nsecond';
    expect(extractMarkdownSection(duplicates, '  cafe\u0301 ')).toBe('## CAFÉ\n\nfirst\n\n');
    expect(extractMarkdownSection(source, 'Missing')).toBeNull();
  });

  it('matches section headings with Unicode 15.1 full case folding', () => {
    expect(extractMarkdownSection('## Straße ΟΣ\n\nbody', 'STRASSE οσ')).toBe(
      '## Straße ΟΣ\n\nbody',
    );
  });
});
