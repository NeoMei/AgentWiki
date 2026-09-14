import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import api from '../../api/client';
import { LanguageProvider } from '../../context/LanguageContext';
import { SearchResults } from './SearchResults';
vi.mock('../../api/client', () => ({ default: { get: vi.fn() } }));
beforeEach(() => localStorage.setItem('agentwiki.language.v1', 'en'));
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
