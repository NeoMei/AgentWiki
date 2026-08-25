import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider, useLanguage } from '../../context/LanguageContext';
import type { PageTemplateListResponse, PageTemplateSummary } from './pageTemplateTypes';
import { PageTemplateManager } from './PageTemplateManager';

const mocks = vi.hoisted(() => ({
  api: { get: vi.fn() },
  listPageTemplates: vi.fn(),
  updatePageTemplate: vi.fn(),
  createPageTemplateVersion: vi.fn(),
  archivePageTemplate: vi.fn(),
  restorePageTemplate: vi.fn(),
}));

vi.mock('../../api/client', () => ({ default: mocks.api }));
vi.mock('./pageTemplateApi', () => ({
  listPageTemplates: mocks.listPageTemplates,
  updatePageTemplate: mocks.updatePageTemplate,
  createPageTemplateVersion: mocks.createPageTemplateVersion,
  archivePageTemplate: mocks.archivePageTemplate,
  restorePageTemplate: mocks.restorePageTemplate,
}));
vi.mock('../../components/SpaceNav', () => ({ SpaceNav: ({ spaceId }: { spaceId?: string }) => <div>Space navigation {spaceId}</div> }));

const systemTemplate: PageTemplateSummary = {
  id: 'system-tasks', scope: 'system', stableKey: 'tasks', category: 'planning',
  name: '任务清单', description: '系统任务清单', defaultTitle: '任务清单', sourceLocale: 'zh-CN',
  currentVersion: 1, archivedAt: null, updatedAt: '2026-08-25T09:00:00.000Z',
};

const spaceTemplate: PageTemplateSummary = {
  id: 'space-1-template', scope: 'space', stableKey: 'team-weekly', category: 'reporting',
  name: '团队周报', description: '团队格式', defaultTitle: '团队周报', sourceLocale: null,
  currentVersion: 7, archivedAt: null, updatedAt: '2026-08-25T10:00:00.000Z',
};

const ownerCatalog: PageTemplateListResponse = {
  system: [systemTemplate], space: [spaceTemplate], totalSpace: 1, skip: 0, take: 50,
  capabilities: { canManage: true },
};

const renderManager = (initialEntry = '/spaces/space-1/settings/page-templates') => render(
  <LanguageProvider>
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/spaces/:id/settings/page-templates" element={<PageTemplateManager />} />
      </Routes>
    </MemoryRouter>
  </LanguageProvider>,
);

const LanguageSwitch = () => {
  const { setLanguage } = useLanguage();
  return <button type="button" onClick={() => setLanguage('en')}>Switch language</button>;
};

const LanguageHarness = () => (
  <LanguageProvider>
    <MemoryRouter initialEntries={['/spaces/space-1/settings/page-templates']}>
      <LanguageSwitch />
      <Routes><Route path="/spaces/:id/settings/page-templates" element={<PageTemplateManager />} /></Routes>
    </MemoryRouter>
  </LanguageProvider>
);

const SpaceSwitch = () => {
  const navigate = useNavigate();
  return <button type="button" onClick={() => navigate('/spaces/space-2/settings/page-templates')}>Switch space</button>;
};

