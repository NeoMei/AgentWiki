import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../../api/client';
import { LanguageSwitcher } from '../../components/LanguageSwitcher';
import { LanguageProvider } from '../../context/LanguageContext';
import { PagePreview } from './PagePreview';

vi.mock('../../api/client', () => ({
  default: { get: vi.fn(), patch: vi.fn(), delete: vi.fn() },
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

describe('PagePreview checklist saves', () => {
  afterEach(cleanup);

  beforeEach(() => {
    localStorage.setItem('agentwiki.language.v1', 'en');
    pageResponses = [];
    vi.mocked(api.get).mockReset();
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
      data: page({ content: '- [x] first task\n- [ ] second task', updatedAt: '2026-08-26T01:01:00.000Z' }),
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
        data: page({ content: '- [x] first task\n- [x] second task', updatedAt: '2026-08-26T01:02:00.000Z' }),
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
      data: page({ content: '- [x] first task\n- [ ] second task', updatedAt: '2026-08-26T01:01:00.000Z' }),
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
        data: page({
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

  it('drops a failed operation but replays and saves later queued task operations', async () => {
    const firstSave = deferred<any>();
    queuePages({ data: page() });
    vi.mocked(api.patch)
      .mockImplementationOnce(() => firstSave.promise)
      .mockResolvedValueOnce({
        data: page({ content: '- [ ] first task\n- [x] second task', updatedAt: '2026-08-26T01:01:00.000Z' }),
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
      data: page({ content: '- [x] first task\n- [ ] second task', updatedAt: '2026-08-26T01:01:00.000Z' }),
    }));

    expect(await screen.findByRole('heading', { name: 'Checklist' })).toBeInTheDocument();
    const [savedFirst] = await taskCheckboxes();
    expect(savedFirst).toBeChecked();
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
      data: page({ content: '- [x] first task\n- [ ] second task', updatedAt: '2026-08-26T01:01:00.000Z' }),
    }));

    expect(screen.getByRole('heading', { name: 'Second checklist' })).toBeInTheDocument();
    expect(screen.getByText('second page task')).toBeInTheDocument();
    expect(screen.queryByText('first task')).not.toBeInTheDocument();
  });
});
