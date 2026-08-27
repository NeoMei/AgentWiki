import { BusinessException } from '../core/filters/business-error';
import { MarkdownResourceService } from './markdown-resource.service';

const principal = { userId: 'user-1' };

function page(overrides: Partial<Record<'id' | 'spaceId' | 'title' | 'slug' | 'syncPath' | 'syncPathKey', string>> = {}) {
  return {
    id: 'page-default',
    spaceId: 'space-1',
    title: 'Default',
    slug: 'default',
    syncPath: 'pages/Default.md',
    syncPathKey: 'pages/default.md',
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
    page: { findMany: jest.fn() },
    spaceAttachment: { findMany: jest.fn() },
  } as any;
  const authorization = { assertSpaceAccess: jest.fn() } as any;
  let service: MarkdownResourceService;

  beforeEach(() => {
    jest.clearAllMocks();
    authorization.assertSpaceAccess.mockResolvedValue({ role: 'viewer' });
    prisma.page.findMany.mockResolvedValue([]);
    prisma.spaceAttachment.findMany.mockResolvedValue([]);
    service = new MarkdownResourceService(prisma, authorization);
  });

  it('authorizes the Space once and resolves pages in id, syncPath, slug, then title order', async () => {
    prisma.page.findMany
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
    prisma.page.findMany
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

  it('treats .md as a page suffix only after full syncPath matching', async () => {
    prisma.page.findMany
      .mockResolvedValueOnce([
        page({ id: 'full-path', title: 'Other', slug: 'other', syncPath: 'guides/Guide.md', syncPathKey: 'guides/guide.md' }),
      ])
      .mockResolvedValueOnce([
        page({ id: 'fallback', title: 'Guide', slug: 'guide', syncPath: 'pages/Guide.md', syncPathKey: 'pages/guide.md' }),
      ])
      .mockResolvedValueOnce([]);

    const result = await service.resolve('space-1', [
      { key: 'full', kind: 'page', target: 'guides/Guide.md' },
      { key: 'fallback', kind: 'page', target: 'Guide.md' },
    ], principal);

    expect(result).toEqual([
      { key: 'full', status: 'resolved', kind: 'page', pageId: 'full-path', title: 'Other', slug: 'other' },
      { key: 'fallback', status: 'resolved', kind: 'page', pageId: 'fallback', title: 'Guide', slug: 'guide' },
    ]);
  });

  it('returns ambiguous without candidates when exact normalized titles collide', async () => {
    prisma.page.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        page({ id: 'one', title: 'Caf\u00e9', slug: 'one' }),
        page({ id: 'two', title: 'CAF\u00c9', slug: 'two' }),
      ]);

    await expect(service.resolve('space-1', [
      { key: 'ambiguous', kind: 'page', target: ' Cafe\u0301 ' },
    ], principal)).resolves.toEqual([{ key: 'ambiguous', status: 'ambiguous' }]);
  });

  it('queries the NFD equivalent so NFC title matching also works for legacy decomposed rows', async () => {
    prisma.page.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockImplementationOnce(async (query: any) => (
        query.where.title.in.includes('cafe\u0301')
          ? [page({ id: 'legacy-nfd', title: 'Cafe\u0301', slug: 'legacy-nfd' })]
          : []
      ));

    await expect(service.resolve('space-1', [
      { key: 'canonical', kind: 'page', target: 'CAF\u00c9' },
    ], principal)).resolves.toEqual([{
      key: 'canonical', status: 'resolved', kind: 'page',
      pageId: 'legacy-nfd', title: 'Cafe\u0301', slug: 'legacy-nfd',
    }]);
  });

  it('queries the NFD equivalent so normalized slug matching covers decomposed stored values', async () => {
    prisma.page.findMany
      .mockResolvedValueOnce([])
      .mockImplementationOnce(async (query: any) => (
        query.where.slug.in.includes('cafe\u0301')
          ? [page({ id: 'nfd-slug', title: 'NFD slug', slug: 'cafe\u0301' })]
          : []
      ))
      .mockResolvedValueOnce([]);

    await expect(service.resolve('space-1', [
      { key: 'slug-canonical', kind: 'page', target: 'CAF\u00c9' },
    ], principal)).resolves.toEqual([{
      key: 'slug-canonical', status: 'resolved', kind: 'page',
      pageId: 'nfd-slug', title: 'NFD slug', slug: 'cafe\u0301',
    }]);
  });

  it('fails every title-tier reference closed when the global title query reaches its cap', async () => {
    prisma.page.findMany
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
    prisma.page.findMany
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
      prisma.page.findMany.mockResolvedValue([
        page({ id: 'spoofed-page', title: target, slug: target.toLowerCase() }),
      ]);
      await expect(service.resolve('space-1', [
        { key: 'image-as-page', kind: 'page', target },
      ], principal)).resolves.toEqual([{ key: 'image-as-page', status: 'unresolved' }]);
    },
  );

  it('scopes every lookup to the authorized Space and never resolves supplied cross-Space rows', async () => {
    prisma.page.findMany.mockResolvedValue([
      { ...page({ id: 'foreign-page', title: 'Foreign' }), spaceId: 'space-2' },
    ]);
    prisma.spaceAttachment.findMany.mockResolvedValue([
      { ...attachment({ id: 'foreign-attachment', displayName: 'foreign.png', nameKey: 'foreign.png' }), spaceId: 'space-2' },
    ]);

    const result = await service.resolve('space-1', [
      { key: 'page', kind: 'page', target: 'Foreign' },
      { key: 'attachment', kind: 'attachment', target: 'foreign.png' },
    ], principal);

    expect(prisma.page.findMany).toHaveBeenCalled();
    for (const [query] of prisma.page.findMany.mock.calls) {
      expect(query.where.spaceId).toBe('space-1');
      expect(query.where.deletedAt).toBeNull();
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
    expect(prisma.page.findMany).not.toHaveBeenCalled();
    expect(prisma.spaceAttachment.findMany).not.toHaveBeenCalled();
  });

  it('uses a constant number of bounded bulk findMany queries for one hundred references', async () => {
    const references = Array.from({ length: 100 }, (_, index) => index % 2 === 0
      ? { key: `page-${index}`, kind: 'page' as const, target: `Page ${index}` }
      : { key: `attachment-${index}`, kind: 'attachment' as const, target: `image-${index}.png` });

    await service.resolve('space-1', references, principal);

    expect(prisma.page.findMany).toHaveBeenCalledTimes(3);
    expect(prisma.spaceAttachment.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.page.findMany.mock.calls[0][0].take).toBe(201);
    expect(prisma.page.findMany.mock.calls[1][0].take).toBe(201);
    expect(prisma.page.findMany.mock.calls[2][0].take).toBe(201);
    expect(prisma.spaceAttachment.findMany.mock.calls[0][0].take).toBeLessThanOrEqual(100);
  });
});
