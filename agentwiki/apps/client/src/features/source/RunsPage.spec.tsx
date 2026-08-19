import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import api from '../../api/client';
import { RunsPage } from './RunsPage';
import { LanguageProvider } from '../../context/LanguageContext';

vi.mock('../../api/client', () => ({ default: { get: vi.fn(), post: vi.fn() } }));

describe('RunsPage', () => {
  it('offers cancel only for active stages and retry for terminal retryable runs', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: [
      { id: 'active', status: 'fetching', stage: 'fetching', attempts: 1, maxAttempts: 3, createdAt: new Date().toISOString(), source: { name: 'Active' } },
      { id: 'partial', status: 'partial', stage: 'partial', attempts: 1, maxAttempts: 3, createdAt: new Date().toISOString(), source: { name: 'Partial' } },
    ] } as any);
    render(
      <LanguageProvider>
        <MemoryRouter initialEntries={['/spaces/space-1/runs']}>
          <Routes><Route path="/spaces/:id/runs" element={<RunsPage />} /></Routes>
        </MemoryRouter>
      </LanguageProvider>,
    );
    await waitFor(() => expect(screen.getByText('Active')).toBeInTheDocument());
    expect(screen.getAllByTitle('Cancel run')).toHaveLength(1);
    expect(screen.getAllByTitle('Retry run')).toHaveLength(1);
  });

  it('shows safe URL diagnostics without exposing a raw English failure', async () => {
    localStorage.setItem('agentwiki.language.v1', 'zh-CN');
    vi.mocked(api.get).mockResolvedValue({ data: [{
      id: 'url-run', status: 'failed', stage: 'failed', attempts: 3, maxAttempts: 3,
      createdAt: new Date().toISOString(), source: { name: '网页' }, error: 'Unsupported content type',
      result: { sourceMetadata: { finalUrl: 'https://example.com/article', contentType: 'text/html', redirectCount: 1 } },
    }] } as any);
    render(
      <LanguageProvider><MemoryRouter initialEntries={['/spaces/space-1/runs']}>
        <Routes><Route path="/spaces/:id/runs" element={<RunsPage />} /></Routes>
      </MemoryRouter></LanguageProvider>,
    );
    expect(await screen.findByText('https://example.com/article')).toBeInTheDocument();
    expect(screen.getByText(/1 次重定向/)).toBeInTheDocument();
    expect(screen.queryByText('Unsupported content type')).not.toBeInTheDocument();
  });
});
