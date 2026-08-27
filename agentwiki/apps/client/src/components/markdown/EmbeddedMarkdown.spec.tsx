import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../../api/client';
import { LanguageProvider } from '../../context/LanguageContext';
import { Markdown } from '../Markdown';

const attachmentMocks = vi.hoisted(() => ({ image: vi.fn((_props: unknown) => null) }));

vi.mock('../../api/client', () => ({
  default: { get: vi.fn(), post: vi.fn() },
}));

vi.mock('../../features/attachments/AttachmentImage', () => ({
  AttachmentImage: (props: unknown) => {
    attachmentMocks.image(props);
    return <span data-testid="protected-attachment" />;
  },
}));

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const pageResource = (key: string, pageId: string, title = pageId) => ({
  key, status: 'resolved', kind: 'page', pageId, title, slug: pageId,
});

const renderMarkdown = (source: string, props: Record<string, unknown> = {}) => render(
  <LanguageProvider><MemoryRouter>
    <Markdown spaceId="space-1" pageId="root-page" mode="page" {...props}>{source}</Markdown>
  </MemoryRouter></LanguageProvider>,
);

describe('EmbeddedMarkdown resource rendering', () => {
  beforeEach(() => {
    localStorage.setItem('agentwiki.language.v1', 'en');
    vi.clearAllMocks();
  });
  afterEach(cleanup);

  it('renders authoritative links, exact section slices and protected attachment metadata in one batch', async () => {
    vi.mocked(api.post).mockImplementation(async (_url, body) => ({
      data: (body as { references: Array<{ key: string; kind: string; target: string }> }).references.map((ref) => {
        if (ref.kind === 'attachment') return {
          key: ref.key, status: 'resolved', kind: 'attachment', attachmentId: 'attachment-1',
          displayName: 'diagram.png', mimeType: 'image/png', width: 1280, height: 720,
        };
        return pageResource(ref.key, ref.target === 'Far Page' ? 'far-page' : 'embedded /?#', ref.target);
      }),
    }));
    vi.mocked(api.get).mockResolvedValue({
      data: { id: 'embedded /?#', content: '# Before\n\n## Section\n\nInside\n\n## Next\n\nOutside' },
    });

    renderMarkdown('[[Far Page|Go far]]\n\n![[Embedded#Section|Excerpt]]\n\n![[diagram.png|Diagram alt]]');

    expect(await screen.findByRole('link', { name: 'Go far' })).toHaveAttribute('href', '/pages/far-page');
    expect(await screen.findByText('Inside')).toBeInTheDocument();
    expect(screen.queryByText('Outside')).not.toBeInTheDocument();
    await waitFor(() => expect(attachmentMocks.image).toHaveBeenCalledWith(expect.objectContaining({
      attachmentId: 'attachment-1', displayName: 'diagram.png', mimeType: 'image/png',
      width: 1280, height: 720, alt: 'Diagram alt',
    })));
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.get).toHaveBeenCalledWith('/pages/embedded%20%2F%3F%23', { signal: expect.any(AbortSignal) });
  });

  it('keeps unresolved and ambiguous link/embed/image markers exactly readable', async () => {
    vi.mocked(api.post).mockImplementation(async (_url, body) => ({
      data: (body as { references: Array<{ key: string; target: string }> }).references.map((ref) => ({
        key: ref.key, status: ref.target.startsWith('Ambiguous') ? 'ambiguous' : 'unresolved',
      })),
    }));

    renderMarkdown('[[Missing|Label]] ![[Ambiguous Page]] ![[Ambiguous.png|Alt]]');

    expect(await screen.findByText('[[Missing|Label]]')).toBeInTheDocument();
    expect(screen.getByText('![[Ambiguous Page]]')).toBeInTheDocument();
    expect(screen.getByText('![[Ambiguous.png|Alt]]')).toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalled();
    expect(attachmentMocks.image).not.toHaveBeenCalled();
  });

  it('localizes a resolver failure and preserves the exact marker and surrounding Markdown', async () => {
    vi.mocked(api.post).mockRejectedValue(new Error('resolver unavailable'));

    renderMarkdown('Before resolver ![[Unavailable]] after resolver');

    expect(await screen.findByText('![[Unavailable]]')).toBeInTheDocument();
    expect(screen.getByText('Before resolver')).toBeInTheDocument();
    expect(screen.getByText('after resolver')).toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalled();
  });

  it('fails block-ID embeds locally and does not fetch page content', async () => {
    vi.mocked(api.post).mockImplementation(async (_url, body) => ({
      data: (body as { references: Array<{ key: string }> }).references.map((ref) => pageResource(ref.key, 'page-a')),
    }));

    renderMarkdown('Before ![[Page#^block-one]] after');

    expect(await screen.findByText('![[Page#^block-one]]')).toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalled();
  });

  it('detects direct and indirect cycles per branch without breaking surrounding Markdown', async () => {
    vi.mocked(api.post).mockImplementation(async (_url, body) => ({
      data: (body as { references: Array<{ key: string; target: string }> }).references.map((ref) => (
        pageResource(ref.key, ref.target === 'Root' ? 'root-page' : 'page-a', ref.target)
      )),
    }));
    vi.mocked(api.get).mockResolvedValue({ data: { id: 'page-a', content: 'Nested before ![[Root]] nested after' } });

    renderMarkdown('Root before ![[Root]] and ![[Page A]] root after');

    expect(await screen.findByText('![[Root]]')).toBeInTheDocument();
    expect(await screen.findByText(/Nested before/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText('![[Root]]')).toHaveLength(2));
    expect(screen.getByText(/root after/)).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledTimes(1);
  });

  it('allows depth three and localizes the depth-four marker', async () => {
    const ids: Record<string, string> = { A: 'a', B: 'b', C: 'c', D: 'd' };
    vi.mocked(api.post).mockImplementation(async (_url, body) => ({
      data: (body as { references: Array<{ key: string; target: string }> }).references.map((ref) => pageResource(ref.key, ids[ref.target], ref.target)),
    }));
    vi.mocked(api.get).mockImplementation(async (url) => {
      const id = String(url).split('/').pop();
      const next: Record<string, string> = { a: 'B', b: 'C', c: 'D' };
      return { data: { id, content: next[id!] ? `${id} body ![[${next[id!]}]]` : `${id} body` } };
    });

    renderMarkdown('![[A]]');

    expect(await screen.findByText('![[D]]')).toBeInTheDocument();
    expect(screen.getByText(/c body/)).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledTimes(3);
    expect(api.get).not.toHaveBeenCalledWith('/pages/d', expect.anything());
  });

  it('shares duplicate page fetches but counts 20 occurrences and keeps the 21st marker readable', async () => {
    vi.mocked(api.post).mockImplementation(async (_url, body) => ({
      data: (body as { references: Array<{ key: string }> }).references.map((ref) => pageResource(ref.key, 'shared')),
    }));
    vi.mocked(api.get).mockResolvedValue({ data: { id: 'shared', content: 'embedded-copy' } });

    renderMarkdown(Array.from({ length: 21 }, () => '![[Shared]]').join('\n\n'));

    expect(await screen.findAllByText('embedded-copy')).toHaveLength(20);
    expect(screen.getByText('![[Shared]]')).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.get).toHaveBeenCalledTimes(1);
  });

  it('counts nested embeds in duplicate page copies as distinct rendered occurrences', async () => {
    vi.mocked(api.post).mockImplementation(async (_url, body) => ({
      data: (body as { references: Array<{ key: string; target: string }> }).references.map((ref) => (
        pageResource(ref.key, ref.target.toLowerCase(), ref.target)
      )),
    }));
    vi.mocked(api.get).mockImplementation(async (url) => ({
      data: {
        id: String(url).split('/').pop(),
        content: String(url).endsWith('/shared')
          ? '![[Leaf]]\n\n![[Leaf]]'
          : 'leaf-copy',
      },
    }));

    renderMarkdown(Array.from({ length: 10 }, () => '![[Shared]]').join('\n\n'));

    expect(await screen.findAllByText('leaf-copy')).toHaveLength(10);
    await waitFor(() => expect(screen.getAllByText('![[Leaf]]')).toHaveLength(10));
    expect(api.get).toHaveBeenCalledTimes(2);
  });

  it('keeps budget and caches stable across StrictMode replay and rerender', async () => {
    vi.mocked(api.post).mockImplementation(async (_url, body) => ({
      data: (body as { references: Array<{ key: string }> }).references.map((ref) => pageResource(ref.key, 'shared')),
    }));
    vi.mocked(api.get).mockResolvedValue({ data: { id: 'shared', content: 'strict-copy' } });
    const source = Array.from({ length: 20 }, () => '![[Shared]]').join('\n\n');
    const view = render(
      <StrictMode><LanguageProvider><MemoryRouter>
        <Markdown spaceId="space-1" pageId="root-page" mode="page">{source}</Markdown>
      </MemoryRouter></LanguageProvider></StrictMode>,
    );
    expect(await screen.findAllByText('strict-copy')).toHaveLength(20);

    view.rerender(
      <StrictMode><LanguageProvider><MemoryRouter>
        <Markdown spaceId="space-1" pageId="root-page" mode="page" canEdit>{source}</Markdown>
      </MemoryRouter></LanguageProvider></StrictMode>,
    );

    expect(screen.getAllByText('strict-copy')).toHaveLength(20);
    expect(screen.queryByText('![[Shared]]')).not.toBeInTheDocument();
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.get).toHaveBeenCalledTimes(1);
  });

  it('enforces the 200,000 embedded-character boundary', async () => {
    vi.mocked(api.post).mockImplementation(async (_url, body) => ({
      data: (body as { references: Array<{ key: string; target: string }> }).references.map((ref) => pageResource(ref.key, ref.target)),
    }));
    vi.mocked(api.get).mockImplementation(async (url) => ({
      data: { id: String(url).split('/').pop(), content: String(url).endsWith('/Allowed') ? ' '.repeat(200_000) : ' '.repeat(200_001) },
    }));

    const view = renderMarkdown('![[Too Large]]');
    expect(await screen.findByText('![[Too Large]]')).toBeInTheDocument();
    view.unmount();

    const allowedView = renderMarkdown('![[Allowed]]');
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    expect(screen.queryByText('![[Allowed]]')).not.toBeInTheDocument();
    expect(allowedView.container.querySelector('.markdown-page-embed')).toBeInTheDocument();
  });

  it('disables tasks inside embeds and only labels successful version-root embeds as current content', async () => {
    vi.mocked(api.post).mockImplementation(async (_url, body) => ({
      data: (body as { references: Array<{ key: string }> }).references.map((ref) => pageResource(ref.key, 'embedded')),
    }));
    vi.mocked(api.get).mockResolvedValue({ data: { id: 'embedded', content: '- [ ] nested task' } });
    const onTaskToggle = vi.fn();

    const pageView = renderMarkdown('![[Embedded]]', { canEdit: true, onTaskToggle });
    expect(await screen.findByRole('checkbox')).toBeDisabled();
    expect(screen.queryByText('Embedded content is from the current version.')).not.toBeInTheDocument();
    pageView.unmount();

    renderMarkdown('![[Embedded]]', { mode: 'version' });
    expect(await screen.findByText('Embedded content is from the current version.')).toBeInTheDocument();
  });

  it('suppresses stale resolver and page responses after source/root changes', async () => {
    const staleResolver = deferred<any>();
    const stalePage = deferred<any>();
    let postCalls = 0;
    vi.mocked(api.post).mockImplementation(async (_url, body) => {
      postCalls += 1;
      if (postCalls === 1) return staleResolver.promise;
      const ref = (body as { references: Array<{ key: string }> }).references[0];
      return { data: [pageResource(ref.key, 'fresh')] };
    });
    vi.mocked(api.get).mockImplementation(async (url) => String(url).endsWith('/stale')
      ? stalePage.promise
      : { data: { id: 'fresh', content: 'fresh-content' } });
    const view = renderMarkdown('![[Stale Resolver]]');

    view.rerender(<LanguageProvider><MemoryRouter>
      <Markdown spaceId="space-2" pageId="root-two" mode="page">![[Fresh]]</Markdown>
    </MemoryRouter></LanguageProvider>);
    expect(await screen.findByText('fresh-content')).toBeInTheDocument();

    await act(async () => {
      staleResolver.resolve({ data: [pageResource('r0', 'stale')] });
      stalePage.resolve({ data: { id: 'stale', content: 'stale-content' } });
      await Promise.all([staleResolver.promise, stalePage.promise]);
    });
    expect(screen.queryByText('stale-content')).not.toBeInTheDocument();
  });

  it('aborts and suppresses an already-started stale page fetch after the active root changes', async () => {
    const stalePage = deferred<any>();
    vi.mocked(api.post).mockImplementation(async (_url, body) => {
      const ref = (body as { references: Array<{ key: string; target: string }> }).references[0];
      return { data: [pageResource(ref.key, ref.target === 'Stale' ? 'stale-page' : 'fresh-page')] };
    });
    vi.mocked(api.get).mockImplementation(async (url) => String(url).endsWith('/stale-page')
      ? stalePage.promise
      : { data: { id: 'fresh-page', content: 'fresh-page-content' } });
    const view = renderMarkdown('![[Stale]]');
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/pages/stale-page', { signal: expect.any(AbortSignal) }));
    const staleSignal = vi.mocked(api.get).mock.calls.find(([url]) => url === '/pages/stale-page')?.[1]?.signal;

    view.rerender(<LanguageProvider><MemoryRouter>
      <Markdown spaceId="space-2" pageId="fresh-root" mode="page">![[Fresh]]</Markdown>
    </MemoryRouter></LanguageProvider>);

    expect(await screen.findByText('fresh-page-content')).toBeInTheDocument();
    await waitFor(() => expect(staleSignal?.aborted).toBe(true));
    await act(async () => stalePage.resolve({ data: { id: 'stale-page', content: 'stale-page-content' } }));
    expect(screen.queryByText('stale-page-content')).not.toBeInTheDocument();
  });
});