describe('PageTemplateManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('agentwiki.language.v1', 'zh-CN');
    mocks.api.get.mockResolvedValue({ data: { data: [], total: 0 } });
  });

  it('edits metadata with the loaded optimistic timestamp', async () => {
    mocks.listPageTemplates.mockResolvedValue(ownerCatalog);
    mocks.updatePageTemplate.mockResolvedValue({ ...spaceTemplate, name: '团队周报新版' });
    renderManager();

    fireEvent.click(await screen.findByRole('button', { name: /编辑 团队周报/ }));
    fireEvent.change(screen.getByLabelText('模板名称'), { target: { value: '团队周报新版' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => expect(mocks.updatePageTemplate).toHaveBeenCalledWith('space-1', 'space-1-template', {
      name: '团队周报新版', description: '团队格式', category: 'reporting',
      defaultTitle: '团队周报', expectedUpdatedAt: spaceTemplate.updatedAt,
    }));
    await waitFor(() => expect(mocks.listPageTemplates).toHaveBeenCalledTimes(2));
  });

  it('allows maximum-length unbroken template names to wrap in both management dialog headings', async () => {
    const longName = 'L'.repeat(80);
    mocks.listPageTemplates.mockResolvedValue({
      ...ownerCatalog,
      space: [{ ...spaceTemplate, name: longName }],
    });
    renderManager();

    fireEvent.click(await screen.findByRole('button', { name: `编辑 ${longName}` }));
    expect(screen.getByRole('heading', { name: `编辑 ${longName}` }))
      .toHaveClass('min-w-0', 'break-words', '[overflow-wrap:anywhere]');
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));

    fireEvent.click(screen.getByRole('button', { name: `从页面更新内容 ${longName}` }));
    expect(screen.getByRole('heading', { name: `从页面更新内容 ${longName}` }))
      .toHaveClass('min-w-0', 'break-words', '[overflow-wrap:anywhere]');
  });

  it('creates a new content version from an exact persisted source page', async () => {
    mocks.listPageTemplates.mockResolvedValue(ownerCatalog);
    mocks.api.get.mockResolvedValue({ data: { data: [{
      id: 'page-source', title: '新版周报结构', format: 'markdown', updatedAt: '2026-08-25T12:00:00.000Z',
    }], total: 1 } });
    mocks.createPageTemplateVersion.mockResolvedValue({ ...spaceTemplate, currentVersion: 8 });
    renderManager();

    fireEvent.click(await screen.findByRole('button', { name: /更新内容 团队周报/ }));
    fireEvent.change(await screen.findByLabelText('源页面'), { target: { value: 'page-source' } });
    fireEvent.click(screen.getByRole('button', { name: '创建新版本' }));

    await waitFor(() => expect(mocks.createPageTemplateVersion).toHaveBeenCalledWith(
      'space-1', 'space-1-template', {
        sourcePageId: 'page-source', expectedSourceUpdatedAt: '2026-08-25T12:00:00.000Z',
        expectedCurrentVersion: spaceTemplate.currentVersion,
      },
    ));
  });

  it('loads every source page batch and offers only Markdown pages', async () => {
    mocks.listPageTemplates.mockResolvedValue(ownerCatalog);
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      id: `page-${index}`, title: `Page ${index}`, format: index === 0 ? 'docx' : 'markdown',
      updatedAt: `2026-08-25T12:${String(index % 60).padStart(2, '0')}:00.000Z`,
    }));
    mocks.api.get
      .mockResolvedValueOnce({ data: { data: firstPage, total: 101 } })
      .mockResolvedValueOnce({ data: { data: [{
        id: 'page-last', title: 'Last Markdown', format: 'markdown', updatedAt: '2026-08-25T13:00:00.000Z',
      }], total: 101 } });
    renderManager();

    fireEvent.click(await screen.findByRole('button', { name: /更新内容 团队周报/ }));
    const source = await screen.findByLabelText('源页面');

    expect(mocks.api.get).toHaveBeenNthCalledWith(1, '/pages?spaceId=space-1&skip=0&take=100');
    expect(mocks.api.get).toHaveBeenNthCalledWith(2, '/pages?spaceId=space-1&skip=100&take=100');
    expect(source.querySelector('option[value="page-0"]')).not.toBeInTheDocument();
    expect(source.querySelector('option[value="page-last"]')).toHaveTextContent('Last Markdown');
  });

  it('archives and restores with confirmation and exact updatedAt', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mocks.archivePageTemplate.mockResolvedValue({ ...spaceTemplate, archivedAt: '2026-08-25T13:00:00.000Z' });
    mocks.restorePageTemplate.mockResolvedValue({ ...spaceTemplate, updatedAt: '2026-08-25T14:00:00.000Z' });
    const archivedTemplate = {
      ...spaceTemplate,
      archivedAt: '2026-08-25T13:00:00.000Z',
      updatedAt: '2026-08-25T13:00:00.000Z',
    };
    mocks.listPageTemplates
      .mockResolvedValueOnce(ownerCatalog)
      .mockResolvedValueOnce({ ...ownerCatalog, space: [archivedTemplate] })
      .mockResolvedValueOnce({ ...ownerCatalog, space: [archivedTemplate] })
      .mockResolvedValue(ownerCatalog);
    renderManager();

    fireEvent.click(await screen.findByRole('button', { name: /归档 团队周报/ }));
    await waitFor(() => expect(mocks.archivePageTemplate).toHaveBeenCalledWith(
      'space-1', 'space-1-template', spaceTemplate.updatedAt,
    ));
    fireEvent.click(screen.getByRole('checkbox', { name: '显示已归档模板' }));
    await waitFor(() => expect(mocks.listPageTemplates).toHaveBeenLastCalledWith(
      'space-1', expect.objectContaining({ archived: 'all' }),
    ));
    fireEvent.click(await screen.findByRole('button', { name: /恢复 团队周报/ }));
    await waitFor(() => expect(mocks.restorePageTemplate).toHaveBeenCalledWith(
      'space-1', 'space-1-template', '2026-08-25T13:00:00.000Z',
    ));
  });

  it('renders system templates read-only and removes every mutation when capability is false', async () => {
    mocks.listPageTemplates.mockResolvedValue({ ...ownerCatalog, capabilities: { canManage: false } });
    renderManager();

    expect(await screen.findByText('任务清单')).toBeInTheDocument();
    expect(screen.getByText('团队周报')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /编辑|归档|恢复|更新内容/ })).not.toBeInTheDocument();
  });

  it('keeps metadata input after failure and prevents closing or duplicate submit while pending', async () => {
    let rejectUpdate!: (reason: unknown) => void;
    mocks.listPageTemplates.mockResolvedValue(ownerCatalog);
    mocks.updatePageTemplate.mockImplementation(() => new Promise((_resolve, reject) => { rejectUpdate = reject; }));
    renderManager();

    fireEvent.click(await screen.findByRole('button', { name: /编辑 团队周报/ }));
    fireEvent.change(screen.getByLabelText('模板名称'), { target: { value: '保留这个名称' } });
    const form = screen.getByLabelText('模板名称').closest('form')!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    const dialog = screen.getByRole('dialog');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.getByRole('button', { name: '关闭' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '取消' })).toBeDisabled();
    expect(mocks.updatePageTemplate).toHaveBeenCalledTimes(1);

    await act(async () => rejectUpdate(new Error('offline')));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByLabelText('模板名称')).toHaveValue('保留这个名称');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('keeps the catalog invalid after a successful metadata mutation until a failed authoritative reload is retried', async () => {
    let rejectReload!: (reason: unknown) => void;
    const refreshedTemplate = {
      ...spaceTemplate,
      name: '权威周报',
      currentVersion: 8,
      updatedAt: '2026-08-25T15:00:00.000Z',
    };
    mocks.listPageTemplates
      .mockResolvedValueOnce(ownerCatalog)
      .mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectReload = reject; }))
      .mockResolvedValue({ ...ownerCatalog, space: [refreshedTemplate] });
    mocks.updatePageTemplate.mockResolvedValue({ ...spaceTemplate, name: '缓存响应' });
    renderManager();

    fireEvent.click(await screen.findByRole('button', { name: /编辑 团队周报/ }));
    fireEvent.change(screen.getByLabelText('模板名称'), { target: { value: '提交名称' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(mocks.listPageTemplates).toHaveBeenCalledTimes(2));

    expect(screen.queryByText('团队周报')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /编辑|归档|恢复|更新内容/ })).not.toBeInTheDocument();
    expect(mocks.updatePageTemplate).toHaveBeenCalledTimes(1);
    expect(mocks.archivePageTemplate).not.toHaveBeenCalled();

    await act(async () => rejectReload(new Error('reload offline')));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('团队周报')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /编辑|归档|恢复|更新内容/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByText('权威周报')).toBeInTheDocument();
    expect(screen.getByText(/v8/)).toBeInTheDocument();
    expect(screen.queryByText('团队周报')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /编辑 权威周报/ }));
    fireEvent.change(screen.getByLabelText('模板名称'), { target: { value: '再次提交' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(mocks.updatePageTemplate).toHaveBeenNthCalledWith(2, 'space-1', 'space-1-template', {
      name: '再次提交', description: '团队格式', category: 'reporting',
      defaultTitle: '团队周报', expectedUpdatedAt: refreshedTemplate.updatedAt,
    }));
  });

  it('uses the same authoritative refresh gate after archive succeeds', async () => {
    let resolveReload!: (value: PageTemplateListResponse) => void;
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mocks.listPageTemplates
      .mockResolvedValueOnce(ownerCatalog)
      .mockImplementationOnce(() => new Promise((resolve) => { resolveReload = resolve; }));
    mocks.archivePageTemplate.mockResolvedValue({
      ...spaceTemplate, archivedAt: '2026-08-25T16:00:00.000Z', updatedAt: '2026-08-25T16:00:00.000Z',
    });
    renderManager();

    fireEvent.click(await screen.findByRole('button', { name: /归档 团队周报/ }));
    await waitFor(() => expect(mocks.listPageTemplates).toHaveBeenCalledTimes(2));

    expect(screen.queryByText('团队周报')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /编辑|归档|恢复|更新内容/ })).not.toBeInTheDocument();
    expect(mocks.archivePageTemplate).toHaveBeenCalledTimes(1);

    await act(async () => resolveReload({ ...ownerCatalog, space: [], totalSpace: 0 }));
    expect(screen.queryByText('团队周报')).not.toBeInTheDocument();
    expect(mocks.archivePageTemplate).toHaveBeenCalledTimes(1);
  });

  it('refreshes the latest filter identity when an archive succeeds after that identity changed', async () => {
    let resolveArchive!: (value: PageTemplateSummary) => void;
    let resolveAuthoritative!: (value: PageTemplateListResponse) => void;
    const filteredOldSnapshot = {
      ...ownerCatalog,
      space: [{ ...spaceTemplate, name: '筛选旧快照' }],
    };
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mocks.listPageTemplates
      .mockResolvedValueOnce(ownerCatalog)
      .mockResolvedValueOnce(filteredOldSnapshot)
      .mockImplementationOnce(() => new Promise((resolve) => { resolveAuthoritative = resolve; }));
    mocks.archivePageTemplate.mockImplementation(() => new Promise((resolve) => { resolveArchive = resolve; }));
    renderManager();

    fireEvent.click(await screen.findByRole('button', { name: /归档 团队周报/ }));
    fireEvent.change(screen.getByLabelText('搜索模板'), { target: { value: 'latest filter' } });
    expect(await screen.findByText('筛选旧快照')).toBeInTheDocument();

    await act(async () => resolveArchive({
      ...spaceTemplate,
      archivedAt: '2026-08-25T17:00:00.000Z',
      updatedAt: '2026-08-25T17:00:00.000Z',
    }));
    await waitFor(() => expect(mocks.listPageTemplates).toHaveBeenCalledTimes(3));
    expect(mocks.listPageTemplates).toHaveBeenLastCalledWith('space-1', expect.objectContaining({
      q: 'latest filter', archived: 'active', skip: 0,
    }));
    expect(screen.queryByText('筛选旧快照')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /编辑|归档|恢复|更新内容/ })).not.toBeInTheDocument();

    await act(async () => resolveAuthoritative({ ...ownerCatalog, space: [], totalSpace: 0 }));
    expect(screen.queryByText('筛选旧快照')).not.toBeInTheDocument();
  });

  it('does not let a deferred mutation completion invalidate a different Space', async () => {
    let resolveArchive!: (value: PageTemplateSummary) => void;
    const spaceTwoTemplate = {
      ...spaceTemplate,
      id: 'space-2-template',
      name: 'Space Two template',
    };
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mocks.listPageTemplates.mockImplementation(async (spaceId: string) => (
      spaceId === 'space-1'
        ? ownerCatalog
        : { ...ownerCatalog, space: [spaceTwoTemplate] }
    ));
    mocks.archivePageTemplate.mockImplementation(() => new Promise((resolve) => {
      resolveArchive = resolve;
    }));
    render(
      <LanguageProvider>
        <MemoryRouter initialEntries={['/spaces/space-1/settings/page-templates']}>
          <SpaceSwitch />
          <Routes><Route path="/spaces/:id/settings/page-templates" element={<PageTemplateManager />} /></Routes>
        </MemoryRouter>
      </LanguageProvider>,
    );

    fireEvent.click(await screen.findByRole('button', { name: /归档 团队周报/ }));
    await waitFor(() => expect(mocks.archivePageTemplate).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Switch space' }));
    expect(await screen.findByText('Space Two template')).toBeInTheDocument();

    await act(async () => resolveArchive({
      ...spaceTemplate,
      archivedAt: '2026-08-25T18:00:00.000Z',
      updatedAt: '2026-08-25T18:00:00.000Z',
    }));

    expect(mocks.listPageTemplates).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Space Two template')).toBeInTheDocument();
    expect(screen.queryByText('团队周报')).not.toBeInTheDocument();
  });

  it('shows no-change feedback and keeps the version dialog open', async () => {
    mocks.listPageTemplates.mockResolvedValue(ownerCatalog);
    mocks.api.get.mockResolvedValue({ data: { data: [{
      id: 'page-source', title: 'Source', format: 'markdown', updatedAt: '2026-08-25T12:00:00.000Z',
    }], total: 1 } });
    mocks.createPageTemplateVersion.mockResolvedValue({ ...spaceTemplate, noChange: true });
    renderManager();

    fireEvent.click(await screen.findByRole('button', { name: /更新内容 团队周报/ }));
    fireEvent.change(await screen.findByLabelText('源页面'), { target: { value: 'page-source' } });
    fireEvent.click(screen.getByRole('button', { name: '创建新版本' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('页面内容未变化，未创建新版本');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('ignores stale search, category, archive, and language responses', async () => {
    const pending: Array<{ options: Record<string, unknown>; resolve: (value: PageTemplateListResponse) => void }> = [];
    mocks.listPageTemplates.mockImplementation((_spaceId: string, options: Record<string, unknown>) => new Promise((resolve) => {
      pending.push({ options, resolve });
    }));
    render(<LanguageHarness />);

    expect(pending).toHaveLength(1);
    fireEvent.change(screen.getByLabelText('搜索模板'), { target: { value: 'weekly' } });
    fireEvent.change(screen.getByLabelText('分类'), { target: { value: 'reporting' } });
    fireEvent.click(screen.getByRole('checkbox', { name: '显示已归档模板' }));
    fireEvent.click(screen.getByRole('button', { name: 'Switch language' }));
    const newest = pending[pending.length - 1];
    await act(async () => newest.resolve({
      ...ownerCatalog, system: [], space: [{ ...spaceTemplate, id: 'newest', name: 'Newest result' }],
    }));
    expect(await screen.findByText('Newest result')).toBeInTheDocument();

    for (const request of pending.slice(0, -1)) {
      await act(async () => request.resolve({
        ...ownerCatalog, system: [], space: [{ ...spaceTemplate, id: 'stale', name: 'Stale result' }],
      }));
    }
    expect(screen.queryByText('Stale result')).not.toBeInTheDocument();
    expect(screen.getByText('Newest result')).toBeInTheDocument();
    expect(newest.options).toEqual(expect.objectContaining({
      locale: 'en', q: 'weekly', category: 'reporting', archived: 'all', skip: 0,
    }));
  });

  it('invalidates the previous Space immediately and ignores its late response', async () => {
    let resolveOld!: (value: PageTemplateListResponse) => void;
    let resolveNew!: (value: PageTemplateListResponse) => void;
    mocks.listPageTemplates.mockImplementation((spaceId: string) => new Promise((resolve) => {
      if (spaceId === 'space-1') resolveOld = resolve;
      else resolveNew = resolve;
    }));
    render(
      <LanguageProvider>
        <MemoryRouter initialEntries={['/spaces/space-1/settings/page-templates']}>
          <SpaceSwitch />
          <Routes><Route path="/spaces/:id/settings/page-templates" element={<PageTemplateManager />} /></Routes>
        </MemoryRouter>
      </LanguageProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Switch space' }));
    await act(async () => resolveNew({
      ...ownerCatalog, space: [{ ...spaceTemplate, id: 'new-space', name: 'Space Two template' }],
    }));
    expect(await screen.findByText('Space Two template')).toBeInTheDocument();

    await act(async () => resolveOld({
      ...ownerCatalog, space: [{ ...spaceTemplate, id: 'old-space', name: 'Old Space template' }],
    }));
    expect(screen.queryByText('Old Space template')).not.toBeInTheDocument();
    expect(screen.getByText('Space Two template')).toBeInTheDocument();
  });

  it('invalidates a completed catalog and its mutation controls synchronously when identity changes', async () => {
    mocks.listPageTemplates
      .mockResolvedValueOnce(ownerCatalog)
      .mockImplementationOnce(() => new Promise(() => undefined));
    renderManager();

    expect(await screen.findByRole('button', { name: /编辑 团队周报/ })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('搜索模板'), { target: { value: 'new identity' } });

    expect(screen.queryByText('团队周报')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /编辑|归档|恢复|更新内容/ })).not.toBeInTheDocument();
  });

  it('deduplicates load-more results and ignores an old page after a reset', async () => {
    let resolveMore!: (value: PageTemplateListResponse) => void;
    mocks.listPageTemplates
      .mockResolvedValueOnce({ ...ownerCatalog, totalSpace: 3 })
      .mockImplementationOnce(() => new Promise((resolve) => { resolveMore = resolve; }))
      .mockResolvedValueOnce({
        ...ownerCatalog, totalSpace: 1, space: [{ ...spaceTemplate, id: 'fresh', name: 'Fresh search' }],
      });
    renderManager();

    fireEvent.click(await screen.findByRole('button', { name: /加载更多/ }));
    fireEvent.change(screen.getByLabelText('搜索模板'), { target: { value: 'fresh' } });
    expect(await screen.findByText('Fresh search')).toBeInTheDocument();
    await act(async () => resolveMore({
      ...ownerCatalog,
      space: [spaceTemplate, { ...spaceTemplate, id: 'old-more', name: 'Old more' }],
      totalSpace: 3,
      skip: 1,
    }));

    expect(screen.queryByText('Old more')).not.toBeInTheDocument();
    expect(screen.getAllByText('Fresh search')).toHaveLength(1);
  });

  it('appends an accepted load-more page without duplicating overlapping records', async () => {
    const secondTemplate = { ...spaceTemplate, id: 'space-1-second', name: 'Second template' };
    mocks.listPageTemplates
      .mockResolvedValueOnce({ ...ownerCatalog, totalSpace: 2 })
      .mockResolvedValueOnce({ ...ownerCatalog, totalSpace: 2, skip: 1, space: [spaceTemplate, secondTemplate] });
    renderManager();

    fireEvent.click(await screen.findByRole('button', { name: /加载更多/ }));
    expect(await screen.findByText('Second template')).toBeInTheDocument();
    expect(screen.getAllByText('团队周报')).toHaveLength(1);
    expect(mocks.listPageTemplates).toHaveBeenLastCalledWith('space-1', expect.objectContaining({ skip: 1 }));
  });
});
