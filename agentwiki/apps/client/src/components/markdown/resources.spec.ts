import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../../api/client';
import {
  collectMarkdownResourceRefs,
  extractMarkdownSection,
  resolveMarkdownResources,
} from './resources';

vi.mock('../../api/client', () => ({
  default: { post: vi.fn() },
}));

describe('collectMarkdownResourceRefs', () => {
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

  it('rejects more than 100 unique identities before any API request', async () => {
    const source = Array.from({ length: 101 }, (_, index) => `[[Page ${index}]]`).join(' ');

    expect(() => collectMarkdownResourceRefs(source)).toThrow('Markdown resource limit exceeded');
    expect(api.post).not.toHaveBeenCalled();
  });

  it('accepts a 512-character target and rejects a 513-character target locally', () => {
    expect(collectMarkdownResourceRefs(`[[${'a'.repeat(512)}]]`)).toHaveLength(1);
    expect(() => collectMarkdownResourceRefs(`[[${'a'.repeat(513)}]]`)).toThrow(
      'Markdown resource reference is too long',
    );
    expect(api.post).not.toHaveBeenCalled();
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
});
