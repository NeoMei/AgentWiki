import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AttachmentReferenceError,
  parseImageReferences,
  resolveReferencedAttachments,
  rewriteAttachmentReferenceRanges,
} from './attachment-reference';

const sourcePath = 'pages/note.md';

interface ConformanceCase {
  name: string;
  body: string;
  expected: Array<{
    syntax: 'obsidian' | 'markdown';
    classification: 'managed' | 'page_embed' | 'external' | 'invalid';
    rawTarget: string;
    resolvedPath: string | null;
  }>;
}

const conformanceCases = JSON.parse(readFileSync(
  join(__dirname, 'attachment-reference.conformance.json'),
  'utf8',
)) as ConformanceCase[];

function normalizeClassification(
  classification: ReturnType<typeof parseImageReferences>[number]['classification'],
): ConformanceCase['expected'][number]['classification'] {
  if (classification === 'managed_candidate') return 'managed';
  if (classification === 'invalid_local' || classification === 'unsupported') return 'invalid';
  return classification;
}

function countIndexedReads(raw: string): { value: string; reads: () => number } {
  let indexedReads = 0;
  const boxed = Object(raw);
  const value = new Proxy(boxed, {
    get(target, property) {
      if (typeof property === 'string' && /^(?:0|[1-9][0-9]*)$/u.test(property)) indexedReads += 1;
      const member = Reflect.get(target, property, target);
      return typeof member === 'function' ? member.bind(raw) : member;
    },
  }) as string;
  return { value, reads: () => indexedReads };
}

