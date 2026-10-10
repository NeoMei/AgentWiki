import React, { useRef } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../context/LanguageContext';
import { ArticleContentsPopover } from './ArticleContentsPopover';
import { SpaceWorkspaceProvider, SpaceWorkspaceScope } from './SpaceWorkspaceContext';

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

const ScopedHarness = ({ pageKey = 'page-1', user = 'alice', space = 'wiki', suppressed = false, source = '# A', left = 0 }: { pageKey?: string; user?: string; space?: string; suppressed?: boolean; source?: string; left?: number }) => {
  const articleRef = useRef<HTMLDivElement>(null);
  return <SpaceWorkspaceProvider userId={user}><SpaceWorkspaceScope mode="read" spaceId={space} activeSection="pages" selectedFolderId={null} selectedPageId={pageKey} selectedPageFolderId={null} pageRefreshRequest={0} selectFolder={vi.fn()} reportPageIdentity={vi.fn()} requestPageRefresh={vi.fn()}><LanguageProvider><div className="document-canvas" ref={(node) => { if (node) vi.spyOn(node, 'getBoundingClientRect').mockReturnValue({ left } as DOMRect); }}><ArticleContentsPopover articleRootRef={articleRef} spaceId={space} pageKey={pageKey} suppressed={suppressed} source={source} /><div ref={articleRef} /></div></LanguageProvider></SpaceWorkspaceScope></SpaceWorkspaceProvider>;
};
const panelPrefs = () => JSON.parse(localStorage.getItem('agentwiki.workspace.v1:alice:wiki') ?? '{}');

