import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { Markdown } from './Markdown';
import { isExternalHref, isInternalPageHref, resolveWikiHref } from './markdownLinks';

const pages = [
  { id: 'abc123', title: 'MyFirstPage', slug: 'myfirstpage-abc' },
  { id: 'def456', title: '链接能力测试', slug: 'link-test-def' },
];

const renderMd = (content: string, p = pages) => render(<MemoryRouter><Markdown pages={p}>{content}</Markdown></MemoryRouter>);

describe('resolveWikiHref', () => {
  afterEach(cleanup);
  it('resolves by title, slug and id, case-insensitively', () => {
    expect(resolveWikiHref('MyFirstPage', pages)).toBe('/pages/abc123');
    expect(resolveWikiHref('myfirstpage-abc', pages)).toBe('/pages/abc123');
    expect(resolveWikiHref('abc123', pages)).toBe('/pages/abc123');
    expect(resolveWikiHref('链接能力测试', pages)).toBe('/pages/def456');
  });
  it('returns null for unknown names', () => {
    expect(resolveWikiHref('不存在', pages)).toBeNull();
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
    expect(link).not.toHaveAttribute('target');
  });

  it('leaves unresolvable [[wiki-link]] as literal text', () => {
    renderMd('This [[没有此页]] stays text');
    expect(screen.queryByRole('link', { name: '没有此页' })).not.toBeInTheDocument();
    expect(screen.getByText(/\[\[没有此页\]\]/)).toBeInTheDocument();
  });

  it('renders explicit internal /pages/{id} links as SPA links without target', () => {
    renderMd('[jump](/pages/abc123)');
    const link = screen.getByRole('link', { name: 'jump' });
    expect(link).toHaveAttribute('href', '/pages/abc123');
    expect(link).not.toHaveAttribute('target');
  });

  it('handles multiple wiki-links in one paragraph', () => {
    renderMd('Link [[MyFirstPage]] and [[链接能力测试]] together');
    expect(screen.getByRole('link', { name: 'MyFirstPage' })).toHaveAttribute('href', '/pages/abc123');
    expect(screen.getByRole('link', { name: '链接能力测试' })).toHaveAttribute('href', '/pages/def456');
  });
});
