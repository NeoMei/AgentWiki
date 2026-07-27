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
        <MemoryRouter initialEntries={['/spaces/space-1/runs']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <Routes><Route path="/spaces/:id/runs" element={<RunsPage />} /></Routes>
        </MemoryRouter>
      </LanguageProvider>,
    );
    await waitFor(() => expect(screen.getByText('Active')).toBeInTheDocument());
    expect(screen.getAllByTitle('Cancel run')).toHaveLength(1);
    expect(screen.getAllByTitle('Retry run')).toHaveLength(1);
  });
});
