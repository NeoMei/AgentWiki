import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Markdown } from './Markdown';
import { isExternalHref, isInternalPageHref, resolveWikiHref } from './markdownLinks';
import { parseWikiReference } from './markdown/obsidian';

const pages = [
  { id: 'abc123', title: 'MyFirstPage', slug: 'myfirstpage-abc' },
  { id: 'def456', title: '链接能力测试', slug: 'link-test-def' },
];

const renderMd = (content: string, p = pages) => render(<MemoryRouter><Markdown pages={p}>{content}</Markdown></MemoryRouter>);

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

  it('renders external markdown links with target=_blank', () => {
    renderMd('[opencode](https://opencode.ai)');
    const link = screen.getByRole('link', { name: 'opencode' });
    expect(link).toHaveAttribute('href', 'https://opencode.ai');
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