describe('parseImageReferences', () => {
  it.each(conformanceCases)('matches neutral conformance case $name', ({ body, expected }) => {
    const references = parseImageReferences(body, sourcePath);

    expect(references.map((reference) => ({
      syntax: reference.syntax,
      classification: normalizeClassification(reference.classification),
      rawTarget: reference.rawTarget,
      resolvedPath: reference.resolvedPath,
    }))).toEqual(expected);
    for (const reference of references) {
      expect(body.slice(reference.targetStart, reference.targetEnd)).toBe(reference.rawTarget);
      expect(reference.targetStart).toBe(body.indexOf(reference.rawTarget));
      expect(reference.targetEnd).toBe(reference.targetStart + reference.rawTarget.length);
    }
  });

  it('resolves standard Markdown paths from the full root and nested Page directories', () => {
    expect(parseImageReferences('![](../assets/root.png)', 'pages/root.md'))
      .toEqual([expect.objectContaining({ resolvedPath: 'assets/root.png', classification: 'managed_candidate' })]);
    expect(parseImageReferences('![](../../assets/nested.png)', 'pages/topic/note.md'))
      .toEqual([expect.objectContaining({ resolvedPath: 'assets/nested.png', classification: 'managed_candidate' })]);
  });

  it.each([
    ['![[assets/a.png|320]]', 'assets/a.png', 'managed_candidate'],
    ['![alt](../assets/a.png "title")', 'assets/a.png', 'managed_candidate'],
    ['![](https://example.com/a.png)', null, 'external'],
    ['![](data:image/png;base64,AA==)', null, 'external'],
    ['![](../../secret.png)', null, 'invalid_local'],
    ['![[assets/a.svg]]', null, 'unsupported'],
    ['![[Page Title]]', null, 'page_embed'],
    ['![[Page Title.md]]', null, 'page_embed'],
  ] as const)('classifies %s', (body, expectedPath, classification) => {
    const [reference] = parseImageReferences(body, sourcePath);

    expect(reference).toMatchObject({
      resolvedPath: expectedPath,
      classification,
    });
    expect(body.slice(reference.targetStart, reference.targetEnd)).toBe(reference.rawTarget);
  });

  it('preserves exact target ranges while decoding escaped parentheses and quoted titles', () => {
    const body = [
      `before ![escaped](../assets/diagram\\(final\\).png 'single title') after`,
      `![second](<../assets/Caf%C3%A9 photo.PNG> "double title")`,
    ].join('\r\n');

    const references = parseImageReferences(body, sourcePath);

    expect(references).toEqual([
      {
        syntax: 'markdown',
        rawTarget: '../assets/diagram\\(final\\).png',
        targetStart: body.indexOf('../assets/diagram'),
        targetEnd: body.indexOf(" 'single title'"),
        resolvedPath: 'assets/diagram(final).png',
        classification: 'managed_candidate',
      },
      {
        syntax: 'markdown',
        rawTarget: '../assets/Caf%C3%A9 photo.PNG',
        targetStart: body.indexOf('../assets/Caf%C3%A9'),
        targetEnd: body.indexOf('> "double title"'),
        resolvedPath: 'assets/Café photo.PNG',
        classification: 'managed_candidate',
      },
    ]);
  });

  it('keeps Obsidian alias, size and surrounding whitespace outside the target range', () => {
    const body = '![[  assets/Cafe\u0301.png  | cover alias | 640x480  ]]';

    expect(parseImageReferences(body, sourcePath)).toEqual([{
      syntax: 'obsidian',
      rawTarget: 'assets/Cafe\u0301.png',
      targetStart: body.indexOf('assets/'),
      targetEnd: body.indexOf('  |'),
      resolvedPath: 'assets/Café.png',
      classification: 'managed_candidate',
    }]);
  });

  it('accepts title whitespace across lines without including it in the target range', () => {
    const body = '![alt](../assets/a.png\r\n  "title"\r\n)';

    expect(parseImageReferences(body, sourcePath)).toEqual([expect.objectContaining({
      rawTarget: '../assets/a.png',
      targetStart: body.indexOf('../assets/a.png'),
      targetEnd: body.indexOf('../assets/a.png') + '../assets/a.png'.length,
      resolvedPath: 'assets/a.png',
      classification: 'managed_candidate',
    })]);
  });

  it('preserves nested brackets in alt text while locating the image target', () => {
    const body = 'before ![diagram [mobile]](../assets/a.png "title") after';

    expect(parseImageReferences(body, sourcePath)).toEqual([expect.objectContaining({
      syntax: 'markdown',
      rawTarget: '../assets/a.png',
      targetStart: body.indexOf('../assets/a.png'),
      targetEnd: body.indexOf('../assets/a.png') + '../assets/a.png'.length,
      resolvedPath: 'assets/a.png',
      classification: 'managed_candidate',
    })]);
  });

  it('allows line whitespace before a standard Markdown image target', () => {
    const body = '![alt](\r\n  ../assets/a.png\r\n  "title"\r\n)';

    expect(parseImageReferences(body, sourcePath)).toEqual([expect.objectContaining({
      rawTarget: '../assets/a.png',
      targetStart: body.indexOf('../assets/a.png'),
      targetEnd: body.indexOf('../assets/a.png') + '../assets/a.png'.length,
      resolvedPath: 'assets/a.png',
      classification: 'managed_candidate',
    })]);
  });

  it.each([
    '![alt](../assets/a.png "double title")',
    "![alt](../assets/a.png 'single title')",
    '![alt](../assets/a.png (parenthesized title))',
    '![alt](<../assets/a.png> "angle title")',
  ])('accepts one complete Markdown image title in %s', (body) => {
    expect(parseImageReferences(body, sourcePath)).toEqual([expect.objectContaining({
      rawTarget: '../assets/a.png',
      targetStart: body.indexOf('../assets/a.png'),
      targetEnd: body.indexOf('../assets/a.png') + '../assets/a.png'.length,
      resolvedPath: 'assets/a.png',
      classification: 'managed_candidate',
    })]);
  });

  it.each([
    '![alt](../assets/a.png not-a-title)',
    '![alt](../assets/a.png "one" "two")',
    '![alt](../assets/a.png "unterminated)',
    '![alt](../assets/a.png (unterminated)',
    '![alt](<../assets/a.png> trailing-text)',
    '![alt](<../assets/a.png> "one" "two")',
  ])('preserves invalid Markdown image destination suffix evidence in %s', (body) => {
    const targetStart = body.indexOf('../assets/a.png');

    expect(parseImageReferences(body, sourcePath)).toEqual([{
      syntax: 'markdown',
      rawTarget: '../assets/a.png',
      targetStart,
      targetEnd: targetStart + '../assets/a.png'.length,
      resolvedPath: null,
      classification: 'invalid_local',
    }]);
    expect(resolveReferencedAttachments(body, sourcePath, []).errors).toEqual([{
      code: 'ATTACHMENT_REFERENCE_INVALID',
      targetStart,
      targetEnd: targetStart + '../assets/a.png'.length,
    }]);
    expect(() => rewriteAttachmentReferenceRanges(body, [{
      start: targetStart,
      end: targetStart + '../assets/a.png'.length,
      target: '../assets/b.png',
    }])).toThrow(expect.objectContaining({ code: 'ATTACHMENT_REFERENCE_INVALID' }));
  });

  it.each([
    '![](../assets/a.png raw title)',
    '![](<../assets/a.png)',
    '![](<../assets/a.png "title")',
  ])('preserves malformed destination evidence without making it rewriteable in %s', (body) => {
    const targetStart = body.indexOf('../assets/a.png');
    const [reference] = parseImageReferences(body, sourcePath);

    expect(reference).toEqual({
      syntax: 'markdown',
      rawTarget: '../assets/a.png',
      targetStart,
      targetEnd: targetStart + '../assets/a.png'.length,
      resolvedPath: null,
      classification: 'invalid_local',
    });
    expect(() => rewriteAttachmentReferenceRanges(body, [{
      start: reference.targetStart,
      end: reference.targetEnd,
      target: '../assets/b.png',
    }])).toThrow(expect.objectContaining({ code: 'ATTACHMENT_REFERENCE_INVALID' }));
  });

  it('accepts escaped destination whitespace but rejects the equivalent raw whitespace', () => {
    expect(parseImageReferences('![](../assets/a\\ b.png)', sourcePath)).toEqual([
      expect.objectContaining({
        rawTarget: '../assets/a\\ b.png',
        resolvedPath: 'assets/a b.png',
        classification: 'managed_candidate',
      }),
    ]);
    expect(parseImageReferences('![](../assets/a b.png)', sourcePath)).toEqual([
      expect.objectContaining({
        rawTarget: '../assets/a',
        resolvedPath: null,
        classification: 'invalid_local',
      }),
    ]);
    expect(parseImageReferences('![[assets/a\\ b.png]]', sourcePath)).toEqual([
      expect.objectContaining({
        rawTarget: 'assets/a\\ b.png',
        resolvedPath: null,
        classification: 'invalid_local',
      }),
    ]);
  });

  it('does not parse image-like text inside an angle-bracket destination title', () => {
    const body = '![](<../assets/a.png> "caption ![not image](../assets/b.png)")';

    expect(parseImageReferences(body, sourcePath)).toEqual([expect.objectContaining({
      rawTarget: '../assets/a.png',
      resolvedPath: 'assets/a.png',
    })]);
  });

  it.each([
    '![](<https://example.com/a.png>)',
    '![](<ftp://cdn.example.com/a.png>)',
    '![](<data:image/png;base64,AA==>)',
  ])('classifies angle-bracket URL %s as external', (body) => {
    expect(parseImageReferences(body, sourcePath)[0]).toMatchObject({
      classification: 'external',
      resolvedPath: null,
    });
  });

  it.each([
    '![](<file:///Users/example/secret.png>)',
    '![](<C:///Users/example/secret.png>)',
    '![](/absolute/secret.png)',
    '![](~/secret.png)',
  ])('rejects local absolute image destination %s', (body) => {
    expect(parseImageReferences(body, sourcePath)[0]).toMatchObject({
      classification: 'invalid_local',
      resolvedPath: null,
    });
  });

  it('ignores ordinary links, escaped image markers, inline code and fenced code', () => {
    const body = [
      '[ordinary](../assets/ordinary.png)',
      '\\![escaped](../assets/escaped.png)',
      '`![inline](../assets/inline.png)`',
      '```md',
      '![[assets/fenced.png]]',
      '![fenced](../assets/fenced-2.png)',
      '```',
      '![[assets/real.png]]',
    ].join('\n');

    expect(parseImageReferences(body, sourcePath)).toEqual([expect.objectContaining({
      rawTarget: 'assets/real.png',
      resolvedPath: 'assets/real.png',
    })]);
  });

  it('keeps a fence open when a marker line has trailing non-whitespace', () => {
    const body = [
      '```md',
      '``` still code',
      '![[assets/not-real.png]]',
      '```',
      '![[assets/real.png]]',
    ].join('\n');

    expect(parseImageReferences(body, sourcePath)).toEqual([expect.objectContaining({
      rawTarget: 'assets/real.png',
      resolvedPath: 'assets/real.png',
    })]);
  });

  it.each([
    [
      'four-space indented code',
      '    ![[assets/hidden.png]]\n![[assets/real.png]]',
    ],
    [
      'tab indented code',
      '\t![hidden](../assets/hidden.png)\n![[assets/real.png]]',
    ],
    [
      'a blockquote fence',
      '> ```md\n> ![[assets/hidden.png]]\n> ```\n> ![[assets/real.png]]',
    ],
    [
      'a list fence',
      '- ~~~md\n  ![[assets/hidden.png]]\n  ~~~\n- ![[assets/real.png]]',
    ],
    [
      'a single-line HTML comment',
      '<!-- ![[assets/hidden.png]] -->\n![[assets/real.png]]',
    ],
    [
      'a multi-line HTML comment',
      '<!--\n![[assets/hidden.png]]\n-->\n![[assets/real.png]]',
    ],
  ])('ignores image-like text inside %s', (_label, body) => {
    expect(parseImageReferences(body, sourcePath).map((reference) => reference.rawTarget))
      .toEqual(['assets/real.png']);
  });

  it('keeps ordinary blockquote and list body images visible to the parser', () => {
    const body = '> ![[assets/quote.png]]\n- ![list](../assets/list.png)';

    expect(parseImageReferences(body, sourcePath).map((reference) => reference.rawTarget))
      .toEqual(['assets/quote.png', '../assets/list.png']);
  });

  it.each([
    [
      'four-space list continuation',
      '- item\n    ![[assets/real.png]]',
    ],
    [
      'five-space list continuation',
      '- item\n     ![[assets/real.png]]',
    ],
    [
      'multi-level list continuation',
      '- outer\n  - inner\n      ![[assets/real.png]]',
    ],
  ])('keeps a real image in %s', (_label, body) => {
    expect(parseImageReferences(body, sourcePath).map((reference) => reference.rawTarget))
      .toEqual(['assets/real.png']);
  });

  it('ignores indented code relative to list content while keeping its following continuation image', () => {
    const body = '- item\n      ![[assets/hidden.png]]\n  ![[assets/real.png]]';

    expect(parseImageReferences(body, sourcePath).map((reference) => reference.rawTarget))
      .toEqual(['assets/real.png']);
  });

  it('ends an unclosed blockquote fence when top-level content resumes', () => {
    const body = '> ```md\n> ![[assets/hidden.png]]\n![[assets/real.png]]';

    expect(parseImageReferences(body, sourcePath).map((reference) => reference.rawTarget))
      .toEqual(['assets/real.png']);
  });

  it.each([
    [
      'list fence followed by a blockquote fence',
      '- ```md\n  ![[assets/list-hidden.png]]\n> ```md\n> ![[assets/quote-hidden.png]]\n![[assets/real.png]]',
    ],
    [
      'blockquote fence followed by a list fence',
      '> ```md\n> ![[assets/quote-hidden.png]]\n- ```md\n  ![[assets/list-hidden.png]]\n- ![[assets/real.png]]',
    ],
  ])('does not cross-close or leak a %s', (_label, body) => {
    expect(parseImageReferences(body, sourcePath).map((reference) => reference.rawTarget))
      .toEqual(['assets/real.png']);
  });

  it('keeps explicit fence closing scoped to the same list item', () => {
    const body = '- ```md\n  ![[assets/hidden.png]]\n  ```\n  ![[assets/real.png]]';

    expect(parseImageReferences(body, sourcePath).map((reference) => reference.rawTarget))
      .toEqual(['assets/real.png']);
  });

  it('keeps blockquote-shaped code inside a top-level fence and closes the original fence', () => {
    const body = '```md\n> ![[assets/hidden.png]]\n```\n![[assets/real.png]]';

    expect(parseImageReferences(body, sourcePath).map((reference) => reference.rawTarget))
      .toEqual(['assets/real.png']);
  });

  it('keeps nested-list-shaped code inside its containing list fence', () => {
    const body = '- ```md\n  - ![[assets/hidden.png]]\n  ```\n- ![[assets/real.png]]';

    expect(parseImageReferences(body, sourcePath).map((reference) => reference.rawTarget))
      .toEqual(['assets/real.png']);
  });

  it('treats a list marker indented four columns past list content as code', () => {
    const body = '- item\n      - ![[assets/hidden.png]]\n  ![[assets/real.png]]';

    expect(parseImageReferences(body, sourcePath).map((reference) => reference.rawTarget))
      .toEqual(['assets/real.png']);
  });

  it.each([
    [
      'blockquote',
      '> ```md\n> ![[assets/hidden.png]]\n![[assets/real.png]]',
    ],
    [
      'list',
      '- ```md\n  ![[assets/hidden.png]]\n![[assets/real.png]]',
    ],
  ])('reprocesses the current line after leaving an unclosed %s fence', (_label, body) => {
    expect(parseImageReferences(body, sourcePath).map((reference) => reference.rawTarget))
      .toEqual(['assets/real.png']);
  });

  it('scans a long backslash-heavy alt in a linear number of indexed reads', () => {
    const raw = `![${'\\'.repeat(512)}alt](../assets/a.png)`;
    const counted = countIndexedReads(raw);

    expect(parseImageReferences(counted.value, sourcePath)).toEqual([expect.objectContaining({
      rawTarget: '../assets/a.png',
      resolvedPath: 'assets/a.png',
    })]);
    expect(counted.reads()).toBeLessThanOrEqual(raw.length * 20);
  });

  it('scans distinct unmatched backtick runs linearly while keeping the following image visible', () => {
    const raw = `${Array.from({ length: 96 }, (_, index) => '`'.repeat(index + 1)).join('x')} ![A](../assets/photo.png)`;
    const counted = countIndexedReads(raw);

    expect(parseImageReferences(counted.value, sourcePath).map((reference) => reference.rawTarget))
      .toEqual(['../assets/photo.png']);
    expect(counted.reads()).toBeLessThanOrEqual(raw.length * 20);
  });

  it('matches deep list-fence blank lines in a linear number of indexed reads', () => {
    const depth = 512;
    const raw = `${'- '.repeat(depth)}\`\`\`md\r\n${'\r\n'.repeat(depth)}![[assets/real.png]]`;
    const counted = countIndexedReads(raw);

    expect(parseImageReferences(counted.value, sourcePath)).toEqual([expect.objectContaining({
      rawTarget: 'assets/real.png',
      resolvedPath: 'assets/real.png',
    })]);
    expect(counted.reads()).toBeLessThanOrEqual(raw.length * 40);
  });
});