describe('ArticleContentsPopover', () => {
  beforeEach(() => {
    localStorage.clear();
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

  it('reports only the visible wide-screen rail and clears its space on close, mobile, suppression, empty source, and unmount', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1700 });
    const occupied = vi.fn();
    const articleRef = React.createRef<HTMLDivElement>();
    const layout = (source = '# A', suppressed = false) => <LanguageProvider><div className="document-canvas"><ArticleContentsPopover articleRootRef={articleRef} pageKey="rail" source={source} suppressed={suppressed} onOccupiedWidthChange={occupied} /><div ref={articleRef} /></div></LanguageProvider>;
    const view = render(layout());
    await screen.findByRole('navigation', { name: 'Contents' });
    expect(occupied).toHaveBeenLastCalledWith(296);
    fireEvent.keyDown(screen.getByRole('separator', { name: 'Resize article contents' }), { key: 'End' });
    expect(occupied).toHaveBeenLastCalledWith(376);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(occupied).toHaveBeenLastCalledWith(0);
    fireEvent.click(screen.getByRole('button', { name: 'Contents' }));
    expect(occupied).toHaveBeenLastCalledWith(376);
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 }); fireEvent.resize(window);
    expect(screen.getByRole('navigation', { name: 'Contents' })).toBeVisible();
    expect(occupied).toHaveBeenLastCalledWith(0);
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 }); fireEvent.resize(window);
    fireEvent.click(screen.getByRole('button', { name: 'Contents' }));
    expect(screen.getByRole('navigation', { name: 'Contents' })).toBeVisible();
    expect(occupied).toHaveBeenLastCalledWith(0);
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1700 }); fireEvent.resize(window);
    expect(occupied).toHaveBeenLastCalledWith(376);
    view.rerender(layout('# A', true));
    expect(occupied).toHaveBeenLastCalledWith(0);
    view.rerender(layout('No headings'));
    expect(screen.queryByRole('navigation', { name: 'Contents' })).not.toBeInTheDocument();
    expect(occupied).toHaveBeenLastCalledWith(0);
    view.rerender(layout('# B'));
    expect(occupied).toHaveBeenLastCalledWith(376);
    view.unmount();
    expect(occupied).toHaveBeenLastCalledWith(0);
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

  it('uses shared source outline and source identity instead of embedded rendered headings', async () => {
    const articleRef = React.createRef<HTMLDivElement>();
    const navigate = vi.fn();
    render(<LanguageProvider><ArticleContentsPopover articleRootRef={articleRef} pageKey="source" source={'# A\n```md\n# fake\n```\n# A'} activeHeadingId="a-1" onNavigate={navigate} /><div ref={articleRef} /></LanguageProvider>);
    fireEvent.click(await screen.findByRole('button', { name: 'Contents' }));
    const buttons = screen.getAllByRole('button', { name: 'A' });
    expect(buttons[1]).toHaveAttribute('aria-current', 'location');
    fireEvent.click(buttons[1]);
    expect(navigate).toHaveBeenCalledWith({ id: 'a-1', label: 'A', level: 1, from: 21, to: 24 });
    expect(screen.queryByRole('button', { name: 'fake' })).not.toBeInTheDocument();
  });

  it('reports an explicit source target without replacing default rendered-heading scrolling', async () => {
    const articleRef = React.createRef<HTMLDivElement>();
    const intent = vi.fn();
    render(<LanguageProvider><ArticleContentsPopover articleRootRef={articleRef} pageKey="preview" source={'# A\n\n# B'} onNavigateIntent={intent} /><div ref={articleRef}><h1 id="a" data-markdown-source-start="0">A</h1><h1 id="b" data-markdown-source-start="5">B</h1></div></LanguageProvider>);
    fireEvent.click(await screen.findByRole('button', { name: 'Contents' }));
    fireEvent.click(screen.getByRole('button', { name: 'B' }));
    expect(intent).toHaveBeenCalledExactlyOnceWith(5);
    expect(screen.getByRole('heading', { name: 'B' }).scrollIntoView).toHaveBeenCalledWith({ block: 'start' });
    expect(window.scrollBy).toHaveBeenCalledWith({ top: -88, left: 0, behavior: 'instant' });
  });

  it('opens a wide-screen outline that can be collapsed without changing the article', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1700 });
    render(<Harness><h2 id="one">One</h2></Harness>);
    expect(await screen.findByRole('navigation', { name: 'Contents' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('navigation', { name: 'Contents' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'One' })).toBeInTheDocument();
  });

  it('retains a collapsed wide outline when the same page source is edited', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1700 });
    const articleRef = React.createRef<HTMLDivElement>();
    const renderSource = (source: string) => <LanguageProvider><ArticleContentsPopover articleRootRef={articleRef} pageKey="same" source={source} onNavigate={() => {}} /><div ref={articleRef} /></LanguageProvider>;
    const rendered = render(renderSource('# A'));
    fireEvent.click(await screen.findByRole('button', { name: 'Close' }));
    rendered.rerender(renderSource('# A\n\nHuman edit'));
    expect(screen.queryByRole('navigation', { name: 'Contents' })).not.toBeInTheDocument();
  });

  it('keeps an explicit desktop close across page and viewport changes', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1700 });
    const view = render(<Harness><h2 id="one">One</h2></Harness>);
    fireEvent.click(await screen.findByRole('button', { name: 'Close' }));
    view.rerender(<Harness pageKey="page-2"><h2 id="two">Two</h2></Harness>);
    expect(screen.queryByRole('navigation', { name: 'Contents' })).not.toBeInTheDocument();
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 }); fireEvent.resize(window);
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1700 }); fireEvent.resize(window);
    expect(screen.queryByRole('navigation', { name: 'Contents' })).not.toBeInTheDocument();
  });

  it('shares an explicit collapse across documents/read-edit remount and isolates accounts/Spaces', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1700 });
    const view = render(<ScopedHarness />);
    fireEvent.click(await screen.findByRole('button', { name: 'Close' }));
    expect(panelPrefs().outlineOpen).toBe(false);
    view.rerender(<ScopedHarness pageKey="page-2:edit" />);
    expect(screen.queryByRole('navigation', { name: 'Contents' })).not.toBeInTheDocument();
    view.rerender(<ScopedHarness space="other" />); expect(await screen.findByRole('navigation', { name: 'Contents' })).toBeVisible();
    view.rerender(<ScopedHarness user="bob" />); expect(screen.getByRole('navigation', { name: 'Contents' })).toBeVisible();
    view.unmount(); render(<ScopedHarness pageKey="page-3:read" />);
    expect(screen.getByRole('button', { name: 'Contents' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('keeps desktop choice and width when temporarily opened/dismissed on mobile', async () => {
    localStorage.setItem('agentwiki.workspace.v1:alice:wiki', JSON.stringify({ schemaVersion: 1, outlineOpen: true, outlineWidth: 360 }));
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    render(<ScopedHarness />);
    fireEvent.click(await screen.findByRole('button', { name: 'Contents' }));
    expect(screen.getByRole('navigation', { name: 'Contents' })).toHaveStyle({ width: '358px' });
    expect(screen.queryByRole('separator')).not.toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(panelPrefs()).toMatchObject({ outlineOpen: true, outlineWidth: 360 });
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1700 }); fireEvent.resize(window);
    expect(screen.getByRole('navigation', { name: 'Contents' })).toHaveStyle({ width: '360px' });
  });

  it('suppresses both automatic and explicit outline without erasing choice or overlapping the collaborator', async () => {
    localStorage.setItem('agentwiki.workspace.v1:alice:wiki', JSON.stringify({ schemaVersion: 1, outlineOpen: true }));
    const view = render(<ScopedHarness suppressed />);
    expect(await screen.findByRole('button', { name: 'Contents' })).toBeDisabled();
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    view.rerender(<ScopedHarness />); expect(await screen.findByRole('navigation')).toBeVisible();
    view.rerender(<ScopedHarness source="no headings" />); expect(screen.queryByRole('button', { name: 'Contents' })).not.toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' }); expect(panelPrefs().outlineOpen).toBe(true);
    view.rerender(<ScopedHarness source="# Again" />); expect(await screen.findByRole('navigation')).toBeVisible();
    expect(panelPrefs().outlineOpen).toBe(true);
  });

  it('clamps desktop display beside the document and persists only deliberate resize', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
    localStorage.setItem('agentwiki.workspace.v1:alice:wiki', JSON.stringify({ schemaVersion: 1, outlineOpen: true, outlineWidth: 360 }));
    render(<ScopedHarness left={600} />);
    const grip = await screen.findByRole('separator', { name: 'Resize article contents' });
    expect(grip).toHaveAttribute('aria-valuemax', '300');
    expect(screen.getByRole('navigation')).toHaveStyle({ width: '300px' });
    expect(panelPrefs().outlineWidth).toBe(360);
    fireEvent.keyDown(grip, { key: 'Home' }); expect(panelPrefs().outlineWidth).toBe(200);
    fireEvent.keyDown(grip, { key: 'End' }); expect(panelPrefs().outlineWidth).toBe(300);
  });

  it('uses the article canvas when the reading toolbar is its sibling without overwriting stored width', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
    localStorage.setItem('agentwiki.workspace.v1:alice:wiki', JSON.stringify({ schemaVersion: 1, outlineOpen: true, outlineWidth: 360 }));
    const articleRef = React.createRef<HTMLDivElement>();
    let canvasLeft = 600;
    render(<SpaceWorkspaceProvider userId="alice"><SpaceWorkspaceScope mode="read" spaceId="wiki" activeSection="pages" selectedFolderId={null} selectedPageId="reader" selectedPageFolderId={null} pageRefreshRequest={0} selectFolder={vi.fn()} reportPageIdentity={vi.fn()} requestPageRefresh={vi.fn()}><LanguageProvider>
      <div data-reading-toolbar><ArticleContentsPopover articleRootRef={articleRef} spaceId="wiki" pageKey="reader" source="# A" /></div>
      <article className="document-canvas" ref={(node) => { if (node) vi.spyOn(node, 'getBoundingClientRect').mockImplementation(() => ({ left: canvasLeft } as DOMRect)); }}><div ref={articleRef}><h1 id="a">A</h1></div></article>
    </LanguageProvider></SpaceWorkspaceScope></SpaceWorkspaceProvider>);
    const grip = await screen.findByRole('separator', { name: 'Resize article contents' });
    expect(screen.getByRole('navigation', { name: 'Contents' })).toHaveStyle({ width: '300px' });
    expect(grip).toHaveAttribute('aria-valuemax', '300');
    expect(panelPrefs().outlineWidth).toBe(360);
    canvasLeft = 650; fireEvent.resize(window);
    expect(screen.getByRole('navigation', { name: 'Contents' })).toHaveStyle({ width: '250px' });
    expect(grip).toHaveAttribute('aria-valuemax', '250');
    expect(panelPrefs().outlineWidth).toBe(360);
    canvasLeft = 750; fireEvent.resize(window);
    expect(screen.queryByRole('separator', { name: 'Resize article contents' })).not.toBeInTheDocument();
    expect(panelPrefs().outlineWidth).toBe(360);
    canvasLeft = 650; fireEvent.resize(window);
    fireEvent.keyDown(screen.getByRole('separator', { name: 'Resize article contents' }), { key: 'End' });
    expect(panelPrefs().outlineWidth).toBe(250);
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

  it('places the automatic wide outline below the owning editor toolbar and follows its resized/scroll position', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1680 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 1000 });
    const articleRef = React.createRef<HTMLDivElement>();
    let toolbarBottom = 222;
    render(<LanguageProvider><div>
      <div data-testid="editor-toolbar" ref={(node) => { if (node) vi.spyOn(node, 'getBoundingClientRect').mockImplementation(() => ({ bottom: toolbarBottom } as DOMRect)); }}><button type="button">Assist action</button></div>
      <ArticleContentsPopover articleRootRef={articleRef} pageKey="editor-wide" source={'# A'} onNavigate={() => {}} />
      <div ref={articleRef} />
    </div></LanguageProvider>);
    const outline = await screen.findByRole('navigation', { name: 'Contents' });
    expect(outline).toHaveStyle({ top: '234px', maxHeight: '750px' });
    toolbarBottom = 280;
    fireEvent.resize(window);
    expect(outline).toHaveStyle({ top: '292px', maxHeight: '692px' });
    toolbarBottom = 128;
    fireEvent.scroll(document);
    expect(outline).toHaveStyle({ top: '140px', maxHeight: '844px' });
    expect(screen.getByRole('button', { name: 'Assist action' })).toBeVisible();
  });

  it('keeps a floating trigger below the sticky toolbar while the article scrolls', async () => {
    let toolbarBottom = 120;
    const articleRef = React.createRef<HTMLDivElement>();
    render(<LanguageProvider><div>
      <div data-testid="editor-toolbar" ref={(node) => { if (node) vi.spyOn(node, 'getBoundingClientRect').mockImplementation(() => ({ bottom: toolbarBottom } as DOMRect)); }} />
      <ArticleContentsPopover articleRootRef={articleRef} pageKey="floating" source="# A" floatingTrigger />
      <div ref={articleRef} />
    </div></LanguageProvider>);

    const trigger = await screen.findByRole('button', { name: 'Contents' });
    expect(trigger.parentElement).toBe(document.body);
    expect(trigger).toHaveClass('fixed');
    await waitFor(() => expect(trigger).toHaveStyle({ top: '132px', right: '16px' }));
    toolbarBottom = 180;
    fireEvent.scroll(document);
    await waitFor(() => expect(trigger).toHaveStyle({ top: '192px' }));
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

  it('limits a mobile popover to the viewport space below a wrapped toolbar', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 844 });
    render(<Harness>{Array.from({ length: 18 }, (_, index) => (
      <h2 id={`mobile-${index}`} key={index}>Mobile heading {index}</h2>
    ))}</Harness>);
    const trigger = await screen.findByRole('button', { name: 'Contents' });
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({ right: 296, bottom: 353 } as DOMRect);
    fireEvent.click(trigger);

    const popover = screen.getByRole('navigation', { name: 'Contents' });
    expect(popover).toHaveStyle({ top: '361px', maxHeight: '467px' });
    expect(popover.lastElementChild).toHaveClass('min-h-0', 'flex-1', 'overflow-y-auto');
  });

  it('renders the fixed popover outside a filtered reading toolbar', async () => {
    const articleRef = React.createRef<HTMLDivElement>();
    render(<LanguageProvider>
      <div data-testid="filtered-toolbar" data-reading-toolbar style={{ backdropFilter: 'blur(8px)' }}>
        <ArticleContentsPopover articleRootRef={articleRef} pageKey="page-1" />
      </div>
      <div ref={articleRef}><h2 id="portal-heading">Portal heading</h2></div>
    </LanguageProvider>);

    fireEvent.click(await screen.findByRole('button', { name: 'Contents' }));
    const toolbar = screen.getByTestId('filtered-toolbar');
    const popover = screen.getByRole('navigation', { name: 'Contents' });
    expect(toolbar).not.toContainElement(popover);
    expect(popover.parentElement).toBe(document.body);
  });
});
