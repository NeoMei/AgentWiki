import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../../api/client';
import { LanguageProvider } from '../../context/LanguageContext';
import { useAuth } from '../../context/AuthContext';
import { ReviewPage } from './ReviewPage';
import { announceReviewChanged } from './review-events';

vi.mock('../../context/AuthContext', () => ({ useAuth: vi.fn() }));
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

const linkedChangeSet = (
  status: 'pending_review' | 'approved' | 'published' = 'pending_review',
  itemStatus: 'pending' | 'accepted' | 'rejected' = 'pending',
) => ({
  ...changeSet(status, itemStatus),
  collaborationArtifactLink: {
    artifactId: 'artifact-1', runId: 'collaboration-run-1', taskId: 'task-1',
    spaceId: 'space-1', pageId: 'page-1',
    reviewPath: '/spaces/space-1/collaboration/runs/collaboration-run-1',
  },
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

let members = [{ userId: 'user-1', role: 'owner' }];
const renderReview = (language: 'en' | 'zh-CN' = 'en') => {
  localStorage.setItem('agentwiki.language.v1', language);
  const implementation = vi.mocked(api.get).getMockImplementation()!;
  vi.mocked(api.get).mockImplementation((url, config) => url === '/spaces/space-1'
    ? Promise.resolve({ data: { members } } as any) : implementation(url, config));
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

const ReviewQuerySwitcher = () => {
  const navigate = useNavigate();
  return <button onClick={() => navigate('/review?changeSet=cs-1')}>Open selected review</button>;
};

describe('ReviewPage detail refresh', () => {
  it.each((['en', 'zh-CN'] as const).flatMap(language => [
    ['pending_review', 'pending'], ['approved', 'accepted'], ['published', 'published'],
    ['rejected', 'rejected'], ['reverted', 'reverted'],
  ].map(([status, itemStatus]) => ({ language, status, itemStatus }))))('shows lifecycle-neutral source alignment in $language for $status', async ({ language, status, itemStatus }) => {
    const detail = { ...changeSet(), status, items: [{ ...changeItem(), status: itemStatus, sourceStatus: { status: 'current', reason: 'reviewed_source', sourceId: 'src', reviewedSourceVersion: 1, currentSourceVersion: 1 } }] };
    vi.mocked(api.get).mockImplementation(async url => ({ data: url === '/review' ? [detail] : detail }));
    renderReview(language); await expand();
    const notice = screen.getByRole('note');
    expect(notice).toHaveTextContent(language === 'en' ? 'This change’s pinned input matches the currently accepted source' : '该变更的固定输入与当前已接收来源一致');
    expect(notice).toHaveTextContent(language === 'en' ? 'does not certify factual correctness' : '不代表内容必然正确');
    expect(notice).not.toHaveTextContent(/human review is still required|仍需人工审核/);
    expect(notice).toHaveTextContent(language === 'en' ? 'Pinned change version' : '变更固定版本');
  });

  it('keeps source alignment neutral when a successful publish refreshes the item to published', async () => {
    let published = false;
    const detail = () => ({ ...changeSet(published ? 'published' : 'pending_review', 'accepted'), items: [{ ...changeItem('accepted'), status: published ? 'published' : 'accepted', sourceStatus: { status: 'current', reason: 'reviewed_source', sourceId: 'src' } }] });
    vi.mocked(api.get).mockImplementation(async url => ({ data: url === '/review' ? [detail()] : detail() }));
    vi.mocked(api.post).mockImplementation(async () => { published = true; return { data: detail() } as any; });
    renderReview(); await expand();
    fireEvent.click(screen.getByRole('button', { name: 'Approve & publish' }));
    expect(await screen.findByRole('button', { name: 'Revert' })).toBeVisible();
    expect(screen.getByRole('note')).toHaveTextContent('This change’s pinned input matches the currently accepted source');
    expect(screen.getByRole('note')).not.toHaveTextContent('human review is still required');
    expect(api.post).toHaveBeenCalledWith('/change-sets/cs-1/review-publish', expect.anything(), expect.anything());
  });

  it.each(['en', 'zh-CN'] as const)('explains a real SOURCE_VERSION_CONFLICT shape in %s while keeping refresh and no retry', async language => {
    let detailReads = 0;
    const detail = changeSet('approved', 'accepted');
    vi.mocked(api.get).mockImplementation(async url => {
      if (url === '/review') return { data: [detail] } as any;
      detailReads += 1;
      return { data: detail } as any;
    });
    vi.mocked(api.post).mockRejectedValue({ response: { status: 409, data: { code: 'SOURCE_VERSION_CONFLICT', message: 'Source input changed; regenerate the candidate' } } });
    renderReview(language); await expand();
    fireEvent.click(screen.getByRole('button', { name: language === 'en' ? 'Publish' : '发布' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(language === 'en' ? 'Regenerate from the current source and review the new candidate' : '来源已更新，请基于当前来源重新生成并审核');
    expect(detailReads).toBe(2);
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.patch).not.toHaveBeenCalled();
  });

  beforeEach(() => {
    localStorage.setItem('agentwiki.language.v1', 'en');
    members = [{ userId: 'user-1', role: 'owner' }];
    vi.mocked(useAuth).mockReturnValue({ user: { id: 'user-1', platformRole: 'super_admin' } } as any);
    vi.mocked(api.get).mockReset();
    vi.mocked(api.post).mockReset();
    vi.mocked(api.patch).mockReset();
  });

  afterEach(cleanup);

  it.each(['admin', 'editor', 'viewer'])('keeps a member platform admin with %s role out of owner-only review decisions', async (role) => {
    members = [{ userId: 'user-1', role }];
    vi.mocked(api.get).mockImplementation(async (url) => ({ data: url === '/review' ? [changeSet()] : changeSet() }));
    renderReview(); await expand();
    expect(screen.queryByRole('button', { name: 'Accept candidate' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve & publish' })).not.toBeInTheDocument();
  });

  it.each(['pending_review', 'approved', 'published'] as const)('hides all %s mutation controls for a nonmember platform admin', async (status) => {
    members = [];
    const detail = changeSet(status);
    vi.mocked(api.get).mockImplementation(async (url) => ({ data: url === '/review' ? [detail] : detail }));
    renderReview(); await expand();
    for (const name of ['Accept candidate', 'Reject candidate', 'Reject', 'Approve only', 'Approve & publish', 'Publish', 'Revert']) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    }
    expect(screen.queryByPlaceholderText('Review comment (optional)')).not.toBeInTheDocument();
  });

  it.each([
    ['en', 'Existing pages with identical content'],
    ['zh-CN', '正文完全相同的已有页面'],
  ] as const)('renders optional existing-page duplicate examples in %s without blocking publishing', async (language, label) => {
    const detail = { ...changeSet(), duplicateContentWarnings: [{ itemId: 'item-1', pages: [{ id: 'existing-1', title: 'Existing knowledge' }, { id: 'existing-2', title: '  ' }] }] };
    vi.mocked(api.get).mockImplementation(async (url) => ({ data: url === '/review' ? [detail] : detail }));
    renderReview(language); await expand();
    expect(screen.getByRole('note', { name: label })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Existing knowledge' })).toHaveAttribute('href', '/pages/existing-1');
    expect(screen.getByRole('link', { name: language === 'en' ? 'Untitled page' : '未命名页面' })).toHaveAttribute('href', '/pages/existing-2');
    expect(screen.getByRole('button', { name: language === 'en' ? 'Approve & publish' : '通过并发布' })).toBeEnabled();
    expect(vi.mocked(api.get).mock.calls.filter(([url]) => url !== '/spaces/space-1')).toHaveLength(2);
  });

  it('keeps older details without duplicate metadata usable and does not fetch a detector endpoint', async () => {
    vi.mocked(api.get).mockImplementation(async (url) => ({ data: url === '/review' ? [changeSet()] : changeSet() }));
    renderReview(); await expand();
    expect(screen.queryByRole('note', { name: 'Existing pages with identical content' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve & publish' })).toBeEnabled();
    expect(vi.mocked(api.get).mock.calls.filter(([url]) => url !== '/spaces/space-1')).toHaveLength(2);
  });

  it('advises about identical content within the loaded change set without blocking publication', async () => {
    const detail = { ...changeSet(), items: [changeItem(), { ...changeItem(), id: 'item-2', payload: { title: 'Another page', content: 'Proposed content' } }] };
    vi.mocked(api.get).mockImplementation((url) => Promise.resolve({ data: url === '/review' ? [detail] : detail } as any));
    renderReview(); await expand();
    expect(screen.getByText(/Identical non-empty content appears in this change set/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Approve & publish' })).toBeEnabled();
  });

  it('reverts against the change set space tree head and prevents duplicate submissions', async () => {
    const head = deferred<any>();
    const detail = changeSet('published', 'accepted');
    vi.mocked(api.get).mockImplementation((url) => {
      if (url === '/spaces/space-1/content-tree') return head.promise;
      return Promise.resolve({ data: url === '/review' ? [detail] : detail } as any);
    });
    vi.mocked(api.post).mockResolvedValue({ data: {} });
    renderReview(); await expand();
    const revert = screen.getByRole('button', { name: 'Revert' });
    fireEvent.click(revert); fireEvent.click(revert);
    expect(revert).toBeDisabled(); expect(api.post).not.toHaveBeenCalled();
    await act(async () => head.resolve({ data: { treeRevision: '9007199254740993' } }));
    await waitFor(() => expect(api.post).toHaveBeenCalledExactlyOnceWith('/change-sets/cs-1/revert', { expectedTreeRevision: '9007199254740993', comment: undefined }, expect.objectContaining({ signal: expect.any(AbortSignal) })));
    expect(api.get).toHaveBeenCalledWith('/spaces/space-1/content-tree', expect.objectContaining({ params: { take: 1 } }));
  });

  it('surfaces a revert tree conflict without retrying the mutation automatically', async () => {
    const detail = changeSet('published', 'accepted');
    vi.mocked(api.get).mockImplementation(async (url) => ({ data: url.includes('/content-tree') ? { treeRevision: '7' } : url === '/review' ? [detail] : detail }));
    vi.mocked(api.post).mockRejectedValue({ response: { status: 409, data: { code: 'CONTENT_TREE_CONFLICT' } } });
    renderReview(); await expand(); fireEvent.click(screen.getByRole('button', { name: 'Revert' }));
    expect(await screen.findByRole('alert')).toBeVisible();
    expect(api.post).toHaveBeenCalledOnce();
    expect(api.post).toHaveBeenCalledWith('/change-sets/cs-1/revert', { expectedTreeRevision: '7', comment: undefined }, expect.anything());
    expect(screen.getByRole('button', { name: 'Revert' })).toBeEnabled();
  });

  it('does not send revert when the tree head is unavailable', async () => {
    const detail = changeSet('published', 'accepted');
    vi.mocked(api.get).mockImplementation((url) => url.includes('/content-tree') ? Promise.reject({ response: { status: 403, data: { code: 'SPACE_ACCESS_DENIED' } } }) : Promise.resolve({ data: url === '/review' ? [detail] : detail } as any));
    renderReview(); await expand(); fireEvent.click(screen.getByRole('button', { name: 'Revert' }));
    await screen.findByRole('alert'); expect(api.post).not.toHaveBeenCalled();
  });

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

  it.each(['pending_review', 'approved'] as const)(
    'routes a collaboration-linked %s candidate to the collaboration review without bypass controls',
    async (status) => {
      vi.mocked(api.get).mockImplementation((url) => Promise.resolve({
        data: url === '/review' ? [summary()] : linkedChangeSet(status, status === 'approved' ? 'accepted' : 'pending'),
      } as any));
      renderReview();
      await expand();

      expect(screen.getByRole('link', { name: 'Go to collaboration review' })).toHaveAttribute(
        'href', '/spaces/space-1/collaboration/runs/collaboration-run-1',
      );
      expect(screen.queryByRole('button', { name: 'Accept candidate' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Approve only' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Approve & publish' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Publish' })).not.toBeInTheDocument();
    },
  );

  it('keeps published collaboration ChangeSet revert separate', async () => {
    vi.mocked(api.get).mockImplementation((url) => Promise.resolve({
      data: url === '/review' ? [summary()] : linkedChangeSet('published', 'accepted'),
    } as any));
    renderReview();
    await expand();
    expect(screen.getByRole('button', { name: 'Revert' })).toBeVisible();
  });

  it('routes a published v3 collaboration ChangeSet without exposing legacy revert', async () => {
    vi.mocked(api.get).mockImplementation((url) => Promise.resolve({
      data: url === '/review'
        ? [{ ...summary(), status: 'published' }]
        : { ...linkedChangeSet('published', 'accepted'), revertible: false },
    } as any));
    renderReview();
    await expand();
    expect(screen.getByRole('link', { name: 'Go to collaboration review' })).toHaveAttribute(
      'href', '/spaces/space-1/collaboration/runs/collaboration-run-1',
    );
    expect(screen.queryByRole('button', { name: 'Publish' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Revert' })).not.toBeInTheDocument();
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

  it('does not offer revert for an explicitly non-revertible v3 Push ChangeSet', async () => {
    vi.mocked(api.get).mockImplementation((url) => Promise.resolve({
      data: url === '/review'
        ? [{ ...summary(), status: 'published' }]
        : { ...changeSet('published', 'accepted'), revertible: false },
    } as any));
    renderReview();
    await expand();
    expect(screen.queryByRole('button', { name: 'Revert' })).not.toBeInTheDocument();
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
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Review state updated'));
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
  it('shows loading without false empty state while the initial review request is pending', async () => {
    const request = deferred<any>();
    vi.mocked(api.get).mockReturnValue(request.promise);
    renderReview();
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
    expect(screen.queryByText('Nothing needs review.')).not.toBeInTheDocument();
    await act(async () => request.resolve({ data: [] }));
    expect(screen.getByText('Nothing needs review.')).toBeVisible();
  });

  it('refreshes an expanded review on a change event and preserves rows during refetch', async () => {
    const refresh = deferred<any>();
    let refreshing = false;
    vi.mocked(api.get).mockImplementation(async (url) => url === '/review'
      ? refreshing ? refresh.promise : { data: [changeSet()] }
      : { data: changeSet(refreshing ? 'approved' : 'pending_review', 'accepted') });
    renderReview(); await expand();
    refreshing = true;
    act(() => announceReviewChanged());
    expect(screen.getByRole('status')).toHaveTextContent('Refreshing');
    expect(screen.getByText('Candidate set')).toBeVisible();
    await act(async () => refresh.resolve({ data: [changeSet('approved', 'accepted')] }));
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    expect(screen.getByTestId('status-badge-approved')).toBeVisible();
  });

  it('refreshes review summaries on window focus', async () => {
    let refreshed = false;
    vi.mocked(api.get).mockImplementation(async () => ({ data: refreshed ? [changeSet()] : [] }));
    renderReview(); await screen.findByText('Nothing needs review.');
    refreshed = true;
    act(() => window.dispatchEvent(new Event('focus')));
    expect(await screen.findByText('Candidate set')).toBeVisible();
  });

  it('starts a new list load when the selected query changes during a pending list request', async () => {
    const oldList = deferred<any>();
    let listReads = 0;
    vi.mocked(api.get).mockImplementation(async (url) => {
      if (url === '/review') return ++listReads === 1 ? oldList.promise : { data: [changeSet()] };
      if (url === '/spaces/space-1') return { data: { members } };
      return { data: changeSet() };
    });
    render(<LanguageProvider><MemoryRouter initialEntries={['/review']}><ReviewQuerySwitcher /><ReviewPage /></MemoryRouter></LanguageProvider>);
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
    fireEvent.click(screen.getByRole('button', { name: 'Open selected review' }));
    await screen.findByText('Candidate set');
    await act(async () => oldList.resolve({ data: [] }));
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    expect(screen.getByText('Candidate set')).toBeVisible();
    act(() => window.dispatchEvent(new Event('focus')));
    await waitFor(() => expect(listReads).toBe(3));
  });

});

describe('ReviewPage real Markdown update diff', () => {
  beforeEach(() => {
    members = [{ userId: 'user-1', role: 'owner' }];
    vi.mocked(useAuth).mockReturnValue({ user: { id: 'user-1' } } as any);
    vi.mocked(api.get).mockReset(); vi.mocked(api.post).mockReset(); vi.mocked(api.patch).mockReset();
  });
  afterEach(cleanup);
  const update = () => ({ ...changeSet(), items: [{ id: 'update-1', type: 'update_page', status: 'pending', payload: { pageId: 'page-1', expectedUpdatedAt: '2026-10-06T00:00:00Z', changes: { content: 'new paragraph', title: 'New title' } } }] });
  it.each([true, false])('shows bounded current text diff with honest version labels (matching=%s)', async (matches) => {
    vi.mocked(api.get).mockImplementation(async (url) => ({ data: url === '/review' ? [update()] : url === '/pages/page-1' ? { id: 'page-1', spaceId: 'space-1', content: 'old paragraph', title: 'Old title', updatedAt: matches ? '2026-10-06T00:00:00Z' : 'later' } : update() }));
    renderReview(); fireEvent.click(await screen.findByRole('button', { name: /Candidate set/ }));
    await screen.findByLabelText('Markdown diff');
    expect(screen.getByText('old paragraph')).toBeInTheDocument(); expect(screen.getByText('new paragraph')).toBeInTheDocument();
    expect(screen.getByText(matches ? 'Current document (matches proposal base version)' : 'Current document vs candidate')).toBeInTheDocument();
    if (!matches) expect(screen.getByText(/Proposal base version is unavailable or stale/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Accept candidate' })).toBeEnabled();
  });
  it('does not invent a baseline after an unauthorized current page read', async () => {
    vi.mocked(api.get).mockImplementation(async (url) => { if (url === '/pages/page-1') throw new Error('Forbidden'); return { data: url === '/review' ? [update()] : update() }; });
    renderReview('zh-CN'); fireEvent.click(await screen.findByRole('button', { name: /Candidate set/ }));
    expect(await screen.findByText('无法读取当前文档，仅显示候选。')).toBeInTheDocument();
    expect(screen.queryByLabelText('Markdown 差异')).not.toBeInTheDocument();
    expect(screen.getByText('new paragraph')).toBeInTheDocument();
  });
});
