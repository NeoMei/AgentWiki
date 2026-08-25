import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../../api/client';
import {
  archivePageTemplate,
  createPageTemplate,
  createPageTemplateVersion,
  listPageTemplates,
  restorePageTemplate,
  updatePageTemplate,
} from './pageTemplateApi';
import type { PageTemplateDetail, PageTemplateListResponse } from './pageTemplateTypes';

vi.mock('../../api/client', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

const template: PageTemplateDetail = {
  id: 'template-1',
  scope: 'space',
  stableKey: 'weekly-report',
  category: 'reporting',
  name: 'Weekly report',
  description: 'A weekly report template',
  defaultTitle: 'Weekly {year}-W{week}',
  sourceLocale: 'en',
  currentVersion: 1,
  archivedAt: null,
  updatedAt: '2026-08-25T10:00:00.000Z',
  content: '# Weekly report',
  contentLocale: 'en',
  sourcePageId: 'page-1',
};

const catalog: PageTemplateListResponse = {
  system: [],
  space: [template],
  totalSpace: 1,
  skip: 0,
  take: 100,
  capabilities: { canManage: true },
};

describe('page template API adapters', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads a localized active catalog with fixed bounds', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: catalog } as never);

    await expect(listPageTemplates('space-1', { locale: 'zh-CN' })).resolves.toEqual(catalog);

    expect(api.get).toHaveBeenCalledWith('/spaces/space-1/page-templates', {
      params: { locale: 'zh-CN', scope: 'all', archived: 'active', skip: 0, take: 100 },
    });
  });

  it('forwards optional catalog filters and trims a non-empty query', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: catalog } as never);

    await listPageTemplates('space-1', {
      locale: 'en',
      scope: 'space',
      archived: 'all',
      category: 'planning',
      q: '  roadmap  ',
      skip: 20,
      take: 10,
    });

    expect(api.get).toHaveBeenCalledWith('/spaces/space-1/page-templates', {
      params: {
        locale: 'en',
        scope: 'space',
        archived: 'all',
        skip: 20,
        take: 10,
        category: 'planning',
        q: 'roadmap',
      },
    });
  });

  it('omits a blank catalog search query', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: catalog } as never);

    await listPageTemplates('space-1', { locale: 'en', q: '   ' });

    expect(api.get).toHaveBeenCalledWith('/spaces/space-1/page-templates', {
      params: { locale: 'en', scope: 'all', archived: 'active', skip: 0, take: 100 },
    });
  });

  it('preserves explicit zero pagination values for the server to validate', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: catalog } as never);

    await listPageTemplates('space-1', { locale: 'en', skip: 0, take: 0 });

    expect(api.get).toHaveBeenCalledWith('/spaces/space-1/page-templates', {
      params: { locale: 'en', scope: 'all', archived: 'active', skip: 0, take: 0 },
    });
  });

  it('creates a template and returns the response data', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: template } as never);
    const input = {
      name: 'Weekly report',
      description: 'A weekly report template',
      category: 'reporting' as const,
      defaultTitle: 'Weekly {year}-W{week}',
      locale: 'en' as const,
      sourcePageId: 'page-1',
      expectedSourceUpdatedAt: '2026-08-25T09:00:00.000Z',
    };

    await expect(createPageTemplate('space-1', input)).resolves.toEqual(template);
    expect(api.post).toHaveBeenCalledWith('/spaces/space-1/page-templates', input);
  });

  it('updates template metadata with optimistic state', async () => {
    vi.mocked(api.patch).mockResolvedValue({ data: template } as never);
    const input = {
      name: 'Weekly report',
      description: 'Updated description',
      category: 'reporting' as const,
      defaultTitle: 'Weekly {year}-W{week}',
      expectedUpdatedAt: '2026-08-25T10:00:00.000Z',
    };

    await expect(updatePageTemplate('space-1', 'template-1', input)).resolves.toEqual(template);
    expect(api.patch).toHaveBeenCalledWith('/spaces/space-1/page-templates/template-1', input);
  });

  it('creates a content version from the source page', async () => {
    const versioned = { ...template, currentVersion: 2, noChange: false };
    vi.mocked(api.post).mockResolvedValue({ data: versioned } as never);
    const input = {
      sourcePageId: 'page-1',
      expectedSourceUpdatedAt: '2026-08-25T09:00:00.000Z',
      expectedCurrentVersion: 1,
    };

    await expect(createPageTemplateVersion('space-1', 'template-1', input)).resolves.toEqual(versioned);
    expect(api.post).toHaveBeenCalledWith('/spaces/space-1/page-templates/template-1/versions', input);
  });

  it('sends DELETE optimistic state in the request body', async () => {
    vi.mocked(api.delete).mockResolvedValue({ data: template } as never);

    await expect(archivePageTemplate(
      'space-1',
      'template-1',
      '2026-08-25T10:00:00.000Z',
    )).resolves.toEqual(template);

    expect(api.delete).toHaveBeenCalledWith('/spaces/space-1/page-templates/template-1', {
      data: { expectedUpdatedAt: '2026-08-25T10:00:00.000Z' },
    });
  });

  it('restores a template with optimistic state and safely encodes path segments', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: template } as never);

    await expect(restorePageTemplate(
      'space/one',
      'template?#one',
      '2026-08-25T10:00:00.000Z',
    )).resolves.toEqual(template);

    expect(api.post).toHaveBeenCalledWith(
      '/spaces/space%2Fone/page-templates/template%3F%23one/restore',
      { expectedUpdatedAt: '2026-08-25T10:00:00.000Z' },
    );
  });

  it.each([
    {
      adapter: 'list',
      call: () => listPageTemplates('space/one?x', { locale: 'en' }),
      method: 'get' as const,
      expectedPath: '/spaces/space%2Fone%3Fx/page-templates',
    },
    {
      adapter: 'create',
      call: () => createPageTemplate('space/one?x', {
        name: 'Weekly report',
        category: 'reporting',
        defaultTitle: 'Weekly {year}-W{week}',
        locale: 'en',
        sourcePageId: 'page-1',
        expectedSourceUpdatedAt: '2026-08-25T09:00:00.000Z',
      }),
      method: 'post' as const,
      expectedPath: '/spaces/space%2Fone%3Fx/page-templates',
    },
    {
      adapter: 'update',
      call: () => updatePageTemplate('space/one?x', 'template?#one', {
        name: 'Weekly report',
        category: 'reporting',
        defaultTitle: 'Weekly {year}-W{week}',
        expectedUpdatedAt: '2026-08-25T10:00:00.000Z',
      }),
      method: 'patch' as const,
      expectedPath: '/spaces/space%2Fone%3Fx/page-templates/template%3F%23one',
    },
    {
      adapter: 'create version',
      call: () => createPageTemplateVersion('space/one?x', 'template?#one', {
        sourcePageId: 'page-1',
        expectedSourceUpdatedAt: '2026-08-25T09:00:00.000Z',
        expectedCurrentVersion: 1,
      }),
      method: 'post' as const,
      expectedPath: '/spaces/space%2Fone%3Fx/page-templates/template%3F%23one/versions',
    },
    {
      adapter: 'archive',
      call: () => archivePageTemplate(
        'space/one?x',
        'template?#one',
        '2026-08-25T10:00:00.000Z',
      ),
      method: 'delete' as const,
      expectedPath: '/spaces/space%2Fone%3Fx/page-templates/template%3F%23one',
    },
    {
      adapter: 'restore',
      call: () => restorePageTemplate(
        'space/one?x',
        'template?#one',
        '2026-08-25T10:00:00.000Z',
      ),
      method: 'post' as const,
      expectedPath: '/spaces/space%2Fone%3Fx/page-templates/template%3F%23one/restore',
    },
  ])('safely encodes collection and item path segments for $adapter', async ({
    call,
    method,
    expectedPath,
  }) => {
    vi.mocked(api[method]).mockResolvedValue({ data: template } as never);

    await call();

    expect(api[method]).toHaveBeenCalled();
    expect(vi.mocked(api[method]).mock.calls[0][0]).toBe(expectedPath);
  });
});
