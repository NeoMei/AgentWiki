import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../../api/client';
import { LanguageProvider } from '../../context/LanguageContext';
import { ReviewPage } from './ReviewPage';

vi.mock('../../api/client', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
}));

const changeItem = (status: 'pending' | 'accepted' | 'rejected' = 'pending') => ({
  id: 'item-1',
  type: 'create_page',
  status,
  payload: { title: 'Proposed page', content: 'Proposed content' },
});

const changeSet = (
  status: 'pending_review' | 'approved' | 'published' = 'pending_review',
  itemStatus: 'pending' | 'accepted' | 'rejected' = 'pending',
) => ({
  id: 'cs-1',
  title: 'Candidate set',
  status,
  space: { id: 'space-1', name: 'Test space' },
  items: [changeItem(itemStatus)],
  run: { source: { id: 'source-1', name: 'Source', type: 'text', uri: null }, evidences: [] },
});

const summary = () => ({ ...changeSet(), run: { source: { type: 'text' } } });

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const renderReview = (language: 'en' | 'zh-CN' = 'en') => {
  localStorage.setItem('agentwiki.language.v1', language);
  return render(
  <LanguageProvider>
    <MemoryRouter initialEntries={['/review']}>
      <ReviewPage />
    </MemoryRouter>
  </LanguageProvider>,
  );
};

const expand = async () => {
  fireEvent.click(await screen.findByRole('button', { name: /Candidate set/ }));
  await screen.findByText('Proposed page');
};

