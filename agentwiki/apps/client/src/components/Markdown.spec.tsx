import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../context/LanguageContext';
import { messages } from '../i18n/messages';

interface MockMermaidDiagramProps {
  source: string;
  loadingLabel: string;
  errorLabel: string;
  tooLargeLabel: string;
}

const mermaidMocks = vi.hoisted(() => ({
  MermaidDiagram: vi.fn((_props: MockMermaidDiagramProps) => null),
  mounted: vi.fn((_source: string) => undefined),
  unmounted: vi.fn((_source: string) => undefined),
}));

vi.mock('./markdown/MermaidDiagram', async () => {
  const { useEffect } = await import('react');
  return {
    MermaidDiagram: (props: MockMermaidDiagramProps) => {
      mermaidMocks.MermaidDiagram(props);
      useEffect(() => {
        mermaidMocks.mounted(props.source);
        return () => mermaidMocks.unmounted(props.source);
      }, []);
      return null;
    },
  };
});

import { Markdown } from './Markdown';
import { isExternalHref, isInternalPageHref, resolveWikiHref } from './markdownLinks';
import { parseWikiReference } from './markdown/obsidian';

const pages = [
  { id: 'abc123', title: 'MyFirstPage', slug: 'myfirstpage-abc' },
  { id: 'def456', title: '链接能力测试', slug: 'link-test-def' },
];

const renderMd = (content: string, p = pages) => render(
  <LanguageProvider><MemoryRouter><Markdown pages={p}>{content}</Markdown></MemoryRouter></LanguageProvider>,
);

describe('resolveWikiHref', () => {
  afterEach(cleanup);
  it('resolves by title, slug and id, case-insensitively', () => {
    expect(resolveWikiHref(parseWikiReference('MyFirstPage'), pages)).toBe('/pages/abc123');
    expect(resolveWikiHref(parseWikiReference('myfirstpage-abc'), pages)).toBe('/pages/abc123');
    expect(resolveWikiHref(parseWikiReference('abc123'), pages)).toBe('/pages/abc123');
    expect(resolveWikiHref(parseWikiReference('链接能力测试'), pages)).toBe('/pages/def456');
  });
  it('appends heading and block fragments only after the page resolves', () => {
    expect(resolveWikiHref(parseWikiReference('MyFirstPage#Heading Name'), pages)).toBe('/pages/abc123#heading-name');
    expect(resolveWikiHref(parseWikiReference('MyFirstPage#^block / one'), pages)).toBe('/pages/abc123#^block%20%2F%20one');
    expect(resolveWikiHref(parseWikiReference('Missing#Heading'), pages)).toBeNull();
  });
  it('uses the same punctuation and spacing slug as rendered headings', () => {
    const { container } = renderMd('## A - B\n\n[[MyFirstPage#A - B]]');
    const heading = container.querySelector('h2');
    const link = screen.getByRole('link', { name: 'MyFirstPage#A - B' });

    expect(heading).toHaveAttribute('id', 'a---b');
    expect(link).toHaveAttribute('href', '/pages/abc123#a---b');
    expect(link.getAttribute('href')?.split('#')[1]).toBe(heading?.id);
  });
  it('full-folds page, heading and block anchors while deduping rendered headings', () => {
    const unicodePages = [{ id: 'unicode-page', title: 'Straße', slug: 'unicode' }];
    const { container } = renderMd([
      '## Straße',
      '',
      '## Straße',
      '',
      '## ΟΣ',
      '',
      'Paragraph ^Straße',
      '',
      '[[STRASSE#STRASSE|German heading]]',
      '[[STRASSE#οσ|Greek heading]]',
      '[[STRASSE#^STRASSE|Block target]]',
    ].join('\n'), unicodePages);

    const headingIds = [...container.querySelectorAll('h2')].map((heading) => heading.id);
    const blockId = container.querySelector('.block-anchor')?.id;
    const germanHref = screen.getByRole('link', { name: 'German heading' }).getAttribute('href');
    const greekHref = screen.getByRole('link', { name: 'Greek heading' }).getAttribute('href');
    const blockHref = screen.getByRole('link', { name: 'Block target' }).getAttribute('href');

    expect(headingIds).toEqual(['strasse', 'strasse-1', 'οσ']);
    expect(blockId).toBe('^strasse');
    expect(germanHref).toBe('/pages/unicode-page#strasse');
    expect(greekHref).toBe('/pages/unicode-page#οσ');
    expect(blockHref).toBe('/pages/unicode-page#^strasse');
    expect(germanHref?.split('#')[1]).toBe(headingIds[0]);
    expect(greekHref?.split('#')[1]).toBe(headingIds[2]);
    expect(blockHref?.split('#')[1]).toBe(blockId);
  });
  it('returns null for unknown names', () => {
    expect(resolveWikiHref(parseWikiReference('不存在'), pages)).toBeNull();
  });
});