describe('resolveReferencedAttachments', () => {
  const attachment = (
    id: string,
    displayName: string,
    nameKey = displayName.normalize('NFC').toLocaleLowerCase('und'),
  ) => ({ id, displayName, nameKey });

  it('resolves canonical and uniquely matched historical bare names into sorted unique ids', () => {
    const body = '![[photo.png|320]]\n![](../assets/Caf%C3%A9.PNG "title")\n![[assets/photo.png]]';

    expect(resolveReferencedAttachments(body, sourcePath, [
      attachment('z-photo', 'Photo.png'),
      attachment('a-cafe', 'Café.PNG'),
    ])).toEqual({
      attachmentIds: ['a-cafe', 'z-photo'],
      references: [
        expect.objectContaining({ rawTarget: 'photo.png', attachmentId: 'z-photo' }),
        expect.objectContaining({ rawTarget: '../assets/Caf%C3%A9.PNG', attachmentId: 'a-cafe' }),
        expect.objectContaining({ rawTarget: 'assets/photo.png', attachmentId: 'z-photo' }),
      ],
      errors: [],
    });
  });

  it('resolves the image after a mixed backtick span with its exact source range', () => {
    const body = '``a ``` b`` ![A](../assets/photo.png) `c`';

    expect(resolveReferencedAttachments(body, sourcePath, [
      attachment('stable-photo-id', 'photo.png'),
    ])).toEqual({
      attachmentIds: ['stable-photo-id'],
      references: [{
        syntax: 'markdown',
        rawTarget: '../assets/photo.png',
        targetStart: 17,
        targetEnd: 36,
        resolvedPath: 'assets/photo.png',
        classification: 'managed_candidate',
        attachmentId: 'stable-photo-id',
      }],
      errors: [],
    });
  });

  it('returns ATTACHMENT_MISSING for the image after a mixed backtick span', () => {
    const body = '``a ``` b`` ![A](../assets/photo.png) `c`';

    expect(resolveReferencedAttachments(body, sourcePath, [])).toEqual({
      attachmentIds: [],
      references: [],
      errors: [{ code: 'ATTACHMENT_MISSING', targetStart: 17, targetEnd: 36 }],
    });
  });

  it('fails historical bare-name case-fold ambiguity closed', () => {
    const body = '![[STRASSE.png]]';
    const result = resolveReferencedAttachments(body, sourcePath, [
      attachment('one', 'Straße.png', 'straße.png'),
      attachment('two', 'STRASSE.png', 'strasse.png'),
    ]);

    expect(result).toEqual({
      attachmentIds: [],
      references: [],
      errors: [{
        code: 'ATTACHMENT_REFERENCE_INVALID',
        targetStart: body.indexOf('STRASSE.png'),
        targetEnd: body.indexOf('STRASSE.png') + 'STRASSE.png'.length,
      }],
    });
  });

  it.each([
    ['![[missing.png]]', 'ATTACHMENT_MISSING'],
    ['![[assets/missing.png]]', 'ATTACHMENT_MISSING'],
    ['![](../../secret.png)', 'ATTACHMENT_REFERENCE_INVALID'],
    ['![[assets/vector.svg]]', 'ATTACHMENT_REFERENCE_INVALID'],
  ] as const)('returns a blocker for %s', (body, code) => {
    expect(resolveReferencedAttachments(body, sourcePath, []).errors).toEqual([{
      code,
      targetStart: expect.any(Number),
      targetEnd: expect.any(Number),
    }]);
  });

  it('ignores external images without producing attachment ids or blockers', () => {
    const body = '![](https://example.com/a.png)\n![](data:image/png;base64,AA==)';

    expect(resolveReferencedAttachments(body, sourcePath, [])).toEqual({
      attachmentIds: [],
      references: [],
      errors: [],
    });
  });

  it('ignores Obsidian Page embeds without treating them as broken image attachments', () => {
    const body = '![[Page Title|Alias]]\n![[Page Title.md#Section]]';

    expect(resolveReferencedAttachments(body, sourcePath, [])).toEqual({
      attachmentIds: [],
      references: [],
      errors: [],
    });
  });
});

