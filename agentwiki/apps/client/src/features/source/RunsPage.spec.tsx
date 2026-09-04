import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../../api/client';
import { RunsPage } from './RunsPage';
import { LanguageProvider } from '../../context/LanguageContext';

vi.mock('../../api/client', () => ({ default: { get: vi.fn(), post: vi.fn() } }));

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};

const run = (id: string, name: string, status = 'completed') => ({
  id, status, stage: status, attempts: 1, maxAttempts: 3,
  createdAt: new Date().toISOString(), source: { name },
});

const renderPage = () => render(
  <LanguageProvider><MemoryRouter initialEntries={['/spaces/space-1/runs']}>
    <Routes><Route path="/spaces/:id/runs" element={<RunsPage />} /></Routes>
  </MemoryRouter></LanguageProvider>,
);

const SpaceSwitcher = () => {
  const navigate = useNavigate();
  return <button onClick={() => navigate('/spaces/space-2/runs')}>Switch space</button>;
};

describe('RunsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.removeItem('agentwiki.language.v1');
    vi.mocked(api.post).mockResolvedValue({ data: {} });
  });

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
      result: { sourceMetadata: {
        finalUrl: 'https://viewer:password@example.com/article?token=top-secret#private-fragment',
        contentType: 'text/html',
        redirectCount: 1,
      } },
    }] } as any);
    render(
      <LanguageProvider><MemoryRouter initialEntries={['/spaces/space-1/runs']}>
        <Routes><Route path="/spaces/:id/runs" element={<RunsPage />} /></Routes>
      </MemoryRouter></LanguageProvider>,
    );
    expect(await screen.findByText('https://example.com/article')).toBeInTheDocument();
    expect(screen.getByText(/1 次重定向/)).toBeInTheDocument();
    expect(screen.queryByText('Unsupported content type')).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('top-secret');
    expect(document.body).not.toHaveTextContent('password');
    expect(document.body).not.toHaveTextContent('private-fragment');
  });

  it('keeps the newest refresh result when an older request finishes later', async () => {
    const oldRequest = deferred<any>();
    const newRequest = deferred<any>();
    vi.mocked(api.get)
      .mockResolvedValueOnce({ data: [run('initial', 'Initial')] })
      .mockReturnValueOnce(oldRequest.promise)
      .mockReturnValueOnce(newRequest.promise);
    renderPage();
    expect(await screen.findByText('Initial')).toBeInTheDocument();

    const refresh = screen.getByTitle('Refresh runs');
    fireEvent.click(refresh);
    fireEvent.click(refresh);
    await act(async () => newRequest.resolve({ data: [run('new', 'Newest')] }));
    expect(await screen.findByText('Newest')).toBeInTheDocument();
    await act(async () => oldRequest.resolve({ data: [run('old', 'Stale')] }));

    expect(screen.getByText('Newest')).toBeInTheDocument();
    expect(screen.queryByText('Stale')).not.toBeInTheDocument();
  });

  it('sends only one retry action while it is pending', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: [run('failed-run', 'Failed source', 'failed')] });
    const request = deferred<any>();
    vi.mocked(api.post).mockReturnValue(request.promise);
    renderPage();
    const retry = await screen.findByTitle('Retry run');

    fireEvent.click(retry);
    fireEvent.click(retry);

    expect(api.post).toHaveBeenCalledTimes(1);
    expect(retry).toBeDisabled();
    request.resolve({ data: {} });
    await waitFor(() => expect(retry).not.toBeDisabled());
  });

  it('shows loading instead of an empty state before the initial request finishes', () => {
    vi.mocked(api.get).mockReturnValue(new Promise(() => {}));
    renderPage();

    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(screen.queryByText('No ingestion runs yet')).not.toBeInTheDocument();
  });

  it('does not let an action from the previous route supersede the new Space load', async () => {
    const action = deferred<any>();
    vi.mocked(api.get).mockImplementation(async (url) => ({
      data: String(url).includes('space-2')
        ? [run('space-2-run', 'Space Two')]
        : [run('space-1-run', 'Space One', 'failed')],
    }));
    vi.mocked(api.post).mockReturnValue(action.promise);
    render(
      <LanguageProvider><MemoryRouter initialEntries={['/spaces/space-1/runs']}>
        <SpaceSwitcher /><Routes><Route path="/spaces/:id/runs" element={<RunsPage />} /></Routes>
      </MemoryRouter></LanguageProvider>,
    );
    fireEvent.click(await screen.findByTitle('Retry run'));
    fireEvent.click(screen.getByRole('button', { name: 'Switch space' }));
    expect(await screen.findByText('Space Two')).toBeInTheDocument();

    await act(async () => action.resolve({ data: {} }));

    expect(screen.getByText('Space Two')).toBeInTheDocument();
    expect(screen.queryByText('Space One')).not.toBeInTheDocument();
    expect(api.get).toHaveBeenCalledTimes(2);
  });
});
