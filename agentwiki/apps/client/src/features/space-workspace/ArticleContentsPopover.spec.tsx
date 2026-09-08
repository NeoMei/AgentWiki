import React, { useRef } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../context/LanguageContext';
import { ArticleContentsPopover } from './ArticleContentsPopover';

const Harness = ({ pageKey = 'page-1', children }: { pageKey?: string; children: React.ReactNode }) => {
  const articleRef = useRef<HTMLDivElement>(null);
  return (
    <LanguageProvider>
      <div>
        <ArticleContentsPopover articleRootRef={articleRef} pageKey={pageKey} />
        <div key={pageKey} ref={articleRef} data-testid="article-root">{children}</div>
      </div>
    </LanguageProvider>
  );
};

describe('ArticleContentsPopover', () => {
  beforeEach(() => {
    localStorage.setItem('agentwiki.language.v1', 'en');
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 768 });
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(window, 'scrollBy', {
      configurable: true,
      value: vi.fn(),
    });
  });

  it('reads real rendered heading ids and text while excluding code and embedded-page headings', async () => {
    render(<Harness>
      <h1 id="overview">Overview <em>today</em><a aria-hidden="true"> #</a></h1>
      <h2 id="overview-1">Overview today</h2>
      <h3 id="中文标题">中文标题</h3>
      <pre><code># code heading</code></pre>
      <div className="markdown-page-embed"><h2 id="embedded">Embedded heading</h2></div>
    </Harness>);

    const trigger = await screen.findByRole('button', { name: 'Contents' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('navigation', { name: 'Contents' })).not.toBeInTheDocument();
    fireEvent.click(trigger);

    const contents = screen.getByRole('navigation', { name: 'Contents' });
    expect(Array.from(contents.querySelectorAll('button[title]')).map((item) => item.textContent)).toEqual([
      'Overview today', 'Overview today', '中文标题',
    ]);
    expect(within(contents).queryByText('code heading')).not.toBeInTheDocument();
    expect(within(contents).queryByText('Embedded heading')).not.toBeInTheDocument();
  });

  it('hides the trigger without headings and refreshes after deferred DOM changes and a page switch', async () => {
    const view = render(<Harness><p>No headings</p></Harness>);
    expect(screen.queryByRole('button', { name: 'Contents' })).not.toBeInTheDocument();

    const article = screen.getByTestId('article-root');
    if (!article) throw new Error('article root missing');
    await act(async () => {
      const heading = document.createElement('h2');
      heading.id = 'late';
      heading.textContent = 'Late heading';
      article.append(heading);
      await Promise.resolve();
    });
    expect(await screen.findByRole('button', { name: 'Contents' })).toBeInTheDocument();

    view.rerender(<Harness pageKey="page-2"><h2 id="next">Next page heading</h2></Harness>);
    fireEvent.click(screen.getByRole('button', { name: 'Contents' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Next page heading' })).toBeInTheDocument());
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Late heading' })).not.toBeInTheDocument());
  });

  it('closes by Escape with focus restoration, outside click without refocusing, and item navigation without layout state', async () => {
    render(<Harness><h2 id="target">Target</h2></Harness>);
    const trigger = await screen.findByRole('button', { name: 'Contents' });
    const focus = vi.spyOn(trigger, 'focus');
    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('navigation', { name: 'Contents' })).not.toBeInTheDocument();
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(trigger).toHaveFocus();

    fireEvent.click(trigger);
    screen.getByRole('button', { name: 'Target' }).focus();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('navigation', { name: 'Contents' })).not.toBeInTheDocument();
    expect(trigger).not.toHaveFocus();

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button', { name: 'Target' }));
    expect(document.getElementById('target')?.scrollIntoView).toHaveBeenCalledWith({ block: 'start' });
    expect(window.scrollBy).toHaveBeenCalledWith({ top: -88, left: 0, behavior: 'instant' });
    expect(screen.queryByRole('navigation', { name: 'Contents' })).not.toBeInTheDocument();
  });

  it('updates the current section from the article scroll position', async () => {
    render(<Harness><h2 id="one">One</h2><h2 id="two">Two</h2></Harness>);
    const one = document.getElementById('one');
    const two = document.getElementById('two');
    if (!one || !two) throw new Error('headings missing');
    vi.spyOn(one, 'getBoundingClientRect').mockReturnValue({ top: -40 } as DOMRect);
    vi.spyOn(two, 'getBoundingClientRect').mockReturnValue({ top: 170 } as DOMRect);
    const trigger = await screen.findByRole('button', { name: 'Contents' });
    fireEvent.scroll(window);
    fireEvent.click(trigger);
    expect(screen.getByRole('button', { name: 'One' })).toHaveAttribute('aria-current', 'location');
    expect(screen.getByRole('button', { name: 'Two' })).not.toHaveAttribute('aria-current');
  });

  it('offsets navigation below the actual sticky reading toolbar', async () => {
    const articleRef = React.createRef<HTMLDivElement>();
    render(<LanguageProvider><div data-reading-toolbar ref={(node) => {
      if (node) vi.spyOn(node, 'getBoundingClientRect').mockReturnValue({ bottom: 146 } as DOMRect);
    }}><ArticleContentsPopover articleRootRef={articleRef} pageKey="page-1" /></div><div ref={articleRef}><h2 id="actual-offset">Actual offset</h2></div></LanguageProvider>);
    fireEvent.click(await screen.findByRole('button', { name: 'Contents' }));
    fireEvent.click(screen.getByRole('button', { name: 'Actual offset' }));
    expect(window.scrollBy).toHaveBeenCalledWith({ top: -158, left: 0, behavior: 'instant' });
  });

  it('clamps the anchored popover inside a 390px viewport', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    render(<Harness><h2 id="mobile">Mobile heading</h2></Harness>);
    const trigger = await screen.findByRole('button', { name: 'Contents' });
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({ right: 233, bottom: 125 } as DOMRect);
    fireEvent.click(trigger);

    const popover = screen.getByRole('navigation', { name: 'Contents' });
    expect(popover).toHaveStyle({ left: '16px', top: '133px', width: '280px' });
  });
});