describe('href classification', () => {
  it('detects internal page links and external links', () => {
    expect(isInternalPageHref('/pages/abc123')).toBe(true);
    expect(isInternalPageHref('https://example.com')).toBe(false);
    expect(isExternalHref('https://example.com')).toBe(true);
    expect(isExternalHref('/pages/abc123')).toBe(false);
  });
});

describe('Markdown rendering', () => {
  afterEach(cleanup);
  beforeEach(() => {
    localStorage.setItem('agentwiki.language.v1', 'en');
    mermaidMocks.MermaidDiagram.mockClear();
    mermaidMocks.mounted.mockClear();
    mermaidMocks.unmounted.mockClear();
  });

  it('renders only a normalized fenced Mermaid block as a diagram and preserves TypeScript highlighting', () => {
    const source = [
      '```  MeRmAiD  ',
      'graph TD;',
      '  Start-->Done',
      '```',
      '',
      '```typescript',
      'const answer: number = 42;',
      '```',
    ].join('\n');

    const { container } = renderMd(source);

    expect(mermaidMocks.MermaidDiagram).toHaveBeenCalledOnce();
    expect(mermaidMocks.MermaidDiagram.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ source: 'graph TD;\n  Start-->Done' }),
    );
    const typescript = container.querySelector('code.language-typescript');
    expect(typescript).toHaveClass('hljs');
    expect(typescript?.querySelector('.hljs-keyword')).toHaveTextContent('const');
  });

  it('keeps inline Mermaid lookalikes and other fenced languages on the normal code path', () => {
    const { container } = renderMd([
      '`mermaid` and `language-mermaid graph TD; A-->B`',
      '',
      '```javascript',
      'const mermaid = true;',
      '```',
    ].join('\n'));

    expect(mermaidMocks.MermaidDiagram).not.toHaveBeenCalled();
    expect(container.querySelectorAll('p code')).toHaveLength(2);
    expect(container.querySelector('code.language-javascript')).toHaveClass('hljs');
  });

  it('renders exactly 20 Mermaid diagrams and preserves the 21st source in a localized limit fallback', () => {
    const blocks = Array.from({ length: 21 }, (_, index) => [
      '```mermaid',
      `graph TD; A${index + 1}-->B${index + 1}`,
      '```',
    ].join('\n')).join('\n\n');

    const { container } = renderMd(blocks);

    expect(mermaidMocks.MermaidDiagram).toHaveBeenCalledTimes(20);
    const lastCall = mermaidMocks.MermaidDiagram.mock.calls[mermaidMocks.MermaidDiagram.mock.calls.length - 1];
    expect(lastCall?.[0]).toEqual(
      expect.objectContaining({ source: 'graph TD; A20-->B20' }),
    );
    expect(screen.getByRole('alert')).toHaveTextContent(messages.en['markdown.mermaid.limitReached']);
    const fallback = container.querySelector('[data-mermaid-state="limit"]');
    expect(fallback).toHaveTextContent('graph TD; A21-->B21');
  });

  it('does not mount the Mermaid component for a document without a Mermaid fence', () => {
    const { container } = renderMd('Plain mermaid text.\n\n```typescript\nconst mermaid = false;\n```');

    expect(mermaidMocks.MermaidDiagram).not.toHaveBeenCalled();
    expect(container.querySelector('code.language-typescript')).toHaveClass('hljs');
  });

  it('passes source and localized readable-fallback labels to MermaidDiagram', () => {
    renderMd('```mermaid\ngraph TD; A["<source>"]-->B\n```');

    expect(mermaidMocks.MermaidDiagram.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        source: 'graph TD; A["<source>"]-->B',
        loadingLabel: messages.en['markdown.mermaid.loading'],
        errorLabel: messages.en['markdown.mermaid.error'],
        tooLargeLabel: expect.stringContaining('20,000'),
      }),
    );
  });

  it('keeps one MermaidDiagram instance mounted across unrelated Markdown rerenders', () => {
    const source = '```mermaid\ngraph TD; A-->B\n```';
    const view = render(
      <LanguageProvider><MemoryRouter>
        <Markdown pages={pages} pendingTaskIndexes={new Set()}>{source}</Markdown>
      </MemoryRouter></LanguageProvider>,
    );

    expect(mermaidMocks.mounted).toHaveBeenCalledOnce();
    expect(mermaidMocks.unmounted).not.toHaveBeenCalled();

    view.rerender(
      <LanguageProvider><MemoryRouter>
        <Markdown
          pages={[...pages, { id: 'ghi789', title: 'AnotherPage', slug: 'another-page-ghi' }]}
          pendingTaskIndexes={new Set([0])}
        >
          {source}
        </Markdown>
      </MemoryRouter></LanguageProvider>,
    );

    expect(mermaidMocks.mounted).toHaveBeenCalledOnce();
    expect(mermaidMocks.unmounted).not.toHaveBeenCalled();
  });

  it('updates Mermaid source once on the existing component instance', () => {
    const initial = '```mermaid\ngraph TD; A-->B\n```';
    const updated = '```mermaid\ngraph TD; C-->D\n```';
    const view = render(
      <LanguageProvider><MemoryRouter><Markdown pages={pages}>{initial}</Markdown></MemoryRouter></LanguageProvider>,
    );
    const renderCount = mermaidMocks.MermaidDiagram.mock.calls.length;

    view.rerender(
      <LanguageProvider><MemoryRouter><Markdown pages={pages}>{updated}</Markdown></MemoryRouter></LanguageProvider>,
    );

    expect(mermaidMocks.MermaidDiagram).toHaveBeenCalledTimes(renderCount + 1);
    const lastCall = mermaidMocks.MermaidDiagram.mock.calls[mermaidMocks.MermaidDiagram.mock.calls.length - 1];
    expect(lastCall?.[0]).toEqual(
      expect.objectContaining({ source: 'graph TD; C-->D' }),
    );
    expect(mermaidMocks.mounted).toHaveBeenCalledOnce();
    expect(mermaidMocks.unmounted).not.toHaveBeenCalled();
  });

  it('contains wide rich content locally without clipping the Markdown document root', () => {
    const { container } = renderMd('```mermaid\ngraph TD; A-->B\n```\n\n$$x^2$$\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n![wide](/wide.png)');
    const root = container.firstElementChild;

    expect(root).toHaveClass('min-w-0');
    expect(root).not.toHaveClass('overflow-hidden');
    expect(root?.className).toContain('[&_.markdown-mermaid]:overflow-x-auto');
    expect(root?.className).toContain('[&_.markdown-mermaid_svg]:max-w-full');
    expect(root?.className).toContain('[&_.katex-display]:overflow-x-auto');
    expect(root?.className).toContain('[&_pre]:max-w-full');
    expect(root?.className).toContain('[&_table]:max-w-full');
    expect(root?.className).toContain('[&_img]:max-w-full');
  });

  it('renders external markdown links with target=_blank', () => {
    renderMd('[opencode](https://opencode.ai)');
    const link = screen.getByRole('link', { name: 'opencode' });
    expect(link).toHaveAttribute('href', 'https://opencode.ai');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('protects external HTTPS links when the URI scheme uses uppercase letters', () => {
    renderMd('[docs](HTTPS://example.com)');
    const link = screen.getByRole('link', { name: 'docs' });

    expect(link).toHaveAttribute('href', 'HTTPS://example.com');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('renders GFM bare-url autolinks as external', () => {
    renderMd('https://github.com/sst/opencode');
    const link = screen.getByRole('link', { name: 'https://github.com/sst/opencode' });
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('resolves [[wiki-link]] by title to an internal SPA link', () => {
    renderMd('See [[MyFirstPage]] for details');
    const link = screen.getByRole('link', { name: 'MyFirstPage' });
    expect(link).toHaveAttribute('href', '/pages/abc123');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('leaves unresolvable [[wiki-link]] as literal text', () => {
    renderMd('This [[没有此页]] stays text');
    expect(screen.queryByRole('link', { name: '没有此页' })).not.toBeInTheDocument();
    expect(screen.getByText(/\[\[没有此页\]\]/)).toBeInTheDocument();
  });

  it('renders internal /pages/{id} links opening in a new tab', () => {
    renderMd('[jump](/pages/abc123)');
    const link = screen.getByRole('link', { name: 'jump' });
    expect(link).toHaveAttribute('href', '/pages/abc123');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('handles multiple wiki-links in one paragraph', () => {
    renderMd('Link [[MyFirstPage]] and [[链接能力测试]] together');
    expect(screen.getByRole('link', { name: 'MyFirstPage' })).toHaveAttribute('href', '/pages/abc123');
    expect(screen.getByRole('link', { name: '链接能力测试' })).toHaveAttribute('href', '/pages/def456');
  });

  it('renders highlights, aliased wiki links, heading fragments and block anchors', () => {
    const { container } = renderMd('==marked== [[MyFirstPage|Shown]] [[MyFirstPage#Heading Name]]\n\nParagraph ^block-1');

    expect(screen.getByText('marked').tagName).toBe('MARK');
    expect(screen.getByRole('link', { name: 'Shown' })).toHaveAttribute('href', '/pages/abc123');
    expect(screen.getByRole('link', { name: 'MyFirstPage#Heading Name' })).toHaveAttribute('href', '/pages/abc123#heading-name');
    expect(container.querySelector('[id="^block-1"]')).toHaveClass('block-anchor');
    expect(container).not.toHaveTextContent('^block-1');
  });

  it('keeps wiki and highlight syntax literal inside inline and fenced code', () => {
    const { container } = renderMd('`==inline== [[MyFirstPage]]`\n\n```md\n==fenced== [[MyFirstPage]]\n```');

    expect(container.querySelector('mark')).toBeNull();
    expect(screen.queryByRole('link', { name: 'MyFirstPage' })).not.toBeInTheDocument();
    expect(screen.getByText('==inline== [[MyFirstPage]]')).toBeInTheDocument();
    expect(screen.getByText(/==fenced== \[\[MyFirstPage\]\]/)).toBeInTheDocument();
  });

  it('removes Callout metadata from body text and renders a neutral unknown type', () => {
    const { container } = renderMd('> [!custom] My title\n> Body text');
    const callout = container.querySelector('[data-callout="custom"]');

    expect(callout).toHaveClass('callout-neutral');
    expect(screen.getByText('My title')).toBeInTheDocument();
    expect(screen.getByText('Body text')).toBeInTheDocument();
    expect(container).not.toHaveTextContent('[!custom]');
  });

  it.each([
    ['+', true],
    ['-', false],
  ])('renders %s Callout folding as a keyboard-accessible control', (fold, initiallyExpanded) => {
    renderMd(`> [!note]${fold} Fold title\n> Fold body`);
    const toggle = screen.getByRole('button', { name: 'Fold title' });

    expect(toggle).toHaveAttribute('aria-expanded', String(initiallyExpanded));
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', String(!initiallyExpanded));
  });

  it('allows internal and HTTPS images, hardens external images, and rejects unsafe sources', () => {
    const { container } = renderMd('![internal](/api/assets/one.png)\n\n![external](https://cdn.example.com/two.png)\n\n![unsafe](data:image/png;base64,abc)\n\n![protocol](//cdn.example.com/three.png)');
    const internal = screen.getByRole('img', { name: 'internal' });
    const external = screen.getByRole('img', { name: 'external' });

    expect(internal).toHaveAttribute('src', '/api/assets/one.png');
    expect(external).toHaveAttribute('loading', 'lazy');
    expect(external).toHaveAttribute('decoding', 'async');
    expect(external).toHaveAttribute('referrerpolicy', 'no-referrer');
    expect(screen.getByText(/Image unavailable: unsafe/)).toBeInTheDocument();
    expect(screen.getByText(/Image unavailable: protocol/)).toBeInTheDocument();
    expect(container.querySelectorAll('img')).toHaveLength(2);
  });

  it('rejects mixed slash and backslash network image paths', () => {
    const { container } = renderMd('![mixed](/\\evil.example/x)');

    expect(screen.getByText('Image unavailable: mixed')).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
  });

  it('disables viewer tasks and delegates enabled page task changes to source refs', () => {
    const source = '- [ ] First task\n- [x] Second task';
    const viewer = renderMd(source);
    expect(screen.getAllByRole('checkbox')[0]).toBeDisabled();
    viewer.unmount();

    const onTaskToggle = vi.fn();
    render(
      <MemoryRouter>
        <Markdown pages={pages} mode="page" canEdit onTaskToggle={onTaskToggle}>{source}</Markdown>
      </MemoryRouter>,
    );
    const checkbox = screen.getAllByRole('checkbox')[0];
    expect(checkbox).toBeEnabled();
    expect(checkbox.closest('li')).toHaveAttribute('data-task-index', '0');

    fireEvent.click(checkbox);
    expect(onTaskToggle).toHaveBeenCalledWith({
      task: expect.objectContaining({ index: 0, checked: false, signature: 'First task' }),
      nextChecked: true,
    });
  });

  it('allows editor previews with a handler and disables pending tasks', () => {
    const source = '- [ ] Waiting';
    const onTaskToggle = vi.fn();
    const { rerender } = render(
      <MemoryRouter>
        <Markdown mode="editor-preview" onTaskToggle={onTaskToggle}>{source}</Markdown>
      </MemoryRouter>,
    );
    expect(screen.getByRole('checkbox')).toBeEnabled();

    rerender(
      <MemoryRouter>
        <Markdown mode="editor-preview" pendingTaskIndexes={new Set([0])} onTaskToggle={onTaskToggle}>{source}</Markdown>
      </MemoryRouter>,
    );
    expect(screen.getByRole('checkbox')).toBeDisabled();
  });
});
