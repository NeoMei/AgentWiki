import { pathKey } from '@neomei/agentwiki-sync-protocol';
import {
  ReadableSyncPathService,
  safeMarkdownBasename,
} from './readable-sync-path.service';

describe('ReadableSyncPathService', () => {
  const tx = {
    page: {
      findMany: jest.fn(),
    },
  };
  let service: ReadableSyncPathService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ReadableSyncPathService();
  });

  it.each([
    ['吃饭睡觉打豆豆', '吃饭睡觉打豆豆'],
    ['  A / B  ', 'A B'],
    ['CON', '未命名文章'],
    ['.', '未命名文章'],
  ])('sanitizes %s to %s', (title, expected) => {
    expect(safeMarkdownBasename(title)).toBe(expected);
  });

  it('normalizes canonically equivalent titles to the same basename', () => {
    expect(safeMarkdownBasename('Cafe\u0301')).toBe('Café');
    expect(safeMarkdownBasename('Cafe\u0301')).toBe(
      safeMarkdownBasename('Café'),
    );
  });

  it('preserves emoji', () => {
    expect(safeMarkdownBasename('设计 🚀')).toBe('设计 🚀');
  });

  it('replaces forbidden and control characters and trims trailing dots', () => {
    expect(safeMarkdownBasename('A<>:"/\\|?*B\u0000... ')).toBe('A B');
  });

  it('falls back for an empty or control-only title', () => {
    expect(safeMarkdownBasename('')).toBe('未命名文章');
    expect(safeMarkdownBasename('\u0000\u0001\u001f')).toBe('未命名文章');
  });

  it('truncates a long title by UTF-8 bytes with room for a suffix and extension', () => {
    const basename = safeMarkdownBasename('汉'.repeat(100));

    expect(Buffer.byteLength(basename, 'utf8')).toBeLessThanOrEqual(248);
    expect(Array.from(basename).every((character) => character === '汉')).toBe(true);
  });

  it('allocates the smallest casefold-safe suffix and excludes the current page', async () => {
    tx.page.findMany.mockResolvedValue([
      { id: 'other-1', syncPathKey: pathKey('pages/Guide.md') },
      { id: 'other-2', syncPathKey: pathKey('pages/guide (2).md') },
      { id: 'current', syncPathKey: pathKey('pages/Old.md') },
    ]);

    await expect(
      service.allocate(tx as any, {
        spaceId: 'space-1',
        directory: 'pages',
        title: 'GUIDE',
        excludePageId: 'current',
      }),
    ).resolves.toEqual({
      path: 'pages/GUIDE (3).md',
      pathKey: pathKey('pages/GUIDE (3).md'),
    });
    expect(tx.page.findMany).toHaveBeenCalledWith({
      where: {
        spaceId: 'space-1',
        id: { not: 'current' },
      },
      select: { syncPathKey: true },
    });
  });

  it('allocates an already-free candidate without a suffix', async () => {
    tx.page.findMany.mockResolvedValue([]);

    await expect(
      service.allocate(tx as any, {
        spaceId: 'space-1',
        directory: 'pages',
        title: '设计 🚀',
      }),
    ).resolves.toEqual({
      path: 'pages/设计 🚀.md',
      pathKey: pathKey('pages/设计 🚀.md'),
    });
    expect(tx.page.findMany).toHaveBeenCalledWith({
      where: {
        spaceId: 'space-1',
      },
      select: { syncPathKey: true },
    });
  });

  it('allocates a root-level path without a leading slash', async () => {
    tx.page.findMany.mockResolvedValue([]);

    await expect(
      service.allocate(tx as any, {
        spaceId: 'space-1',
        directory: '',
        title: 'Guide',
      }),
    ).resolves.toEqual({
      path: 'Guide.md',
      pathKey: pathKey('Guide.md'),
    });
  });

  it('treats NFC-equivalent occupied paths as the same candidate', async () => {
    tx.page.findMany.mockResolvedValue([
      { syncPathKey: pathKey('pages/Cafe\u0301.md') },
    ]);

    await expect(
      service.allocate(tx as any, {
        spaceId: 'space-1',
        directory: 'pages',
        title: 'Café',
      }),
    ).resolves.toEqual({
      path: 'pages/Café (2).md',
      pathKey: pathKey('pages/Café (2).md'),
    });
  });

  it('allocates a portable path for a title longer than one path segment', async () => {
    tx.page.findMany.mockResolvedValue([]);

    const result = await service.allocate(tx as any, {
      spaceId: 'space-1',
      directory: 'pages',
      title: '汉'.repeat(100),
    });

    const segments = result.path.split('/');
    expect(
      Buffer.byteLength(segments[segments.length - 1]!, 'utf8'),
    ).toBeLessThanOrEqual(255);
    expect(result.pathKey).toBe(pathKey(result.path));
  });

  it('shrinks a 248-byte basename to allocate the smallest two-digit suffix', async () => {
    const basename = 'a'.repeat(248);
    tx.page.findMany.mockResolvedValue([
      { syncPathKey: pathKey(`pages/${basename}.md`) },
      ...Array.from({ length: 8 }, (_, index) => ({
        syncPathKey: pathKey(`pages/${basename} (${index + 2}).md`),
      })),
    ]);

    await expect(
      service.allocate(tx as any, {
        spaceId: 'space-1',
        directory: 'pages',
        title: basename,
      }),
    ).resolves.toEqual({
      path: `pages/${'a'.repeat(247)} (10).md`,
      pathKey: pathKey(`pages/${'a'.repeat(247)} (10).md`),
    });
  });

  it('uses the NFC directory byte length to fit the full path limit', async () => {
    const directory = Array.from({ length: 4 }, () =>
      'e\u0301'.repeat(120),
    ).join('/');
    const normalizedDirectory = directory.normalize('NFC');
    tx.page.findMany.mockResolvedValue([]);

    await expect(
      service.allocate(tx as any, {
        spaceId: 'space-1',
        directory,
        title: 't'.repeat(248),
      }),
    ).resolves.toEqual({
      path: `${normalizedDirectory}/${'t'.repeat(57)}.md`,
      pathKey: pathKey(`${normalizedDirectory}/${'t'.repeat(57)}.md`),
    });
  });

  it('treats a soft-deleted page path as occupied by the database unique key', async () => {
    tx.page.findMany.mockImplementation(
      ({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve(
          'deletedAt' in where
            ? []
            : [{ syncPathKey: pathKey('pages/Guide.md') }],
        ),
    );

    await expect(
      service.allocate(tx as any, {
        spaceId: 'space-1',
        directory: 'pages',
        title: 'Guide',
      }),
    ).resolves.toEqual({
      path: 'pages/Guide (2).md',
      pathKey: pathKey('pages/Guide (2).md'),
    });
    expect(tx.page.findMany).toHaveBeenCalledWith({
      where: { spaceId: 'space-1' },
      select: { syncPathKey: true },
    });
  });

  it('uses a preloaded occupied-key set without querying every page again', async () => {
    const occupied = new Set([
      pathKey('pages/Guide.md'),
      pathKey('pages/guide (2).md'),
    ]);

    await expect(
      service.allocate(tx as any, {
        spaceId: 'space-1',
        directory: 'pages',
        title: 'GUIDE',
      }, occupied),
    ).resolves.toEqual({
      path: 'pages/GUIDE (3).md',
      pathKey: pathKey('pages/GUIDE (3).md'),
    });
    expect(tx.page.findMany).not.toHaveBeenCalled();
  });
});
