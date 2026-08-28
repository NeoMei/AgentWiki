import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../../api/client';
import { LanguageProvider } from '../../context/LanguageContext';
import { PageVersionHistory } from './PageVersionHistory';

vi.mock('../../api/client', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
const contentTreeMocks = vi.hoisted(() => ({ getContentTreeRevision: vi.fn() }));
vi.mock('../../api/content-tree', () => ({ getContentTreeRevision: contentTreeMocks.getContentTreeRevision }));

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const NavigationHarness = () => {
  const navigate = useNavigate();
  return (
    <>
      <button type="button" onClick={() => navigate('/pages/page-1/versions')}>Open first history</button>
      <button type="button" onClick={() => navigate('/pages/page-2/versions')}>Open second history</button>
      <button type="button" onClick={() => navigate('/outside')}>Leave history</button>
      <Routes>
        <Route path="/pages/:id/versions" element={<PageVersionHistory />} />
        <Route path="/outside" element={<p>Outside history</p>} />
      </Routes>
    </>
  );
};

describe('PageVersionHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    contentTreeMocks.getContentTreeRevision.mockResolvedValue('37');
    localStorage.setItem('agentwiki.language.v1', 'zh-CN');
    vi.mocked(api.get).mockImplementation(async (url: string) => url.endsWith('/versions')
      ? { data: [{ id: 'v1', title: '旧版本', content: '# 旧标题\n\n旧正文\n\n- [ ] 历史任务', createdAt: '2026-08-19T00:00:00Z' }] }
      : { data: { id: 'page-1', title: '当前页面', spaceId: 'space-1', capabilities: { canEdit: false } } });
  });

  it('previews a historical Markdown version without restoring it', async () => {
    render(<MemoryRouter initialEntries={['/pages/page-1/versions']}><LanguageProvider>
      <Routes><Route path="/pages/:id/versions" element={<PageVersionHistory />} /></Routes>
    </LanguageProvider></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: '预览 v1' }));
    expect(screen.getByRole('heading', { name: '旧标题' })).toBeInTheDocument();
    expect(screen.getByText('旧正文')).toBeInTheDocument();
    expect(screen.getByRole('checkbox')).toBeDisabled();
    expect(screen.queryByRole('button', { name: '恢复' })).not.toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '关闭预览' }));
    expect(screen.queryByText('旧正文')).not.toBeInTheDocument();
  });

  it('uses the shared modal focus trap, Escape close, inert background and focus restoration', async () => {
    render(<MemoryRouter initialEntries={['/pages/page-1/versions']}><LanguageProvider>
      <Routes><Route path="/pages/:id/versions" element={<PageVersionHistory />} /></Routes>
    </LanguageProvider></MemoryRouter>);
    const trigger = await screen.findByRole('button', { name: '预览 v1' });
    trigger.focus();
    fireEvent.click(trigger);

    const dialog = screen.getByRole('dialog', { name: '预览 v1' });
    const close = screen.getByRole('button', { name: '关闭预览' });
    expect(close).toHaveFocus();
    expect([...document.body.children].filter((element) => !element.hasAttribute('data-modal-portal')))
      .toEqual(expect.arrayContaining([expect.objectContaining({})]));
    expect([...document.body.children].filter((element) => !element.hasAttribute('data-modal-portal'))
      .every((element) => element.hasAttribute('inert'))).toBe(true);

    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(close).toHaveFocus();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await act(async () => Promise.resolve());
    expect(trigger).toHaveFocus();
    expect([...document.body.children].every((element) => !element.hasAttribute('inert'))).toBe(true);
  });

  it('resolves version-root embeds in the current Space and labels successful dynamic content', async () => {
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url === '/pages/page-1') return {
        data: { id: 'page-1', title: '当前页面', spaceId: 'space-1', capabilities: { canEdit: false } },
      };
      if (url === '/pages/page-1/versions') return {
        data: [{ id: 'v1', title: '旧版本', content: '![[Embedded]]', createdAt: '2026-08-19T00:00:00Z' }],
      };
      if (url === '/pages/embedded') return { data: { id: 'embedded', content: '当前嵌入内容' } };
      throw new Error(`unexpected get ${url}`);
    });
    vi.mocked(api.post).mockImplementation(async (url, body) => {
      expect(url).toBe('/spaces/space-1/markdown/resolve');
      const reference = (body as { references: Array<{ key: string }> }).references[0];
      return { data: [{ key: reference.key, status: 'resolved', kind: 'page', pageId: 'embedded', title: 'Embedded', slug: 'embedded' }] };
    });
    render(<MemoryRouter initialEntries={['/pages/page-1/versions']}><LanguageProvider>
      <Routes><Route path="/pages/:id/versions" element={<PageVersionHistory />} /></Routes>
    </LanguageProvider></MemoryRouter>);

    fireEvent.click(await screen.findByRole('button', { name: '预览 v1' }));

    expect(await screen.findByText('当前嵌入内容')).toBeInTheDocument();
    expect(screen.getByText('嵌入内容为当前版本。')).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/pages/embedded', { signal: expect.any(AbortSignal) });
  });

  it('offers Restore to an editor while keeping historical tasks immutable', async () => {
    vi.mocked(api.get).mockImplementation(async (url: string) => url.endsWith('/versions')
      ? { data: [{ id: 'v1', title: '旧版本', content: '- [ ] 历史任务', createdAt: '2026-08-19T00:00:00Z' }] }
      : { data: { id: 'page-1', title: '当前页面', spaceId: 'space-1', capabilities: { canEdit: true } } });
    render(<MemoryRouter initialEntries={['/pages/page-1/versions']}><LanguageProvider>
      <Routes><Route path="/pages/:id/versions" element={<PageVersionHistory />} /></Routes>
    </LanguageProvider></MemoryRouter>);

    expect(await screen.findByRole('button', { name: '恢复' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '预览 v1' }));
    const checkbox = screen.getByRole('checkbox');
    expect(checkbox).toBeDisabled();

    fireEvent.click(checkbox);

    expect(checkbox).not.toBeChecked();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('ignores stale page and capability responses after a version-history route switch', async () => {
    const stalePage = deferred<any>();
    const staleVersions = deferred<any>();
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url === '/pages/page-1') return stalePage.promise;
      if (url === '/pages/page-1/versions') return staleVersions.promise;
      if (url === '/pages/page-2') {
        return { data: { id: 'page-2', title: 'Second page', spaceId: 'space-2', capabilities: { canEdit: false } } };
      }
      if (url === '/pages/page-2/versions') {
        return { data: [{ id: 'v2', title: 'Second version', content: '- [ ] second task', createdAt: '2026-08-20T00:00:00Z' }] };
      }
      throw new Error(`unexpected get ${url}`);
    });
    render(<MemoryRouter initialEntries={['/pages/page-1/versions']}><LanguageProvider>
      <NavigationHarness />
    </LanguageProvider></MemoryRouter>);

    fireEvent.click(screen.getByRole('button', { name: 'Open second history' }));
    expect(await screen.findByText('Second version')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '恢复' })).not.toBeInTheDocument();

    await act(async () => {
      stalePage.resolve({ data: { id: 'page-1', title: 'First page', spaceId: 'space-1', capabilities: { canEdit: true } } });
      staleVersions.resolve({ data: [{ id: 'v1', title: 'Stale first version', content: '- [ ] first task', createdAt: '2026-08-19T00:00:00Z' }] });
      await Promise.all([stalePage.promise, staleVersions.promise]);
    });

    expect(screen.getByText('Second version')).toBeInTheDocument();
    expect(screen.queryByText('Stale first version')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '恢复' })).not.toBeInTheDocument();
  });

  it('ignores a successful restore completion after navigating to another history route', async () => {
    const restore = deferred<any>();
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.mocked(api.post).mockImplementation(() => restore.promise);
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      const pageId = url.includes('page-2') ? 'page-2' : 'page-1';
      if (url.endsWith('/versions')) return {
        data: [{ id: `${pageId}-version`, title: `${pageId} version`, content: '', createdAt: '2026-08-19T00:00:00Z' }],
      };
      return { data: { id: pageId, title: `${pageId} title`, spaceId: `${pageId}-space`, capabilities: { canEdit: true } } };
    });
    render(<MemoryRouter initialEntries={['/pages/page-1/versions']}><LanguageProvider>
      <NavigationHarness />
    </LanguageProvider></MemoryRouter>);

    fireEvent.click(await screen.findByRole('button', { name: '恢复' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith(
      '/pages/page-1/versions/page-1-version/restore',
      { expectedTreeRevision: '37' },
    ));
    expect(contentTreeMocks.getContentTreeRevision).toHaveBeenCalledWith('page-1-space', expect.any(AbortSignal));
    fireEvent.click(screen.getByRole('button', { name: 'Open second history' }));
    expect(await screen.findByText('page-2 version')).toBeInTheDocument();

    await act(async () => restore.resolve({ data: {} }));

    expect(alertSpy).not.toHaveBeenCalled();
    expect(screen.getByText('page-2 version')).toBeInTheDocument();
  });

  it('ignores a failed restore completion after navigating to another history route', async () => {
    const restore = deferred<any>();
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.mocked(api.post).mockImplementation(() => restore.promise);
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      const pageId = url.includes('page-2') ? 'page-2' : 'page-1';
      if (url.endsWith('/versions')) return {
        data: [{ id: `${pageId}-version`, title: `${pageId} version`, content: '', createdAt: '2026-08-19T00:00:00Z' }],
      };
      return { data: { id: pageId, title: `${pageId} title`, spaceId: `${pageId}-space`, capabilities: { canEdit: true } } };
    });
    render(<MemoryRouter initialEntries={['/pages/page-1/versions']}><LanguageProvider>
      <NavigationHarness />
    </LanguageProvider></MemoryRouter>);

    fireEvent.click(await screen.findByRole('button', { name: '恢复' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Open second history' }));
    expect(await screen.findByText('page-2 version')).toBeInTheDocument();

    await act(async () => restore.reject(new Error('late restore failure')));

    expect(alertSpy).not.toHaveBeenCalled();
    expect(screen.getByText('page-2 version')).toBeInTheDocument();
  });

  it.each(['resolve', 'reject'] as const)(
    'ignores a restore completion that would %s after version history unmounts',
    async (settlement) => {
      const restore = deferred<any>();
      const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      vi.mocked(api.post).mockImplementation(() => restore.promise);
      vi.mocked(api.get).mockImplementation(async (url: string) => url.endsWith('/versions')
        ? { data: [{ id: 'v1', title: 'Version one', content: '', createdAt: '2026-08-19T00:00:00Z' }] }
        : { data: { id: 'page-1', title: 'Page one', spaceId: 'space-1', capabilities: { canEdit: true } } });
      render(<MemoryRouter initialEntries={['/pages/page-1/versions']}><LanguageProvider>
        <NavigationHarness />
      </LanguageProvider></MemoryRouter>);

      fireEvent.click(await screen.findByRole('button', { name: '恢复' }));
      await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
      fireEvent.click(screen.getByRole('button', { name: 'Leave history' }));
      expect(await screen.findByText('Outside history')).toBeInTheDocument();

      await act(async () => {
        if (settlement === 'resolve') restore.resolve({ data: {} });
        else restore.reject(new Error('late unmounted failure'));
        await Promise.allSettled([restore.promise]);
      });

      expect(alertSpy).not.toHaveBeenCalled();
      expect(screen.getByText('Outside history')).toBeInTheDocument();
    },
  );

  it('does not keep a reused version ID disabled after a history route switch', async () => {
    const restore = deferred<any>();
    vi.spyOn(window, 'alert').mockImplementation(() => undefined);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.mocked(api.post).mockImplementation(() => restore.promise);
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      const pageId = url.includes('page-2') ? 'page-2' : 'page-1';
      if (url.endsWith('/versions')) return {
        data: [{ id: 'shared-version', title: `${pageId} version`, content: '', createdAt: '2026-08-19T00:00:00Z' }],
      };
      return { data: { id: pageId, title: `${pageId} title`, spaceId: `${pageId}-space`, capabilities: { canEdit: true } } };
    });
    render(<MemoryRouter initialEntries={['/pages/page-1/versions']}><LanguageProvider>
      <NavigationHarness />
    </LanguageProvider></MemoryRouter>);

    fireEvent.click(await screen.findByRole('button', { name: '恢复' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Open second history' }));
    expect(await screen.findByText('page-2 version')).toBeInTheDocument();

    expect(screen.getByRole('button', { name: '恢复' })).toBeEnabled();
  });

  it('allows only one restore request and disables every Restore button while it is pending', async () => {
    const restore = deferred<any>();
    vi.spyOn(window, 'alert').mockImplementation(() => undefined);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.mocked(api.post).mockImplementation(() => restore.promise);
    vi.mocked(api.get).mockImplementation(async (url: string) => url.endsWith('/versions')
      ? { data: [
        { id: 'v2', title: 'Version two', content: '', createdAt: '2026-08-20T00:00:00Z' },
        { id: 'v1', title: 'Version one', content: '', createdAt: '2026-08-19T00:00:00Z' },
      ] }
      : { data: { id: 'page-1', title: 'Current page', spaceId: 'space-1', capabilities: { canEdit: true } } });
    render(<MemoryRouter initialEntries={['/pages/page-1/versions']}><LanguageProvider>
      <Routes><Route path="/pages/:id/versions" element={<PageVersionHistory />} /></Routes>
    </LanguageProvider></MemoryRouter>);

    const restoreButtons = await screen.findAllByRole('button', { name: '恢复' });
    fireEvent.click(restoreButtons[0]);

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    expect(restoreButtons[0]).toBeDisabled();
    expect(restoreButtons[1]).toBeDisabled();
    fireEvent.click(restoreButtons[1]);
    expect(api.post).toHaveBeenCalledTimes(1);
  });

  it('does not POST a restore after navigating while the tree head is pending', async () => {
    const head = deferred<string>();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    contentTreeMocks.getContentTreeRevision.mockReturnValue(head.promise);
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      const pageId = url.includes('page-2') ? 'page-2' : 'page-1';
      if (url.endsWith('/versions')) return {
        data: [{ id: `${pageId}-version`, title: `${pageId} version`, content: '', createdAt: '2026-08-19T00:00:00Z' }],
      };
      return { data: { id: pageId, title: `${pageId} title`, spaceId: `${pageId}-space`, capabilities: { canEdit: true } } };
    });
    render(<MemoryRouter initialEntries={['/pages/page-1/versions']}><LanguageProvider>
      <NavigationHarness />
    </LanguageProvider></MemoryRouter>);

    fireEvent.click(await screen.findByRole('button', { name: '恢复' }));
    await waitFor(() => expect(contentTreeMocks.getContentTreeRevision).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Open second history' }));
    expect(await screen.findByText('page-2 version')).toBeInTheDocument();

    await act(async () => head.resolve('37'));

    expect(api.post).not.toHaveBeenCalled();
  });

  it('ignores a rejected first A load after navigating A to B to A', async () => {
    const firstPageA = deferred<any>();
    const firstVersionsA = deferred<any>();
    let pageALoads = 0;
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url === '/pages/page-1') {
        pageALoads += 1;
        return pageALoads === 1
          ? firstPageA.promise
          : { data: { id: 'page-1', title: 'Fresh A', spaceId: 'space-a', capabilities: { canEdit: false } } };
      }
      if (url === '/pages/page-1/versions') {
        return pageALoads === 1
          ? firstVersionsA.promise
          : { data: [{ id: 'fresh-a', title: 'Fresh A version', content: '', createdAt: '2026-08-21T00:00:00Z' }] };
      }
      if (url === '/pages/page-2') return { data: { id: 'page-2', title: 'Page B', spaceId: 'space-b', capabilities: { canEdit: false } } };
      if (url === '/pages/page-2/versions') return { data: [{ id: 'b', title: 'B version', content: '', createdAt: '2026-08-20T00:00:00Z' }] };
      throw new Error(`unexpected get ${url}`);
    });
    render(<MemoryRouter initialEntries={['/pages/page-1/versions']}><LanguageProvider>
      <NavigationHarness />
    </LanguageProvider></MemoryRouter>);

    fireEvent.click(screen.getByRole('button', { name: 'Open second history' }));
    expect(await screen.findByText('B version')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open first history' }));
    expect(await screen.findByText('Fresh A version')).toBeInTheDocument();

    await act(async () => {
      firstPageA.reject(new Error('stale A failure'));
      firstVersionsA.resolve({ data: [] });
      await Promise.allSettled([firstPageA.promise, firstVersionsA.promise]);
    });

    expect(screen.getByText('Fresh A version')).toBeInTheDocument();
    expect(screen.queryByText('Failed to load version history')).not.toBeInTheDocument();
  });
});
