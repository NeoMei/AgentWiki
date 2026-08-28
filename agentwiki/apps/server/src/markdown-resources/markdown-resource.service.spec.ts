import { BusinessException } from '../core/filters/business-error';
import { MarkdownResourceService } from './markdown-resource.service';

const principal = { userId: 'user-1' };

function page(overrides: Partial<Record<'id' | 'spaceId' | 'title' | 'slug' | 'syncPath' | 'syncPathKey', string> & { folderId: string | null }> = {}) {
  return {
    id: 'page-default',
    spaceId: 'space-1',
    title: 'Default',
    slug: 'default',
    syncPath: 'pages/Default.md',
    syncPathKey: 'pages/default.md',
    folderId: null,
    ...overrides,
  };
}

function attachment(overrides: Partial<Record<'id' | 'spaceId' | 'displayName' | 'nameKey' | 'mimeType', string> & Record<'width' | 'height', number>> = {}) {
  return {
    id: 'attachment-default',
    spaceId: 'space-1',
    displayName: 'default.png',
    nameKey: 'default.png',
    mimeType: 'image/png',
    width: 640,
    height: 480,
    status: 'active',
    ...overrides,
  };
}

describe('MarkdownResourceService', () => {
  const prisma = {
    $queryRaw: jest.fn(),
    spaceAttachment: { findMany: jest.fn() },
  } as any;
  const authorization = { assertSpaceAccess: jest.fn() } as any;
  let service: MarkdownResourceService;

  beforeEach(() => {
    jest.clearAllMocks();
    authorization.assertSpaceAccess.mockResolvedValue({ role: 'viewer' });
    prisma.$queryRaw.mockResolvedValue([]);
    prisma.spaceAttachment.findMany.mockResolvedValue([]);
    service = new MarkdownResourceService(prisma, authorization);
  });

  it('authorizes the Space once and resolves pages by stable id, current path, title, then legacy slug', async () => {
    prisma.$queryRaw
      .mockResolvedValueOnce([
        page({ id: 'same-target', title: 'ID winner', slug: 'id-winner', syncPath: 'pages/Id.md', syncPathKey: 'pages/id.md' }),
        page({ id: 'sync-row', title: 'Sync winner', slug: 'same-target', syncPath: 'Same-Target', syncPathKey: 'same-target' }),
      ])
      .mockResolvedValueOnce([
        page({ id: 'slug-row', title: 'Same-Target', slug: 'same-target', syncPath: 'pages/Slug.md', syncPathKey: 'pages/slug.md' }),
      ])
      .mockResolvedValueOnce([
        page({ id: 'title-row', title: 'Title Target', slug: 'other', syncPath: 'pages/Title.md', syncPathKey: 'pages/title.md' }),
      ]);

    const result = await service.resolve('space-1', [
      { key: 'id', kind: 'page', target: ' SAME-TARGET ' },
      { key: 'title', kind: 'page', target: ' title target ' },
    ], principal);

    expect(authorization.assertSpaceAccess).toHaveBeenCalledTimes(1);
    expect(authorization.assertSpaceAccess).toHaveBeenCalledWith(
      principal, 'space-1', ['owner', 'admin', 'editor', 'viewer'], 'pages:read',
    );
    expect(result).toEqual([
      { key: 'id', status: 'resolved', kind: 'page', pageId: 'same-target', title: 'ID winner', slug: 'id-winner' },
      { key: 'title', status: 'resolved', kind: 'page', pageId: 'title-row', title: 'Title Target', slug: 'other' },
    ]);
  });

  it('matches NFC/case-normalized sync paths and slugs while preserving response keys and order', async () => {
    prisma.$queryRaw
      .mockResolvedValueOnce([
        page({ id: 'sync', title: 'Sync', slug: 'sync', syncPath: 'Guides/Caf\u00e9.md', syncPathKey: 'guides/caf\u00e9.md' }),
      ])
      .mockResolvedValueOnce([
        page({ id: 'slug', title: 'Slug', slug: 'MiXeD', syncPath: 'pages/Slug.md', syncPathKey: 'pages/slug.md' }),
      ])
      .mockResolvedValueOnce([]);

    const result = await service.resolve('space-1', [
      { key: 'z-key', kind: 'page', target: ' mixed ' },
      { key: 'a-key', kind: 'page', target: ' GUIDES/Cafe\u0301.MD ' },
    ], principal);

    expect(result.map((item) => item.key)).toEqual(['z-key', 'a-key']);
    expect(result).toEqual([
      { key: 'z-key', status: 'resolved', kind: 'page', pageId: 'slug', title: 'Slug', slug: 'MiXeD' },
      { key: 'a-key', status: 'resolved', kind: 'page', pageId: 'sync', title: 'Sync', slug: 'sync' },
    ]);
  });

  it('queries and compares sync paths with the shared Unicode full-fold pathKey', async () => {
    prisma.$queryRaw
      .mockImplementationOnce(async (query: any) => (
        query.values.includes('strasse/guide.md')
          && query.strings.join('?').includes('markdown_page_identity("syncPath")')
          ? [page({
              id: 'unicode-path', title: 'Unicode path', slug: 'unicode-path',
              syncPath: ' Stra\u00dfe/Guide.md ', syncPathKey: ' strasse/guide.md ',
            })]
          : []
      ));

    await expect(service.resolve('space-1', [
      { key: 'unicode-path', kind: 'page', target: ' Stra\u00dfe/Guide.md ' },
    ], principal)).resolves.toEqual([{
      key: 'unicode-path', status: 'resolved', kind: 'page',
      pageId: 'unicode-path', title: 'Unicode path', slug: 'unicode-path',
    }]);
  });

  it('treats .md as a page suffix only after full syncPath matching', async () => {
    prisma.$queryRaw
      .mockResolvedValueOnce([
        page({ id: 'full-path', title: 'Other', slug: 'other', syncPath: 'guides/Guide.md', syncPathKey: 'guides/guide.md' }),
      ])
      .mockResolvedValueOnce([
        page({ id: 'fallback', title: 'Guide', slug: 'guide', syncPath: 'pages/Guide.md', syncPathKey: 'pages/guide.md' }),
      ]);

    const result = await service.resolve('space-1', [
      { key: 'full', kind: 'page', target: 'guides/Guide.md' },
      { key: 'fallback', kind: 'page', target: 'Guide.md' },
    ], principal);

    expect(result).toEqual([
      { key: 'full', status: 'resolved', kind: 'page', pageId: 'full-path', title: 'Other', slug: 'other' },
      { key: 'fallback', status: 'resolved', kind: 'page', pageId: 'fallback', title: 'Guide', slug: 'guide' },
    ]);
  });

  it('returns structured same-Space candidates when exact normalized titles collide', async () => {
    prisma.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        page({ id: 'one', title: 'Caf\u00e9', slug: 'one' }),
        page({ id: 'two', title: 'CAF\u00c9', slug: 'two' }),
      ]);

    await expect(service.resolve('space-1', [
      { key: 'ambiguous', kind: 'page', target: ' Cafe\u0301 ' },
    ], principal)).resolves.toEqual([{
      key: 'ambiguous', status: 'ambiguous', candidates: [
        { pageId: 'one', title: 'Caf\u00e9', path: 'pages/Default.md' },
        { pageId: 'two', title: 'CAF\u00c9', path: 'pages/Default.md' },
      ],
    }]);
  });

  it('queries the indexed identity so NFC title matching covers legacy decomposed rows', async () => {
    prisma.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([page({ id: 'legacy-nfd', title: 'Cafe\u0301', slug: 'legacy-nfd' })]);

    await expect(service.resolve('space-1', [
      { key: 'canonical', kind: 'page', target: 'CAF\u00c9' },
    ], principal)).resolves.toEqual([{
      key: 'canonical', status: 'resolved', kind: 'page',
      pageId: 'legacy-nfd', title: 'Cafe\u0301', slug: 'legacy-nfd',
    }]);
    expect(prisma.$queryRaw.mock.calls[2][0].values).toContain('caf\u00e9');
  });

  it('queries the indexed identity so normalized slug matching covers decomposed stored values', async () => {
    prisma.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([page({ id: 'nfd-slug', title: 'NFD slug', slug: 'cafe\u0301' })])
      .mockResolvedValueOnce([]);

    await expect(service.resolve('space-1', [
      { key: 'slug-canonical', kind: 'page', target: 'CAF\u00c9' },
    ], principal)).resolves.toEqual([{
      key: 'slug-canonical', status: 'resolved', kind: 'page',
      pageId: 'nfd-slug', title: 'NFD slug', slug: 'cafe\u0301',
    }]);
    expect(prisma.$queryRaw.mock.calls[1][0].values).toContain('caf\u00e9');
  });

  it('fails every title-tier reference closed when the global title query reaches its cap', async () => {
    prisma.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(Array.from({ length: 201 }, (_, index) => page({
        id: `crowded-${index}`,
        title: 'Crowded',
        slug: `crowded-${index}`,
        syncPath: `pages/Crowded-${index}.md`,
        syncPathKey: `pages/crowded-${index}.md`,
      })));

    await expect(service.resolve('space-1', [
      { key: 'crowded', kind: 'page', target: 'Crowded' },
      { key: 'possibly-truncated', kind: 'page', target: 'Later Unique Title' },
    ], principal)).resolves.toEqual([
      { key: 'crowded', status: 'ambiguous' },
      { key: 'possibly-truncated', status: 'ambiguous' },
    ]);
  });

  it('fails every post-exact reference closed when case-insensitive slug candidates reach the cap', async () => {
    prisma.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(Array.from({ length: 201 }, (_, index) => page({
        id: `slug-collision-${index}`,
        title: `Slug collision ${index}`,
        slug: 'Crowded',
        syncPath: `pages/Slug-collision-${index}.md`,
        syncPathKey: `pages/slug-collision-${index}.md`,
      })))
      .mockResolvedValueOnce([]);

    await expect(service.resolve('space-1', [
      { key: 'crowded-slug', kind: 'page', target: 'crowded' },
      { key: 'possibly-truncated', kind: 'page', target: 'later-unique-slug' },
    ], principal)).resolves.toEqual([
      { key: 'crowded-slug', status: 'ambiguous' },
      { key: 'possibly-truncated', status: 'ambiguous' },
    ]);
  });

  it('resolves active and retained archived attachments through Task 3 nameKey normalization', async () => {
    prisma.spaceAttachment.findMany.mockResolvedValue([
      attachment({ id: 'active', displayName: 'Caf\u00e9.png', nameKey: 'caf\u00e9.png' }),
      attachment({ id: 'archived', displayName: 'Old.GIF', nameKey: 'old.gif', mimeType: 'image/gif', width: 10, height: 20, status: 'archived' } as any),
    ]);

    const result = await service.resolve('space-1', [
      { key: 'active-key', kind: 'attachment', target: ' CAFE\u0301.PNG ' },
      { key: 'archive-key', kind: 'attachment', target: 'old.gif' },
    ], principal);

    expect(result).toEqual([
      { key: 'active-key', status: 'resolved', kind: 'attachment', attachmentId: 'active', displayName: 'Caf\u00e9.png', mimeType: 'image/png', width: 640, height: 480 },
      { key: 'archive-key', status: 'resolved', kind: 'attachment', attachmentId: 'archived', displayName: 'Old.GIF', mimeType: 'image/gif', width: 10, height: 20 },
    ]);
    expect(prisma.spaceAttachment.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ spaceId: 'space-1', nameKey: { in: ['caf\u00e9.png', 'old.gif'] } }),
    }));
    expect(prisma.spaceAttachment.findMany.mock.calls[0][0].where).not.toHaveProperty('status');
  });

  it.each(['diagram.PNG', 'photo.jpg', 'photo.jpeg', 'photo.webp', 'photo.gif'])(
    'never resolves image-extension target %s as a page',
    async (target) => {
      await expect(service.resolve('space-1', [
        { key: 'image-as-page', kind: 'page', target },
      ], principal)).resolves.toEqual([{ key: 'image-as-page', status: 'unresolved' }]);
    },
  );

  it('scopes every lookup to the authorized Space and never resolves supplied cross-Space rows', async () => {
    prisma.$queryRaw.mockResolvedValue([
      { ...page({ id: 'foreign-page', title: 'Foreign' }), spaceId: 'space-2' },
    ]);
    prisma.spaceAttachment.findMany.mockResolvedValue([
      { ...attachment({ id: 'foreign-attachment', displayName: 'foreign.png', nameKey: 'foreign.png' }), spaceId: 'space-2' },
    ]);

    const result = await service.resolve('space-1', [
      { key: 'page', kind: 'page', target: 'Foreign' },
      { key: 'attachment', kind: 'attachment', target: 'foreign.png' },
    ], principal);

    for (const [query] of prisma.$queryRaw.mock.calls) {
      expect(query.values).toContain('space-1');
      expect(query.strings.join('?')).toMatch(/"deletedAt" IS NULL/u);
    }
    expect(prisma.spaceAttachment.findMany.mock.calls[0][0].where.spaceId).toBe('space-1');
    expect(result).toEqual([
      { key: 'page', status: 'unresolved' },
      { key: 'attachment', status: 'unresolved' },
    ]);
  });

  it('returns byte-identical unresolved shapes for missing and forbidden targets', async () => {
    const missing = await service.resolve('space-1', [
      { key: 'same-key', kind: 'attachment', target: 'missing.png' },
    ], principal);
    prisma.spaceAttachment.findMany.mockResolvedValue([
      { ...attachment({ id: 'foreign', displayName: 'secret.png', nameKey: 'secret.png' }), spaceId: 'space-2' },
    ]);
    const forbidden = await service.resolve('space-1', [
      { key: 'same-key', kind: 'attachment', target: 'secret.png' },
    ], principal);

    expect(JSON.stringify(missing)).toBe(JSON.stringify(forbidden));
    expect(missing).toEqual([{ key: 'same-key', status: 'unresolved' }]);
  });

  it('denies an outsider before issuing any resource query', async () => {
    authorization.assertSpaceAccess.mockRejectedValue(
      new BusinessException('SPACE_ACCESS_DENIED'),
    );

    await expect(service.resolve('space-1', [
      { key: 'secret', kind: 'page', target: 'Secret' },
    ], principal)).rejects.toMatchObject({ businessCode: 'SPACE_ACCESS_DENIED' });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(prisma.spaceAttachment.findMany).not.toHaveBeenCalled();
  });

  it('uses four constant-count bounded Page and alias queries for one hundred references', async () => {
    const references = Array.from({ length: 100 }, (_, index) => index % 2 === 0
      ? { key: `page-${index}`, kind: 'page' as const, target: `Page ${index}` }
      : { key: `attachment-${index}`, kind: 'attachment' as const, target: `image-${index}.png` });

    await service.resolve('space-1', references, principal);

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(4);
    expect(prisma.spaceAttachment.findMany).toHaveBeenCalledTimes(1);
    for (const [query] of prisma.$queryRaw.mock.calls) {
      expect(query.values).toContain(201);
    }
    expect(prisma.$queryRaw.mock.calls[3][0].strings.join('?')).toContain('PagePathAlias');
    expect(prisma.spaceAttachment.findMany.mock.calls[0][0].take).toBeLessThanOrEqual(100);
  });

  it('prefers a same-Folder title before a globally duplicated title', async () => {
    prisma.$queryRaw
      .mockResolvedValueOnce([page({
        id: 'source-page', folderId: 'folder-a', title: 'Source',
        syncPath: 'pages/Project/Source.md', syncPathKey: 'pages/project/source.md',
      })])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        page({ id: 'same-folder', folderId: 'folder-a', title: 'Weekly', syncPath: 'pages/Project/Weekly.md', syncPathKey: 'pages/project/weekly.md' }),
        page({ id: 'other-folder', folderId: 'folder-b', title: 'Weekly', syncPath: 'pages/Other/Weekly.md', syncPathKey: 'pages/other/weekly.md' }),
      ])
      .mockResolvedValueOnce([]);

    await expect((service as any).resolve('space-1', [
      { key: 'weekly', kind: 'page', target: 'Weekly' },
    ], principal, 'source-page')).resolves.toEqual([{
      key: 'weekly', status: 'resolved', kind: 'page',
      pageId: 'same-folder', title: 'Weekly', slug: 'default',
    }]);
  });

  it('resolves a Folder-qualified wiki target through the current canonical path before aliases', async () => {
    prisma.$queryRaw
      .mockResolvedValueOnce([page({
        id: 'current', title: 'Weekly', syncPath: 'pages/Project/Weekly.md',
        syncPathKey: 'pages/project/weekly.md', folderId: 'folder-project',
      })])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        ...page({ id: 'alias-owner', title: 'Old Weekly', syncPath: 'pages/Archive/Weekly.md', syncPathKey: 'pages/archive/weekly.md' }),
        aliasPathKey: 'pages/project/weekly.md',
      }]);

    await expect(service.resolve('space-1', [
      { key: 'qualified', kind: 'page', target: 'Project/Weekly' },
    ], principal)).resolves.toEqual([{
      key: 'qualified', status: 'resolved', kind: 'page',
      pageId: 'current', title: 'Weekly', slug: 'default',
    }]);
  });

  it('returns structured candidates for an ambiguous historical path alias', async () => {
    prisma.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { ...page({ id: 'alias-a', title: 'Alpha', syncPath: 'pages/New/Alpha.md', syncPathKey: 'pages/new/alpha.md' }), aliasPathKey: 'pages/old/weekly.md' },
        { ...page({ id: 'alias-b', title: 'Beta', syncPath: 'pages/New/Beta.md', syncPathKey: 'pages/new/beta.md' }), aliasPathKey: 'pages/old/weekly.md' },
        { ...page({ id: 'foreign', spaceId: 'space-2', title: 'Secret', syncPath: 'pages/Secret.md', syncPathKey: 'pages/secret.md' }), aliasPathKey: 'pages/old/weekly.md' },
      ]);

    await expect(service.resolve('space-1', [
      { key: 'alias', kind: 'page', target: 'Old/Weekly' },
    ], principal)).resolves.toEqual([{
      key: 'alias', status: 'ambiguous', candidates: [
        { pageId: 'alias-a', title: 'Alpha', path: 'pages/New/Alpha.md' },
        { pageId: 'alias-b', title: 'Beta', path: 'pages/New/Beta.md' },
      ],
    }]);
  });

  it('fails alias resolution closed when the bounded alias query is truncated', async () => {
    prisma.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(Array.from({ length: 201 }, (_, index) => ({
        ...page({
          id: `alias-${index}`,
          title: `Alias ${index}`,
          syncPath: `pages/New/Alias-${index}.md`,
          syncPathKey: `pages/new/alias-${index}.md`,
        }),
        aliasPathKey: index === 0 ? 'pages/old/weekly.md' : `pages/other/${index}.md`,
      })));

    await expect(service.resolve('space-1', [
      { key: 'alias-cap', kind: 'page', target: 'Old/Weekly' },
    ], principal)).resolves.toEqual([{ key: 'alias-cap', status: 'ambiguous' }]);
  });
});
