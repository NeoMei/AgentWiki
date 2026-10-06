import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLanguage } from '../../context/LanguageContext';
import { MarkdownDiff } from './MarkdownDiff';
vi.mock('../../context/LanguageContext', () => ({ useLanguage: vi.fn() }));
afterEach(cleanup);
beforeEach(() => vi.mocked(useLanguage).mockReturnValue({ language: 'en' } as ReturnType<typeof useLanguage>));
describe('Markdown source diff', () => {
  it('provides textual addition/removal/unchanged labels and escapes HTML', () => {
    const { container } = render(<MarkdownDiff before={'# Same\nold'} after={'# Same\n<script>literal</script>'} />);
    expect(screen.getByLabelText('Markdown diff')).toBeInTheDocument();
    expect(screen.getByText('Unchanged')).toBeInTheDocument();
    expect(screen.getByText('Removed')).toBeInTheDocument();
    expect(screen.getByText('Added')).toBeInTheDocument();
    expect(screen.getByText('<script>literal</script>')).toBeInTheDocument();
    expect(container.querySelector('script')).toBeNull();
  });
  it('labels an incomplete long document preview honestly', () => {
    render(<MarkdownDiff before={'a\n'.repeat(1000)} after={'b\n'.repeat(1000)} />);
    expect(screen.getByRole('status')).toHaveTextContent('Download both full texts to review before accepting');
    expect(screen.getAllByRole('listitem')).toHaveLength(600);
  });
  it('uses bilingual accessible textual labels', () => {
    vi.mocked(useLanguage).mockReturnValue({ language: 'zh-CN' } as ReturnType<typeof useLanguage>);
    render(<MarkdownDiff before="旧内容" after="新内容" />);
    expect(screen.getByLabelText('Markdown 差异')).toBeInTheDocument();
    expect(screen.getByText('删除')).toBeInTheDocument();
    expect(screen.getByText('新增')).toBeInTheDocument();
    expect(screen.getByText('新增 1 行，删除 1 行')).toBeVisible();
  });
  it('labels Chinese incomplete context controls and no-change messages honestly', () => {
    vi.mocked(useLanguage).mockReturnValue({ language: 'zh-CN' } as ReturnType<typeof useLanguage>);
    render(<MarkdownDiff before={'same\n'.repeat(320)} after={'same\n'.repeat(321)} />);
    expect(screen.getByText('预览：新增 0 行，删除 0 行')).toBeVisible();
    expect(screen.getByText('显示范围内没有变更。')).toBeVisible();
    fireEvent.click(screen.getByRole('button', {name: '展开 300 行未改动内容'}));
    expect(screen.getByRole('button', {name: '收起 300 行未改动内容'})).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', {name: '显示完整预览'})).toHaveAttribute('aria-pressed', 'false');
  });
  it('focuses a late change with exactly three neighboring unchanged lines and reversible context', () => {
    const lines = Array.from({ length: 80 }, (_, i) => `line ${i}`);
    const after = [...lines]; after[60] = 'changed late';
    render(<MarkdownDiff before={lines.join('\n')} after={after.join('\n')} />);
    expect(screen.getByText('changed late')).toBeVisible();
    expect(screen.getByText('line 57')).toBeVisible();
    expect(screen.getByText('line 63')).toBeVisible();
    expect(screen.queryByText('line 56')).not.toBeInTheDocument();
    expect(screen.queryByText('line 64')).not.toBeInTheDocument();
    const expand = screen.getByRole('button', { name: 'Show 57 unchanged lines' });
    expect(expand).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(expand);
    expect(screen.getByText('line 0')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Hide 57 unchanged lines' }));
    expect(screen.queryByText('line 0')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show full preview' }));
    expect(screen.getByText('line 79')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Focus on changes' }));
    expect(screen.queryByText('line 79')).not.toBeInTheDocument();
  });
  it('resets full mode and expanded gaps when source inputs change', () => {
    const before = Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n');
    const ui = render(<MarkdownDiff before={before} after={before.replace('line 30', 'change A')} />);
    fireEvent.click(screen.getByRole('button', { name: 'Show 27 unchanged lines' }));
    ui.rerender(<MarkdownDiff before={before} after={before.replace('line 30', 'change B')} />);
    expect(screen.queryByText('line 0')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show full preview' }));
    ui.rerender(<MarkdownDiff before={before} after={before.replace('line 30', 'change C')} />);
    expect(screen.queryByText('line 0')).not.toBeInTheDocument();
    expect(screen.getByText('change C')).toBeVisible();
  });
  it('counts only the bounded preview and does not deny invisible changes', () => {
    const before = Array.from({ length: 320 }, (_, i) => `line ${i}`).join('\n');
    const ui = render(<MarkdownDiff before={before} after={`${before}\nhidden addition`} />);
    expect(screen.getByText('Preview: 0 added lines, 0 removed lines')).toBeVisible();
    expect(screen.getByText('No changes in the displayed portion.')).toBeVisible();
    expect(screen.queryByText('No changes.')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show full document' })).not.toBeInTheDocument();
    ui.rerender(<MarkdownDiff before={'a'.repeat(100_000)} after={`${'a'.repeat(100_000)}hidden`} />);
    expect(screen.getByText('No changes in the displayed portion.')).toBeVisible();
    ui.rerender(<MarkdownDiff before="same" after="same" />);
    expect(screen.getByText('No changes.')).toBeVisible();
    ui.rerender(<MarkdownDiff before={'old\n'.repeat(320)} after={'new\n'.repeat(320)} />);
    expect(screen.getByText('Preview: 300 added lines, 300 removed lines')).toBeVisible();
  });
});
