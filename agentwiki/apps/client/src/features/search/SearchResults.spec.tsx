import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import api from '../../api/client';
import { LanguageProvider } from '../../context/LanguageContext';
import { SearchResults } from './SearchResults';
vi.mock('../../api/client', () => ({ default: { get: vi.fn() } }));
beforeEach(() => { vi.clearAllMocks(); localStorage.setItem('agentwiki.language.v1', 'en'); });
it('distinguishes text and semantic matches and keeps untyped old results scoreless', async () => {
  vi.mocked(api.get).mockResolvedValue({ data: { results: [
    { page: { id: 'text', title: 'Text result', spaceId: 's' }, similarity: 1, matchType: 'text' },
    { page: { id: 'semantic', title: 'Semantic result', spaceId: 's' }, similarity: .82, matchType: 'semantic' },
    { page: { id: 'old', title: 'Old result', spaceId: 's' }, similarity: 1 },
  ] } });
  render(<LanguageProvider><MemoryRouter><SearchResults /></MemoryRouter></LanguageProvider>);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'result' } });
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));
  expect(await screen.findByText('Text match')).toBeVisible();
  expect(screen.getByText('Semantic relevance: 82%')).toBeVisible();
  expect(screen.getByRole('link', { name: 'Old result' })).toHaveAttribute('href', '/pages/old');
  expect(screen.queryByText(/100%/)).not.toBeInTheDocument();
});

it('distinguishes same-title pages with their canonical paths and opens their own page IDs', async () => {
  vi.mocked(api.get).mockResolvedValue({ data: { results: [
    { page: { id: 'a', title: 'Weekly', spaceId: 's', space: { id: 's', name: 'Team' }, path: 'pages/Design/Weekly.md' } },
    { page: { id: 'b', title: 'Weekly', spaceId: 's', space: { id: 's', name: 'Team' }, path: 'pages/Engineering/Weekly.md' } },
    { page: { id: 'legacy-page', title: 'Weekly', spaceId: 's', path: null } },
  ] } });
  render(<LanguageProvider><MemoryRouter><SearchResults /></MemoryRouter></LanguageProvider>);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Weekly' } });
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));
  const design = await screen.findByText('pages/Design/Weekly.md');
  expect(within(design.closest('article')!).getByRole('link', { name: 'Weekly' })).toHaveAttribute('href', '/pages/a');
  const engineering = screen.getByText('pages/Engineering/Weekly.md');
  expect(within(engineering.closest('article')!).getByRole('link', { name: 'Weekly' })).toHaveAttribute('href', '/pages/b');
  expect(screen.getByText(/ID: legacy-page/)).toBeVisible();
});

const resultRows = (count: number) => Array.from({ length: count }, (_, index) => ({ page: { id: `p${index}`, title: `Result ${index}`, spaceId: 's' } }));

it('shows a loaded range without treating the legacy batch total as the match total and expands the submitted query', async () => {
  vi.mocked(api.get).mockResolvedValueOnce({ data: { results: resultRows(10), total: 10, limit: 10, maxLimit: 100, hasMore: true } })
    .mockResolvedValueOnce({ data: { results: resultRows(12), total: 12, limit: 20, maxLimit: 100, hasMore: false } });
  render(<LanguageProvider><MemoryRouter><SearchResults /></MemoryRouter></LanguageProvider>);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Original' } });
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));
  expect(await screen.findByRole('status')).toHaveTextContent('Showing 1–10');
  expect(screen.getByRole('status')).toHaveTextContent('total not counted');
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Unsubmitted edit' } });
  fireEvent.click(screen.getByRole('button', { name: 'Load more results' }));
  expect(await screen.findByRole('link', { name: 'Result 11' })).toBeVisible();
  expect(api.get).toHaveBeenLastCalledWith('/search', { params: { q: 'Original', limit: 20 } });
  expect(screen.getByRole('status')).toHaveTextContent('Showing 1–12');
  expect(screen.getByText('No more results for this search.')).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Load more results' })).not.toBeInTheDocument();
});

it('explains the result cap and directs users to narrow the query instead of claiming all results are loaded', async () => {
  vi.mocked(api.get).mockResolvedValue({ data: { results: resultRows(100), total: 100, limit: 100, maxLimit: 100, hasMore: true } });
  render(<LanguageProvider><MemoryRouter><SearchResults /></MemoryRouter></LanguageProvider>);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Result' } });
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));
  expect(await screen.findByText(/Only the first 100 results can be shown/)).toBeVisible();
  expect(screen.queryByText('No more results for this search.')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Load more results' })).not.toBeInTheDocument();
});