describe('rewriteAttachmentReferenceRanges', () => {
  it('rewrites only path tokens in descending order and preserves every other byte', () => {
    const body = [
      'before photo.png',
      '![[  assets/photo.png  | alias | 320x200  ]]',
      'middle',
      '![alt text](<../assets/photo.png>  "title here")',
      'after photo.png',
    ].join('\r\n');
    const obsidianStart = body.indexOf('assets/photo.png');
    const markdownStart = body.indexOf('../assets/photo.png');

    expect(rewriteAttachmentReferenceRanges(body, [
      { start: obsidianStart, end: obsidianStart + 'assets/photo.png'.length, target: 'assets/renamed.png' },
      { start: markdownStart, end: markdownStart + '../assets/photo.png'.length, target: '../assets/renamed.png' },
    ])).toBe([
      'before photo.png',
      '![[  assets/renamed.png  | alias | 320x200  ]]',
      'middle',
      '![alt text](<../assets/renamed.png>  "title here")',
      'after photo.png',
    ].join('\r\n'));
  });

  const invalidRangeCases: Array<[
    Array<{ start: number; end: number; target: string }>,
  ]> = [
    [{ start: -1, end: 3, target: 'assets/new.png' }],
    [{ start: 0, end: 999, target: 'assets/new.png' }],
    [
      { start: 3, end: 15, target: 'assets/one.png' },
      { start: 8, end: 18, target: 'assets/two.png' },
    ],
  ].map((replacements) => [replacements]);

  it.each(invalidRangeCases)('rejects invalid or overlapping ranges %#', (replacements) => {
    expect(() => rewriteAttachmentReferenceRanges('![[assets/a.png]]', replacements))
      .toThrow(expect.objectContaining({ code: 'ATTACHMENT_REFERENCE_INVALID' }));
  });

  it('rejects duplicate current target ranges as overlapping', () => {
    const body = '![[assets/a.png]]';
    const start = body.indexOf('assets/a.png');
    const range = { start, end: start + 'assets/a.png'.length };

    expect(() => rewriteAttachmentReferenceRanges(body, [
      { ...range, target: 'assets/one.png' },
      { ...range, target: 'assets/two.png' },
    ])).toThrow(expect.objectContaining({ code: 'ATTACHMENT_REFERENCE_INVALID' }));
  });

  it('rejects a stale range that no longer identifies an image target token', () => {
    const body = 'prefix ![[assets/a.png]]';
    const staleStart = body.indexOf('assets/a.png') + 1;

    expect(() => rewriteAttachmentReferenceRanges(body, [{
      start: staleStart,
      end: staleStart + 'assets/a.png'.length,
      target: 'assets/b.png',
    }])).toThrow(AttachmentReferenceError);
  });
});
