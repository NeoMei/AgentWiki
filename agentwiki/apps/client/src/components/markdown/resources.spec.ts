import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { visit } from 'unist-util-visit';
import api from '../../api/client';
import {
  collectMarkdownResourceOccurrences,
  collectMarkdownResourceRefs,
  editorMarkdownResourceParser,
  extractMarkdownSection,
  resolveMarkdownResources,
} from './resources';

vi.mock('../../api/client', () => ({
  default: { post: vi.fn() },
}));

afterEach(() => vi.restoreAllMocks());

const fullAstWikiLiterals = (source: string): string[] => {
  const literals: string[] = [];
  const tree = editorMarkdownResourceParser.parse(source);
  visit(tree as never, 'agentWikiLink', (node: any) => {
    const literal = node.data?.hProperties?.['data-markdown-literal'];
    if (typeof literal === 'string') literals.push(literal);
  });
  return literals;
};

const collectedWikiLiterals = (source: string): string[] => (
  collectMarkdownResourceOccurrences(source).map(({ from, to }) => source.slice(from, to))
);

describe('collectMarkdownResourceRefs', () => {
  it('returns exact source ranges only for syntax-valid Wiki links', () => {
    const source = [
      '[[Real page]]',
      '`[[Real page]]`',
      '```md',
      '[[Real page]]',
      '```',
      '[ordinary [[Real page]]](https://example.com)',
      '[ordinary](https://example.com/[[Real page]])',
      '[reference [[Real page]]][target]',
      '[target]: https://example.com/[[Real page]]',
      '',
      '    [[Real page]]',
      '',
      '~~~md',
      '[[Real page]]',
      '~~~',
      '``[[Real page]]``',
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

  it('handles CRLF, escapes, unterminated code and nested brackets without candidate injection', () => {
    const valid = '[[CRLF page]]\r\n\\[[Escaped]]\r\n[[Page#Heading|Alias with | pipes]]';
    expect(collectMarkdownResourceOccurrences(valid).map(({ from, to }) => valid.slice(from, to))).toEqual([
      '[[CRLF page]]',
      '[[Page#Heading|Alias with | pipes]]',
    ]);

    expect(collectMarkdownResourceOccurrences('```md\r\n[[fenced]]\r\n[[still fenced]]')).toEqual([]);
    const unmatchedCode = '`unterminated [[inline]]\r\n[[still inline]]';
    expect(fullAstWikiLiterals(unmatchedCode)).toEqual(['[[inline]]', '[[still inline]]']);
    expect(collectedWikiLiterals(unmatchedCode)).toEqual(['[[inline]]', '[[still inline]]']);
    expect(collectMarkdownResourceOccurrences('<!--\r\n[[commented]]\r\n[[still commented]]')).toEqual([]);
    expect(collectMarkdownResourceOccurrences(
      '[[Outer [nested] target]] [[Page|Alias [nested]]] [[broken ] delimiter]]',
    )).toEqual([]);

    const htmlBlock = '<script>\r\n[[scripted]]\r\n</script>\r\n\r\n[[After HTML]]';
    expect(collectMarkdownResourceOccurrences(htmlBlock).map(({ from, to }) => htmlBlock.slice(from, to))).toEqual([
      '[[After HTML]]',
    ]);
  });

  it.each([
    ['generic HTML block', '<div>\n[[inside]]\n</div>\n\n[[after]]'],
    ['blockquote fenced code', '> ~~~md\n> [[inside]]\n> ~~~\n\n[[after]]'],
    ['blockquote indented code', '>     [[inside]]\n\n[[after]]'],
  ])('matches the full resource AST for %s', (_kind, source) => {
    expect(fullAstWikiLiterals(source)).toEqual(['[[after]]']);
    expect(collectedWikiLiterals(source)).toEqual(fullAstWikiLiterals(source));
  });

  it.each([
    [
      'type-7 tag after paragraph text',
      'paragraph\n<custom-tag>\n[[valid in paragraph]]\n\n[[after]]',
      ['[[valid in paragraph]]', '[[after]]'],
    ],
    ['type-7 tag after an ATX heading', '# heading\n<custom-tag>\n[[inside]]\n\n[[after]]', ['[[after]]']],
    ['quoted type-6 HTML dedent', '> <div>\n> [[inside]]\n[[outside]]', ['[[outside]]']],
    ['quoted comment dedent', '> <!--\n> [[inside]]\n[[outside]]', ['[[outside]]']],
    ['quoted raw-tag dedent', '> <script>\n> [[inside]]\n[[outside]]', ['[[outside]]']],
    ['quoted unclosed fence dedent', '> ~~~md\n> [[inside]]\n[[outside]]', ['[[outside]]']],
    ['list unclosed fence dedent', '- ~~~md\n  [[inside]]\n[[outside]]', ['[[outside]]']],
    ['unclosed code span before blank line', '`unterminated [[inside]]\n\n[[after]]', ['[[inside]]', '[[after]]']],
    ['unclosed link label before blank line', '[unterminated [[inside]]\n\n[[after]]', ['[[inside]]', '[[after]]']],
    ['unclosed inline comment before blank line', 'paragraph <!--\n[[inside]]\n\n[[after]]', ['[[inside]]', '[[after]]']],
  ])('resumes full-AST resource collection across %s', (_kind, source, expected) => {
    expect(fullAstWikiLiterals(source)).toEqual(expected);
    expect(collectedWikiLiterals(source)).toEqual(expected);
  });

  it.each([
    ['type 1 raw tag', '<script>\r\n[[inside]]\r\n</script>\r\n\r\n[[after]]'],
    ['type 2 comment', '<!--\r\n[[inside]]\r\n-->\r\n\r\n[[after]]'],
    ['type 3 instruction', '<?agentwiki\r\n[[inside]]\r\n?>\r\n\r\n[[after]]'],
    ['type 4 declaration', '<!AGENTWIKI\r\n[[inside]]\r\n>\r\n\r\n[[after]]'],
    ['type 5 CDATA', '<![CDATA[\r\n[[inside]]\r\n]]>\r\n\r\n[[after]]'],
    ['type 6 block tag', '<table>\r\n[[inside]]\r\n</table>\r\n\r\n[[after]]'],
    ['type 7 complete tag', '<custom-tag data-kind="wiki">\r\n[[inside]]\r\n\r\n[[after]]'],
  ])('matches the full resource AST for CommonMark HTML block %s', (_kind, source) => {
    expect(fullAstWikiLiterals(source)).toEqual(['[[after]]']);
    const parseSpy = vi.spyOn(editorMarkdownResourceParser, 'parse');
    const collected = collectedWikiLiterals(source);
    expect(parseSpy.mock.calls.map(([input]) => input)).toEqual(['[[after]]']);
    expect(collected).toEqual(fullAstWikiLiterals(source));
    parseSpy.mockRestore();
  });

  it.each([
    ['bullet-list fence', '- ~~~md\n  [[inside]]\n  ~~~\n\n[[after]]'],
    ['ordered-list fence', '1. ~~~md\n   [[inside]]\n   ~~~\n\n[[after]]'],
    ['nested quote/list fence CRLF', '> - ~~~md\r\n>   [[inside]]\r\n>   ~~~\r\n\r\n[[after]]'],
    ['nested quote indented code', '> >     [[inside]]\r\n\r\n[[after]]'],
    ['list indented code', '- item\n\n      [[inside]]\n\n[[after]]'],
    ['nested list indented code CRLF', '> - item\r\n>\r\n>       [[inside]]\r\n\r\n[[after]]'],
    ['unclosed quoted fence', '> ```md\r\n> [[inside]]\r\n> [[still inside]]'],
  ])('matches the full resource AST for %s', (_kind, source) => {
    const expected = source.includes('[[after]]') ? ['[[after]]'] : [];
    expect(fullAstWikiLiterals(source)).toEqual(expected);
    expect(collectedWikiLiterals(source)).toEqual(fullAstWikiLiterals(source));
  });

  it('bounds synchronous collection and resolution for a near-200k stored document', async () => {
    const firstHundred = Array.from({ length: 100 }, (_, index) => `[[Page ${index}]]`).join(' ');
    const source = `${firstHundred} ${'[[Page 0]] '.repeat(15_000)}`.padEnd(199_000, 'x');
    expect(source.length).toBe(199_000);

    const parseSpy = vi.spyOn(editorMarkdownResourceParser, 'parse');
    const occurrences = collectMarkdownResourceOccurrences(source);
    const references = [...new Map(
      occurrences.map(({ reference }) => [reference.canonicalKey, reference]),
    ).values()];
    vi.mocked(api.post).mockImplementation(async (_url, body) => ({
      data: (body as { references: Array<{ key: string }> }).references.map(({ key }) => ({
        key,
        status: 'unresolved',
      })),
    }));

    expect(occurrences).toHaveLength(256);
    expect(references).toHaveLength(100);
    expect(parseSpy.mock.calls.reduce((sum, [input]) => sum + input.length, 0)).toBeLessThanOrEqual(32_768);
    expect(parseSpy).not.toHaveBeenCalledWith(source);
    expect(source.slice(occurrences[255].from, occurrences[255].to)).toBe('[[Page 0]]');
    await expect(resolveMarkdownResources('space-editor', references)).resolves.toHaveProperty('size', 100);
    expect(api.post).toHaveBeenCalledTimes(1);
    expect((vi.mocked(api.post).mock.calls[0][1] as any).references).toHaveLength(100);
    parseSpy.mockRestore();
  });

  it('fails a delimiter-heavy near-200k paragraph raw before parser or resolver work', () => {
    const source = `${'` '.repeat(600)}[[after]]`.padEnd(199_000, 'x');
    const parseSpy = vi.spyOn(editorMarkdownResourceParser, 'parse');

    expect(collectMarkdownResourceOccurrences(source)).toEqual([]);
    expect(parseSpy).not.toHaveBeenCalled();
    expect(api.post).not.toHaveBeenCalled();
    parseSpy.mockRestore();
  });

  it('bounds expensive parsing and requests for 30,001 unique links in 180,005 characters', async () => {
    const source = Array.from(
      { length: 30_001 },
      (_, index) => `[[${String.fromCodePoint(0x4e00 + index)}]]`,
    ).join(' ');
    expect(source.length).toBe(180_005);
    const parseSpy = vi.spyOn(editorMarkdownResourceParser, 'parse');

    const occurrences = collectMarkdownResourceOccurrences(source);
    const references = [...new Map(
      occurrences.map(({ reference }) => [reference.canonicalKey, reference]),
    ).values()];
    vi.mocked(api.post).mockImplementation(async (_url, body) => ({
      data: (body as { references: Array<{ key: string }> }).references.map(({ key }) => ({
        key,
        status: 'unresolved',
      })),
    }));

    expect(occurrences).toHaveLength(100);
    expect(references).toHaveLength(100);
    expect(parseSpy.mock.calls.reduce((sum, [input]) => sum + input.length, 0)).toBeLessThanOrEqual(32_768);
    expect(parseSpy).not.toHaveBeenCalledWith(source);
    await expect(resolveMarkdownResources('space-editor', references)).resolves.toHaveProperty('size', 100);
    expect(api.post).toHaveBeenCalledTimes(1);
    parseSpy.mockRestore();
  });

  it('degrades an over-budget candidate and all following links to raw source without parsing or I/O', () => {
    const source = `[[Target|${'x'.repeat(32_768)}]] [[Good]]`;
    const parseSpy = vi.spyOn(editorMarkdownResourceParser, 'parse');

    expect(collectMarkdownResourceOccurrences(source)).toEqual([]);
    expect(parseSpy).not.toHaveBeenCalled();
    expect(api.post).not.toHaveBeenCalled();
    parseSpy.mockRestore();
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

  it('rejects 201 exported references before issuing its single-request resolver contract', async () => {
    const source = Array.from({ length: 201 }, (_, index) => `[[Page ${index}]]`).join('\n');
    const references = collectMarkdownResourceRefs(source, { maxReferences: 250 });
    vi.mocked(api.post).mockImplementation(async (_url, body) => ({
      data: (body as { references: Array<{ key: string }> }).references.map((reference) => ({
        key: reference.key,
        status: 'unresolved',
      })),
    }));

    await expect(resolveMarkdownResources('space-editor', references)).rejects.toThrow(
      'Markdown resource limit exceeded',
    );
    expect(api.post).not.toHaveBeenCalled();
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