describe('ReviewPage detail refresh', () => {
  beforeEach(() => {
    localStorage.setItem('agentwiki.language.v1', 'en');
    vi.mocked(api.get).mockReset();
    vi.mocked(api.post).mockReset();
    vi.mocked(api.patch).mockReset();
  });

  afterEach(cleanup);

  it('refetches expanded detail after an item decision and renders the returned item state', async () => {
    const calls: string[] = [];
    let detailReads = 0;
    vi.mocked(api.get).mockImplementation((url) => {
      calls.push(`get:${url}`);
      if (url === '/review') return Promise.resolve({ data: [summary()] } as any);
      detailReads += 1;
      return Promise.resolve({ data: detailReads === 1 ? changeSet() : changeSet('pending_review', 'accepted') } as any);
    });
    vi.mocked(api.patch).mockImplementation(async (url, body) => {
      calls.push(`patch:${url}:${(body as any).status}`);
      return { data: {} } as any;
    });

    renderReview();
    await expand();
    fireEvent.click(screen.getByRole('button', { name: 'Accept candidate' }));

    expect(await screen.findByText('accepted')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Accept candidate' })).not.toBeInTheDocument();
    expect(calls).toContain('patch:/change-sets/cs-1/items/item-1:accepted');
    expect(calls.filter((call) => call === 'get:/change-sets/cs-1')).toHaveLength(2);
  });

  it('disables approve-only until every candidate is decided', async () => {
    vi.mocked(api.get).mockImplementation((url) => Promise.resolve({
      data: url === '/review' ? [summary()] : changeSet(),
    } as any));
    renderReview();
    await expand();
    expect(screen.getByRole('button', { name: 'Approve only' })).toBeDisabled();
    expect(screen.getByText('Decide every candidate before approving only.')).toBeInTheDocument();
  });

  it('shows a localized fixed toast and refreshes stale detail on a CAS conflict', async () => {
    vi.mocked(api.get).mockImplementation((url) => Promise.resolve({
      data: url === '/review' ? [summary()] : changeSet(),
    } as any));
    vi.mocked(api.post).mockRejectedValue({ response: { status: 409, data: {
      code: 'CHANGESET_INVALID_STATE', message: 'Change set is not pending review',
    } } });
    renderReview('zh-CN');
    await expand();
    fireEvent.click(screen.getByRole('button', { name: '通过并发布' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('审核状态已变化，已为你刷新');
    expect(screen.queryByText('Change set is not pending review')).not.toBeInTheDocument();
    expect(vi.mocked(api.get).mock.calls.filter(([url]) => url === '/change-sets/cs-1')).toHaveLength(2);
  });

  it('renders the authoritative refreshed state after a stale action returns HTTP 409', async () => {
    let detailReads = 0;
    vi.mocked(api.get).mockImplementation((url) => {
      if (url === '/review') return Promise.resolve({ data: [summary()] } as any);
      detailReads += 1;
      return Promise.resolve({
        data: detailReads === 1
          ? changeSet('pending_review', 'accepted')
          : changeSet('approved', 'accepted'),
      } as any);
    });
    vi.mocked(api.post).mockRejectedValue({ response: {
      status: 409,
      data: { message: 'The action used a stale review state' },
    } });

    renderReview();
    await expand();
    fireEvent.click(screen.getByRole('button', { name: 'Approve only' }));

    expect(await screen.findByRole('button', { name: 'Publish' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve only' })).not.toBeInTheDocument();
    expect(detailReads).toBe(2);
  });

  it('refetches detail after a set action so the next valid action is immediately visible', async () => {
    let detailReads = 0;
    vi.mocked(api.get).mockImplementation((url) => {
      if (url === '/review') return Promise.resolve({ data: [summary()] } as any);
      detailReads += 1;
      return Promise.resolve({ data: detailReads === 1 ? changeSet('pending_review', 'accepted') : changeSet('approved', 'accepted') } as any);
    });
    vi.mocked(api.post).mockResolvedValue({ data: {} } as any);

    renderReview();
    await expand();
    fireEvent.click(await screen.findByRole('button', { name: 'Approve only' }));

    expect(await screen.findByRole('button', { name: 'Publish' })).toBeInTheDocument();
    expect(vi.mocked(api.get).mock.calls.filter(([url]) => url === '/change-sets/cs-1')).toHaveLength(2);
  });

  it('does not refetch or fabricate a successful state when an action fails', async () => {
    vi.mocked(api.get).mockImplementation((url) => Promise.resolve({
      data: url === '/review' ? [summary()] : changeSet('pending_review', 'accepted'),
    } as any));
    vi.mocked(api.post).mockRejectedValue({ response: { data: { message: 'Approval was rejected' } } });

    renderReview();
    await expand();
    fireEvent.click(screen.getByRole('button', { name: 'Approve only' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to update change set');
    expect(screen.queryByText('Approval was rejected')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Publish' })).not.toBeInTheDocument();
    expect(vi.mocked(api.get).mock.calls.filter(([url]) => url === '/change-sets/cs-1')).toHaveLength(1);
  });

  it('replaces an earlier success toast with the latest action failure', async () => {
    let detailReads = 0;
    vi.mocked(api.get).mockImplementation((url) => {
      if (url === '/review') return Promise.resolve({ data: [summary()] } as any);
      detailReads += 1;
      return Promise.resolve({ data: detailReads === 1 ? changeSet('pending_review', 'accepted') : changeSet('approved', 'accepted') } as any);
    });
    vi.mocked(api.post)
      .mockResolvedValueOnce({ data: {} } as any)
      .mockRejectedValueOnce({ response: { status: 500, data: { message: 'Raw failure' } } });
    renderReview();
    await expand();

    fireEvent.click(screen.getByRole('button', { name: 'Approve only' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Review state updated');
    fireEvent.click(await screen.findByRole('button', { name: 'Publish' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to update change set');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('coalesces rapid duplicate actions for the same change set', async () => {
    const actionRequest = deferred<any>();
    let detailReads = 0;
    vi.mocked(api.get).mockImplementation((url) => {
      if (url === '/review') return Promise.resolve({ data: [summary()] } as any);
      detailReads += 1;
      return Promise.resolve({ data: detailReads === 1 ? changeSet('pending_review', 'accepted') : changeSet('approved', 'accepted') } as any);
    });
    vi.mocked(api.post).mockImplementation(() => actionRequest.promise);

    renderReview();
    await expand();
    const approve = screen.getByRole('button', { name: 'Approve only' });
    fireEvent.click(approve);
    fireEvent.click(approve);
    expect(api.post).toHaveBeenCalledTimes(1);

    await act(async () => actionRequest.resolve({ data: {} } as any));
    expect(await screen.findByRole('button', { name: 'Publish' })).toBeInTheDocument();
  });

  it('aborts an expanded detail request when the page unmounts', async () => {
    const detailRequest = deferred<any>();
    let detailSignal: AbortSignal | undefined;
    vi.mocked(api.get).mockImplementation((url, config) => {
      if (url === '/review') return Promise.resolve({ data: [summary()] } as any);
      detailSignal = config?.signal as AbortSignal;
      return detailRequest.promise;
    });

    const view = renderReview();
    fireEvent.click(await screen.findByRole('button', { name: /Candidate set/ }));
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/change-sets/cs-1', expect.anything()));
    view.unmount();

    expect(detailSignal?.aborted).toBe(true);
    await act(async () => detailRequest.resolve({ data: changeSet() } as any));
  });
});
