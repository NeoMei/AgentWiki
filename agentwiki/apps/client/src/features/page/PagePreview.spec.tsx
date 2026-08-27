import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../../api/client';
import { LanguageSwitcher } from '../../components/LanguageSwitcher';
import { LanguageProvider } from '../../context/LanguageContext';
import { PagePreview } from './PagePreview';

vi.mock('../../api/client', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

const source = '- [ ] first task\n- [ ] second task';

const page = (overrides: Record<string, unknown> = {}) => ({
  id: 'page-1',
  title: 'Checklist',
  content: source,
  format: 'markdown',
  spaceId: 'space-1',
  createdAt: '2026-08-26T00:00:00.000Z',
  updatedAt: '2026-08-26T01:00:00.000Z',
  capabilities: { canEdit: true },
  ...overrides,
});

const patchPage = (overrides: Record<string, unknown> = {}) => {
  const response: Record<string, unknown> = page(overrides);
  delete response.capabilities;
  return response;
};

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

let pageResponses: any[] = [];
let scrollIntoViewMock: ReturnType<typeof vi.fn>;
const originalScrollIntoView = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView');

const queuePages = (...responses: any[]) => {
  pageResponses = responses;
};

const renderPreview = () => render(
  <LanguageProvider>
    <MemoryRouter initialEntries={['/pages/page-1']}>
      <Routes><Route path="/pages/:id" element={<PagePreview />} /></Routes>
    </MemoryRouter>
  </LanguageProvider>,
);

const taskCheckboxes = async () => {
  await screen.findAllByRole('checkbox');
  await act(async () => {
    await Promise.resolve();
  });
  return screen.getAllByRole('checkbox');
};

const NavigationHarness = () => {
  const navigate = useNavigate();
  return (
    <>
      <button type="button" onClick={() => navigate('/pages/page-2')}>Open second page</button>
      <Routes><Route path="/pages/:id" element={<PagePreview />} /></Routes>
    </>
  );
};

const AbaNavigationHarness = () => {
  const navigate = useNavigate();
  return (
    <>
      <button type="button" onClick={() => navigate('/pages/page-1')}>Open first page</button>
      <button type="button" onClick={() => navigate('/pages/page-2')}>Open second page</button>
      <Routes><Route path="/pages/:id" element={<PagePreview />} /></Routes>
    </>
  );
};

describe('PagePreview checklist saves', () => {
  afterEach(() => {
    cleanup();
    document.querySelectorAll('[data-page-preview-test-outside]').forEach((node) => node.remove());
    window.history.replaceState(null, '', '/');
    if (originalScrollIntoView) {
      Object.defineProperty(Element.prototype, 'scrollIntoView', originalScrollIntoView);
    } else {
      delete (Element.prototype as Partial<Element>).scrollIntoView;
    }
  });

  beforeEach(() => {
    scrollIntoViewMock = vi.fn();
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      writable: true,
      value: scrollIntoViewMock,
    });
    window.history.replaceState(null, '', '/');
    localStorage.setItem('agentwiki.language.v1', 'en');
    pageResponses = [];
    vi.mocked(api.get).mockReset();
    vi.mocked(api.post).mockReset();
    vi.mocked(api.patch).mockReset();
    vi.mocked(api.delete).mockReset();
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url.startsWith('/knowledge/related/')) return Promise.resolve({ data: [] } as any);
      if (url.startsWith('/pages?')) return Promise.resolve({ data: { data: [] } } as any);
      if (url.startsWith('/pages/')) {
        const next = pageResponses.shift();
        if (next) return Promise.resolve(next);
      }
      return Promise.reject(new Error(`unexpected get ${url}`));
    });
  });

  it('optimistically toggles an editable task and immediately saves page content', async () => {
    queuePages({ data: page() });
    vi.mocked(api.patch).mockResolvedValue({
      data: patchPage({ content: '- [x] first task\n- [ ] second task', updatedAt: '2026-08-26T01:01:00.000Z' }),
    } as any);
    renderPreview();

    const [first] = await taskCheckboxes();
    expect(first).toBeEnabled();
    fireEvent.click(first);

    expect(first).toBeChecked();
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/pages/page-1', {
      content: '- [x] first task\n- [ ] second task',
      expectedUpdatedAt: '2026-08-26T01:00:00.000Z',
    }));
    const [savedFirst] = await taskCheckboxes();
    expect(savedFirst).toBeChecked();
    expect(savedFirst).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete page' })).toBeInTheDocument();
  });

  it('keeps viewer tasks and page mutation controls disabled', async () => {
    queuePages({ data: page({ capabilities: { canEdit: false } }) });
    renderPreview();

    const checkboxes = await taskCheckboxes();
    expect(checkboxes).toHaveLength(2);
    expect(checkboxes[0]).toBeDisabled();
    expect(checkboxes[1]).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete page' })).not.toBeInTheDocument();
  });

  it('serializes two fast task saves and advances the version token from the first response', async () => {
    const firstSave = deferred<any>();
    queuePages({ data: page() });
    vi.mocked(api.patch)
      .mockImplementationOnce(() => firstSave.promise)
      .mockResolvedValueOnce({
        data: patchPage({ content: '- [x] first task\n- [x] second task', updatedAt: '2026-08-26T01:02:00.000Z' }),
      } as any);
    renderPreview();

    const [initialFirst] = await taskCheckboxes();
    fireEvent.click(initialFirst);
    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1));
    const [first, second] = await taskCheckboxes();
    expect(first).toBeDisabled();
    fireEvent.click(second);
    expect(second).toBeChecked();
    expect(api.patch).toHaveBeenCalledTimes(1);

    await act(async () => firstSave.resolve({
      data: patchPage({ content: '- [x] first task\n- [ ] second task', updatedAt: '2026-08-26T01:01:00.000Z' }),
    }));

    await waitFor(() => expect(api.patch).toHaveBeenNthCalledWith(2, '/pages/page-1', {
      content: '- [x] first task\n- [x] second task',
      expectedUpdatedAt: '2026-08-26T01:01:00.000Z',
    }));
  });

  it('rebases a conflicted task onto the latest page and retries only once', async () => {
    queuePages(
      { data: page() },
      { data: page({
        content: '# Remote heading\n\n- [ ] first task\n- [ ] second task',
        updatedAt: '2026-08-26T01:05:00.000Z',
      }) },
    );
    vi.mocked(api.patch)
      .mockRejectedValueOnce({ response: { status: 409 } })
      .mockResolvedValueOnce({
        data: patchPage({
          content: '# Remote heading\n\n- [x] first task\n- [ ] second task',
          updatedAt: '2026-08-26T01:06:00.000Z',
        }),
      } as any);
    renderPreview();

    const [first] = await taskCheckboxes();
    fireEvent.click(first);

    await waitFor(() => expect(api.patch).toHaveBeenNthCalledWith(2, '/pages/page-1', {
      content: '# Remote heading\n\n- [x] first task\n- [ ] second task',
      expectedUpdatedAt: '2026-08-26T01:05:00.000Z',
    }));
    expect(api.patch).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('rolls back only an ambiguously rebased task to the authoritative server snapshot', async () => {
    queuePages(
      { data: page({ content: '- [ ] first task' }) },
      { data: page({
        content: '- [ ] first task\n- [ ] first task',
        updatedAt: '2026-08-26T01:05:00.000Z',
      }) },
    );
    vi.mocked(api.patch).mockRejectedValueOnce({ response: { status: 409 } });
    renderPreview();

    const [first] = await taskCheckboxes();
    fireEvent.click(first);

    expect(await screen.findByRole('alert')).toHaveTextContent('Checklist change could not be saved');
    const checkboxes = await taskCheckboxes();
    expect(checkboxes).toHaveLength(2);
    expect(checkboxes[0]).not.toBeChecked();
    expect(checkboxes[1]).not.toBeChecked();
    expect(api.patch).toHaveBeenCalledTimes(1);
  });

  it('accepts an already-satisfied conflicted task without a retry version and continues later queued work', async () => {
    const firstSave = deferred<any>();
    queuePages(
      { data: page() },
      { data: page({
        content: '- [x] first task\n- [ ] second task',
        updatedAt: '2026-08-26T01:05:00.000Z',
      }) },
    );
    vi.mocked(api.patch)
      .mockImplementationOnce(() => firstSave.promise)
      .mockResolvedValueOnce({
        data: patchPage({
          content: '- [x] first task\n- [x] second task',
          updatedAt: '2026-08-26T01:06:00.000Z',
        }),
      } as any);
    renderPreview();

    const [first] = await taskCheckboxes();
    fireEvent.click(first);
    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1));
    const [, second] = await taskCheckboxes();
    fireEvent.click(second);
    await act(async () => firstSave.reject({ response: { status: 409 } }));

    await waitFor(() => expect(api.patch).toHaveBeenNthCalledWith(2, '/pages/page-1', {
      content: '- [x] first task\n- [x] second task',
      expectedUpdatedAt: '2026-08-26T01:05:00.000Z',
    }));
    expect(api.patch).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('drops a failed operation but replays and saves later queued task operations', async () => {
    const firstSave = deferred<any>();
    queuePages({ data: page() });
    vi.mocked(api.patch)
      .mockImplementationOnce(() => firstSave.promise)
      .mockResolvedValueOnce({
        data: patchPage({ content: '- [ ] first task\n- [x] second task', updatedAt: '2026-08-26T01:01:00.000Z' }),
      } as any);
    renderPreview();

    const [first] = await taskCheckboxes();
    fireEvent.click(first);
    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1));
    const [, second] = await taskCheckboxes();
    fireEvent.click(second);

    await act(async () => firstSave.reject({ response: { status: 500 } }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Checklist change could not be saved');
    await waitFor(() => expect(api.patch).toHaveBeenNthCalledWith(2, '/pages/page-1', {
      content: '- [ ] first task\n- [x] second task',
      expectedUpdatedAt: '2026-08-26T01:00:00.000Z',
    }));
  });

  it('keeps an in-flight task save attached to the same page across a language change', async () => {
    const save = deferred<any>();
    queuePages({ data: page() });
    vi.mocked(api.patch).mockImplementationOnce(() => save.promise);
    render(
      <LanguageProvider>
        <LanguageSwitcher />
        <MemoryRouter initialEntries={['/pages/page-1']}>
          <Routes><Route path="/pages/:id" element={<PagePreview />} /></Routes>
        </MemoryRouter>
      </LanguageProvider>,
    );

    const [first] = await taskCheckboxes();
    fireEvent.click(first);
    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Switch language' }));
    await act(async () => save.resolve({
      data: patchPage({ content: '- [x] first task\n- [ ] second task', updatedAt: '2026-08-26T01:01:00.000Z' }),
    }));

    expect(await screen.findByRole('heading', { name: 'Checklist' })).toBeInTheDocument();
    const [savedFirst] = await taskCheckboxes();
    expect(savedFirst).toBeChecked();
  });

  it('ignores the first page-one load after navigating A to B to A', async () => {
    const firstA = deferred<any>();
    const secondA = deferred<any>();
    let pageOneLoads = 0;
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url.startsWith('/knowledge/related/')) return Promise.resolve({ data: [] } as any);
      if (url.startsWith('/pages?')) return Promise.resolve({ data: { data: [] } } as any);
      if (url === '/pages/page-1') return ++pageOneLoads === 1 ? firstA.promise : secondA.promise;
      if (url === '/pages/page-2') return Promise.resolve({ data: page({ id: 'page-2', title: 'Page B' }) } as any);
      return Promise.reject(new Error(`unexpected get ${url}`));
    });
    render(
      <LanguageProvider>
        <MemoryRouter initialEntries={['/pages/page-1']}>
          <AbaNavigationHarness />
        </MemoryRouter>
      </LanguageProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open second page' }));
    expect(await screen.findByRole('heading', { name: 'Page B' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open first page' }));
    await waitFor(() => expect(pageOneLoads).toBe(2));
    await act(async () => secondA.resolve({ data: page({ title: 'New page A', content: '- [ ] new A task' }) }));
    expect(await screen.findByRole('heading', { name: 'New page A' })).toBeInTheDocument();

    await act(async () => firstA.resolve({ data: page({ title: 'Old page A', content: '- [ ] old A task' }) }));
    expect(screen.getByRole('heading', { name: 'New page A' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Old page A' })).not.toBeInTheDocument();
  });

  it('ignores a first-page save response after navigating A to B to A', async () => {
    const oldSave = deferred<any>();
    let pageOneLoads = 0;
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url.startsWith('/knowledge/related/')) return Promise.resolve({ data: [] } as any);
      if (url.startsWith('/pages?')) return Promise.resolve({ data: { data: [] } } as any);
      if (url === '/pages/page-1') {
        pageOneLoads += 1;
        return Promise.resolve({ data: page(pageOneLoads === 1 ? {} : {
          title: 'New page A', content: '- [ ] new A task', updatedAt: '2026-08-26T02:00:00.000Z',
        }) } as any);
      }
      if (url === '/pages/page-2') return Promise.resolve({ data: page({ id: 'page-2', title: 'Page B' }) } as any);
      return Promise.reject(new Error(`unexpected get ${url}`));
    });
    vi.mocked(api.patch).mockImplementationOnce(() => oldSave.promise);
    render(
      <LanguageProvider>
        <MemoryRouter initialEntries={['/pages/page-1']}>
          <AbaNavigationHarness />
        </MemoryRouter>
      </LanguageProvider>,
    );

    const [first] = await taskCheckboxes();
    fireEvent.click(first);
    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Open second page' }));
    expect(await screen.findByRole('heading', { name: 'Page B' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open first page' }));
    expect(await screen.findByRole('heading', { name: 'New page A' })).toBeInTheDocument();

    await act(async () => oldSave.resolve({
      data: patchPage({ title: 'Old saved A', content: '- [x] first task\n- [ ] second task', updatedAt: '2026-08-26T01:01:00.000Z' }),
    }));
    expect(screen.getByRole('heading', { name: 'New page A' })).toBeInTheDocument();
    expect(screen.getByText('new A task')).toBeInTheDocument();
  });

  it('ignores a first-page conflict refetch after navigating A to B to A', async () => {
    const oldRefetch = deferred<any>();
    let pageOneLoads = 0;
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url.startsWith('/knowledge/related/')) return Promise.resolve({ data: [] } as any);
      if (url.startsWith('/pages?')) return Promise.resolve({ data: { data: [] } } as any);
      if (url === '/pages/page-1') {
        pageOneLoads += 1;
        if (pageOneLoads === 1) return Promise.resolve({ data: page() } as any);
        if (pageOneLoads === 2) return oldRefetch.promise;
        return Promise.resolve({ data: page({
          title: 'New page A', content: '- [ ] new A task', updatedAt: '2026-08-26T02:00:00.000Z',
        }) } as any);
      }
      if (url === '/pages/page-2') return Promise.resolve({ data: page({ id: 'page-2', title: 'Page B' }) } as any);
      return Promise.reject(new Error(`unexpected get ${url}`));
    });
    vi.mocked(api.patch).mockRejectedValueOnce({ response: { status: 409 } });
    render(
      <LanguageProvider>
        <MemoryRouter initialEntries={['/pages/page-1']}>
          <AbaNavigationHarness />
        </MemoryRouter>
      </LanguageProvider>,
    );

    const [first] = await taskCheckboxes();
    fireEvent.click(first);
    await waitFor(() => expect(pageOneLoads).toBe(2));
    fireEvent.click(screen.getByRole('button', { name: 'Open second page' }));
    expect(await screen.findByRole('heading', { name: 'Page B' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open first page' }));
    expect(await screen.findByRole('heading', { name: 'New page A' })).toBeInTheDocument();

    await act(async () => oldRefetch.resolve({ data: page({
      title: 'Old conflict A', content: '- [ ] first task\n- [ ] second task', updatedAt: '2026-08-26T01:05:00.000Z',
    }) }));
    expect(screen.getByRole('heading', { name: 'New page A' })).toBeInTheDocument();
    expect(api.patch).toHaveBeenCalledTimes(1);
  });

  it('clears related pages when routing from A to B before the B request completes', async () => {
    const relatedB = deferred<any>();
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url.startsWith('/pages?')) return Promise.resolve({ data: { data: [] } } as any);
      if (url === '/pages/page-1') return Promise.resolve({ data: page({ title: 'Page A', spaceId: 'space-a' }) } as any);
      if (url === '/pages/page-2') return Promise.resolve({ data: page({ id: 'page-2', title: 'Page B', spaceId: 'space-b' }) } as any);
      if (url === '/knowledge/related/page-1') return Promise.resolve({ data: [{
        page: { id: 'related-a', title: 'Related A' }, direction: 'outgoing', relation: 'references',
      }] } as any);
      if (url === '/knowledge/related/page-2') return relatedB.promise;
      return Promise.reject(new Error(`unexpected get ${url}`));
    });
    render(<LanguageProvider><MemoryRouter initialEntries={['/pages/page-1']}>
      <NavigationHarness />
    </MemoryRouter></LanguageProvider>);

    expect(await screen.findByRole('link', { name: /Related A/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open second page' }));
    expect(await screen.findByRole('heading', { name: 'Page B' })).toBeInTheDocument();

    expect(screen.queryByRole('link', { name: /Related A/ })).not.toBeInTheDocument();
    await act(async () => relatedB.resolve({ data: [{
      page: { id: 'related-b', title: 'Related B' }, direction: 'outgoing', relation: 'references',
    }] }));
    expect(await screen.findByRole('link', { name: /Related B/ })).toBeInTheDocument();
  });

  it('ignores the first related-pages response after navigating A to B to A', async () => {
    const firstRelatedA = deferred<any>();
    let relatedALoads = 0;
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url.startsWith('/pages?')) return Promise.resolve({ data: { data: [] } } as any);
      if (url === '/pages/page-1') return Promise.resolve({ data: page({ title: 'Page A', spaceId: 'space-a' }) } as any);
      if (url === '/pages/page-2') return Promise.resolve({ data: page({ id: 'page-2', title: 'Page B', spaceId: 'space-b' }) } as any);
      if (url === '/knowledge/related/page-1') {
        relatedALoads += 1;
        return relatedALoads === 1 ? firstRelatedA.promise : Promise.resolve({ data: [{
          page: { id: 'fresh-a', title: 'Fresh related A' }, direction: 'outgoing', relation: 'references',
        }] } as any);
      }
      if (url === '/knowledge/related/page-2') return Promise.resolve({ data: [{
        page: { id: 'related-b', title: 'Related B' }, direction: 'outgoing', relation: 'references',
      }] } as any);
      return Promise.reject(new Error(`unexpected get ${url}`));
    });
    render(<LanguageProvider><MemoryRouter initialEntries={['/pages/page-1']}>
      <AbaNavigationHarness />
    </MemoryRouter></LanguageProvider>);

    expect(await screen.findByRole('heading', { name: 'Page A' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open second page' }));
    expect(await screen.findByRole('link', { name: /Related B/ })).toHaveAttribute('href', '/pages/related-b');
    fireEvent.click(screen.getByRole('button', { name: 'Open first page' }));
    expect(await screen.findByRole('link', { name: /Fresh related A/ })).toHaveAttribute('href', '/pages/fresh-a');

    await act(async () => firstRelatedA.resolve({ data: [{
      page: { id: 'stale-a', title: 'Stale related A' }, direction: 'outgoing', relation: 'references',
    }] }));

    expect(screen.getByRole('link', { name: /Fresh related A/ })).toHaveAttribute('href', '/pages/fresh-a');
    expect(screen.queryByRole('link', { name: /Stale related A/ })).not.toBeInTheDocument();
  });

  it('ignores an old related-pages rejection after B related pages have loaded', async () => {
    const oldRelatedA = deferred<any>();
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url.startsWith('/pages?')) return Promise.resolve({ data: { data: [] } } as any);
      if (url === '/pages/page-1') return Promise.resolve({ data: page({ title: 'Page A', spaceId: 'space-a' }) } as any);
      if (url === '/pages/page-2') return Promise.resolve({ data: page({ id: 'page-2', title: 'Page B', spaceId: 'space-b' }) } as any);
      if (url === '/knowledge/related/page-1') return oldRelatedA.promise;
      if (url === '/knowledge/related/page-2') return Promise.resolve({ data: [{
        page: { id: 'related-b', title: 'Related B' }, direction: 'outgoing', relation: 'references',
      }] } as any);
      return Promise.reject(new Error(`unexpected get ${url}`));
    });
    render(<LanguageProvider><MemoryRouter initialEntries={['/pages/page-1']}>
      <NavigationHarness />
    </MemoryRouter></LanguageProvider>);

    expect(await screen.findByRole('heading', { name: 'Page A' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open second page' }));
    expect(await screen.findByRole('link', { name: /Related B/ })).toBeInTheDocument();
    await act(async () => oldRelatedA.reject(new Error('stale related failure')));

    expect(screen.getByRole('link', { name: /Related B/ })).toBeInTheDocument();
  });

  it('uses the authoritative Space resolver for wiki links without loading a 200-page index', async () => {
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url.startsWith('/knowledge/related/')) return Promise.resolve({ data: [] } as any);
      if (url === '/pages/page-1') return Promise.resolve({ data: page({ title: 'Page A', content: '[[Page 201]]', spaceId: 'space-a' }) } as any);
      return Promise.reject(new Error(`unexpected get ${url}`));
    });
    vi.mocked(api.post).mockImplementation(async (url, body) => {
      expect(url).toBe('/spaces/space-a/markdown/resolve');
      const reference = (body as { references: Array<{ key: string }> }).references[0];
      return { data: [{ key: reference.key, status: 'resolved', kind: 'page', pageId: 'target-201', title: 'Page 201', slug: 'page-201' }] };
    });
    renderPreview();

    expect(await screen.findByRole('link', { name: 'Page 201' })).toHaveAttribute('href', '/pages/target-201');
    expect(api.get).not.toHaveBeenCalledWith(expect.stringContaining('/pages?'), expect.anything());
    expect(vi.mocked(api.get).mock.calls.some(([url]) => String(url).startsWith('/pages?'))).toBe(false);
  });

  it('clears a stale A resolver before B resolves its own wiki-link target', async () => {
    const resolverA = deferred<any>();
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url.startsWith('/knowledge/related/')) return Promise.resolve({ data: [] } as any);
      if (url === '/pages/page-1') return Promise.resolve({ data: page({ title: 'Page A', content: '[[Shared]]', spaceId: 'space-a' }) } as any);
      if (url === '/pages/page-2') return Promise.resolve({ data: page({ id: 'page-2', title: 'Page B', content: '[[Shared]]', spaceId: 'space-b' }) } as any);
      return Promise.reject(new Error(`unexpected get ${url}`));
    });
    vi.mocked(api.post).mockImplementation(async (url, body) => {
      const reference = (body as { references: Array<{ key: string }> }).references[0];
      if (url === '/spaces/space-a/markdown/resolve') return resolverA.promise;
      if (url === '/spaces/space-b/markdown/resolve') return { data: [{ key: reference.key, status: 'resolved', kind: 'page', pageId: 'target-b', title: 'Shared', slug: 'shared' }] };
      throw new Error(`unexpected post ${url}`);
    });
    render(<LanguageProvider><MemoryRouter initialEntries={['/pages/page-1']}>
      <NavigationHarness />
    </MemoryRouter></LanguageProvider>);

    expect(await screen.findByRole('heading', { name: 'Page A' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open second page' }));
    expect(await screen.findByRole('link', { name: 'Shared' })).toHaveAttribute('href', '/pages/target-b');
    await act(async () => resolverA.resolve({ data: [{ key: 'r0', status: 'resolved', kind: 'page', pageId: 'target-a', title: 'Shared', slug: 'shared' }] }));

    expect(screen.getByRole('link', { name: 'Shared' })).toHaveAttribute('href', '/pages/target-b');
  });

  it('ignores an obsolete save response after navigating to another page', async () => {
    const oldSave = deferred<any>();
    queuePages(
      { data: page() },
      { data: page({
        id: 'page-2',
        title: 'Second checklist',
        content: '- [ ] second page task',
        updatedAt: '2026-08-26T02:00:00.000Z',
      }) },
    );
    vi.mocked(api.patch).mockImplementationOnce(() => oldSave.promise);
    render(
      <LanguageProvider>
        <MemoryRouter initialEntries={['/pages/page-1']}>
          <NavigationHarness />
        </MemoryRouter>
      </LanguageProvider>,
    );

    const [first] = await taskCheckboxes();
    fireEvent.click(first);
    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Open second page' }));
    expect(await screen.findByRole('heading', { name: 'Second checklist' })).toBeInTheDocument();

    await act(async () => oldSave.resolve({
      data: patchPage({ content: '- [x] first task\n- [ ] second task', updatedAt: '2026-08-26T01:01:00.000Z' }),
    }));

    expect(screen.getByRole('heading', { name: 'Second checklist' })).toBeInTheDocument();
    expect(screen.getByText('second page task')).toBeInTheDocument();
    expect(screen.queryByText('first task')).not.toBeInTheDocument();
  });

  it('scrolls a standard heading after the initial hashed page finishes loading', async () => {
    const pageLoad = deferred<any>();
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url.startsWith('/knowledge/related/')) return Promise.resolve({ data: [] } as any);
      if (url === '/pages/page-1') return pageLoad.promise;
      return Promise.reject(new Error(`unexpected get ${url}`));
    });
    window.history.replaceState(null, '', '/pages/page-1#intro');
    renderPreview();

    expect(scrollIntoViewMock).not.toHaveBeenCalled();
    await act(async () => pageLoad.resolve({ data: page({ content: '# Intro' }) }));

    const heading = await screen.findByRole('heading', { name: 'Intro' });
    await waitFor(() => expect(scrollIntoViewMock).toHaveBeenCalledTimes(1));
    expect(scrollIntoViewMock.mock.instances[0]).toBe(heading);
  });

  it('retries once when an embedded hash target mounts asynchronously and disconnects after scrolling', async () => {
    const embeddedPage = deferred<any>();
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url.startsWith('/knowledge/related/')) return Promise.resolve({ data: [] } as any);
      if (url === '/pages/page-1') return Promise.resolve({
        data: page({ content: '![[Embedded#Late heading]]' }),
      } as any);
      if (url === '/pages/embedded') return embeddedPage.promise;
      return Promise.reject(new Error(`unexpected get ${url}`));
    });
    vi.mocked(api.post).mockImplementation(async (_url, body) => {
      const reference = (body as { references: Array<{ key: string }> }).references[0];
      return { data: [{ key: reference.key, status: 'resolved', kind: 'page', pageId: 'embedded', title: 'Embedded', slug: 'embedded' }] };
    });
    window.history.replaceState(
      null,
      '',
      '/pages/page-1#agentwiki%3Aheading%3A00006c00006100007400006500002000006800006500006100006400006900006e000067',
    );
    renderPreview();
    await screen.findByRole('heading', { name: 'Checklist' });
    expect(scrollIntoViewMock).not.toHaveBeenCalled();

    await act(async () => embeddedPage.resolve({ data: { id: 'embedded', content: '## Late heading\n\nArrived.' } }));

    await waitFor(() => expect(scrollIntoViewMock).toHaveBeenCalledTimes(1));
    expect(scrollIntoViewMock.mock.instances[0]).toBe(document.getElementById(
      'agentwiki:heading:00006c00006100007400006500002000006800006500006100006400006900006e000067',
    ));
    document.getElementById('agentwiki:heading:00006c00006100007400006500002000006800006500006100006400006900006e000067')
      ?.append(document.createElement('span'));
    await act(async () => Promise.resolve());
    expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);
  });

  it('scrolls Wiki heading and block aliases plus the exact block on same-page hash changes, then removes its listener', async () => {
    queuePages({ data: page({ content: '## Straße\n\nParagraph ^Block-One' }) });
    const view = renderPreview();
    await screen.findByRole('heading', { name: 'Straße' });

    const targets = [
      'agentwiki:heading:000073000074000072000061000073000073000065',
      'agentwiki:block:00006200006c00006f00006300006b00002d00006f00006e000065',
      '^Block-One',
    ];
    for (const [index, targetId] of targets.entries()) {
      window.history.replaceState(null, '', `/pages/page-1#${encodeURIComponent(targetId)}`);
      act(() => window.dispatchEvent(new Event('hashchange')));
      await waitFor(() => expect(scrollIntoViewMock).toHaveBeenCalledTimes(index + 1));
      expect(scrollIntoViewMock.mock.instances[index]).toBe(document.getElementById(targetId));
    }

    view.unmount();
    scrollIntoViewMock.mockClear();
    window.history.replaceState(null, '', '/pages/page-1#another-target');
    act(() => window.dispatchEvent(new Event('hashchange')));
    expect(scrollIntoViewMock).not.toHaveBeenCalled();
  });

  it('does not scroll a missing or out-of-page target and ignores malformed hash encoding', async () => {
    const outsideTarget = document.createElement('div');
    outsideTarget.id = 'outside-target';
    outsideTarget.dataset.pagePreviewTestOutside = 'true';
    document.body.append(outsideTarget);
    queuePages({ data: page({ content: '# Present' }) });
    window.history.replaceState(null, '', '/pages/page-1#outside-target');
    renderPreview();
    await screen.findByRole('heading', { name: 'Present' });

    expect(document.getElementById('outside-target')).toBe(outsideTarget);
    expect(scrollIntoViewMock).not.toHaveBeenCalled();

    window.history.replaceState(null, '', '/pages/page-1#missing-target');
    act(() => window.dispatchEvent(new Event('hashchange')));
    window.history.replaceState(null, '', '/pages/page-1#%E0%A4%A');
    expect(() => act(() => window.dispatchEvent(new Event('hashchange')))).not.toThrow();
    expect(scrollIntoViewMock).not.toHaveBeenCalled();
    outsideTarget.remove();
  });

  it('does not let an obsolete page load scroll the active page after a fast route change', async () => {
    const oldPageLoad = deferred<any>();
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url.startsWith('/knowledge/related/')) return Promise.resolve({ data: [] } as any);
      if (url === '/pages/page-1') return oldPageLoad.promise;
      if (url === '/pages/page-2') return Promise.resolve({
        data: page({ id: 'page-2', title: 'Page B', content: '# Shared', spaceId: 'space-b' }),
      } as any);
      return Promise.reject(new Error(`unexpected get ${url}`));
    });
    window.history.replaceState(null, '', '/pages/page-1#shared');
    render(<LanguageProvider><MemoryRouter initialEntries={['/pages/page-1']}>
      <NavigationHarness />
    </MemoryRouter></LanguageProvider>);

    fireEvent.click(screen.getByRole('button', { name: 'Open second page' }));
    const activeHeading = await screen.findByRole('heading', { name: 'Shared' });
    await waitFor(() => expect(scrollIntoViewMock).toHaveBeenCalledTimes(1));
    expect(scrollIntoViewMock.mock.instances[0]).toBe(activeHeading);

    await act(async () => oldPageLoad.resolve({
      data: page({ title: 'Old page A', content: '# Shared', spaceId: 'space-a' }),
    }));
    expect(screen.getByRole('heading', { name: 'Page B' })).toBeInTheDocument();
    expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);
  });
});
