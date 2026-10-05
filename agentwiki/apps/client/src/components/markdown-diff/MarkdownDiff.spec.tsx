import { cleanup, render, screen } from '@testing-library/react';
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
  });
});
